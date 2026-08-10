# Notifications — Lessons

Design: `docs/design/notifications.md`. Todo: `20260810-notifications-todo.md`.

## From the design phase

- **Sharing here is link-token based, so "shared with you" has no recipient.**
  `CreateInviteDto` takes only `{ role, expiration }` and `ShareLink` carries a
  token, not a target user — no action in the product names a person. The
  original scope ("comments + share/invite") had to be re-cut to
  `workspace_member_joined` on the accept side, which is the one user-targeted
  event that exists. Check that an event *has* a recipient before designing a
  notification for it.

- **Yorkie `doc.broadcast()` cannot deliver notifications.** It is
  document-scoped and ephemeral — only clients currently attached to that
  document receive it, and a notification recipient is by definition not in the
  document. The viable Yorkie route was a per-user `notification-<userId>`
  inbox document written by the backend, which was rejected because
  `YORKIE_AUTH_WEBHOOK_ENFORCE` still defaults to `false`
  (`document/yorkie-auth.controller.ts`): until enforcement is on, any client
  could attach to another user's inbox key.

- **Comments live in the CRDT, not Postgres.** docs and pdf store threads at
  `root.comments[threadId]`, sheets at
  `root.worksheets[tab].comments[threadId]`. The backend has no idea a comment
  was posted, which is why the client reports and the server only authorizes.

- **Server-side content verification is more expensive than it looks.**
  `withDocument()` loads the whole document, the client's write may not have
  synced yet when the report lands, and each document type needs its own
  thread-lookup adapter. Verifying *who may notify whom* captures most of the
  security value at none of that cost.

- **Watch the module cycle.** `WorkspaceService.acceptInvite()` calls into
  `NotificationService`, so `NotificationService` must not inject
  `WorkspaceService`. Its membership check is one `workspaceMember.findUnique`.

## From the implementation phase

<!-- filled in during implementation -->
