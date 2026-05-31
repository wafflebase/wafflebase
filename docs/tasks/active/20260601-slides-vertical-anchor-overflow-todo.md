# Slides — vertical anchor overflow parity with PowerPoint

## Context

PPTX import sets `TextElement.data.verticalAnchor` from `<a:bodyPr anchor>`
(`top`/`middle`/`bottom`). On slide 22 of `Yorkie, 캐즘 뛰어넘기.pptx` the right-
side description text boxes use `anchor="ctr"` with a fixed `cy` that ends up
slightly smaller than the laid-out text (12pt × 2 lines + `<br/>` ≈ 70px in a
~69px frame). PowerPoint and Google Slides keep the anchor relationship on
overflow — middle stays centered (text extends both above and below the
frame), bottom stays anchored to the frame bottom (text extends above).
Wafflebase currently clamps to top on any overflow, breaking visual parity.

Root cause: `computeVerticalOriginY` in `packages/slides/src/view/canvas/
text-renderer.ts` wraps the offset in `Math.max(0, ...)`. An accompanying
test (`text-renderer.test.ts:133` — "falls back to top-anchored when content
is taller than the frame") and the function's doc comment enshrine the
clamp as intentional, but it diverges from PPT/GS.

## Goal

Make middle/bottom anchors preserve their anchor position on overflow, so a
faithfully imported PPTX renders identically. Keep top unchanged.

## Checklist

- [x] Create feature branch `slides-vertical-anchor-overflow-parity`
- [x] Write this task doc
- [ ] Update `computeVerticalOriginY` in `packages/slides/src/view/canvas/text-renderer.ts:210-218`
      - `middle`: return `(frameH − contentH) / 2` (no clamp)
      - `bottom`: return `frameH − contentH` (no clamp)
      - `top` (and absent): return `0` (unchanged)
- [ ] Update the doc comment (`:198-209`) to describe the new semantics
- [ ] Rewrite the test "falls back to top-anchored when content is taller than the frame" → "keeps the anchor on overflow"
      - middle anchor + tall content → baseline near `−contentH/2`
      - bottom anchor + tall content → baseline near `frameH − contentH`
      - top anchor + tall content → baseline near `0` (unchanged)
- [ ] Update `docs/design/slides/slides-themes-layouts-import.md:438` to note overflow now preserves anchor (PPT parity)
- [ ] `pnpm verify:fast`
- [ ] Self-review the full diff (`/code-review` skill)
- [ ] Commit, push, open PR
- [ ] Archive task (`pnpm tasks:archive && pnpm tasks:index`)

## Notes

- Canvas has no clip-rect over text painting (verified in `text-renderer.ts`
  and `element-renderer.ts`), so allowing a negative `originY` simply paints
  beyond the frame into the surrounding slide canvas — matching what PPT
  produces on the same input.
- For extreme overflow (e.g. dozens of paragraphs in a tiny frame) middle
  anchor will clip top content off-canvas. This matches PPT exactly; users
  with that issue should use `<a:normAutofit>` (`autofit: 'shrink'`), which
  already shrinks the type to fit before anchor offset is computed.
- No other callers of `computeVerticalOriginY` exist (it's module-private).
  `paintTextBody` is the single entry point, used by both `drawText`
  (text elements) and `paintShapeText` (shapes with inline text).
