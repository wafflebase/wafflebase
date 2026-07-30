# Docs — Fix nested-table paste input routing (#333), fold into #528's paste-into-cell fix

## Context

Issue #528 (pasting a table into a table cell) was already fixed and merged
(PR #531, `Nest a pasted table into the table cell the caret is in`). Working
on that fix uncovered that it also addresses issue #333 (open, unclaimed):
pasting a table that contains **nested** tables misroutes input on the pasted
copy.

#333's symptom, by nesting depth:

- Deepest nested level: caret can't enter a cell of the pasted copy at all.
- Every level above the deepest: caret visually enters the pasted copy's cell,
  but typed characters land in the corresponding cell of the **original**
  table instead.

Root cause: the multi-block paste path's middle-block clone only refreshed a
block's own top-level id (`{ ...block, id: generateBlockId() }`), so a pasted
table's nested cell blocks kept the source's ids. `Doc.getBlock` /
`findBlockInCells` then resolved those shared ids back to the source at every
level above the deepest; the deepest level's cell isn't in `_blockParentMap`
yet (only rebuilt at layout) and so couldn't resolve at all.

Fix (already implemented in the working tree, carried over from the #528
branch after that branch merged — see `git log` on
`fix/nested-table-paste-input-routing`, based on `upstream/main`):

- `cloneBlockWithFreshIds` (already existed for the single-table branch) now
  also used for the multi-block branch's middle blocks, replacing the shallow
  clone. Its `refreshBlockIds` already recursed through
  `tableData.rows[].cells[].blocks[]`, so this alone fixes the id-sharing.
- `Doc.findBlockInCells` gained a `walkCellsForBlock` recursive fallback for
  blocks not yet in `_blockParentMap` (created since the last layout — e.g.
  the paste's own middle blocks), so `getBlock` doesn't spuriously fail for a
  real cell block.
- `insertBlockAfter` chaining (already the #528 fix) threads the pasted
  middle blocks between the head and split tail.

Design note: [docs-paste-table-into-cell.md](../../design/docs/docs-paste-table-into-cell.md)
(updated to fold #333 into its Goals/Background/Risks — see git history on
this branch for the diff).

## Work

- [x] Diagnose #333 root cause (shared block ids on the multi-block paste
  path, distinct from #528's routing bug).
- [x] Fix: `cloneBlockWithFreshIds` for multi-block middle clones.
- [x] Fix: `findBlockInCells` recursive fallback (`walkCellsForBlock`).
- [x] Update `docs-paste-table-into-cell.md` design note to cover #333.
- [x] Manual smoke: re-ran #333's 2-level and 3-level repro steps in the
  `packages/docs` standalone demo — caret enters and input lands in the
  pasted copy at every level, confirmed fixed.
- [ ] Add an automated regression test for #333's repro (model-level,
  matching the existing test style — e.g. paste/clone a table with a nested
  table, assert `Doc.getBlock` resolves the pasted copy's nested cell block,
  not the source's).
- [ ] `pnpm verify:fast` green.
- [ ] Self code review (`superpowers:requesting-code-review` or
  `/code-review`) over the full branch diff.
- [ ] Rebase onto latest `upstream/main`, open PR: `Fixes #528` is already
  merged separately — this PR should read `Fixes #333`.
