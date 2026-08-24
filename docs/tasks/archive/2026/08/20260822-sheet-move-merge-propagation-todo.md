# Support merge propagation in cell drag-move (moveRangeTo)

Issue: #74

## Problem

`Sheet.moveRangeTo` (`packages/sheets/src/model/worksheet/sheet.ts`) moves
cell values, formulas and range styles to the drop position, but it ignores
merge metadata entirely. Dragging a merged block leaves the merge behind at
the source, so the destination shows the moved value in a plain single cell
while the vacated source area still renders as merged — the sheet's merge
state no longer matches its content.

Google Sheets propagates the merge: the destination adopts the source's merge
layout after a drag-move.

## Approach

All merge state lives in `Sheet.merges` (anchor sref → span) plus the derived
`mergeCoverMap`, and is persisted through `Store.setMerge` / `Store.deleteMerge`.
Cell storage (`fetchGrid` / `setGrid`) is independent of it, so the existing
move logic needs no change — only a merge pass inside the same batch.

Inside `moveRangeTo`, before any mutation:

1. Collect merges intersecting the normalized source range. If any of them is
   not fully contained in the source range, the move would split a merged
   block: reject the move (return without mutating), matching the conservative
   stance `autofill` and the row/column move path already take.
2. Collect merges intersecting the destination range (excluding the source
   merges, since source and destination can overlap). If any is not fully
   contained in the destination range, the move would partially overwrite a
   merged block: reject the same way.

Then inside the existing batch, after the cells and range styles are written:

3. Delete the source merges and the fully-covered destination merges (the
   latter are overwritten by the moved content).
4. Re-create each source merge at `anchor + (deltaRow, deltaCol)`.
5. Rebuild the cover map, so the recalculation that follows (which expands
   changed srefs through merge aliases) sees the new layout.

## Todo

- [x] Read `moveRangeTo`, the merge model (`merges` / `mergeCoverMap` /
      `getMergesIntersecting`) and `mergeSelection` / `unmergeSelection`
- [x] Implement merge propagation + split rejection in `moveRangeTo`
- [x] Tests in `packages/sheets/test/sheet/merge.test.ts`:
      - merged source block → destination is merged, source is not
      - moved merged block keeps its value and covered-cell aliasing
      - move onto a merged destination unmerges the destination
      - move that would split a merged block is a no-op
- [x] Update the "Cell drag-move" bullet in `docs/design/sheets/sheet.md`
- [x] PR + CI

## Non-goals

- Changing the drag-move interaction in the view layer (the selection is
  already expanded to merge boundaries by `expandRangeToMergedBoundaries`).
- Copy/paste merge propagation — a separate path with its own semantics.
