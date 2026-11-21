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
