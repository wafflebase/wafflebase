# Chat: default #general + first-run and P1/P2 fixes

Source: `/impeccable critique` of workspace chat (v0.6.18), 23/40 —
`.impeccable/critique/2026-11-21T14-29-14Z__packages-frontend-src-app-chat.md`.

Decisions (user, 2026-11-21): Slack-style default channel; scope = #general +
the P1/P2 bugs; sidebar badge counts mentions + DMs only.

## Default channel (#general)

- [x] `ChatChannel.defaultKey` (unique, = workspaceId; the `dmKey` idiom)
- [x] Migration backfill: adopt an existing public `general` (unarchive it)
      or create one; every workspace member joins at the channel tail
- [x] `src/chat/default-channel.ts`: `createDefaultChannel(tx, ws, owner)`,
      `joinDefaultChannel(tx, ws, user)` — one author for every create path
- [x] Wire into `WorkspaceService.create`, `UserService` signup workspace,
      `WorkspaceService.acceptInvite` (+ mem notify)
- [x] Refuse leave + archive of the default channel (rename stays allowed)
- [x] `ChannelSummary.isDefault`; `GET channels/:cid/members`
- [x] e2e: create/invite/leave/archive/backfill-shaped cases

## Frontend

- [x] Bare `/chat` on desktop: last channel only if still a member, else
      the default channel (fixes leave → bounce back into the left channel)
- [x] Hide Leave / Archive on the default channel
- [x] Add people: pass current members as `excluded`
- [x] Member picker: "You're the only one here" + invite link when empty
- [x] Continuation-row hover time: compact, no wrap
- [x] Channel list error state (not the empty state)
- [x] Empty-state "Browse channels" opens the Browse tab
- [x] Connection state: "Reconnecting…" / "Live updates stopped" line
- [x] Sidebar badge: mentions + DM unread only
- [x] Tests for each

## Docs

- [x] `docs/design/chat.md` default channel section; backend README

## Review

- Backend: unit 201 (chat/workspace/user) + chat e2e 52 green on an isolated
  `wafflebase_chat_test` database (the e2e helper's default URL is the dev DB,
  which `clearDatabase` wipes). Backfill SQL checked by hand on crafted rows:
  public `general` adopted + unarchived (existing read position kept, new
  member at tail), missing one created and owned by the owner, private
  `general` left alone; a second run is a no-op.
- Frontend: chat tests 125 → 133, `verify:fast` green.
- Not verified in a browser: the local stack needs a GitHub login, and the
  :3000 backend is another checkout. The visible changes are copy, a link, a
  status line, and the gutter time (covered by a unit test).

## Known limitations (not in scope)

- Archived channels still vanish from every list (unarchive by URL only)
- Unread divider / new-messages pill, member list panel, ⌘K, doc link chips
