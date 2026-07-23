# Lessons — Undo/redo selection restore (#340)

## What broke

Undo history recorded the caret (`activeCursorPos`) but not the selection
(`activeSelection`), and the editor's undo/redo only moved the caret. So undo
placed a bare caret and dropped the highlight.

## Lessons

- **Yorkie presence-with-history reverses only the keys you set.** `p.set(x,
  { addToHistory: true })` records a reverse for exactly the keys in the
  partial. `activeSelection` was never in the partial, so undo never restored
  it. The fix is simply to include the key — the "restored value" is Yorkie's
  reverse (the pre-edit presence), not something we stash.

- **Set a concrete collapsed range, never `undefined`.** A key set to
  `undefined` can be dropped during (esp. networked) presence serialization,
  so its reverse may not be recorded. A collapsed range (`anchor === focus`)
  guarantees the key is tracked and reads as "no selection" (`hasSelection()`
  is false for it), which is the correct post-edit/redo state.

- **The reverse is captured from *current* presence, so timing matters.** The
  live cursor publish is throttled, so "select then immediately type" could
  record a stale selection. `setCursorForHistory` now flushes the pre-edit
  selection synchronously before the mutation. This was the non-obvious race
  (R2) — the fix only works because the pre-edit selection is guaranteed to be
  in presence at mutation time.

- **Restoring presence ≠ restoring the view.** Undo puts the range back into
  Yorkie presence, but the editor's `Selection` object (the visible
  highlight) doesn't update itself — `undoFn`/`redoFn` must read it back and
  call `selection.setRange`, exactly as they already did `cursor.moveTo` for
  the caret.

- **A shared helper turned 21 near-identical sites into one change** (same
  pattern as the earlier baseline dedup): the selection support fell out for
  free once every recording site routed through `recordHistoryPresence`.

- **Type-over is two undo units, and that's fine.** `deleteText` +
  `insertText` are separate `doc.update`s; the delete unit carries the
  pre-edit selection, so the original highlight returns on the second undo —
  matching Google Docs. Don't fight the unit boundary; test it.
