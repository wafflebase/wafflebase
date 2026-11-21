# Workspace Chat P1 — Lessons

Plan: [20261120-chat-p1-todo.md](20261120-chat-p1-todo.md) · Design: [chat.md](../../design/chat.md)

## Design phase

- Workspace membership already grants access to every document in the
  workspace, so Lark's "grant access when a link is shared" step has nothing to
  do here. An early flow mockup proposed a "3 people can't open this" warning;
  checking the access model before designing the flow would have caught it.
- A builder-check review of the design caught three gaps that would have
  stalled implementation: a column the delivery path depended on (`lastSeq`)
  was missing from the model, the per-user stream had no `:workspaceId` for
  `WorkspaceScopeGuard`, and document URLs carry no workspace. Run the check
  before handing a design over, not after.

## Self-review rounds

### Round 1 — correctness / tests (diff `0aa5b039e..HEAD`)

12 findings (2 blocking, 10 non-blocking; two pairs were duplicates).

| # | Finding | Verdict | Outcome |
|---|---|---|---|
| 1 | `useThreadMessages` starts without a cursor, gets the *newest* page, then pages forward from its tail and stops: a thread past 50 messages loses its root and oldest replies | Confirmed, blocking | Fixed: page forward from `after: 0`. `tests/components/chat/use-chat.test.tsx` (61-message thread against a fake that pages like `ChatMessageService.page`) fails before, passes after |
| 2, 8 | `openDm` returns an existing `dmKey` channel without the member rows `removeMember` deleted, so a re-added member gets 404 on that DM forever | Confirmed, blocking | Fixed: `openDm` restores the member set with `createMany(skipDuplicates)` (everyone was just checked to be a workspace member) and announces it. e2e `reopening a DM restores a member whose row was removed` |
| 4 | `join`/`invite` rows start at `lastReadSeq` 0, so the whole history and its old mentions read as unread | Confirmed | Fixed: new rows start at `channel.lastSeq`. e2e `joining or being invited starts the read position at the tail`. A restored DM member deliberately keeps 0: that history was addressed to them |
| 5 | Phone opens a channel rather than the list: `useIsMobile` is false on the first render and the restore effect runs then | Confirmed | Fixed: the effect also reads `window.innerWidth < MOBILE_BREAKPOINT` (now exported). No test: the page has no harness yet |
| 6 | One shared debounce timer: a message in workspace B cancels A's pending list refresh | Confirmed | Fixed: one timer per workspace. Stream test `debounces the channel-list refresh per workspace` |
| 7 | Text typed while a send is in flight is wiped when it resolves | Confirmed | Fixed: only clear when the box still holds the sent snapshot. Composer test |
| 12 | Desktop with a thread open shows two primary Send buttons (One Accent Rule) | Confirmed | Fixed: Send is `ghost` until there is something to send. Residual: two composers that both hold drafts both show syrup |
| 3, 9 | Edits and deletes emit no bus event; peers keep the old or deleted text until reload | Confirmed | Known limitation. Fixing it adds a bus/stream event kind, which changes the plan's binding `ChatBusEvent` / stream contracts. Do it in a follow-up rather than in a fix round |
| 10 | Chat mention fan-out allows 30 posts / 10 s × 20 recipients, ~6x the comment path's ceiling | Confirmed | Known limitation: the same per-recipient ceiling the notifications design already defers (`docs/design/notifications.md`) bounds both |
| 11 | The mention chip shows the author-typed `username`, unchecked against the id | Confirmed, inherited | Known limitation: the shared `parseMentionBody` renders comment mentions the same way; normalize on the server for both in one change |

Lesson: a paging loop that is wrong in its first iteration still passes every
test that fits in one page. Test any "fetch until short page" loop with more
than one page, against a fake that pages the way the server does.

### Panel round 1 (`/self-review`, six lenses)

