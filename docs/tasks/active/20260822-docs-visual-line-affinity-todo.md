# Thread lineAffinity through getVisualLine* (issue #67)

## Problem

PR #65 added `cursor.lineAffinity` to disambiguate the caret at a visual
wrap boundary: at an offset that is simultaneously the end of visual line
`i` and the start of line `i + 1`, `'backward'` means "render/act on line
`i`", `'forward'` means line `i + 1`.

`getVisualLineRange()` / `getVisualLineStart()` / `getVisualLineEnd()` in
`packages/docs/src/view/text-editor.ts` (and the `findVisualLine()` helper
they delegate to) resolve the boundary by offset alone, always picking the
later line — i.e. they behave as if affinity were always `'forward'`.

The issue calls this "currently safe" because `getVisualLineEnd()` trims
trailing spaces on wrapped lines, so `End` never lands exactly on the
boundary. That holds only for space-wrapped text: a long unbroken token
takes layout's character-level wrap fallback, where the boundary has no
trailing space to trim. There, `End` lands exactly on the boundary with
`'backward'` affinity and the caret is drawn at the end of line `i`, yet:

- `Home` resolves the boundary to line `i + 1` and moves to its start —
  the same offset — so `Home` appears to do nothing.
- `End` again jumps to the end of line `i + 1` (walking down the paragraph).
- `Cmd/Ctrl+Backspace` sees `lineStart === pos.offset` and falls into the
  "delete to block start" branch, deleting every earlier visual line.

`ArrowLeft` from the start of line `i + 1` reaches the same state.

## Plan

1. `packages/docs/src/view/visual-line.ts` — add a third
   `lineAffinity` parameter to `findVisualLine()`, defaulting to
   `'forward'` so the existing `moveVertical()` caller and its tests keep
   their behaviour. With `'backward'`, an offset equal to a non-last
   line's end resolves to that line.
2. `packages/docs/src/view/text-editor.ts` — thread `lineAffinity`
   (defaulting to `this.cursor.lineAffinity`) through
   `getVisualLineRange()` / `getVisualLineStart()` / `getVisualLineEnd()`,
   including the table-cell branch of `getVisualLineRange()`, which walks
   cell lines with its own inline loop.
3. Tests:
   - unit: `findVisualLine` boundary resolution under both affinities
     (`packages/docs/test/view/visual-line.test.ts`).
   - integration: jsdom editor over a character-wrapped paragraph —
     `End` then `Home` returns to the start of the caret's own visual
     line, `End` twice does not walk down, `Cmd+Backspace` deletes only
     that visual line.

## Acceptance criteria (from the issue)

- [x] `getVisualLineRange()`, `getVisualLineStart()`, `getVisualLineEnd()`
      consult `cursor.lineAffinity` when the offset coincides with a wrap
      boundary, so navigation (`Home`/`End`) and deletion
      (`Cmd/Ctrl+Backspace`) act on the visual line the caret is drawn on.

## Non-goals

- Changing `moveVertical()`'s boundary resolution (it hit-tests pixels
  with the affinity already and its `findVisualLine()` use is only a
  first/last-line check).
- Any change to the affinity model itself, or to trailing-space trimming.
