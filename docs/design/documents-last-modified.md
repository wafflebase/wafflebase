---
title: documents-last-modified
target-version: 0.5.0
---

# Documents List — Last-Modified Ordering

## Summary

The documents list orders by "last modified". Content edits, however, flow
**client → Yorkie only** — the NestJS backend is not on the edit path, so
Postgres has no edit signal (`Document` historically had `createdAt` only).

The list previously synthesized `updatedAt` per request from Yorkie's admin
`GetDocuments` call. That call is slow and variable (authenticated presence
query against a sharded MongoDB) and straddles the backend's 800 ms timeout,
so `updatedAt` flipped between the real Yorkie value and a `createdAt`
fallback on each 5 s poll — the list visibly reshuffled. (Confirmed on the
live cluster: gateway RTT ~25 ms, but the admin query timed out ~every poll.)

This design moves last-modified into a stable Postgres column fed by Yorkie's
**event webhook**, and demotes the admin call to editor-avatars only.

## Goals / Non-Goals

**Goals**
- Stable documents-list ordering that still reflects real edit recency.
- No per-request dependency on the flaky Yorkie admin call for ordering.

**Non-Goals**
- Self-healing missed webhooks (backend down mid-edit) — accept small
  staleness; a periodic Yorkie→PG sync can be layered later.
- Fixing the underlying Yorkie admin-query latency (separate concern; the
  "currently editing" avatars remain best-effort over it).

## Proposal Details

### Data model
`Document.updatedAt DateTime @default(now())` — set **explicitly** (not
Prisma `@updatedAt`). Migration backfills existing rows `= createdAt`. List
endpoints order by `[{ updatedAt: desc }, { createdAt: desc }]`.

### Ingestion — Yorkie event webhook (yorkie 0.7.12)
- Event `DocumentRootChanged`, fired on real root-content operations (not
  presence/attach/watch).
- Body: `{ type, attributes: { key: "<type>-<id>", issuedAt } }`.
- Auth: `X-Signature-256: sha256=<hex>`, `HMAC-SHA256(rawBody, project.SecretKey)`.
  The signing key **is** the project secret key, already held by the backend
  as `YORKIE_SECRET_KEY` — no new secret. Raw request bytes are captured via a
  `bodyParser.json({ verify })` hook (HMAC must run over exact bytes).
- Endpoint `POST /internal/yorkie/events` — no JWT, `YorkieSignatureGuard`,
  `@SkipThrottle`. Parses the key (`parseYorkieDocKey`), then
  `DocumentService.touchUpdatedAt(id, issuedAt)`.
- Delivery is at-least-once, unordered, retried → `touchUpdatedAt` is
  **monotonic** (`updateMany where updatedAt < at`) and idempotent; unknown
  keys / other events / missing docs are 200-swallowed so Yorkie won't retry.

### Read path
`attachMeta` sources `updatedAt` from the DB column and uses
`YorkieAdminService.getEditors` purely for the avatars. The frontend keeps its
`updatedAt desc` default sort, which is now stable because the value is.

### Ops
Register the webhook on the Yorkie project (internal cluster URL, no public
exposure):

```shell
yorkie project update <project> \
  --event-webhook-url http://wafflebase.wafflebase.svc.cluster.local:3000/internal/yorkie/events \
  --event-webhook-events DocumentRootChanged
```

### Non-content updates
Rename / move never touch Yorkie, so no webhook fires. `DocumentService.updateDocument`
therefore sets `updatedAt = now()` explicitly on every **non-empty** metadata
update, so a rename still floats the document to the top like any edit. An
empty / no-op PATCH (no fields to change) skips the bump so it can't spuriously
re-sort the document.

### Clock skew
`issuedAt` is Yorkie's server clock. The webhook clamps it to `min(issuedAt, now())`
before storing — a future-skewed event must not pin `updatedAt` ahead, which
(with the monotonic guard) would reject every later real edit until wall-clock
caught up.

## Risks and Mitigation

- **Duplicate / out-of-order events** → monotonic advance-only update absorbs.
- **Forged requests** → HMAC signature verification is mandatory; the endpoint
  refuses to run when `YORKIE_SECRET_KEY` is unset.
- **`pdf` documents** have no CRDT edits → no webhook → stay at `createdAt`,
  which is correct.
- **Backfill of pre-deploy edit history** → the migration seeds existing rows to
  `createdAt`, discarding any real Yorkie `updated_at`. Low impact in the current
  deployment (the live admin read times out on ~every poll today, so the list
  already effectively shows `createdAt` order), but not authoritative against a
  healthy Yorkie. **Follow-up:** a one-time / periodic reconciliation job that
  batch-reads Yorkie `updated_at` → `touchUpdatedAt` (Option C) both seeds
  history and self-heals missed webhooks.
- **Missed webhook** (backend down mid-edit, or Yorkie retries exhausted) →
  `updatedAt` stays stale for that doc with no in-app recovery until its next
  edit. Same reconciliation follow-up closes this.
- **Deploy sequencing** → the list query reads/sorts the new column, so
  `prisma migrate deploy` must run before the new image serves traffic, and the
  Yorkie project webhook must be registered (see ops step) or `updatedAt` never
  advances. Both are release-runbook items, not code paths.
