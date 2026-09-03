---
title: notifications
target-version: 0.6.5
---

# Notifications

## Summary

Add in-app notifications: a bell icon in the app header with an unread badge
and a dropdown listing recent activity directed at the current user. Four
event types ship in v1 — comment mention, comment reply, thread resolved, and
workspace member joined.

Notifications live in Postgres (`Notification`) and reach the browser over an
SSE stream. Comment events are **reported by the client and authorized by the
server**: comments live inside Yorkie CRDT documents and never pass through
the backend, so the client is the only party that knows a comment was posted.
The workspace-join event is created server-side in `acceptInvite()`, where the
backend already has authority.

This closes the follow-up that [comments-mentions.md](comments-mentions.md)
deferred; its `extractMentionedUserIds()` helper — written for "future
notification work" and until now consumed only by a unit test — becomes the
mention source.

## Goals / Non-Goals

### Goals

- A bell in `SiteHeader` (one insertion point, visible on the documents list
  and in every editor) showing an unread count, with a dropdown of the 20 most
  recent notifications, per-item read and "mark all read".
- Four notification types: `comment_mention`, `comment_reply`,
  `thread_resolved`, `workspace_member_joined`.
- Clicking a notification opens the referenced document, routed by document
  type through the existing URL prefixes.
- Near-real-time delivery over SSE that stays correct under multiple backend
  replicas, with **no new infrastructure** — no Redis, no Kafka, no new
  environment variable.
- Server-side authorization on every client-reported event: the actor must
  belong to the document's workspace, and so must each recipient.

### Non-Goals

- **Email notifications.** The backend has no mail infrastructure
  (no nodemailer/Resend/SMTP dependency). Adding one is a separate change with
  its own env vars, templates, retry handling, and unsubscribe flow.
- **Per-type preferences.** No settings page, no opt-out. Every recipient of a
  qualifying event gets the notification.
- **A dedicated `/notifications` page.** The dropdown is the whole surface;
  the list API takes a cursor so a page can be added later without a redesign.
- **Thread deep-linking.** Clicking opens the document, not the specific
  comment thread. Scrolling to a thread requires touching all three comment
  controllers (docs, sheets, pdf) and is deferred.
- **Content verification of comment events.** See Authorization depth below.
- **Retention/cleanup.** No age-based cleanup job in v1. Rows *are* deleted,
  but only by cascade — with their document, workspace, or recipient.
- **"Document shared with you".** No such event exists — see below.

### Why there is no "shared with you" notification

Sharing and inviting in wafflebase are **entirely link-token based**.
`CreateInviteDto` (`packages/backend/src/workspace/workspace.dto.ts`) accepts
only `{ role, expiration }` and returns a URL; `ShareLink` likewise carries a
token, not a target user. No action in the product names a recipient, so there
is no one to notify. Document access derives from workspace membership, so
members can already open every document in their workspace — "sharing" with an
internal member is not a concept that exists.

The one user-targeted event that *does* exist today is the far side of that
flow: someone accepts an invite link and joins. That becomes
`workspace_member_joined`, delivered to the workspace owners and the invite's
creator.

## Proposal Details

### Data model

One table, added to `packages/backend/prisma/schema.prisma`:

```prisma
model Notification {
  id          String    @id @default(uuid())
  type        String    // comment_mention | comment_reply
                        // thread_resolved | workspace_member_joined
  recipientId Int
  recipient   User      @relation("NotificationRecipient", fields: [recipientId], references: [id], onDelete: Cascade)
  actorId     Int?
  actor       User?     @relation("NotificationActor", fields: [actorId], references: [id], onDelete: SetNull)

  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  documentId  String?
  document    Document? @relation(fields: [documentId], references: [id], onDelete: Cascade)

  threadId    String?
  commentId   String?
  dedupeKey   String?   // comment id, or "<threadId>:resolved"
  preview     String?   // <= 200 chars, sanitized

  readAt      DateTime?
  createdAt   DateTime  @default(now())

  @@unique([recipientId, type, dedupeKey])
  @@index([recipientId, createdAt])
  // The badge query filters `readAt IS NULL`; without this it scans every
  // row the recipient has ever received.
  @@index([recipientId, readAt])
}
```

Three deliberate choices:

- **`document` cascades.** Deleting a document removes its notifications, so
  the dropdown never offers a dead link.
