---
title: webhooks
target-version: 0.7.0
---

# Workspace Webhooks

## Summary

Wafflebase can be driven from outside (`/api/v1`, the CLI, the Claude
plugin) but cannot tell anything outside that something happened. An
integration that wants to react to a new document, a member joining or a
sheet being edited has to poll. This design adds **outbound webhooks scoped
to a workspace**: an owner registers an HTTPS endpoint, picks event types,
and Wafflebase POSTs a signed, thin event to it.

The one idea the rest follows from: a webhook is **a signal to re-fetch, not
a data channel**. Every collaborative-document product surveyed (Notion,
Figma, Google Drive, Microsoft Graph, Dropbox, Airtable) arrived there, and
it is what makes our real constraints harmless — the Yorkie change stream
carries no actor, delivery is unordered and can be lost, and CRDT state is
large and always moving. The existing `/api/v1` re-checks access and
returns current state; the webhook only says *where to look*.

The real build is two backend foundations the feature needs and does not
yet have: a Postgres **outbox worker** (Wafflebase's first general job
queue) and an **SSRF guard** for requests to user-supplied URLs (its first
general egress control). Both outlive webhooks — the worker can later run
notification retention and reconciliation; the guard closes the same hole
in the datasource `host`.

### Goals

- An owner can register, test, pause and delete webhooks for a workspace
  from Settings and from the CLI.
- Lifecycle events the backend itself performs (`document.*`, `folder.*`,
  `member.*`) are delivered at least once, signed per Standard Webhooks.
- Content edits arrive as one coalesced `document.content_updated` per
  document, not one per keystroke.
- A failing endpoint is visible, explained in plain words, and disabled
  before it piles up work — with a warning first.
- A self-hosted deployment cannot be turned into an SSRF proxy by default,
  and an operator can deliberately allow internal targets.

### Non-Goals

- **Content in payloads.** No cell values, text, or diffs. Consumers fetch
  through `/api/v1`.
- **Per-document subscriptions.** Membership already grants read on every
  document in a workspace, so a narrower subscription is a filter, not a
  security boundary. The *folder* filter is the exception: the
  team-channel use case below needs it, so it lands in Phase 2.
