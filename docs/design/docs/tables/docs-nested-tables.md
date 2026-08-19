---
title: docs-nested-tables
target-version: 0.3.3
---

# Nested Tables

## Summary

Support recursively nested tables in the Docs editor. A table cell can contain
another table, which in turn can contain another table, and so on. This enables
.docx import/export fidelity (many real-world forms use nested tables) and lets
users create nested tables directly in the editor.

## Goals / Non-Goals

### Goals

- Recursive nesting with no hard depth limit (UI naturally limits via minimum
  cell width of 30 px)
- Full feature parity inside nested tables: cell merge/split, row/column
  insert/delete, resize, styling (one exception ships today — see
  [Known gap](#known-gap-inline-styling-does-not-descend))
- Editor insertion: users can insert a table into a cell via the existing table
  insertion UI
- Real-time collaboration via Yorkie CRDT synchronization
- .docx round-trip: import nested tables from .docx, export them back

### Non-Goals

- Cross-page splitting of nested rows (rows remain atomic across pages)
- Repeating column headers on page break (future enhancement)
- Drag-and-drop of tables between nesting levels

### Known gap: inline styling does not descend

The styling half of the parity Goal above is not met for a *range* toggle
that sweeps over a nested table. `visitRangeSlices`
(`packages/docs/src/model/range-slices.ts`) — the single traversal both the
inline-style write (`Doc.applyInlineStyle`) and the toolbar/keyboard reads
drive, see
[docs-font-controls.md](../docs-font-controls.md#the-shared-range-traversal-modelrange-slicests-modelrange-runsts)
— covers a table caught inside a cross-block selection cell block by cell
block, and a nested table *is* one of those blocks: `getBlockTextLength` is 0
for it, so nothing inside it is visited. Selecting across the outer table and
pressing **Bold** therefore leaves the nested table's text unbolded. Its
endpoint case has the same shape: a selection *starting* inside a nested cell
normalizes to the inner table block, which is not a context block, so the
range is a no-op.

Editing inside a nested cell is unaffected — a selection wholly within one
nested block, or across blocks of one nested cell, styles normally. Only the
enclosing-selection case is skipped.

Closing this means making the table case of `visitRangeSlices` recursive (and
resolving an endpoint to its top-level ancestor table rather than its direct
parent). Because there is exactly one traversal, that would close it for the
read and the write in the same change — which is the point of keeping the
gap symmetric rather than fixing only the read: a read that reported runs the
write cannot reach is precisely the issue #715 trap (a style that can be
added but never removed).

## Proposal Details

### 1. Data Model

No type changes required. `TableCell.blocks: Block[]` already accepts any
`Block`, and `Block` already has `type: 'table'` with a `tableData` field.

**Changes:**

- **Dedicated cell-insertion method.** A table block is added to a cell's
  `blocks` via `Document.insertTableInCell(blockId, rows, cols)`, which looks up
  the parent cell in `BlockParentMap` and inserts the new table after `blockId`
  (`packages/docs/src/model/document.ts`). `Document.insertTable(blockIndex, rows, cols)`
  remains the body-only path and carries no nested-table guard; the editor's
  Insert Table command branches on `blockParentMap` and calls `insertTableInCell`
  when the cursor is inside a cell.

- **Recursive `BlockParentMap` construction.** When building the map, recurse
  into cell blocks: if a block is a table, iterate its rows/cells and register
  each inner block. Every `blockId` maps to its *direct* parent cell
  (`BlockCellInfo`), regardless of nesting depth.

- **Recursive `findBlock()`.** When searching for a block by ID, if it is not
  found at the document level, search recursively through table cells. The
  existing `BlockParentMap` lookup already provides O(1) access; the recursive
  search is the fallback/construction path.

**Invariants:**

- All `blockId` values are globally unique.
- `BlockParentMap[blockId]` always points to the *direct* parent cell.
- A table block inside a cell is itself registered in the parent cell's map
  entry.

### 2. Layout Engine

`computeTableLayout()` and `layoutCellBlocks()` become mutually recursive.

**Changes:**

- **`layoutCellBlocks()` handles `table` blocks.** When `block.type === 'table'`,
  call `computeTableLayout()` recursively with `contentWidth = cellWidth - padding * 2`.
  The returned `LayoutTable` is stored on a dedicated field.

- **`LayoutLine` extension.** Add `nestedTable?: LayoutTable` to `LayoutLine`.
  A table block produces a single `LayoutLine` whose height equals
  `nestedTable.totalHeight`.

- **`blockParentMap` merge.** Each recursive `computeTableLayout()` returns its
  own `blockParentMap`. Merge all inner maps into the outermost map so that
  global block lookup works.

- **Inner table width.** The inner table receives the parent cell's content
  width (cell pixel width minus padding on each side). This means deeper nesting
  naturally produces narrower tables, and the 30 px minimum column width acts as
  a practical depth limiter.

**Call flow:**

```
computeTableLayout(outerTable, contentWidth)
  layoutCellBlocks(cell.blocks, cellContentWidth)
    block.type === 'table'
      computeTableLayout(innerTable, cellContentWidth)   // recurse
        layoutCellBlocks(innerCell.blocks, innerCellContentWidth)
```

### 3. Rendering

`renderTableBackgrounds()` and `renderTableContent()` become recursive.

**Changes:**

- **Nested table rendering.** When iterating lines inside a cell, if a line has
  `nestedTable`, call `renderTableBackgrounds()` then `renderTableContent()`
  recursively with the line's (x, y) as the origin.

- **Coordinate transform.** The inner table's rendering origin is computed as:
  `x = cellX + padding`, `y = cellY + padding + lineYOffset`. All inner
  coordinates are relative to this origin.

- **Selection highlight.** When the cursor is inside a nested table, only that
  table's cell selection is highlighted. `BlockParentMap` identifies which table
  the cursor belongs to.

- **Borders.** Each table renders its own borders independently. No
  border-collapse interaction between outer and inner tables.

**Unchanged:**

- Pagination: rows (including those containing nested tables) remain atomic.
- Border collapse logic: operates per-table, no cross-table collapse.

### 4. Editing and Cursor/Navigation

**Cursor context:**

- `getCellInfo(blockId)` returns the direct parent cell from `BlockParentMap` —
  works unchanged for nested tables.

- **Target-table resolution.** The direct parent table is resolved via
  `blockParentMap.get(blockId)` (its `BlockCellInfo` carries `tableBlockId`) and
  `Document.getParentTableBlock(blockId)`
  (`packages/docs/src/model/document.ts`). No dedicated hierarchy-path helper is
  needed — structural operations only need the direct parent, which these
  provide.

**Table insertion in cells:**

- `insertTableInCell(blockId, rows, cols)` inserts a table block into the parent
  cell's `blocks` array, after the block at `blockId`. Identical to inserting a
  paragraph, except the block type is `'table'`.

**Tab / arrow navigation:**

- Tab moves between cells of the *direct parent* table only. If the cursor is
  inside an inner table, Tab cycles through inner table cells.
- Tab at the last cell of an inner table adds a new row to that inner table
  (existing behavior, scoped to direct parent).
- Arrow keys at an inner table boundary move the cursor to the next/previous
  block in the outer cell.

**Structural operations (insert row, delete column, merge, etc.):**

- All operations use `getCellInfo()` to identify the direct parent table and
  operate on it. No changes needed — operations are already table-scoped.

**Context menu:**

- Right-click inside a nested table shows row/column operations for that table.
- "Delete table" deletes only the direct parent table (the inner table), not the
  outer one.

### 5. CRDT (Yorkie Tree) Synchronization

Current Yorkie Tree structure:

```
<doc>
  <p> ... </p>
  <table>
    <tr>
      <td>            // container cell
        <p> ... </p>
      </td>
    </tr>
  </table>
</doc>
```

**Extended structure with nesting:**

```
<doc>
  <table>
    <tr>
      <td>
        <p> ... </p>
        <table>          // nested table inside <td>
          <tr>
            <td>
              <p> ... </p>
            </td>
          </tr>
        </table>
        <p> ... </p>
      </td>
    </tr>
  </table>
</doc>
```

**Changes:**

- **Allow `<table>` inside `<td>`.** Yorkie Tree supports arbitrary element
  nesting, so no SDK changes are needed — just insert the `<table>` subtree
  under the `<td>` node.

- **Nested cell-path helpers.** A blockId resolves to a deeper Yorkie Tree path
  via the repeating `[r, c, b]`-triplet helpers in
  `packages/frontend/src/app/docs/yorkie-doc-store.ts`
  (`getCellSubPath`, `getCellBlock`, `setCellBlock`, `getBlocksArrayForPath`).
  For nested tables the path descends through successive `[rowIdx, colIdx,
  blockIdx]` triplets.

- **Granular operations path adjustment.** Existing Store methods
  (`insertTableRow`, `deleteTableColumn`, `updateTableCell`, etc.) use tree
  paths. For nested tables, the cell-path helpers above produce the correct
  deeper path.

**Concurrent editing:**

| Scenario | Resolution |
|----------|-----------|
| Two users edit different inner tables | No conflict (different subtrees) |
| Two users edit the same inner cell | Text CRDT merge (existing behavior) |
| User A deletes outer row, User B edits inner table in that row | Delete wins (Yorkie policy: edits to deleted subtrees are discarded) |
| User A inserts row in outer table, User B inserts row in inner table | No conflict (different tables) |

### 6. Pagination

No changes. The existing rule applies recursively:

- Rows are never split across pages.
- A row containing a nested table is treated as a single atomic unit.
- If a row (with its nested table) exceeds page height, it gets its own page.

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Path calculation complexity for Yorkie operations | High — wrong paths corrupt data | `resolveTreePath` utility with comprehensive unit tests; round-trip test that inserts/edits nested tables and verifies Yorkie state |
| Performance with deep nesting | Medium — recursive layout/render | Minimum column width (30 px) naturally limits depth to ~4-5 levels; profile with stress test (3-level nesting, 10x10 tables) |
| Coordinate math errors in rendering | Medium — visual glitches | Snapshot/visual regression tests for nested table rendering |
| Undo/redo granularity | Low — snapshot-based undo already captures full state | No change needed, but verify undo works correctly across nesting levels |
| .docx import/export | Medium — nested `<w:tbl>` mapping | Separate task; data model support is prerequisite |
