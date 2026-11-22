# Chat usability pass

Follow-up to the 2026-11-21 Impeccable critique of workspace chat
(`.impeccable/critique/2026-11-21T14-29-14Z__packages-frontend-src-app-chat.md`),
re-checked against `main` at `1ca5c8e3a`: the findings still open are
channel membership visibility, archived channels, unread orientation in
the conversation, and coarse-pointer targets. Document cards, the editor
chat panel and P3 bot/API work stay out of scope (`docs/design/chat.md`).

Implemented in parallel by three agents with disjoint file ownership,
merged into one branch.

## A — Channel members
- [x] Backend: `DELETE /workspaces/:wid/chat/channels/:cid/members/:userId` —
      `canRemove`: channel creator or workspace owner, an owner only by an
      owner; not a DM, not the default channel, not yourself (that stays
      `members/me`); 404 on an unreadable channel
- [x] Backend tests (controller/service spec)
- [x] Frontend: Members entry in the channel header → members dialog
      (list, Add people, Remove for authorized callers)
- [x] Thread close button gets a coarse-pointer 44px target

## B — Archived channels + list targets
- [x] "Archived" section/toggle in the channel list so Unarchive is reachable
- [x] Browse dialog can show archived channels
- [x] Section "+" buttons get a coarse-pointer 44px target and an accessible name

## C — Unread orientation
- [x] "New messages" divider at the first unread message when opening a channel
      (placed from `(lastReadSeq, lastSeq]`, both now on the channel summary)
- [x] "Jump to latest" pill when scrolled up and new messages arrive

## Integration
- [x] Merge A/B/C, `pnpm verify:fast` green
- [x] Update `docs/design/chat.md` + backend README route table
- [x] Self-review rounds logged in lessons
- [ ] PR

## Review

Three parallel agents (members / archived / unread) in one checkout with
disjoint file ownership, each followed by an independent reviewer; two
blockers from those reviews fixed test-first. Self-review: round 1 blocked
on removal authorization (now `canRemove`) and a missing e2e; round 2 clean;
a design-fit second opinion led to replacing the count-back divider with
the summary's read position; round 3 blocked on stale test fixtures, fixed.
Chat unit/component tests 185 frontend + 166 backend, chat e2e 58/58 on a
scratch database, `verify:fast` green on every commit.

Not done: no live-browser check or Before → After mobile captures — the
local backend was not running and the dev database had been emptied by an
agent's e2e run (see lessons).
