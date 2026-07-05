# Lessons — PPTX text body insets

## What the bug actually was

"Text shifted to top-left inside circles" looked like a vertical-anchor or
centering bug, but the real cause was **dropped `<a:bodyPr>` insets**. The
labels were separate `txBox="1"` boxes (not text inside the ellipses), and the
source centered a single glyph purely with large symmetric insets
(`lIns=tIns=rIns=bIns=91425` EMU). With insets ignored, a text element renders
at inset `0` → glyph at the exact (0,0) corner.

## Debugging patterns that paid off

- **Read the source XML before touching code.** Confirming the label was a
  `txBox="1"` (→ TextElement path, inset `0`) vs a shape (→ `SHAPE_TEXT_PADDING`
  path) changed which render path the fix had to target. An early wrong
  assumption (shape padding) would have produced a smaller, still-wrong shift.
- **Map the display order → rId → file** via `presentation.xml` `sldIdLst`
  before trusting `slide13.xml` == "13th slide". Here it matched, but the rels
  numbering is not the display order in general.
- **Verify against the real artifact**, not just synthetic fixtures: parsing
  the actual `slide13.xml` and asserting all 5 labels gained a ~19.2 px inset
  proved the end-to-end fix, then the throwaway `/tmp`-referencing test was
  removed so CI stays hermetic.

## Design choices

- **Bounded blast radius:** only store `inset` when `<a:bodyPr>` explicitly
  declares one. Empty `<a:bodyPr/>` (the common case — insets inherited from
  master) keeps the prior renderer default, so existing decks don't shift.
- **Reused the existing pattern:** table cells already convert `marL/R/T/B`
  EMU → px via `ctx.scale.sx/sy`. Mirroring that (not inventing a 96-dpi
  constant) kept the conversion consistent with how frames are scaled.
- **Compose, don't replace:** shapes thread the imported inset through
  `shapeTextInset(kind, w, h, pad)` so it still composes with the per-kind
  preset text rect (ellipse silhouette inset), rather than bypassing it.

## Self-review caught a paint/edit divergence

A `/code-review high` pass over the branch flagged that changing only the paint
path broke the invariant that the in-place editor mounts exactly where the
committed glyphs land: `buildEditTarget` still inset text elements by `0` and
shapes by the default padding. Fixed in the same PR by threading the imported
inset through `shapeTextFrame(kind, frame, inset)` (shapes) and a new
`insetFrame(frame, inset)` (text elements). Lesson: when a fix touches a
render path that has a mirrored editor/measurement path, change both together —
grep for other callers of the shared geometry (`shapeTextInset`,
`shapeTextFrame`) before declaring done.
