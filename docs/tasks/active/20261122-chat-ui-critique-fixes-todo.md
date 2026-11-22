# Chat UI critique fixes

Source: `/impeccable critique` of the chat UI (2026-11-22, 25/40,
`.impeccable/critique/2026-11-22T06-01-10Z__packages-frontend-src-app-chat.md`).
Scope: every P1–P3 issue plus the minor observations. Docked editor panel
and search stay P2/P3 of `docs/design/chat.md` and are out of scope.

## Message surface (conversation / thread / message item / body)

- [x] Move live announcements off the scroller: plain labelled region for
      the log, sr-only polite region announcing only tail arrivals
- [x] sr-only "author, time" on continuation lines; separators readable
- [x] Roving tabindex over messages (one tab stop, ↑/↓, Enter/`.` for actions)
      so the hidden toolbar no longer floods the tab order
- [x] Copy text + copy link on desktop for every message
- [x] Neutral mention chips; self-mention chip + line in the butter wash
- [x] Same-origin Wafflebase links route in-app (same tab)
- [x] "Show more" collapse for very long bodies
- [x] Gutter time ≥ 11px (DESIGN.md Micro rule)
- [x] Retry button on failed message load
- [x] Thread: "Join to reply" for non-members of a public channel
- [x] Mention autocomplete in the edit box

## Composer + send

- [x] Combobox semantics for the mention listbox
- [x] ↑ in an empty composer edits the caller's last message
- [x] Optimistic send: pending row, "Not sent · Retry" on failure
- [x] Shift+Enter hint

## Page shell (chat page / channel list / dialogs)

- [x] Persistent "Browse channels" row with unjoined count
- [x] Previewed (unjoined) channel shows a transient row
- [x] Dialog titles match their tabs (Create / Browse)
- [x] Leave: Undo toast for public, confirm for private
- [x] Esc closes the thread and restores focus
- [x] Alt+↑/↓ between channels, ⌘K channel switcher
- [x] `document.title` reflects channel + unread
- [x] Topic reachable on mobile
- [x] Group DM avatar reads as a group

## Verify

- [x] `pnpm verify:fast`
- [x] Before → After at 393×659
- [x] Self review (3 rounds, stopped at the bound)

## Review

- Three parallel agents (message surface / composer / page shell) on
  disjoint files, integrated by hand; then three self-review rounds plus a
  `requesting-code-review` pass. Every round blocked on something real; the
  third still did, its findings were fixed without a fourth panel round.
- The after-screenshots caught one regression no test did: making the Chat
  page own the tab title had also blanked the header title, because Layout
  passes the same value to both. `routeTitle` now returns the header title
  and a separate `pageOwnsTab` flag.
- Known limitations (PR body): a post whose response alone is lost shows as
  failed beside its delivered copy; `modalSurfaceOpen` duplicates board's
  selector; a focused pending row loses focus when the server row replaces
  it; the docked editor chat panel and search remain P2/P3.