Panel round 1 (correctness/test-adequacy weighting): blocked on 6 items —
(1) the last member could leave a private channel and orphan it; (2)
flattening an unresolved mention token could re-form a valid one
(`@[[FAKE](999999)](42)` stored as `@[FAKE](42)`); (3) `useChatStream` was
mounted in `AppSidebar` (seven mounts), so every list↔editor hop reopened the
stream and replayed `ready`'s blanket refetch; (4) `Conversation` had no
test; (5) `parsePayload` had no rejection test; (6) `useMarkRead` /
`usePostMessage` ran only behind mocks. Fixed all 6 plus minors 7–12 (hub
routing survives a rejection, delete takes its bell previews, `seq` capped at
`MAX_SAFE_INTEGER`, `memPayload`/`CHAT_NOTIFY_CHANNEL` exported and used by
`WorkspaceService`, bounded member reload + unref'd retry timer,
`alsoInChannel` on the `msg` event so the client counts such replies unread)
and the stale `prependAnchor` after an empty older page. Deferred: removing a
workspace member who is a private channel's sole member still orphans it;
`mentionCount` is a `LIKE '%](id)%'` substring match; `summaries` /
`summaryOf` carry no workspace check of their own; only posting is per-user
throttled (edit, channel create, invite are not); `mentionOutcome` notifies a
non-member about an archived public channel they cannot join; hub subjects
are not completed on shutdown; module-level chat caches (`exhausted`, open
channel, catch-up state) and the last-channel key survive sign-out;
notification → `chat-access` import couples the two modules; the 500-reply
thread cap, the rename/topic/archive routes with no UI and the extra
`ChatMessage` index are not in the design doc's "P1 as built"; untested:
`ChannelList` / sidebar badge rules, `useCoarsePointer`, backend
`normalizeChannelName`, and `chat-cache`'s identity-vs-equality nit.

Lesson: a sanitizer that rewrites part of its input is only safe if it is a
fixpoint. Stripping the brackets from a flattened name still left a trailing
`@` that the next text segment could close into a token (`@[](9)[](42)`); a
structural fuzz (nested tokens and near-tokens) found that in one run where
hand-picked cases and a character-level fuzz both passed. Assert
`f(f(x)) === f(x)` and the output invariant directly, over generated nested
input.

### Panel round 2 (`/self-review`, six lenses)

Panel round 2 (design-fit/blast-radius weighting): blocked on 5; fixed 1–4,
item 5 copy fixed + disputed (rebuttal). (1) A private channel's last member
who was neither creator nor owner could neither leave nor archive it —
`canManage` now lets any member manage a private channel; (2)
`refreshMessage` reused generation numbers after deleting the map entry, so
a slow edit could resurrect a delete — one module-wide counter that only
grows; (3) the hub spec's `findMany` ignored the workspace clause — the
harness now honours it and a test asserts the `where` (fails with the clause
removed); (4) `chat-page.tsx` had no test — `tests/app/chat/chat-page.test.tsx`
covers the deep-link thread open, `alsoInChannel`, the `?thread`
short-circuit and the desktop/phone last-channel restore, each
mutation-checked; (5) the duplicate-name `409` reveals a private channel's
name — kept (workspace-wide uniqueness is Slack parity and leaks no
content), but the `409` no longer echoes the name and the dialog no longer
claims a private channel cannot be found.

Lesson: a "nothing happened" assertion after a microtask flush proves
nothing when the effect under test waits on a React Query notification,
which is timer-batched. Two of the first chat-page tests passed against the
mutation they existed to catch; settle on a real timer, and mutation-check
every negative test before trusting it.

### Panel round 3 (`/self-review`, six lenses)

Panel round 3 (security/docs weighting): rebuttal on private-name 409 upheld
(security passed); blocked on 4 (removeMember orphan, thread reply marking
read, missing manage UI, untested reconnect) — all fixed after the round;
loop bound reached, no round 4. (1) `removeMember` deleted a last private
member's row around the `leave` guard — the removal now deletes any private
channel it empties, in the same transaction (unit + e2e: the name is free
again, a DM and a still-populated private channel survive); (2) a
thread-only reply moved the author's `lastReadSeq` to the channel tail —
only top-level and `alsoInChannel` posts advance it now, a thread-only one
joins with `DO NOTHING` (e2e both ways); (3) with no rename/topic/archive UI
the `leave` 409's "archive instead" was a dead end — summaries carry
`canManage` (DM → false, now in `chat-access` too), the actions menu offers
rename, topic, archive (confirmed in its dialog) and unarchive, and an
archived channel shows a read-only banner; (4) `ChatBus` reconnection was
untested — `chat-bus.spec` drives `error`/`end` → backoff → second connect
→ second `resets$`, plus a failed connect that also emits `error`
scheduling one reconnect (mutation-checked: removing both guards fails it;
a duplicate `error` on a connected client cannot, since `drop()` strips its
listeners first).

