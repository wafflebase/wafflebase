# Keep the board text edit open across collaborator activity

**Created**: 2026-11-28

On a shared board, typing into a sticky intermittently stops showing and the
text lands later — or lands in the wrong place. Reproduced on two clients
(the second a Node Yorkie peer): one remote edit, or one peer selection
change, ends the local edit mid-sentence. The next keystroke re-enters
through type-to-edit with the caret at the start, so `abc` + `def` became
`defabc`.

Root cause: `markDirty()` (every remote change) and a chrome-changing
`setPeers` rebuild the editor's DOM overlay, and `renderOverlay` cleared it
with `overlay.innerHTML = ''`. That detached the in-place text box and its
hidden IME textarea; Chrome fires `blur` on the removal, which commits and
closes the edit (and cuts off any IME composition). `paintOverlay`
re-appended the box afterwards, too late.

## Plan

- [x] Failing regression test with the real text box:
      `packages/slides/test/view/editor/remote-change-text-focus.test.ts`
      (`markDirty` and selection/drag `setPeers` keep the textarea attached
      and focused).
- [x] Reproduce in the browser: two clients on one board, remote edit and
      presence change both end the local edit (detached 1, blur 1).
- [x] `renderOverlay` clears only chrome: children marked
      `data-overlay-persistent` (text-box container, peer-cursor layer) stay
      mounted; fresh chrome is moved in front of them so z-order is
      unchanged and the persistent nodes are never moved.
- [x] Editor marks the text-box container (any `mountTextBox`) and the
      peer-cursor layer persistent; update
      comments that describe the old detach.
- [x] Unit tests green: new test, overlay/editor suites.
- [x] Browser re-check with the same two-client scenario.
- [x] `pnpm verify:fast`.

## Review

- Fix lives in `renderOverlay` (`packages/slides/src/view/editor/overlay.ts`):
  one place, so every overlay path (markDirty, setPeers, selection, gesture
  repaints, crop) keeps the box mounted. `reattachEditingTextBox` is gone —
  the box never leaves the tree.
- Tests: `remote-change-text-focus.test.ts` (failed before, passes now),
  plus an `overlay.test.ts` case pinning that persistent nodes are never
  removed and stay after the chrome. Slides suite: 371 files, 3126 passed.
- Browser (two clients, Node Yorkie peer sending 3 remote edits then 3
  presence changes): before — detached 1, blur 1, edit closed, `abc` +
  `def` → `defabc`; after — detached 0, blur 0, still editing, `abcdef`.
- Not verified: real OS Hangul IME composition across a remote change (the
  browser driver cannot drive the IME). The textarea now never detaches, so
  the composition has nothing to cut it off.
- The peer-cursor layer is inserted below an open text box, so the box stays
  the topmost overlay child as it was when it was re-appended last.
- Entering a new edit tears down the previous box even when its
  blur-driven commit was a no-op (focus on a keepalive control) — it is
  persistent now, so the old `innerHTML` wipe no longer reaps it.
