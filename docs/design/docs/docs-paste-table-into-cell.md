---
title: docs-paste-table-into-cell
target-version: 0.6.2
---

# Docs Paste Table Into Cell

## Summary

Pasting a table while the caret is **inside a table cell** should insert it into
that cell, matching Google Docs. In practice a copied table arrives as a
**multi-block** clipboard payload — to select a whole table the user drags from a
line outside it, so the selection is `[paragraph, table, paragraph]` — and Google
Docs pastes all three blocks together into the cell. Today the paste path is
body-only: the single-table case does nothing, and the multi-block case
**crashes**.

The fix for that (#528) turns out to also fix a second, related bug (#333):
pasting a table that contains nested tables leaves the pasted copy's inner cell
blocks sharing ids with the source, so clicking/typing into the pasted copy's
nested table(s) silently edits the source instead. Both bugs live on the same
paste path and are fixed by the same change, so this note covers both.

## Background

**#528** — copying a table produces one of two clipboard shapes, and pasting
into a cell fails in both:

- **Multi-block** (the common case). Selecting a table means dragging from a line
  above it through to a line below, so the clipboard is
  `[paragraph, table, paragraph]`. Paste routes to `insertBlocks`' multi-block
  branch, which splits at the caret then inserts the middle blocks with the
  **body-only** `getBlockIndex` + `insertBlockAt`. In a cell `getBlockIndex`
  returns `-1`, the middle blocks are dropped into the document body, and a stale
  reference throws `Block not found` — an uncaught crash.
- **Single table block**. If the clipboard is exactly `[table]`, the single-table
  branch used the same body-only `getBlockIndex` + `insertBlockAt`, so nothing was
  inserted into the cell.

The **primitives are already cell-aware** — `store.splitBlock` and
`store.insertBlockAfter` both resolve the containing array via
`findBlockInAnyArray`, and `Doc.getBlock` searches cells via `findBlockInCells`.
Only `insertBlocks`' block-index insertion (`getBlockIndex` + `insertBlockAt`) is
body-only. (Note `EditContext` is `'body' | 'header' | 'footer'` with no cell
value; the cell signal comes from `blockParentMap` / `isInCell` instead, the same
way the **Insert Table** command detects a cell.)

A third shape — a **cell-range** copy (dragging across cells inside a table) —
serializes as `tableCells` and pastes via `pasteTableCells`, which merges cell
*content* into the target cells. That is intentionally a different operation
(cell-to-cell paste, not table nesting) and is out of scope here.

**#333** — pasting a table that contains nested tables (2-level or 3-level
nesting) misroutes input on the pasted copy, and the failure mode differs by
depth:

- At the **deepest** nested level, the caret cannot enter a cell of the pasted
  copy at all — clicking does nothing, typing is impossible.
- At **every level above the deepest**, the caret visually enters the clicked
  cell of the pasted copy, but typed characters land in the corresponding cell
  of the **original** table instead.