Lesson: a guard on one path (`leave`) is a claim about the state, not the
path — every other writer of the same rows has to keep it too.
`UserService.deleteUser`'s `ChatChannelMember` cascade has the same shape;
it has no caller today, so it is recorded here rather than fixed. When adding a refusal, grep for every other
statement that deletes the rows it protects.

### CodeRabbit round (PR #1186, 12 inline findings)

| Comment | Finding | Verdict | Outcome |
|---|---|---|---|
| 4651539648 | A bus reconnect clears the hub cache but tells no open stream, so a quiet channel misses what the outage swallowed | Real | `d73f08249`: hub sends `ready` to every open stream on each bus connection (the first too). `chat-hub.spec` `tells every open stream to catch up…`, `chat-stream.spec` `passes a hub resync on as another ready` |
| 4651539654 | Listener connect has no deadline; a stalled handshake holds boot | Real | `d73f08249`: `connectionTimeoutMillis` + `query_timeout` 10 s. `chat-bus.spec` |
| 4651539659, 4651539667 | A failed `mem` NOTIFY with the listener up leaves a removed member in the cache forever | Real | `d73f08249`: member sets expire after `MEMBER_CACHE_TTL_MS` (60 s). Events are ids only and every fetch re-checks access, so a bounded window is the trade-off rather than a per-event query. `chat-hub.spec` `expires a cached member set…` |
| 4651539664 | A load in flight across a reset re-caches a stale set | Real | `d73f08249`: generation counter; a load that straddles a reset is reloaded. `chat-hub.spec` `does not cache or deliver a member set loaded across a reconnect` |
| 4651539665 | An edit racing a delete writes the body back | Real | `d73f08249`: `updateMany` on `deletedAt: null`, 0 rows → 404, no announce. e2e `an edit racing a delete cannot restore the deleted body` |
| 4651539668 | A rerun starts at a tail a local post moved | Real | `ee75059c3`: reruns keep the earliest requested start. Stream test `a rerun starts from the earliest hint…` |
| 4651539672 | A channel that loaded empty never catches up | Real | `ee75059c3`: loaded-empty catches up from seq 0. Stream test `fetches from the start when the open channel loaded empty` |
| 4651539673 | An older message refresh finishing last undoes a newer one | Real | `ee75059c3`: per-message generation. Stream test `an older refresh finishing last…` |
| 4651539675, 4651539678 | `ready` does not refresh threads, and misses edits/deletes before the tail | Real | `ee75059c3`: `ready` re-reads the open channel's loaded range (`after = oldest − 1`) in place and invalidates threads and other cached channels. Stream tests `ready event refetches the open channel's loaded range…`, `ready event invalidates thread caches…` |
| 4651539680 | Long-press `touchend` preventDefault eats taps in the portalled sheet | Real | `ee75059c3`: guarded by `own(e)`. `message-item.test` `does not swallow a tap inside the sheet…` |

The summary body's 20 minor/trivial items (chat-channel join/invite tail race
and DM-restore `lastReadSeq`, null name/topic DTO, mention-id and cursor
bounds, archive check on edit/delete, post vs removal race, thread-reply
notify after mention failure, e2e cleanup/ordering, DM unread count, chat-page
restore after leave, dialog request race, conversation viewport/prepend
anchor, composer draft mentions and serialized length, URL parens, midnight
grouping, design-doc membership serialization, cache-update test timing) were
not addressed in this round; they are listed for a follow-up triage. The DM
restore one is a deliberate choice already recorded in Round 1 (#4).

Lesson: "a missed event self-corrects on `ready`" is only true if something
sends `ready` for every way an event can be missed — a client reconnect, a
server-side listener reconnect, and a best-effort NOTIFY that failed — and if
`ready` reconciles state rather than only appending past a tail. Enumerate the
loss paths and the kinds of change (append, edit, delete, thread) before
claiming self-correction.