- **`actor` sets null.** A deleted user must not take other people's
  notifications with them; the item renders with a generic actor.
- **`@@unique([recipientId, type, dedupeKey])`** makes creation idempotent
  against client retries and duplicate submits. `dedupeKey` is separate from
  `commentId` because `thread_resolved` has no comment of its own — it uses
  `"<threadId>:resolved"`, so toggling a thread resolved and unresolved
  repeatedly still notifies once. `workspace_member_joined` leaves it null,
  and Postgres treats NULLs as distinct, so re-joining a workspace correctly
  notifies again.

`threadId`/`commentId` are opaque CRDT identifiers with no foreign key; the
backend never resolves them, it only stores them for the client to use.

### Backend module — `packages/backend/src/notification/`

```
notification.module.ts
notification.service.ts      # create / list / markRead / unreadCount
notification.controller.ts   # REST + SSE
notification.dto.ts
notification-hub.ts          # in-process userId -> Subject fan-out
notification-stream.ts       # merges hub + poll + heartbeat into one stream
user-throttler.guard.ts      # throttle bucket keyed on the caller, not the IP
```

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/notifications/comment` | Client report of a comment event (all three comment types) |
| `GET` | `/notifications` | 20 most recent for the caller, `?before=<createdAt>&beforeId=<id>` cursor |
| `GET` | `/notifications/unread-count` | `{ count }` |
| `POST` | `/notifications/read` | `{ ids? }` — omitted marks everything read |
| `GET` | `/notifications/stream` | SSE summary stream |

All routes sit behind `JwtAuthGuard`. `/stream` is `@SkipThrottle()`.

**`NotificationService` reads membership through Prisma directly rather than
injecting `WorkspaceService`.** `WorkspaceService.acceptInvite()` calls *into*
`NotificationService`, so the reverse dependency would be circular. The check
is one `workspaceMember.findMany` — `memberIdsAmong()` resolves the actor and
every recipient in a single round trip, and the join path reads the
workspace's members the same way. Not worth a module cycle.

### Creating comment notifications

The client reports; the server authorizes.

```ts
POST /notifications/comment
{
  type: 'comment_mention' | 'comment_reply' | 'thread_resolved',
  documentId: string,
  threadId: string,
  commentId?: string,        // absent for thread_resolved
  recipientUserIds: number[],
  preview: string,
}
```

The client computes recipients because the backend cannot: thread participants
exist only inside the CRDT document. Per type, with the actor always removed
server-side:

| Type | Recipients | `dedupeKey` |
|------|-----------|-------------|
| `comment_mention` | user ids from `extractMentionedUserIds(body)` | `commentId` |
| `comment_reply` | authors of every earlier comment in the thread, minus anyone already receiving a mention for this same comment | `commentId` |
| `thread_resolved` | authors of every comment in the thread | `<threadId>:resolved` |

Excluding mention recipients from the reply set is what stops one reply from
producing two notifications for the same person. The preview is
`mentionBodyToPlainText(body).slice(0, 200)`; for `thread_resolved` it is the
thread's first comment, so the item reads as "resolved your comment: …".

`NotificationService.createFromComment(actorId, dto)` then enforces:

1. The document exists (else 404).
2. The actor is a member of the document's workspace (else 403).
3. Each recipient is a member of that same workspace — non-members are
   **silently dropped**, not rejected, so one stale id cannot fail the batch.
4. The actor is removed from the recipient set. You are never notified about
   your own comment.
5. `preview` is truncated to 200 characters, with control characters
   collapsed to spaces and invisible formatting characters (zero-width, bidi
   overrides) removed outright; at most 20 recipients per request.
6. `@Throttle` caps a user at 30 reports per minute. `@nestjs/throttler`'s
   default tracker keys on the request IP, which would both make colleagues
   behind one NAT share a bucket and leave a multi-address attacker uncapped,
   so this route uses a `UserThrottlerGuard` that keys on the authenticated
   caller instead. The global per-IP bucket still applies on top.

`preview` is optional in the DTO even though every planned event supplies one:
`thread_resolved` on an empty first comment legitimately produces none.

Callers are the three comment controllers —
`packages/frontend/src/app/docs/comments/docs-comments-controller.ts`,
`packages/frontend/src/app/files/comments/pdf-comments-controller.ts`, and the sheets comment path.
Each fires the report **after** the CRDT write succeeds, and ignores failures:
the comment is already saved, so a failed notification must not surface an
error to the author.

### Creating join notifications

`WorkspaceService.acceptInvite()` (`packages/backend/src/workspace/workspace.service.ts`) already runs
server-side with full authority. After the membership row is created, it emits
`workspace_member_joined` to the union of the workspace owners and the
invite's creator, excluding the joiner. `documentId` is null.

### Authorization depth — what is *not* verified

The server verifies **who may notify whom**, not **what happened**. It does
not attach the Yorkie document to confirm that `commentId` exists or that its
body really contains the mention.

That verification was considered and rejected for v1. `withDocument()` loads
the *entire* document — megabytes for a large spreadsheet — on every comment
post, and the client's write may not have synced to the Yorkie server yet when
the report arrives, which would require retry logic plus a per-document-type
adapter (docs and pdf store threads at `root.comments[threadId]`, sheets at
`root.worksheets[tab].comments[threadId]`).

The residual risk is narrow: a malicious client can create a notification with
a fabricated preview, but only targeting users who share a workspace with it —
people it could reach anyway by posting a real comment. Rate limiting and the
length cap bound the abuse. Content verification remains available as a later
upgrade behind the same endpoint.

### Delivery — SSE

`NotificationHub` is an app singleton holding `Map<userId, Set<Subject>>`.
`publish(userId, summary)` reaches subscribers **in the same process**;
`subscribe(userId)` returns an Observable the controller merges into the
stream.

```ts
@Sse('stream')
stream(@Req() req): Observable<MessageEvent> {
  return merge(
    this.hub.subscribe(userId),   // same-replica creations, instant
    this.pollFallback(userId),    // every 60s, rows newer than lastSeen
    this.heartbeat(),             // every 25s, keep-alive comment
  );
}
```

`pollFallback` is what makes this correct without a message bus: a
notification created on another replica arrives within 60 seconds, and a
client that reconnects mid-gap catches up on its first tick. Best case
instant, worst case one minute, zero new infrastructure.

**The stream carries `{ unreadCount, latestId }`, not notification objects.**
The client refreshes the badge from the event and fetches the actual list only
when the dropdown opens. So a dropped event costs at most a stale badge that
self-corrects on open, and no notification content travels over the long-lived
connection.

Responses set `Cache-Control: no-cache` and `X-Accel-Buffering: no` so
intermediaries do not buffer the stream.

### Frontend — `packages/frontend/src/components/notifications/`

```
notification-bell.tsx        # bell + badge + Popover trigger
notification-list.tsx        # items, empty state, "mark all read"
notification-item.tsx        # icon, sentence, relative time, click routing
use-notifications.ts         # React Query: list / unread-count / read
use-notification-stream.ts   # EventSource -> queryClient.setQueryData
types.ts
```

`SiteHeader` (`packages/frontend/src/components/site-header.tsx`) is used by `packages/frontend/src/app/Layout.tsx` and by
every editor shell, so mounting the bell there covers the whole app from a
single place. It renders **only for an authenticated session** — anonymous
share-link viewers have no inbox and get no bell.

Relative times use `date-fns`, already a dependency.

#### Where a click goes

`notificationHref` (`notification-text.ts`) switches on the **type**, because
the destination follows from what happened and not from which rows the
notification happens to carry. Most types resolve to the document, routed by
document type through the existing prefixes (`/s/` sheet, `/d/` doc, `/p/`
slides, `/f/` file, `/n/` note, `/b/` board) — which is why the list response
embeds `document: { id, title, type }`. An unrecognized type takes that path
too, so a type this client has not learned yet still opens what it is about.

Two are exceptions, and a rule that just opened any attached document got both
wrong:

- **`workspace_member_joined` → `/w/:workspaceId/settings`.** It has no
  document at all, so under the old rule it rendered a row that marked itself
  read and went nowhere. The member list is a section of the settings page;
  there is no members route. Both recipient classes — workspace owners and the
  invite's creator — are members, so the page is theirs to open.
- **`template_review_queued` → `/admin/templates`.** It carries a document its
  recipient *cannot open*: a reviewer is on the global
  `WAFFLEBASE_TEMPLATE_REVIEWER_IDS` allowlist and belongs to neither the
  publishing workspace nor the document. The queue is the whole reason the
  notification exists.

The list response therefore also embeds `workspace: { id, name }`. It is what
identifies a workspace-level notification — a reader belongs to several, and
"someone joined the workspace" names none of them — and it is what the join
href is built from. Nullable on the client, so a workspace deleted since the
row was written degrades to a row that goes nowhere rather than to
`/w/undefined/settings`.

### Testing

- `packages/backend/src/notification/notification.service.spec.ts` — non-member recipients dropped, actor
  excluded from its own event, repeated `commentId` yields one row, preview
  truncation and control-character stripping, 404/403 paths, and that the list
  select carries the workspace while `dedupeKey`/`recipientId` stay server-side.
- `packages/backend/src/notification/notification-hub.spec.ts` — publish reaches subscribers, unsubscribe stops
  delivery, no cross-user leakage.
- `packages/backend/src/notification/notification-stream.spec.ts` — the SSE
  composition: the summary sent on connect, hub and poll results forwarded, an
  unchanged poll tick suppressed, pings not disturbing change detection.
- `packages/backend/src/notification/user-throttler.guard.spec.ts` — the
  bucket keys on the caller, not their address.
- `packages/backend/test/notification.e2e-spec.ts` — routes through the JWT
  guard against a real database (`RUN_DB_INTEGRATION_TESTS`).
- Frontend unit tests for route-URL construction and read-state transitions,
  written without JSX rendering (JSX render tests are flaky in this repo).
- The browser end of the stream is verified by manual smoke in `pnpm dev`.
  Server-side composition has unit coverage (above); what a unit test of an
  `EventSource` would add over that is nothing.
- `pnpm verify:fast` green on every commit.

### Rollout

Three PRs, each independently green:

1. **Backend core** — Prisma model + migration, module, REST + SSE,
   `acceptInvite()` hook, unit + e2e tests.
2. **Bell UI** — components, React Query hooks, EventSource, header mount.
3. **Comment wiring** — the three comment controllers report events.

Merging only 1 and 2 leaves an empty but functional inbox; nothing breaks.

No new environment variable and no new service, so this needs no devops
version bump.

## Risks and Mitigation

- **A proxy buffers the SSE stream.** The response headers disable buffering,
  but a deployment's reverse proxy may still need configuring. *Mitigation:*
  the 60-second `pollFallback` means a buffered or failed stream degrades to
  polling rather than to silence, and the badge is always correct once the
  dropdown opens.
- **One SSE connection per tab.** A user with many tabs holds many
  connections. *Mitigation:* accepted for v1; if it becomes a problem,
  `BroadcastChannel` can elect one tab to hold the connection and fan out to
  the rest without any server change.
- **Forged previews.** Bounded to workspace peers and rate limited (see
  Authorization depth). *Mitigation:* content verification can be added behind
  the same endpoint later without a schema or client change.
- **Unbounded growth.** Nothing is deleted. *Mitigation:* the list is capped
  at 20 per fetch and covered by `(recipientId, createdAt)`, and the badge
  query is covered by `(recipientId, readAt)` — without that second index the
  unread count would scan every row a user has ever received. A retention job
  is a later, isolated change.
- **Inbox flooding by a workspace peer.** The per-user throttle permits a
  sustained 30 × 20 rows per minute, `dedupeKey` is attacker-supplied so the
  unique index is no brake, and nothing is deleted. *Mitigation:* none in v1
  beyond the throttle — the abuse is attributable (every row carries
  `actorId`) and confined to workspace peers. A per-recipient-per-day ceiling
  or the retention job would bound it; both are deferred.
- **Cursor ties.** One report inserts its whole batch at a single `createdAt`,
  so a timestamp-only cursor would skip every row sharing a page boundary.
  *Mitigation:* the cursor is the composite `(createdAt, id)` pair
  (`?before=&beforeId=`) and `orderBy` breaks ties on `id`, so paging is both
  complete and stable. `beforeId` without `before` is rejected rather than
  silently ignored.
- **Client-computed recipients drift.** A client bug could omit a legitimate
  recipient, and no server-side check would catch it. *Mitigation:* recipient
  computation lives in the shared comments module, not per-consumer, so the
  three controllers cannot diverge; the mention path reuses the already-tested
  `extractMentionedUserIds`.