Root cause (see [Fresh IDs](#fresh-ids)): the paste path only refreshed a
cloned block's own top-level id, not the ids of blocks nested inside its table
cells, so a pasted nested table's inner cell blocks kept the source's ids.
`Doc.getBlock` then resolved those shared ids back to the source for every
level above the deepest (visually-correct caret, wrong input target); the
deepest level's cell wasn't in `_blockParentMap` yet (rebuilt only at layout)
and so couldn't resolve at all (caret rejected outright).

## Goals

- Pasting a **single `table` block** with the caret inside a cell nests the table
  into that cell (caret lands in its first cell).
- Pasting a **multi-block payload** (`[paragraph, table, paragraph]`, the common
  "copy a table" shape) with the caret inside a cell inserts **all** of those
  blocks into that cell, in order, matching Google Docs — no crash.
- Paste into the body / header / footer is unchanged.
- Fixes #333: pasting a table that contains **nested** tables no longer
  misroutes caret entry / typed input to the source table at any nesting
  level. Root cause was shared block ids between the pasted copy and its
  source — see [Fresh IDs](#fresh-ids).

## Non-Goals

- **Cell-range** copy (`tableCells`) pasted into a cell — that is cell-content
  merge via `pasteTableCells`, a different operation, left as is.
- Broad rework of `EditContext` to add a first-class `'cell'` value — the fix
  reuses the existing `blockParentMap` / `isInCell` signal, as `insertTable` does.

## Proposal Details

The fix is contained: replace the **body-only block-index insertion** in
`insertBlocks` with the **cell-aware `insertBlockAfter`**, which works for both
body and cell targets. The split (`store.splitBlock`) and lookup (`Doc.getBlock`)
are already cell-aware, so no cell-specific split machinery is needed.

**Single-table branch** (`blocks.length === 1 && blocks[0].type === 'table'`):

- When `isInCell(pos.blockId)`, insert the pasted table after `pos.blockId` via
  `Doc.insertBlockAfter` (cell-aware); otherwise keep the body path. Move the
  caret into the pasted table's first cell.

**Multi-block branch** (`blocks.length > 1`):

- Keep the existing split-at-caret + head/tail inline merge (those use the
  cell-aware `splitBlock` / `getBlock` / `updateBlockDirect`).
- Replace the middle-block loop's `getBlockIndex(pos.blockId)` +
  `insertBlockAt(idx++)` with **`insertBlockAfter` chaining**: start from
  `pos.blockId` (the head) and, for each middle block, `insertBlockAfter(prevId,
  newBlock)` then advance `prevId` to the inserted block. This threads the pasted
  blocks in order between the head and the split tail, inside whatever array the
  head lives in (cell or body).

### Fresh IDs

Each inserted block is deep-cloned with **fresh ids at every level** via
`cloneBlockWithFreshIds` — for a `table` block this regenerates the whole nested
tree, so a same-tab copy shares no ids with its source. This is required for the
paste to be independently editable, and it is also the fix for #333: the old
middle-block clone (`{ ...blocks[i], id: generateBlockId() }`) only refreshed the
block's own top-level id, so a pasted table's nested cell blocks kept the
source's ids. `Doc.getBlock` / `findBlockInCells` then resolved those shared ids
back to the source table for input at every level but the deepest, and the
deepest level — whose containing cell wasn't in `_blockParentMap` yet, since the
map is only rebuilt at layout — couldn't resolve at all and rejected the caret.
`cloneBlockWithFreshIds`'s recursive `refreshBlockIds` regenerates ids through
every nested `tableData.rows[].cells[].blocks[]`, and `findBlockInCells` gained a
`walkCellsForBlock` recursive fallback for blocks created since the last layout
(e.g. the paste's own middle blocks), so a pasted nested table resolves — and
accepts input — independently of its source at every level.

## Testing Strategy

The repo does not unit-test the view editor (`TextEditor`); coverage sits at the
model layer, so the tests exercise the cell-aware primitives and the sequence the
paste wiring performs.

Model-level unit tests (`packages/docs/test/model/paste-table-into-cell.test.ts`):

- `cloneBlockWithFreshIds` regenerates the table id and every nested cell block id
  (recursively), with no overlap with the source, and does not mutate the source.
- `Doc.insertBlockAfter` nests a block into a cell when the sibling is inside that
  cell (not at the top level); and inserts after a top-level block for the body.
- `Doc.splitBlock` on a block **inside a cell** places the tail block in the same
  cell (the cell-aware split the multi-block paste relies on).
- **Chaining** `insertBlockAfter` after a split inserts `[paragraph, table,
  paragraph]` into a cell **in order**, between the head and the split tail —
  the model-level equivalent of pasting a multi-block table selection into a cell.

Manual smoke (`pnpm dev`): copy a table (drag from a line above through a line
below → `[paragraph, table, paragraph]`), click into a cell, paste — the blocks
nest into the clicked cell (no crash). Also re-ran #333's repro steps (2-level
and 3-level nested tables, copy the outer table, paste elsewhere, click/type into
the pasted copy at every nesting level) — caret enters and input lands in the
pasted copy at every level, not the source.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Multi-block paste into a cell crashes (`Block not found`) | Root cause is the body-only middle-block insertion; replaced with cell-aware `insertBlockAfter` chaining so the split tail stays resolvable |
| Pasted table shares cell ids with the source (same-tab copy) — #333's caret-rejection / input-misroute at every nesting level | `cloneBlockWithFreshIds` deep-regenerates ids recursively through nested tables; `findBlockInCells` gains a recursive fallback for blocks not yet in `_blockParentMap`; asserted by a no-collision test and manually verified against #333's 2-level and 3-level repro steps |
| Changing the body multi-block path regresses body paste | `insertBlockAfter(pos.blockId, …)` after the head is equivalent to `insertBlockAt(getBlockIndex+1)` for a body sibling; a body-paste regression-guard test covers it |
| `blockParentMap` / cell signal stale after a remote edit | Use `getActiveLayout()` (refreshed for the active region), matching existing table ops |
| Caret left in a stale position | Single-table: move into the pasted table's first cell; multi-block: keep the existing tail-block caret placement |
