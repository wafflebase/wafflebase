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

- **`verify:fast` does not lint the backend.** It runs `pnpm backend test`
  but no backend `eslint`, so `packages/backend/src/**/*.spec.ts` carries
  pre-existing `no-unsafe-member-access` and prettier violations that the gate
  never sees. Lint your own new backend files explicitly
  (`npx eslint "src/<module>/**/*.ts"`) — the gate will not do it for you.

- **`eslint --fix` reformats files you only happened to name.** Running it
  over a directory reformatted three workspace files that had no functional
  change. Revert those (`git checkout HEAD -- <path>`) before committing;
  otherwise the diff buries the real change in prettier noise.

- **The frontend `tsconfig.app.json` has ~300 pre-existing errors.** `tsc
  --noEmit` there is not a pass/fail signal — grep the output for your own
  paths. The real frontend gate is `lint` + `test` + `build`.

- **`clearDatabase` in `test/helpers/integration-helpers.ts` is hand-written**,
  so a new model needs a line there. Cascades would have covered
  `Notification` here, but relying on that makes the next model's omission
  silent.

- **The Edit tool cannot round-trip literal control characters.** Writing a
  `[\u0000-\u001F]` character class produced a mangled class that matched a
  space. Write the escapes via a line-indexed node rewrite and read the result
  back before trusting it.

- **`throttler.spec.ts` flakes under full-suite parallel load** — it exercises
  real ttl-based rate limiting. It passes alone and on re-run; it is unrelated
  to whatever you changed.

- **Testing an assumption beat assuming it.** The `?before=` cursor depends on
  the global `ValidationPipe` having `transform: true`. It does — but the
  integration test that proves it also proves a malformed cursor 400s instead
  of being silently dropped, which no amount of reading the config would have
  shown.

- **The anonymous-actor guard came out of a test, not the design.** Writing
  "plans nothing when the acting user is anonymous" as a failing test revealed
  the reporter happily firing requests that could only ever return 401.

- **Prisma `include` publishes the whole row.** The list endpoint was handing
  clients `dedupeKey`, `recipientId`, and `workspaceId` — visible only once
  the response was read during the live smoke, not in any unit test. Prefer an
  explicit `select` for anything a client sees.

## From code review

- **An optional field that keys a unique index is a suppression bug.**
  `commentId` was optional for every notification type, and mention/reply fell
  back to a thread-wide dedupe key. Since the key is shared by every later
  comment in that thread, the unique index would swallow all of them — one
  notification per thread, forever. When a column feeds `@@unique`, ask what
  happens when it is absent; "the client always sends it" is not an answer.

- **A cursor needs a tiebreak, not just an order.** `orderBy` on
  `(createdAt, id)` makes paging *stable*; it does not make it *complete*. A
  `createdAt`-only cursor still skips every row sharing the boundary instant,
  and one report inserts its whole batch at one instant. Both halves are
  needed.

- **Test the tree you ship, not the hook you changed.** React Query's
  `invalidateQueries` only refetches *active* queries. A `renderHook` test of
  the mutation alone passes whether or not the invalidation exists. Mounting
  `useUnreadCount` alongside it — the way the bell does — is what makes the
  test able to fail. Always confirm by removing the fix and watching red.

- **Optimistic writes need an authoritative follow-up.** Deriving the badge
  from the mutation's own inputs races the stream: a notification that arrives
  between the server's write and the response resolving gets erased. Write
  optimistically for feel, then invalidate for truth.

- **A hung Puppeteer click usually means the element is not there.** The
  backend restarted mid-session (tsc watch), `/auth/me` 401'd, the app
  redirected to `/login`, and the click waited on a selector that no longer
  existed. Screenshot before concluding the renderer is wedged; a wedged CDP
  session then needs `launchOptions` passed to force a browser restart.
