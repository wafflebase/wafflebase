# Lessons — Docs: cell / header-footer wrap affinity (#934)

## What we learned

- The docs editor resolves a pixel to a caret in **four** places, not one:
  `find-position-at-pixel.ts` (body blocks), `resolveOffsetInCellAtXY`
  (body table cells, page/split aware), `resolveOffsetInNestedTable`
  (tables inside cells, any depth) and `getHFPositionFromMouse` /
  `resolveHFCellOffset` (header/footer, including header tables). A rule
  about hit-test results has to be applied in all four or the caret
  behaves differently depending on which region was clicked.
- Every one of them already computes the char offset at the start of the
  line it hit-tested, so the affinity rule needs no new geometry — only
  the comparison, which is why a three-argument pure helper
  (`hitTestLineAffinity`) was enough to unify them.
- `getVisualLineRange` (added by #931) is the only line-resolver that is
  region-aware *and* cell-aware, so anything that needs "which visual line
  is this offset on" — including `getWrapAffinity`, which predates it and
  hardcoded the body layout — should go through it rather than walk
  `getLayout().blocks` again.
- Affinity has to travel on the **selection endpoint** as well as the
  cursor: the in-cell drag path rebuilds `pos` from the resolver's plain
  `{blockId, offset}`, so an affinity set on `cursor.moveTo` alone would
  be dropped by the next mouse-move.
