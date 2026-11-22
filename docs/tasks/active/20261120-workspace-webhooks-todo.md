# Workspace webhooks

Design: [`docs/design/webhooks.md`](../../design/webhooks.md). Outbound,
owner-managed webhooks per workspace; thin signed events as a re-fetch
signal. This file tracks the design phase and the Phase 1 plan; Phases 2–3
get their own task files when they start.

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
- [ ] Decide before Phase 1: `WAFFLEBASE_SECRETS_ENCRYPTION_KEY` vs reusing
      `DATASOURCE_ENCRYPTION_KEY`
- [ ] Decide: first-consumer target (no-code vs. own servers) — drives
      whether a Slack `format` lands in Phase 2 or 3
- [ ] Review the design doc (PR)

## Phase 1 — foundations + lifecycle events

Backend
- [ ] `common/safe-outbound.ts`: https-only, resolve-all + private-range
      refusal, pinned lookup, `redirect: 'manual'`, size cap; tests for
      rebinding, redirect, IPv4-mapped IPv6, metadata host; CIDR / HTTP
      overrides failing closed
- [ ] Prisma `Webhook` + `WebhookDelivery` (+ migration)
- [ ] Standard Webhooks signer (`webhook-id` stable across attempts)
- [ ] Outbox worker: `SKIP LOCKED` claim, lease expiry, per-webhook
      concurrency 2, retry schedule, `WAFFLEBASE_WEBHOOKS_ENABLED`
- [ ] `WebhookEventService.emit()` called from services with an `actor`;
      `document.*`, `folder.*`, `member.*`, `webhook.test`; one visibility
      filter at emit time (chat-ready)
- [ ] `document.created` `source` (`blank|copy|template|upload|import`);
      inline member fields (`id, username, email, role, kind`); folder
      `{ id, name }` in document payloads
- [ ] `member.joined` from every membership path: `acceptInvite`,
      `WorkspaceService.create`, `createUserWithWorkspace`,
      `claimGithubWorkspaces`
- [ ] Extract `chat-bus.ts` listener into a shared `LISTEN/NOTIFY` bus;
      worker wakes on `webhook` channel
- [ ] Disable creator's webhooks inside `removeMember`
- [ ] Owner-only JWT routes `workspaces/:wid/webhooks` (CRUD, test,
      reveal-secret, deliveries); members get a host-only read list; 404
      across workspaces
- [ ] Contract test: web and `/api/v1` paths both emit
- [ ] Integration test: two workers never double-send

Frontend
- [ ] Settings → `#webhooks` list section after Data sources (outline add
      button, hash anchoring like `#datasources`)
- [ ] Detail page `/w/:wid/settings/webhooks/:id`: config, secret
      reveal/copy, delivery log (failed filter, expandable rows, cards on
      phone)
- [ ] Event picker with four use-case presets over the grouped list
- [ ] Create flow with inline test result; SSRF errors that name the env var
- [ ] Feature-off muted section for owners
- [ ] Member-removal confirm dialog naming deleted private channels and
      affected webhooks (can ship ahead of webhooks as its own PR)
- [ ] Before → After captures for Settings at 393×659

Docs
- [ ] Backend README env vars; docs site page with a verification snippet

## Review

_(filled in at the end)_
