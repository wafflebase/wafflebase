---
title: docs-paste-table-into-cell
target-version: 0.6.2
---

# Docs Paste Table Into Cell

## Summary

Pasting a table while the caret is **inside a table cell** should nest the table
into that cell, matching the **Insert Table** command and Google Docs / Word.
Today the paste path is body-only and does not nest — nothing is inserted into
the cell.

## Background

Issue #528. The insert-a-table and paste-a-table paths diverge on cell handling:

- **Insert Table** (`insertTable` in `packages/docs/src/view/editor.ts`) detects a
  cell target via `getActiveLayout().blockParentMap` and routes to
  `Doc.insertTableInCell`, which inserts through the **cell-aware**
  `store.insertBlockAfter` (backed by `findBlockInAnyArray`). Nesting works.
- **Paste** (`insertBlocks` in `packages/docs/src/view/text-editor.ts`) for a
  single `table` block uses the **body-only** `getBlockIndex` + `insertBlockAt`.
  `EditContext` is only `'body' | 'header' | 'footer'` (no cell value) and
  `getContextBlocks()` returns only body/header/footer blocks, so a cell target
  is never resolved and the table is not inserted.

So the in-cell nesting capability already exists; the paste path just doesn't use
it.

## Goals

- Pasting a single `table` block with the caret inside a cell nests the table
  into that cell.
- The caret lands in the first cell of the pasted table (matching `insertTable`
  and the existing body-paste behavior).
- Paste of a table into the body / header / footer is unchanged.

## Non-Goals

- Input being misrouted after pasting an already-nested table into the body
  (#333) — a separate bug.
- Multi-block paste that contains a table, dropped into a cell — this note
  covers only the single-table paste branch.
- Broad rework of `EditContext` to add a first-class `'cell'` value — the fix
  reuses the existing `blockParentMap` cell signal, as `insertTable` does.

## Proposal Details

In `insertBlocks`'s single-table branch
(`blocks.length === 1 && blocks[0].type === 'table'`):

1. Detect whether `pos.blockId` is inside a table cell using the existing
   `getActiveLayout().blockParentMap` — the same signal `insertTable` already
   uses for its cell/body split.
2. **Inside a cell:** insert the pasted table block after `pos.blockId` via the
   cell-aware `store.insertBlockAfter` (exposed through a `Doc` method), so it
   lands in that cell's block list. Move the caret into the pasted table's first
   cell.
3. **Otherwise:** keep the existing body path (`getBlockIndex` + `insertBlockAt`).

This mirrors `insertTable`'s existing cell/body split and reuses the cell-aware
insertion primitive rather than adding new machinery.

### Fresh IDs

The pasted table block already gets a fresh top-level id via `generateBlockId()`.
Its **cell-internal** block ids must also be independent of the source, or a
same-tab copy would share ids between the original and the paste. Whether the
current clipboard clone already regenerates nested ids is verified during
implementation; if not, a deep id refresh is applied to the pasted table here.
This overlaps with #333 and is kept minimal.

## Testing Strategy

Unit tests (`packages/docs`, paste / text-editor path):

- Paste a single `table` block with the caret **inside a cell** → the table
  appears as a nested table in that cell (present in the cell's `blocks`), not at
  the top level of the document.
- The caret lands in the first cell of the pasted table.
- Paste a table with the caret **in the body** → still inserted at the top level
  (regression guard for the unchanged path).
- The pasted table's cell block ids do not collide with the source table's ids.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Pasted table shares cell ids with the source (same-tab copy) | Deep-regenerate ids for the pasted table's cell blocks; asserted by a no-collision test; overlaps with #333 |
| `blockParentMap` is stale after a remote edit | Use `getActiveLayout()` (already refreshed for the active region), matching the existing table ops |
| Header / footer cell paste | `store.insertBlockAfter` uses `findBlockInAnyArray`, so it resolves cells in any region uniformly |
| Caret left in a stale position after nesting | Move the caret into the pasted table's first cell, mirroring `insertTable` |
