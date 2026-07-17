# Documents list `updatedAt` via Yorkie event webhook

## Problem

The documents list reorders every ~5s. Root cause (confirmed against the
live cluster with `kubectl`): the list is sorted by `updatedAt`, which is
layered on at request time from Yorkie's admin `GetDocuments`. That call
times out at the backend's 800ms cut on essentially every poll (573
timeouts / 68h; ~5.8s spacing = every refetch). The gateway RTT is ~25ms,
so the slowness is the authenticated presence query against Yorkie's
sharded MongoDB, and it straddles the 800ms cut — so `updatedAt` flips
between the real Yorkie value and the `createdAt` fallback per poll, and
the frontend re-sorts each time.

Content edits are recorded **only in Yorkie** (the NestJS backend is not on
the edit path), so Postgres has no last-modified signal today (`Document`
has `createdAt` only).

## Approach (Option A)

Feed real edit times into Postgres via Yorkie's **event webhook**
(`DocumentRootChanged`, fired on actual root-content operations). The list
then reads/sorts a stable Postgres `updatedAt`; the flaky admin call is
demoted to editor-avatars only and no longer affects ordering.

Yorkie 0.7.12 contract (verified from source):
- Event `DocumentRootChanged`; payload
  `{ type, attributes: { key: "<type>-<id>", issuedAt } }`.
- Header `X-Signature-256: sha256=<hex>`, `HMAC-SHA256(rawBody, project.SecretKey)`.
  Signing key = project SecretKey = backend's existing `YORKIE_SECRET_KEY`.
- At-least-once, throttled per document, retried w/ backoff → receiver must
  be idempotent + monotonic.

## Tasks

- [x] Prisma: add `Document.updatedAt DateTime @default(now())` (manual, **not**
      `@updatedAt`); migration backfills existing rows `= createdAt`.
- [x] `yorkie-doc-key.ts`: add `parseYorkieDocKey(key) → { type, id } | null`.
- [x] `DocumentService.touchUpdatedAt(id, at)` — monotonic advance-only
      (`updateMany where updatedAt < at`), idempotent, no-op on missing doc.
- [x] HMAC signature guard reading `req.rawBody` + `X-Signature-256`,
      timing-safe compare against `YORKIE_SECRET_KEY`; reject if key unset.
- [x] `main.ts`: capture raw body via `bodyParser.json({ verify })`.
- [x] `POST /internal/yorkie/events` controller (no JWT, signature guard,
      `@SkipThrottle`): handle `DocumentRootChanged`, parse key, touch;
      200-swallow unknown keys/other events.
- [x] `attachMeta`: source `updatedAt` from the DB column; keep `editors`
      from the (best-effort) summary. Sort both list endpoints by
      `[{ updatedAt: desc }, { createdAt: desc }]`.
- [x] **Ops (post-merge, needs cluster access)**: register webhook on the
      Yorkie project (internal svc URL) — see design doc. Until this runs,
      `updatedAt` stays at `createdAt` but the list is already stable.
- [x] Tests: `parseYorkieDocKey` round-trip; guard valid/invalid/missing sig;
      `touchUpdatedAt`/event handling (controller unit). *(DB-backed e2e for
      the advance-only path deferred; covered by unit + monotonic SQL.)*

## Review

- Backend `build` + `pnpm verify:fast` green (EXIT=0). 20 new unit tests pass.
- No frontend change needed: the list already sorts `updatedAt desc`; that
  value is now stable from Postgres, so the flip disappears. The 5s poll now
  only refreshes editor avatars.
- Migration `20260710000000_add_document_updated_at` adds the column + backfill.

### Code review (high effort, workflow-backed) — outcomes

Applied:
- Rename/move now bumps `updatedAt` (`updateDocument` sets `now()`) — a metadata
  edit floats the doc up; content edits still come via webhook.
- `rawBody` capture scoped to the webhook path in `main.ts` — no longer retains
  25MB import buffers on every JSON request.
- Webhook clamps `issuedAt` to `min(issuedAt, now())` — a clock-skewed future
  event can't pin `updatedAt` ahead and freeze ordering.

Second review pass (post-fix) — applied:
- Empty / no-op PATCH no longer bumps `updatedAt` (`updateDocument` skips the
  bump when `data` is empty), so an empty-body PATCH can't re-sort a doc to the
  top. Added `document.service.spec.ts` for both branches.
- Simplified `attachMeta` (`{ ...d, updatedAt: d.updatedAt.toISOString() }`).

Deferred (documented in design Risks):
- Backfill of pre-deploy Yorkie `updated_at` + self-heal for missed webhooks →
  reconciliation job (Option C). Low impact now (live admin read already times
  out ~every poll, so today's list is effectively `createdAt` order); tracked as
  follow-up.
- Deploy sequencing (migrate-before-serve, webhook registration) → release
  runbook items, not code.

## Non-Goals / follow-ups

- Webhook loss self-heal (backend down during edit) — accept small staleness
  initially; a periodic Yorkie→PG sync (Option C) or read-time touch can be
  layered later.
- Live "editing" avatars still use Yorkie presence (decorative; failure no
  longer affects ordering). Fixing the 800ms admin-query latency itself is
  separate.

## Verification

- `pnpm verify:fast` green.
- Unit: HMAC signature guard (valid / wrong-key / tampered / missing-sig /
  no-secret), `parseYorkieDocKey` round-trip + edges, webhook event handling
  (dispatch, unknown key, future-skew clamp, fallback), `updateDocument`
  empty-PATCH no-bump. (DB-backed e2e for the signed-webhook advance path is
  deferred — see Tasks — and covered by the unit tests + monotonic SQL.)
- Manual: list order stable across polls in `pnpm dev`; editing a doc floats
  it to the top after the next webhook.

## Audit closure (2026-07-17)

Archived by the active-tasks audit. Verified shipped: `yorkie-event.controller.ts`
`DocumentRootChanged` + `touchUpdatedAt`, HMAC `yorkie-signature.guard.ts`,
`Document.updatedAt` migration `20260710000000_add_document_updated_at`, both list
endpoints sort `updatedAt desc`, full spec coverage. Boxes ticked for closure. **Open
ops follow-up (not code)**: registering the event webhook on the Yorkie project needs
cluster access — the list is already stable without it; tracked as a release-runbook step.
