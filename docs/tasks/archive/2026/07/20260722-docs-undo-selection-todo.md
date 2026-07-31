# Docs — Undo/redo restores the selection range, not just the caret (#340)

## Context

Undo restored the caret but collapsed the selection: after undo you got a
bare caret, losing the highlight (Google Docs restores the selection). Two
causes: (1) the docs Yorkie store recorded only `activeCursorPos` in the
undo-history presence set — never `activeSelection`; (2) the editor's
`undoFn`/`redoFn` only moved the caret, never re-applied a range.

## Work

- [x] Store (`packages/frontend/src/app/docs/yorkie-doc-store.ts`):
  - `DocsSelection` type = `NonNullable<DocsPresence['activeSelection']>`.
  - `setCursorForHistory(pos, selection?)` widened; flushes the pre-edit
    selection to presence synchronously via `updateCursorPos` (defeats the
    throttle race — Yorkie captures the *current* presence as the reverse).
  - New private `recordHistoryPresence(p, cursor, selection?)` — sets both
    `activeCursorPos` and `activeSelection` (defaulting to a **concrete
    collapsed range** at the caret, never `undefined`, so the key is tracked)
    with `{ addToHistory: true }`. Replaced all 21 recording sites with it.
  - New `getPresenceSelection()` reader mirroring `getPresenceCursorPos()`
    (with the `getPresenceForTest` offline/test fallback).
- [x] Editor (`packages/docs/src/view/editor.ts`):
  - Both `setCursorForHistory` call sites now pass
    `selection.hasSelection() && selection.range ? selection.range : null`.
  - `undoFn`/`redoFn` call a shared `restoreSelectionFromPresence()` that
    reads `getPresenceSelection()`, guards block existence + clamps offsets
    (mirroring the caret restore), then `selection.setRange(...)`; collapsed
    / missing / stale-block → `setRange(null)`.
- [x] Tests (`packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`):
  undo restores range, redo collapses, applyStyle undo restores range,
  two-unit type-over restores on the second undo. Existing caret tests stay
  green.
- [x] docs typecheck + 1105 tests, frontend typecheck + 862 tests — all green.

## Notes / follow-ups

- Type-over (`deleteText` + `insertText`) is **two undo units** by design
  (see the IME comment in `text-editor.ts`), so the real editor restores the
  original selection on the *second* undo — matches Google Docs.
- R4 (deferred): redo of a style op shows a caret (collapsed default) rather
  than re-highlighting; optional upgrade = pass the styled range as the
  helper's `selection` arg in `applyStyle`/`applyCellStyle`.
- Manual in-app repro needs the full stack (not runnable locally under the
  corporate EDR); covered by store unit tests instead.
