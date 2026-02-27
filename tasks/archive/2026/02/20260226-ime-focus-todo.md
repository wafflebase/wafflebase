# TODO

- [x] Identify IME entry path and isolate the composition break point
- [x] Patch worksheet input routing to keep IME composition intact on edit entry
- [x] Add/adjust unit tests for the new IME routing behavior
- [x] Run targeted sheet view tests
- [x] Re-check IME first-keystroke composition flow with focus/selection handling
- [x] Patch `CellInput.show()` and text-range fallback for empty contenteditable
- [x] Re-run focused sheet view tests after IME fallback patch
- [x] Introduce primed cell-input focus model for selected-cell state
- [x] Route keydown with primed focus through grid keymap while preserving native text/IME insertion
- [x] Re-prime input after selection movement (mouse/keyboard/programmatic focus)
- [x] Re-run focused sheet view tests after structural focus update
- [x] Prevent primed focus state from committing blank cell values in `finishEditing`
- [x] Keep primed pointer-events disabled during placement updates
- [x] Add regression tests for primed commit guard and pointer-events stability
- [x] Re-prime selection after editor-level Enter/Tab/Arrow commit navigation
- [x] Add editor keymap expectations for re-prime after commit navigation

## Review

- Root cause candidate: grid-level edit entry used a generic printable-key path
  for IME-triggered key events, and keyup synchronization still ran while IME
  composition state could be active.
- Fix: added composition-aware entry handling (`compositionstart` listener +
  dedicated IME key rule) and skipped keyup synchronization while either input
  is composing.
- Verification: `pnpm --filter @wafflebase/sheet test -- test/view/worksheet-keymap.test.ts test/view/worksheet-editor-keymap.test.ts`
  passed (35 files, 525 tests; Vitest ran the package suite with filters).
- Follow-up fix: keyboard-entry path no longer forces caret placement on first
  editor open; empty-content selection fallback was added in `setTextRange` to
  avoid invalid/unanchored ranges during initial IME entry.
- Structural update: selected-cell idle state now keeps focus on a hidden
  "primed" cell input. Typing/composition activates visible editing in-place,
  while arrow/tab/shortcut handling continues through grid key rules.
- Review fixes: `finishEditing` now skips persistence for primed state, and
  `CellInput.updatePlacement` no longer re-enables pointer events while primed.
- Follow-up bug fix: editor key handlers now call `primeCellInputForSelection()`
  after commit-and-move (Enter/Tab/Arrow), preventing IME first-keystroke
  regressions right after moving to the next cell.