- **Which cells, slides or paragraphs changed.** The Yorkie stream carries
  no diff. A receiver that needs one fetches and compares (see
  [use cases](#use-cases)).
- **Ordering guarantees.** No surveyed provider offers them.
- **Destination-specific formats** (Slack `{"text"}`, Teams cards). The
  model reserves a `format` field; v1 ships `standard` only.
- **`comment.*` events.** Web-editor comments are client-reported to
  `POST /notifications/comment` and not verified server-side; emitting them
  from the v1 path alone would make the same event appear from some sources
  and not others.
- **Managing webhooks through `/api/v1` with an API key.** See
  [Permissions](#ownership-and-permissions).
- **Private-channel and DM chat events, ever, on a workspace webhook.** A
  workspace owner is not entitled to read them (`chat-access.ts`), so a
  webhook the owner registers must not carry them either. A bot's push
  channel — the "later design" [chat.md](chat.md) Non-Goals defer — reuses
  this engine with the bot as the principal; it is not a workspace webhook.
- **A replay feed** (`GET /api/v1/workspaces/:wid/events?after=`). Phase 3.

## Use Cases

The people this is for (`PRODUCT.md`): a small team that self-hosts, with
one person who runs the deployment and has n8n, a Mattermost or a NAS next
to it. There are also agents that already drive Wafflebase through the CLI.
Each case below says what the receiver does after the event arrives,
because that step is where the design either holds up or fails.

| # | Use case | Events | What the receiver then does | What it needs from us |
|---|---|---|---|---|
| 1 | **Team-channel feed.** "New document in *Contracts*", "*Q4 plan* was moved to the trash", posted to Mattermost or Slack through n8n | `document.created`, `.trashed`, `.moved` | Formats a message; usually no fetch | `title`, `url`, actor name and folder in the payload; **a folder filter**, because nobody wants every document in the workspace in one channel |
| 2 | **Backup to our own storage.** Copy edited documents to S3, a NAS or a git repo as `.xlsx`/`.docx`/`.md` | `document.content_updated`, `.deleted`, `.renamed` | `wafflebase … export` or `GET …/content`, then write the file | Coalescing (one export per pause, not per keystroke); `deleted` still carrying `title` and `type` after the row is gone |
| 3 | **Agent trigger.** A Claude agent tidies a meeting-notes doc made from the *Weekly sync* template, or summarizes a sheet when its inbox tab changes | `document.created`, `document.content_updated` | Reads through `/api/v1`, **writes back through `/api/v1`** | What the document was made from (`source`); a way to recognize its **own** write so it does not loop |
| 4 | **Search and RAG index.** Keep an internal search engine or vector store current | `content_updated`, `trashed`, `restored`, `deleted` | Re-indexes or drops the document | The trash events, so trashed content leaves the index; this is why they are in Phase 1 |
| 5 | **Joiner and leaver automation.** Add a new member to the company directory and share an onboarding doc; record leavers | `member.joined`, `member.removed` | Calls another system | **Inline member fields**, because `/api/v1` has no members endpoint to fetch from |
| 6 | **Sheet as a lightweight database.** A *Requests* sheet where a status column moving to "Approved" sends an email | `document.content_updated` | Fetches the range, compares it with its last snapshot | Only the signal; the diff is the receiver's job (Non-Goal) |
| 7 | **Audit trail to a SIEM.** Every lifecycle change with who did it | everything | Appends to a log store | Actor on every event, stable `webhook-id`; eventually `share_link.*`, `api_key.*`, `invite.*` |
| 8 | **Public channel mirror / incident relay.** Post `#incidents` messages to an on-call tool | `chat.message.created` | Fetches the message | Chat's `/api/v1` mirror (Phase 3) |

What the cases change in the proposal:

- **The folder filter moves up to Phase 2** (case 1). `folder_id` alone
  fails as a filter key in n8n, so the payload also carries the folder's
  `name`.
- **Loop protection is a requirement, not an edge case** (case 3). An agent
  that writes back fires `DocumentRootChanged` for its own write. Yorkie's
  event has no actor, so the backend cannot attribute edits inside a window
  to anyone. It does know which writes it made itself:
  `YorkieService.withDocument` runs for every `/api/v1` content write.
  - That path stamps the pending row with the API key that wrote.
    `content_updated` carries them as `data.api_writers: [{ api_key_id,
    user_id, at }]`. This is a hint that the window *contains* those
    writes, not a claim that nothing else changed.
  - Receivers guard on two things: their own key appearing in
    `api_writers`, and a content hash being unchanged since their last
    write. The docs recipe shows both.
  - The per-webhook hourly cap is the backstop when a receiver gets this
    wrong.
- **`document.created` carries `source`** (case 3): `{ kind: 'blank' |
  'copy' | 'template' | 'upload' | 'import', id? }`. "Made from the *Weekly
  sync* template" is the most natural agent trigger there is.
- **Member events are fat by necessity** (case 5): `{ id, username, email,
  role, kind }`. There is nothing to fetch them from. Every subscriber is
  an owner who sees the same emails in Settings → Members, so this
  discloses nothing new.
- **Audit wants the deferred events sooner** (case 7). `share_link.created`
  with role `editor` is the event an auditor cares about most, so the audit
  pack (`share_link.*`, `api_key.*`, `invite.*`) is first in line after
  Phase 2. The 30-day delivery log is not an audit log and the docs say so.
- **Diffs stay out** (case 6). The recipe stores the last fetched range and
  compares; the docs say plainly that we will not tell anyone which cell
  changed.
- **The event picker starts from use cases** (see
  [User experience](#user-experience)).

## Prior Art

| Product | Scope | Content edits | Payload | Signing / handshake | Retries → disable |
|---|---|---|---|---|---|
| Notion | integration × workspace | `page.content_updated` aggregated (~1 min) | IDs only; "fetch latest" | HMAC `X-Notion-Signature`; token paste-back | 8 over ~24 h |
| Figma | team / folder / file | `FILE_UPDATE` after 30 min idle | IDs | body passcode; `PING` on create | 3 (5 m, 30 m, 3 h) |
| Airtable | base | ping, then cursor pull | ping only | HMAC; secret shown once; **7-day expiry** | 13 over ~1 day |
| Linear | org / team, **admin-only** | per-entity | full record + `updatedFrom` | HMAC + 60 s timestamp | 3 (1 m, 1 h, 6 h); auto-off |
| Slack Events | app × workspace | n/a | full event | HMAC + 5 min window; URL challenge | 3; off at >95 % failure/h |
| Miro | board (experimental) | — | — | — | **withdrawn 2025-12** ("reliability and scalability") |
| Google Drive | file / changes feed | `content` change, coalescing undocumented | empty body, pull `changes.list` | channel token | expires 1 day–1 week |
| MS Graph | driveItem / resource | no detail, pull `delta` | ping (rich only for Teams/Outlook, encrypted) | `validationToken` echo, 10 s | backoff ≤4 h; lifecycle `missed` |
| Dropbox / Box | app / folder | ping, pull with cursor | IDs | HMAC; Box: two live keys | Dropbox: off at >35 errors/10 min |
| Stripe | account | n/a | thin events recommended | `t=,v1=`; rotation overlap ≤7 d | ~3 days; manual resend 15–30 d |
| Standard Webhooks / Svix | endpoint | n/a | any | HMAC over `id.timestamp.body`; multi-sig rotation | 8 over ~32 h; off after 5 days |

What we take: Linear's admin-owned workspace subscription; Notion's
coalesced content event with a fetch-latest contract; Figma's signed test
ping instead of an echo handshake; Standard Webhooks' wire format; Svix's
retry schedule, private-range blocking with an operator CIDR override, and
"recover since" on re-enable; Stripe's lesson that **the right to create an
endpoint is the right to read everything it subscribes to**.

What we avoid: Airtable/Google-style expiry (our consumers are no-code
tools that will not renew), Box's per-retry delivery id, and Miro's mistake
of real-time per-object webhooks over a CRDT.

## Proposal Details

### Ownership and permissions

- A `Webhook` belongs to a workspace. **Only owners create, edit, rotate,
  reveal, redeliver or delete** (`assertOwner`). A webhook keeps exporting
  data with no human calling anything, which is what separates it from an
  API key that any member may mint; Linear and Figma gate theirs the same
  way.
- **Members see the list read-only**, host only (never the full URL, which
  is often itself a secret, as with Slack/Zapier hook URLs). Where workspace
  data leaves to is something members are entitled to know.
- `createdBy` is recorded. When the creator is removed or loses the owner
  role, their webhooks are disabled (`disabledReason = 'creator_removed'`)
  in the same transaction as `WorkspaceService.removeMember`, mirroring how
  their API keys are revoked. Any remaining owner can take one over by
  re-enabling it, which records them as the new `createdBy`.
- Another workspace's webhook id answers `404`, as API keys do.
- Management is **JWT-only** (`workspaces/:wid/webhooks`). A leaked
  `write`-scoped API key must not be able to register an exfiltration
  endpoint. A dedicated `webhooks:manage` scope is Phase 3.

### Event catalog (v1)

An event's trustworthiness is decided by where it comes from.

| Event | Source | Trust | Phase |
|---|---|---|---|
| `document.created` | `DocumentService` create, copy, template use, v1 + file upload | authoritative, with actor | 1 |
| `document.renamed`, `document.moved` | `PATCH documents/:id`, v1 `PATCH` | authoritative; a cross-workspace move fires in both | 1 |
| `document.trashed`, `document.restored`, `document.deleted` | trash / restore / purge | authoritative; `deleted` captures its payload before purge | 1 |
| `folder.created`, `folder.updated`, `folder.deleted` | `FolderService` | authoritative; cascaded sub-folders and `SetNull` documents emit nothing — documented | 1 |
| `member.joined`, `member.removed` | every path that creates a `WorkspaceMember` — `acceptInvite`, `WorkspaceService.create`, `UserService.createUserWithWorkspace` (sign-up), `claimGithubWorkspaces` — and `removeMember` | authoritative; `data.member.kind` carries `bot` once [chat.md](chat.md) bots exist, rather than suppressing them as `workspace_member_joined` does | 1 |
| `webhook.test` | management API | — | 1 |
| `document.content_updated` | Yorkie `DocumentRootChanged` | the change is real; **no actor**, may be lost | 2 |
| `chat.message.created`, `chat.message.updated`, `chat.message.deleted` | `ChatMessageService.post` / `edit` / `remove` | authoritative, with actor; **public channels only** | 3 |
| `chat.channel.created`, `chat.channel.updated` (rename, topic, archive) | `ChatChannelService.create` / `update` | authoritative; public only | 3 |
| `comment.*`, `share_link.*`, `template.*`, `document.version_created` | — | — | deferred |

Emission lives **in services, with an `actor` argument**, not in
controllers: the web routes and `/api/v1` are parallel controllers over the
same services, and emitting from both is how one path ends up silent. A
contract test asserts both paths emit.

### Chat events

[Workspace chat](chat.md) is the first workspace content whose visibility
is **not** uniform: a document is readable by every member, a private
channel or DM only by its members, and a workspace owner is refused one
they do not belong to (`chat-access.ts`, `404`). So the outbox insert
filters by visibility at emit time, and for a workspace webhook the rule is
simply *public channels only*. Every event type carries the same filter,
so one function decides what a webhook may see rather than each emitter.

Chat writes are a good source. Unlike web comments they are server-side,
transactional and carry the actor. The delivery row goes inside
`ChatMessageService.post`'s transaction, where `seq` is already allocated
under the channel row lock. The `pg_notify` and `chat_mention`
notifications run after commit, best-effort, and stay that way.

They still wait for Phase 3, for one reason: a thin event needs somewhere
to fetch from, and chat has no `/api/v1` mirror yet (chat P3). Shipping
`chat.message.created` without one would force either a fat payload
carrying the message body, which breaks the rule the rest of this design
depends on, or an event nobody can act on. They land together with the
mirror.

Two consequences, both recorded so they do not surprise anyone:

- `removeMember` hard-deletes private channels it leaves empty. That
  emits nothing, which is correct because private channels are invisible
  to workspace webhooks anyway.
- Archiving a public channel emits `chat.channel.updated` with
  `archived_at`. There is no separate `archived` type.

### `document.content_updated` coalescing

`yorkie-event.controller.ts` already fans `DocumentRootChanged` out to
`touchUpdatedAt` and `TemplateReviewSyncService`. A third consumer **only
upserts** `WebhookContentPending(documentId PK, workspaceId, firstSeenAt,
lastIssuedAt, apiWriters Json)` and returns — outbound I/O never delays the 200 to Yorkie,
which would otherwise trigger Yorkie's retries.

The worker flushes a row when `lastIssuedAt + 60s ≤ now` (quiet) **or**
`firstSeenAt + 5m ≤ now` (max wait), so a document under continuous editing
still signals every five minutes. `/api/v1` content writes append
`{ api_key_id, user_id, at }` to `apiWriters` from `YorkieService` before
they commit to Yorkie (the loop guard, [use case 3](#use-cases)). Coalescing is per document, not per
webhook, so state stays one row per document however many subscribers
there are. A trashed document at flush time is dropped (`LIVE_DOCUMENT`).
Both windows are env-tunable until Yorkie's own per-document throttle is
measured.

The contract published to consumers: *"the content may have changed since
`window_start`; fetch it from `api_url`. This event can be late and, until
the Phase 3 feed exists, can be lost."*

### Payload

Standard Webhooks envelope, thin `data`, links to fetch:

```json
{
  "type": "document.content_updated",
  "timestamp": "2026-11-20T09:12:44Z",
  "data": {
    "workspace_id": "…",
    "document": { "id": "…", "type": "sheet", "title": "Q4 plan",
                  "folder": { "id": "…", "name": "Planning" } },
    "actor": null,
    "api_writers": [{ "api_key_id": "…", "user_id": 7, "at": "2026-11-20T09:10:02Z" }],
    "window_start": "2026-11-20T09:07:44Z",
    "updated_at": "2026-11-20T09:11:40Z",
    "url": "https://<origin>/s/…",
    "api_url": "https://<origin>/api/v1/workspaces/…/documents/…"
  }
}
```

`title` and `url` are included so a Zapier/n8n step can build a message
without a second call. That is safe because the webhook's creator is an
owner who can read every document title anyway. The same argument would
not hold for a private channel's name, which is one more reason chat
events are limited to public channels. Actors are `{ id, username }`.
`folder` is `null` at the workspace root. Payloads are capped at 20 KB.

### Signing and secrets

- Headers `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64>`
  over `id.timestamp.body`, HMAC-SHA256, secret `whsec_` + 32 random bytes
  per webhook. Consumers can use any Standard Webhooks verifier; we
  recommend a 5-minute tolerance. Also sent, unsigned:
  `X-Wafflebase-Event`, `User-Agent: Wafflebase-Webhooks/<version>`.
- `webhook-id` is assigned when the delivery row is created and **reused on
  every retry and manual redeliver**; timestamp and signature are recomputed
  per attempt.
- The secret is stored encrypted with `datasource/crypto.util.ts`
  (AES-256-GCM) — it must be decryptable to sign. Because of that, an owner
  can **reveal it at any time** (Stripe, Svix); showing it once would buy no
  security and would force a rotation every time someone loses it.
- Rotation keeps up to **two live secrets** and sends both signatures during
  the overlap (default 24 h, up to 7 days). Rotating again during an
  overlap is refused — it would drop a secret the receiver still uses.

### Registration and test

No echo handshake: the realistic first consumers (Zapier catch hooks, n8n,
a team's own small server) answer 200 but cannot echo a challenge. On create
or URL change we send a signed `webhook.test` and show its result in place.
**A failed test does not block saving** — the webhook is active with a
warning, so someone can register the endpoint before building the receiver.
Abuse of third-party URLs is bounded by owner-only creation, per-webhook
rate limits and auto-disable; the real danger, SSRF, has its own guard.

States are `active` and `disabled` only.

### Delivery engine

```prisma
/// Owner-managed outbound subscription. Disabled, never deleted, on failure.
model Webhook {
  id                  String    @id @default(uuid())
  workspaceId         String
  createdBy           Int
  name                String
  url                 String
  format              String    @default("standard") /// standard
  events              String[]  /// event types; empty = all
  documentTypes       String[]  /// empty = all
  secretEnc           String    /// AES-256-GCM
  prevSecretEnc       String?
  prevSecretExpiresAt DateTime?
  status              String    /// active | disabled
  disabledAt          DateTime?
  disabledReason      String?   /// failing | gone | creator_removed | manual
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}

/// Outbox: one row per (webhook, event). `id` is the webhook-id header.
model WebhookDelivery {
  id            String    @id @default(uuid())
  webhookId     String
  eventType     String
  payload       Json
  status        String    /// pending | in_flight | delivered | failed
  attempts      Int       @default(0)
  nextAttemptAt DateTime
  leaseUntil    DateTime?
  lastStatus    Int?
  lastError     String?
  lastDurationMs Int?
  responseExcerpt String? /// first 1 KB
  deliveredAt   DateTime?
  createdAt     DateTime  @default(now())

  @@index([status, nextAttemptAt])
  @@index([webhookId, createdAt])
}
```

Backend-originated events insert their delivery rows **in the same Prisma
transaction** as the domain write (transactional outbox). Yorkie-originated
events are inserted when the pending row flushes; that path is at-least-once
only from the Yorkie webhook onward.

One worker per replica, in the `DemoResetService` shape (re-armed
`setTimeout`, `unref()`, re-entrancy flag), polls every 5 s. It is woken
immediately on **any** replica through Postgres `LISTEN/NOTIFY`, which chat
introduced (`chat/chat-bus.ts`: one dedicated listening client,
`CHAT_LISTEN_DATABASE_URL` defaulting to `DATABASE_URL`). The insert
transaction issues `pg_notify('webhook', …)`, which Postgres delivers only
on commit, so a worker is never woken for a row it cannot yet see. The poll
is then a fallback rather than the latency path. Extract the listener into
a shared bus with per-channel handlers rather than opening a second
dedicated connection. It claims with one statement —
`UPDATE … SET status='in_flight', leaseUntil=now()+60s WHERE id IN (SELECT
… FOR UPDATE SKIP LOCKED LIMIT 50) RETURNING *` — and sends HTTP **outside**
the transaction. An expired lease returns the row to `pending`. At most two
concurrent requests per webhook. Svix and Convoy were considered and
rejected: each adds Redis (and Svix a Rust service) to a stack that has
deliberately stayed Postgres-only.

### Retries and disable

- 10 s timeout. Only 2xx is success; **3xx is a failure and redirects are
  never followed**; `410` disables immediately; `429` honours
  `Retry-After`.
- Schedule (Svix): immediately, 5 s, 5 m, 30 m, 2 h, 5 h, 10 h, 10 h, with
  jitter — 8 attempts over ~32 h.
- Auto-disable when no delivery has succeeded for 3 days and failures span
  at least 12 h. A `webhook_failing` notification goes to **every owner**
  24 h before; `webhook_disabled` when it happens. Every owner, not the
  creator — the creator may be the reason (`creator_removed`).
- Re-enabling asks whether to also send what failed while disabled
  ("recover since", default: from the moment it was disabled).
- Manual redeliver pulls the row's next attempt to now rather than creating
  a parallel attempt (Stripe's resend not cancelling its retries surprised
  users).
- Delivery rows are kept 30 days and purged by the same worker.

Limits: 10 webhooks per workspace; a per-webhook hourly cap whose overflow
is reported, not silently dropped.

### SSRF guard

A new `common/safe-outbound.ts`, checked **at registration and on every
send**:

- `https` only; resolve every A/AAAA record and refuse loopback, RFC 1918,
  link-local, CGNAT `100.64/10`, `fc00::/7`, IPv4-mapped IPv6, `0.0.0.0`,
  multicast and cloud metadata hosts;
- connect to the address that was checked (undici `Agent` `connect.lookup`),
  defeating DNS rebinding; `redirect: 'manual'`; response size capped; URLs
  never logged in full.

Operator overrides, both failing closed on a typo:
`WAFFLEBASE_WEBHOOK_ALLOWED_CIDRS` (exact CIDRs, default empty) and
`WAFFLEBASE_WEBHOOK_ALLOW_HTTP` (literal `true` only). Stronger isolation
(an egress proxy such as Smokescreen) is documented, not built.

The whole feature is off unless `WAFFLEBASE_WEBHOOKS_ENABLED=true`, like
Kafka/Sentry/StarRocks.

### User experience

**Where.** Workspace Settings is still a single scrolling page of sections,
not tabs. It gained a Data sources section, with `#datasources` hash
anchoring and a redirect from the old `/w/:wid/datasources`. Webhooks
follows that precedent:

- A **list section** `#webhooks`, placed after Data sources and shaped like
  API keys. Each row shows name, host, status and last delivery.
- Each row opens a **detail page** `/w/:wid/settings/webhooks/:id`, the
  first sub-route under settings. It holds configuration, the secret, the
  delivery log and the danger zone, none of which fits in a section.
- The add button is `outline`, like Data sources, per the One Accent Rule:
  "Create invite link" stays the page's primary action.

Chat's planned Bots section will also land on this page. Webhooks and Bots
should sit next to each other under one "Integrations" heading when the
second of them arrives.

**Create.**
1. *Name* (required, `e.g. Zapier → weekly report`): URLs are unreadable
   in a list and often secret.
2. *URL*, validated as typed against the SSRF rules.
3. *Events*: start from what the person is trying to do, not from a list of
   event names. Four presets map to the [use cases](#use-cases), each
   pre-checking a bundle that stays editable underneath:
   - *Post to a team channel*: created, moved, trashed. Adds the folder
     filter in Phase 2.
   - *Back up or index documents*: content updated, renamed, trashed,
     restored, deleted.
   - *Sync members*: joined, removed.
   - *Everything*: the audit case. This is the default.

   Below the presets is the full list, grouped Documents / Folders /
   Members.
   `content_updated` carries its latency in the label — *"arrives about a
   minute after editing pauses, at most 5 minutes"* — or it reads as broken.
4. Save → test ping → the result in place: status, latency, response
   excerpt. A failure shows a warning banner, not a blocked form.

**Errors that teach.** The first failure most self-hosters hit is an
internal n8n address. Not "Invalid URL" but: *"This address resolves to a
private network (10.0.4.12). Your server administrator can allow it by
adding the range to `WAFFLEBASE_WEBHOOK_ALLOWED_CIDRS`."* Same for `http://`
with `WAFFLEBASE_WEBHOOK_ALLOW_HTTP`.

**Secret.** Masked with Reveal and Copy. During a rotation overlap:
*"Previous secret stops working in 23 h"*, and Rotate is disabled with that
reason beside it.

**Delivery log.** The debugging surface. Rows: event, status code, attempt
count, next retry, duration; a "Failed only" filter; expanding shows the
payload and response excerpt (copyable) and Redeliver. Cards below `sm`.

**Disabled.** The reason in words — *"Turned off automatically after 3 days
of failed deliveries. Last response: 502."* — with Re-enable and the
"recover since" choice.

**Feature off.** Owners still see the section, muted: *"Webhooks are off on
this server. An administrator can enable them with
`WAFFLEBASE_WEBHOOKS_ENABLED=true`."* On a self-hosted install the owner is
often the operator; a hidden section is an undiscoverable one.

**Removing a member.** The remove button in the Members table
(`workspace-settings.tsx`) still acts on click. Since chat shipped, a click
also removes the person from every channel, and `removeMember` hard-deletes
any private channel the removal leaves empty, messages included. The button
gains a confirm dialog that names what will happen: *"Private channels only
they belonged to (2) will be deleted. 1 webhook they created will be turned
off."* This dialog is worth shipping on its own, ahead of webhooks.

**CLI.** `wafflebase webhooks list | get | create | update | delete |
rotate-secret | reveal-secret | test | deliveries | redeliver`, calling the
JWT routes like `api-keys`. `registry.ts` declares `safety`: `list`,
`get`, `deliveries` read-only; `reveal-secret` and the rest write; `delete`
destructive — so the Claude plugin guard covers them automatically.

### Rollout

1. **Foundations + lifecycle events.** SSRF util with rebinding/redirect
   tests; models; signer; outbox worker; owner-only JWT routes; Settings
   list + detail (create, test, secret, delivery log); member-removal
   confirm; `document.*`, `folder.*`, `member.*`, `webhook.test`; behind
   `WAFFLEBASE_WEBHOOKS_ENABLED`. Proof: web and v1 paths both emit; two
   replicas never double-send.
2. **Content and operations.** `content_updated` coalescing (after
   measuring Yorkie's throttle) with `api_writers`, the folder filter,
   rotation, auto-disable + notifications, redeliver and recover-since,
   CLI, 30-day purge. Docs-site recipes for the use cases that prove the
   design: n8n → Mattermost team feed (1), back up to S3/git (2), an agent
   trigger with the loop guard (3), and sheet-range diffing (6).
3. **Audit pack.** `share_link.*`, `api_key.*`, `invite.*` (use case 7).
4. **Recovery and reach.** Workspace event feed with a cursor; public
   `chat.*` together with chat's `/api/v1` mirror; bot-principal push for
   chat mentions (the engine reused, scoped to the bot's channels);
   `comment.*` once comments have a server write path; `webhooks:manage`
   scope; destination formats (Slack); revisit member-created webhooks;
   CloudEvents attribute alignment.

### Risks and Mitigation

- **Yorkie stream quality.** Its throttle window is not recorded, and a
  missed `DocumentRootChanged` is lost for good (reconciliation is an open
  follow-up in [documents-last-modified.md](documents-last-modified.md)).
  *Mitigation:* document `content_updated` as a lossy hint; the Phase 3
  feed is the recovery path. Graph's driveItem (up to 6 h late, `missed`
  lifecycle) sets the bar.
- **Owner-only is conservative.** Members already read everything and mint
  API keys. *Mitigation:* start narrow; widening is additive, narrowing
  later breaks people.
- **Encryption key naming.** Reusing `DATASOURCE_ENCRYPTION_KEY` for webhook
  secrets misnames it. *Mitigation:* introduce
  `WAFFLEBASE_SECRETS_ENCRYPTION_KEY` falling back to the old key; decide
  before Phase 1 ships.
- **SSRF regressions.** Webhook producers have repeatedly shipped SSRF
  (registration-only checks, followed redirects, rebinding). *Mitigation:*
  check at send time, pin the address, refuse redirects, test each bypass.
- **Scale.** Miro withdrew per-board real-time webhooks. *Mitigation:*
  per-document coalescing, per-workspace and per-webhook caps from day one,
  SKIP LOCKED leasing even while production runs one replica.
