# Workspace webhooks

Design: [`docs/design/webhooks.md`](../../design/webhooks.md). Outbound,
owner-managed webhooks per workspace; thin signed events as a re-fetch
signal. This file tracks the design phase and Phases 1–2, which ship in one
PR (built by five parallel lanes, then integrated). The audit pack, chat
events and the event feed get their own task files when they start.

## Design (this branch)

- [x] Competitor survey (collab tools, storage platforms, delivery infra) and
      internal audit (Yorkie event webhook, notifications, API keys, SSRF
      precedents)
- [x] UX review of the proposal; fold its corrections in (no `pending`
      state, revealable secret, `name` + `format` fields, list section +
      detail page, Slack-incoming-webhook claim dropped)
- [x] `docs/design/webhooks.md` + design README index entry
- [x] Rebase onto main after chat (#1186/#1189) and settings data sources
      (#1188): chat events (public only, Phase 3), all `member.joined`
      paths, `LISTEN/NOTIFY` wake-up, `#webhooks` section, member-removal
      confirm now also covers private-channel deletion, target 0.7.0
- [x] Use cases (team feed, backup, agent trigger, search index, joiner /
      leaver, sheet-as-database, audit, chat relay) and what they change:
      folder filter → Phase 2, `api_writers` loop guard, `document.created`
      `source`, inline member fields, audit pack as Phase 3, use-case
      presets in the event picker
- [x] Decide before Phase 1: `WAFFLEBASE_SECRETS_ENCRYPTION_KEY` vs reusing
      `DATASOURCE_ENCRYPTION_KEY` — the new key, falling back to the old one
- Follow-up (not this PR): decide the first-consumer target (no-code vs.
  own servers), which drives when a Slack `format` lands
- [x] Review the design doc (PR #1191)

## Phase 1 — foundations + lifecycle events

Backend
- [x] `common/safe-outbound.ts`: https-only, resolve-all + private-range
      refusal, pinned lookup, `redirect: 'manual'`, size cap; tests for
      rebinding, redirect, IPv4-mapped IPv6, metadata host; CIDR / HTTP
      overrides failing closed
- [x] Prisma `Webhook` + `WebhookDelivery` (+ migration)
- [x] Standard Webhooks signer (`webhook-id` stable across attempts)
- [x] Outbox worker: `SKIP LOCKED` claim, lease expiry, per-webhook
      concurrency 2, retry schedule, `WAFFLEBASE_WEBHOOKS_ENABLED`
- [x] `WebhookEventService.emit()` called from services with an `actor`;
      `document.*`, `folder.*`, `member.*`, `webhook.test`; one visibility
      filter at emit time (chat-ready)
- [x] `document.created` `source` (`blank|copy|template|upload|import`);
      inline member fields (`id, username, email, role, kind`); folder
      `{ id, name }` in document payloads
- [x] `member.joined` from every membership path: `acceptInvite`,
      `WorkspaceService.create`, `createUserWithWorkspace`,
      `claimGithubWorkspaces`
- [x] Extract `chat-bus.ts` listener into a shared `LISTEN/NOTIFY` bus;
      worker wakes on `webhook` channel
- [x] Disable creator's webhooks inside `removeMember`
- [x] Owner-only JWT routes `workspaces/:wid/webhooks` (CRUD, test,
      reveal-secret, deliveries); members get a host-only read list; 404
      across workspaces
- [x] Contract test: web and `/api/v1` paths both emit
- [x] Integration test: two workers never double-send

Frontend
- [x] Settings → `#webhooks` list section after Data sources (outline add
      button, hash anchoring like `#datasources`)
- [x] Detail page `/w/:wid/settings/webhooks/:id`: config, secret
      reveal/copy, delivery log (failed filter, expandable rows, cards on
      phone)
- [x] Event picker with four use-case presets over the grouped list
- [x] Create flow with inline test result; SSRF errors that name the env var
- [x] Feature-off muted section for owners
- [x] Member-removal confirm dialog naming deleted private channels and
      affected webhooks (can ship ahead of webhooks as its own PR)
- [x] Before → After captures for Settings at 393×659 (`assets/pr-1191`)

Docs
- [x] Backend README env vars; docs site page with a verification snippet

## Phase 2 — content and operations (same PR)

- [x] `WebhookContentPending` intake from `DocumentRootChanged` (upsert only)
      and worker flush on quiet (60 s) / max wait (5 m), env-tunable
- [x] `api_writers` loop guard: `ApiKeyStrategy` → `apiKeyId`, global
      `ApiWriterInterceptor` → `YorkieService.withDocument`
- [x] Folder filter (`folderIds`) in emit, API, CLI and the create/edit form
- [x] Secret rotation with a two-secret overlap; refused during an overlap
- [x] Auto-disable after 3 days (span ≥ 12 h) with `webhook_failing` at 2 days
      and `webhook_disabled`, to every owner
- [x] Redeliver (same `webhook-id`) and recover-since on re-enable
- [x] CLI `wafflebase webhooks …` + registry safety + plugin guard table
- [x] 30-day delivery purge
- [x] Docs-site recipes: team feed (1), backup (2), agent loop guard (3),
      sheet-range diff (6)
- Follow-up (not this PR): measure Yorkie's `DocumentRootChanged` throttle
  before tuning the windows (unmeasured; env vars cover it)

## Integration (after the parallel lanes)

- [x] Wire `WebhookEventModule` into document / api-v1 / folder / workspace /
      user / yorkie modules; register `ApiWriterInterceptor` globally
- [x] `apiKeyId` on API-key requests
- [x] Manual disable fails queued rows; test sends carry the actor
- [x] Secrets-key check: boot log + `503 secrets_key_missing`
- [x] `ROUTE_TITLES` entry for the detail page
- [x] Boot the built server against a scratch DB and send real events to a
      local receiver (signatures verified)
- [x] Review: one two-lens round (correctness/tests, security/design) in the
      workflow, 7 blocking fixed in `e09398275`; the `/self-review` skill
      itself was not run, and one non-blocking finding (API write not
      extending the window) was fixed afterwards in `62ea82f81`
- [x] UI pass against the built backend found a false http:// error under
      saved webhooks; fixed in `33654698d`

## Review

Built as five concurrent lanes (SSRF + signer, worker, events, management API
+ CLI, frontend) against a contract fixed in the foundation commit, then
integrated in one tree.

What the integration had to fix: the event lane injected
`WebhookEventService` into five modules that did not import it (Nest would
have failed at boot for three, and silently emitted nothing for the two that
used `@Optional()`); the API key id never reached the request, so the loop
guard recorded nothing; the interceptor was not registered; a manual disable
left queued rows to flush on re-enable; and a deployment that turned the
feature on without an encryption key answered creates with a bare 500.

Verification: backend unit (147 suites), every backend e2e suite against a
scratch database and a private Yorkie (20 suites, including the two-worker
no-double-send run), frontend lint + tests, CLI typecheck + tests, frontend
build + chunk gate, docs-site build, and a live run of the built server: SSRF
refusal with the resolved address, create with an inline test, then
`document.created` / `renamed` / `trashed` received with verified signatures
and the delivery log showing each as delivered. The docs verification snippet
was run against the real signer, including a two-secret rotation.

Not done here: Before → After mobile captures, `/self-review`, and measuring
Yorkie's throttle. See the design doc's *As built* for deviations.
