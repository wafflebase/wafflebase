# Notifications — TODO

Design: `docs/design/notifications.md`. Branch: `notifications`.

Goal: in-app notifications — a bell in `SiteHeader` with an unread badge and a
dropdown, backed by a Postgres `Notification` table and an SSE stream. Four
types: `comment_mention`, `comment_reply`, `thread_resolved`,
`workspace_member_joined`. Comment events are client-reported and
server-authorized; the join event is created server-side.

## PR 1 — Backend core

- [x] `prisma/schema.prisma`: `Notification` model
  - `document` `onDelete: Cascade`, `actor` `onDelete: SetNull`
  - `@@index([recipientId, createdAt])`
  - `dedupeKey String?` (comment id, or `<threadId>:resolved`) with
    `@@unique([recipientId, type, dedupeKey])` — separate from `commentId`
    because `thread_resolved` has no comment of its own
  - back-relations on `User` (recipient + actor), `Workspace`, `Document`
- [x] `pnpm backend migrate` — commit the generated migration
- [x] `notification/notification-hub.ts` — `Map<userId, Set<Subject>>`,
      `subscribe(userId)` / `publish(userId, summary)`, unsubscribe cleanup
- [x] `notification/notification.service.ts`
  - `createFromComment(actorId, dto)` — 404 unknown document, 403 non-member
        actor, silently drop non-member recipients, exclude the actor,
        truncate preview to 200 + strip control chars, cap 20 recipients
  - `createMemberJoined(workspaceId, joinerId)` — owners ∪ invite creator,
        joiner excluded
        — *superseded:* shipped as `createMemberJoined({ workspaceId,
        joinerId, inviteCreatorId })`; `docs/design/notifications.md` is the
        authoritative contract
  - `list(userId, before?)` / `unreadCount(userId)` / `markRead(userId, ids?)`
  - membership check via Prisma directly — do **not** inject `WorkspaceService`
        (`acceptInvite` calls into this service; injecting would be circular)
- [x] `notification/notification.controller.ts`
  - `POST /notifications/comment` (`@Throttle` 30/min)
  - `GET /notifications` (`?before=`), `GET /notifications/unread-count`
  - `POST /notifications/read` (`{ ids? }`)
  - `@Sse('stream')` = merge(hub, 60s pollFallback, 25s heartbeat);
        payload is `{ unreadCount, latestId }` only
  - SSE response headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`
  - all routes `JwtAuthGuard`; `/stream` `@SkipThrottle()`
- [x] `notification/notification.dto.ts` — class-validator on every field
- [x] `notification/notification.module.ts`; register in `app.module.ts`
- [x] `workspace.service.ts` `acceptInvite()` — emit `workspace_member_joined`
      after the membership row is created
- [x] `WorkspaceModule` imports `NotificationModule`

## PR 2 — Bell UI

- [x] Types — landed in `api/notifications.ts` alongside the fetchers rather
      than a separate `types.ts`; there was nothing to share between them
- [x] `use-notifications.ts` — React Query list / unread-count / read mutations
- [x] `use-notification-stream.ts` — `EventSource` → `queryClient.setQueryData`
- [x] `notification-item.tsx` — icon, sentence per type, `date-fns` relative
      time, click → document URL by `document.type`
      (`/s/ /d/ /p/ /f/ /n/ /b/`)
- [x] `notification-list.tsx` — items, empty state, "mark all read"
- [x] `notification-bell.tsx` — bell + badge + Popover
- [x] Mount in `components/site-header.tsx`, authenticated sessions only
      (no bell for anonymous share-link viewers)

## PR 3 — Comment wiring

- [x] Shared reporter in `components/comments/` so the three consumers cannot
      diverge; preview from `mentionBodyToPlainText(body).slice(0, 200)`
  - `comment_mention` → `extractMentionedUserIds(body)`
  - `comment_reply` → earlier comment authors **minus** this comment's mention
    recipients (otherwise one reply notifies the same person twice)
  - `thread_resolved` → all comment authors in the thread
- [x] `app/docs/comments/docs-comments-controller.ts` — report after CRDT write
- [x] `app/files/comments/pdf-comments-controller.ts` — same
- [x] Sheets comment path — same
- [x] Fire-and-forget: a failed report must not surface an error to the author

## Tests

- [x] `notification.service.spec.ts` — non-member recipients dropped, actor
      excluded, duplicate `commentId` → one row, preview truncation/sanitizing,
      404/403
- [x] `notification-hub.spec.ts` — publish/subscribe/unsubscribe, no
      cross-user leakage
- [x] `notification-stream.spec.ts` — initial summary on connect, hub and poll
      forwarded, an unchanged poll tick suppressed, pings do not disturb
      change detection
- [x] `test/notification.e2e-spec.ts` — JWT guard + real DB
      (`RUN_DB_INTEGRATION_TESTS`)
- [x] Frontend: route-URL construction + read-state transitions (non-JSX)
- [x] Manual smoke in `pnpm dev`: mention a second user, confirm badge updates
      live, dropdown opens the right document, "mark all read" clears
  - SSE confirmed live: `200 text/event-stream`, `X-Accel-Buffering: no`,
    summary on connect, instant push on the mention, push again on mark-read
  - Preview newline collapsing confirmed end to end
  - Bell renders with badge `2`; dropdown shows all three type sentences;
    "Mark all read" clears the badge and disables itself; clicking the
    mention navigates to `/s/<documentId>`
- [x] `pnpm verify:fast` green on every commit

## Known limitations

- The anonymous share-link view (`app/shared/shared-document.tsx`) does not
  pass `documentId`, so comments made there report nothing. The reporter
  already refuses to plan anything for a non-numeric actor id, so this only
  affects a *signed-in* member who reaches a document through a share link
  rather than the workspace.
- Reopening a resolved thread notifies nobody; only resolving does.

## Docs

- [x] `docs/design/README.md` — Common table entry (done with the design doc)
- [x] `packages/backend/README.md` — endpoint table + module tree entry
- [x] Fill in `20260810-notifications-lessons.md`
- [ ] `pnpm tasks:archive && pnpm tasks:index` before merge

## Review

<!-- filled in after implementation -->
