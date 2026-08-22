# Carry merge metadata through copy/cut-paste (Sheet.paste)

Issue: #936 (follow-up from #74 / PR #927, which fixed the same class of bug
for drag-move and explicitly deferred paste)

## Problem

`Sheet.paste` (`packages/sheets/src/model/worksheet/sheet.ts`) touches merges
only through `expandChangedSrefsWithMergeAliases`, for recalculation. So:

- Copying a merged block and pasting it elsewhere reproduces the *content* but
  not the *layout* — the destination renders as ordinary cells.
- Pasting a multi-cell range over an existing merged block writes values into
  cells that stay hidden under the merge. They resurface as stale data when the
  block is unmerged — exactly what #927 fixed for `moveRangeTo`.

## Approach

Mirror `moveRangeTo`: **propagate or reject**, with the same machinery
(`getMergesIntersecting`, `mergeCoveredSrefs`, `rebuildMergeCoverMap`, the
covered-cell clearing, and `changedSrefs` invalidation).

1. **Capture at copy time.** `copy` / `cut` snapshot the merged blocks
   intersecting the source range into `copyBuffer.merges`. `getRangeOrActiveCell`
   expands a selection to merged boundaries, so those blocks lie fully inside
   the copied range; a partially covered one refuses the paste rather than
   producing a block wider than the pasted content.
2. **Normalize the paste target.** The destination origin becomes
   `normalizeRefToAnchor(activeCell)`, so a paste onto a covered cell lands in
   the visible cell — the same rule `setData` follows.
3. **Paste geometry.** For an internal paste the pasted range is the copied
   source range translated by the paste delta (the copied grid is sparse, so
   its bounding box can be smaller than the copied block). For an external
   HTML/TSV paste it is the bounding box of the parsed grid.
4. **Validate the target.** Merged blocks the pasted range fully covers are
   dropped — the pasted content replaces them. A block the paste would only
   partially overwrite (splitting it) refuses the whole paste. A single-cell
   paste is exempt: it writes through the anchor, so the block keeps its
   layout, which is what Google Sheets does and what the toolbar already
   relies on.
5. **Create + clear + invalidate.** Inside the existing batch: delete the
   overwritten blocks (plus the source blocks on a cut-paste, since the cells
   travel), re-create the copied blocks at the destination, clear the cells the
   new blocks newly hide (the `mergeSelection` invariant — otherwise they
   resurface on unmerge), and feed every deleted/created block's covered srefs
   into `changedSrefs` before the recalculation.

The covered-cell clearing (including its spill anchor/ghost handling) is
extracted from `moveRangeTo` into `clearCellsUnderMerge` and shared, and the
grid bounding box into `gridRange`, reused by `selectPastedRange`.

## Todo

- [x] Read `paste` / `copy` / `cut`, `moveRangeTo`'s merge pass, and the merge
      model helpers
- [x] Store merges in `copyBuffer`; normalize the paste target to the anchor
- [x] Propagate + reject in `paste`, inside the existing batch
- [x] Extract `clearCellsUnderMerge` / `gridRange` and reuse from `moveRangeTo`
      / `selectPastedRange`
- [x] Tests in `packages/sheets/test/sheet/merge.test.ts`
- [x] Update the paste bullet in `docs/design/sheets/sheet.md`
- [ ] PR + CI

## Non-goals

- Importing `rowspan` / `colspan` from external spreadsheet HTML into merges —
  a foreign-layout mapping problem, separate from carrying our own copies.
- User-visible feedback for a refused paste. `moveRangeTo` and `autofill`
  refuse silently too; a shared notification surface is tracked separately.
- Extending the post-paste selection to the propagated merge's full extent
  (`selectPastedRange` still selects the pasted grid's bounding box).
