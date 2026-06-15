# Slides text box border / fill not rendered

## Problem

Setting a text box border (color + weight) or background fill via the
slides toolbar persists the values to the model (`TextElement.data.stroke`
/ `data.fill`) but they never appear on the canvas.

## Root cause

`view/canvas/text-renderer.ts` (`drawText` → `paintTextBody`) only paints
the rich-text glyphs and the placeholder hint. It never reads
`data.stroke` or `data.fill`, so the text-box frame decorations are never
drawn. Shapes work because `drawShape` (`shape-renderer.ts`) paints
`data.fill` / `data.stroke`; the text path has no equivalent.

The write path is correct: `text-element-controls.tsx` →
`store.updateElementData(slideId, id, { stroke | fill })` →
`yorkie-slides-store.ts` persists the keys.

## Plan

- [x] Investigate & confirm root cause (render-side gap)
- [x] Failing test: `drawText` paints fill rect + stroke rect from `data`
- [x] Failing test: border paints even when the text body is empty
- [x] Implement: paint box fill + stroke (with dash) at top of `drawText`,
      before the empty-body early return; reuse `resolveStrokeColor`
- [x] `pnpm verify:fast` (exit 0)
- [x] Self code review over branch diff
- [ ] Manual smoke in `pnpm dev`

## Review

Added `paintTextBoxDecorations` in `text-renderer.ts`, called at the top
of `drawText` before the empty-body early return so a bordered-but-empty
text box still shows its border. Reuses `resolveColor` (fill) and
`resolveStrokeColor` (border) and a `strokeDashPattern` helper matching
the table renderer (dashed `[6,4]`, dotted `[2,2]`).

The fix lives in the single shared `drawText` chokepoint
(`drawSlide → drawElement → drawText`), so borders/fills now render in the
editor, thumbnails, presentation mode, and canvas-based PDF export.

Transform safety: decorations paint inside the counter-flip transform, but
a `(0,0,w,h)` rect is invariant under flip-about-center, so flipped boxes
draw correctly; rotation comes from the parent transform so the border
rotates with the box.

5 new unit tests in `text-renderer.test.ts`; full slides suite
(1779 passing) and `pnpm verify:fast` green.

### Follow-up: decorations disappeared in text-edit mode

After the render fix, entering text-edit mode made the border/fill vanish
(shapes were fine). Root cause: `maskEditingElement` (editor.ts) dropped
the whole TextElement during edit — harmless before, but now it also
dropped the new fill/border. Shapes only strip `data.text`, keeping
fill/stroke.

Fix: mask the editing text element like a shape — keep the element, clear
`data.blocks` (so the body isn't double-painted), and drop
`placeholderRef` (so the ghost hint doesn't paint behind the active
editor). Exported `maskEditingElement` and added
`mask-editing-element.test.ts` (6 tests; verified red against the old
drop-entirely behavior, green after). Full slides suite (1785) +
`verify:fast` green.
