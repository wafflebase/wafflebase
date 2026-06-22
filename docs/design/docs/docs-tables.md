---
title: docs-tables
target-version: 0.3.1
---

# Docs Tables

## Summary

Tables in Wafflebase Docs. A table is a single `Block` whose children are
a tree of `row → cell → block → inline → text` nodes in Yorkie. Each cell
is a **`Block[]` container** — paragraphs, lists, headings, even nested
tables — addressed by `blockId` like any other block. Cell-level
concurrent editing is granular: independent cells merge cleanly; same-cell
text is LWW at the cell node; structural ops (row/col insert/delete)
compose with text ops.

This doc is the umbrella reference for the table subsystem. UI affordances,
resize, copy-paste, row-splitting across pages, and nested-table specifics
each have their own dedicated doc — see the cluster index below.

### Goals

- Represent tables as a Block whose tree expresses `row → cell → block →
  inline`, persisted as Yorkie Tree nodes.
- Cells are `Block[]` containers; cell-internal blocks are first-class
  blocks indistinguishable from top-level blocks for editing purposes.
- Cell merge (colSpan/rowSpan), cell styling (background, borders,
  vertical align, padding), and proportional column widths.
- Granular Yorkie ops for row/column insert/delete and per-cell updates
  so concurrent edits don't collide on the whole table.
- Reuse the existing inline formatting engine and layout pipeline.
- Integrate with pagination (row-level page splitting; see
  [docs-table-row-splitting.md](tables/docs-table-row-splitting.md)).

### Non-Goals

- Cell-level images — deferred.
- Yorkie-native undo/redo — snapshot-based undo is reused (separate
  project).
- Horizontal rules inside cells.
- True character-level merge within a single cell — same-cell concurrent
  text edits remain LWW at the cell node; targeting
  `[tIdx, row, col, blockIdx, inlineIdx]` is deferred as a rare scenario
  with disproportionate complexity.
- Table of contents auto-generation from table content.
- CSV/spreadsheet import into tables.

## Table Cluster Index

| Doc | What it covers |
|---|---|
| **`docs-tables.md`** (this doc) | Data model, CRDT structure, cursor/navigation, layout, granular store ops, pagination basics, frontend UI (grid picker, context menu, IME cell routing) |
| [`tables/docs-table-resize.md`](tables/docs-table-resize.md) | Column/row border drag handles, guideline rendering |
| [`tables/docs-table-copy-paste.md`](tables/docs-table-copy-paste.md) | Cell-range clipboard, whole-table block, external HTML table paste |
| [`tables/docs-table-row-splitting.md`](tables/docs-table-row-splitting.md) | Split tall table rows across pages; recursive nested-table support |
| [`tables/docs-nested-tables.md`](tables/docs-nested-tables.md) | Tables inside cells; recursive `BlockParentMap`; CRDT path resolution |

## Data Model

### Type Extensions

```typescript
// Extend BlockType
type BlockType = ... | 'table';

// Extend Block
interface Block {
  // ... existing fields
  tableData?: TableData;
}
```

### Table Types

```typescript
interface TableData {
  rows: TableRow[];
  columnWidths: number[];      // Proportional ratios (0–1), sum = 1.0
}

interface TableRow {
  cells: TableCell[];
}

interface TableCell {
  blocks: Block[];             // Mini-document: paragraphs, lists, headings, nested tables
  style: CellStyle;
  colSpan?: number;            // Default 1; 0 marks a covered cell
  rowSpan?: number;            // Default 1
}

interface CellStyle {
  backgroundColor?: string;
  borderTop?: BorderStyle;
  borderBottom?: BorderStyle;
  borderLeft?: BorderStyle;
  borderRight?: BorderStyle;
  verticalAlign?: 'top' | 'middle' | 'bottom';  // Default 'top'
  padding?: number;            // Default 4 px
}

interface BorderStyle {
  width: number;               // px, default 1
  color: string;               // Default '#000000'
  style: 'solid' | 'none';     // Default 'solid'
}
```

### Key Decisions

- **Block[] cells.** Cells are mini-documents. Cell-internal blocks are
  ordinary `Block` instances addressed by `blockId`. There is no
  `cellAddress` on `DocPosition`; the editing pipeline does not branch on
  "inside cell" vs "top-level".
- **Proportional column widths.** `columnWidths` stores ratios (e.g.,
  `[0.3, 0.7]`). Pixel widths are computed at layout time as
  `ratio × (contentWidth - totalBorderWidth)`, so tables scale with page
  width and orientation.
- **Independent cell borders.** Each cell has 4 sides. Adjacent shared
  edges pick the thicker/darker border (CSS `border-collapse`).
- **Merged cell representation.** The top-left cell of a merged region
  carries `colSpan` / `rowSpan` > 1. Cells covered by the merge are
  marked with `colSpan: 0` and `blocks: []`. The renderer skips them.

## Yorkie Tree Structure

Tables are stored as a Yorkie Tree subtree, not a JSON-stringified
attribute. This is what enables granular merge.

```text
doc (root)
├─ block(type=paragraph)
│   └─ inline → text("normal paragraph")
├─ block(type=table, cols="0.333,0.334,0.333")
│   ├─ row
│   │   ├─ cell(backgroundColor="" verticalAlign="top" padding="4"
│   │   │       colSpan="1" rowSpan="1")
│   │   │   └─ block(type=paragraph)
│   │   │       └─ inline → text("cell A")
│   │   └─ cell(...)
│   │       ├─ block(type=paragraph)
│   │       │   └─ inline → text("cell B paragraph 1")
│   │       └─ block(type=list-item, listKind=unordered)
│   │           └─ inline → text("list item")
│   └─ row
│       ├─ cell(...) → block(paragraph) → inline → text
│       └─ cell(...) → block(paragraph) → inline → text
└─ block(type=paragraph)
    └─ inline → text("below table")
```

**New element node types:** `row` and `cell`.

**Table-level attributes** (on the `block` node):
- `cols` — comma-separated proportional widths (`"0.5,0.5"`).

**Cell-level attributes** (on each `cell` node, individually for LWW):
- `backgroundColor` — CSS color string.
- `verticalAlign` — `"top" | "middle" | "bottom"`.
- `padding` — pixel value as string.
- `colSpan` — span count as string (default `"1"`).
- `rowSpan` — span count as string (default `"1"`).
- `borderTop`, `borderBottom`, `borderLeft`, `borderRight` — encoded as
  `"width,style,color"` (e.g., `"1,solid,#000000"`).

**Cell children:** standard `block → inline → text` hierarchy, identical
to top-level document blocks.

### Concurrent Editing Behavior

| Scenario | Outcome |
|---|---|
| Different cells edited simultaneously | Independent node edits — **merged** |
| Same cell text edited simultaneously | LWW on cell node — last writer wins within cell |
| Cell styles changed simultaneously | Per-attribute LWW — **property-level merge** |
| Rows/columns added simultaneously | Tree structure edit — **merged** |
| Cell style + different cell text | Independent nodes — **both preserved** |
| Row inserted + cell edited | Independent tree ops — **both preserved** |
| Column width + cell edit | Table attrs vs cell node — **both preserved** |

## Cursor & Navigation

`DocPosition` is uniformly `{ blockId, offset }` — there is **no
`cellAddress` field**. Cell-internal blocks are referenced by `blockId`
like any other block.

### Block → Cell Reverse Lookup

Cell-internal blocks need to know which table/cell they belong to for
navigation (Tab between cells, Enter at cell boundary, Arrow exit from
table). A reverse-lookup map is built during layout:

```typescript
interface BlockCellInfo {
  tableBlockId: string;
  rowIndex: number;
  colIndex: number;
}

type BlockParentMap = Map<string, BlockCellInfo>;
```

Built during layout computation by walking the table structure
(recursively, for nested tables — see
[`tables/docs-nested-tables.md`](tables/docs-nested-tables.md)). Cached
on `DocumentLayout` and invalidated when the table block is dirty.

**Usage:** only navigation decisions consult `BlockParentMap`. Normal
text editing uses `blockId` directly.

### Navigation Rules

| Action | Behavior |
|---|---|
| **Tab** | Move to the first block of the next cell. At the last cell, insert a new row. |
| **Shift+Tab** | Move to the last block of the previous cell. |
| **Arrow at block boundary** | If the block is the last/first in the cell, move to the adjacent cell. If the cell is at the table edge, exit the table. |
| **Enter** | Insert a new paragraph block within the cell (not jump to next cell). |
| **Backspace at cell start** | If the cell has multiple blocks, merge with the previous block in the same cell. At the first block of the cell, no-op. |
| **Click outside table** | Exit the table, place cursor in the nearest paragraph. |
| **Cmd+A inside cell** | Select all text in the cell; second Cmd+A selects the entire table. |

### Selection

Drag and arrow selection within a cell uses the existing block-level
machinery — there are no cell-aware branches. Drag across a cell
boundary switches to **cell-range selection** (a blue overlay over the
affected cells). Cell-range delete clears cell content but keeps the
table structure.

### Allowed Cell Content

| Block type | Allowed in cell |
|---|---|
| `paragraph` | Yes |
| `list-item` | Yes |
| `heading` | Yes |
| `table` | **Yes** — recursive at any depth (see [`tables/docs-nested-tables.md`](tables/docs-nested-tables.md)) |
| `horizontal-rule` | No |
| `image` | Deferred |

## Layout & Rendering

### Layout Types

```typescript
interface LayoutTable {
  cells: LayoutTableCell[][];  // [row][col]
  columnXOffsets: number[];
  rowYOffsets: number[];
  rowHeights: number[];
}

interface LayoutTableCell {
  lines: LayoutLine[];         // produced by layoutBlock(cell.blocks[i], cellWidth)
  contentHeight: number;
}
```

### Computation

`computeTableLayout` runs `layoutBlock` on each block in each cell and
stacks the resulting lines vertically. Row height is the max content
height across cells in the row.

```typescript
const cellLines: LayoutLine[] = [];
for (const block of cell.blocks) {
  const blockLines = layoutBlock(block, cellWidth);
  cellLines.push(...blockLines);
}
```

### Rendering Order (DocCanvas)

1. Cell backgrounds (per row, per cell).
2. Cell content (block lines + inline runs, the same run renderer used
   by top-level blocks).
3. Cell borders (computed against neighbors for `border-collapse`
   semantics).
4. Selection overlays (block-level highlight inside cells, cell-range
   blue overlay across cells).

### Pagination

Tables split at **row boundaries** only — a row is never split across
pages by the default pagination pass. Cell content with multiple blocks
makes rows taller but they remain atomic for page splitting.

The optional row-splitting extension (tall rows broken across pages,
recursive nested-table support) lives in
[`tables/docs-table-row-splitting.md`](tables/docs-table-row-splitting.md).

### Dirty Block Cache

The existing dirty-block cache skips relayout of unchanged tables. Per-cell
cache is deferred — current granularity is acceptable for typical sizes.

## Frontend UI

### Table Insert

A toolbar grid picker (`TableGridPicker`) lives inside a Radix
`DropdownMenuContent`. The grid starts at 5×5 and expands up to 10×10 as
the pointer nears an edge. Hovering highlights the `(0,0) → hovered`
region and a label shows the dimensions (e.g., `"3 x 4"`); clicking calls
`editor.insertTable(rows, cols)`.

### Cell Operations Context Menu

A Radix `ContextMenu` wraps the editor container. It shows table
operations only when `editor.isInTable()` is true; otherwise it falls
through to the default browser menu. The menu groups:

- **Rows / columns** — insert/delete row, insert/delete column.
- **Cells** — merge cell, split cell (disabled when the target has no
  existing merge), cell background color (shared color palette).
- **Table** — delete table.

### IME in Cells

IME composition (and all text editing) inside a cell uses the ordinary
block-level path — there is no cell-specific routing. Because cells are
mini-documents whose blocks are ordinary `Block` instances addressed by
`blockId` (see Key Decisions: no `cellAddress` on `DocPosition`), the
composition handlers in `text-editor.ts` need no "inside cell" branch.

> Earlier table UI (v0.3.1) routed IME through dedicated
> `insertTextInCell` / `deleteTextInCell` ops keyed on a
> `position.cellAddress`; the later Block[]-cells redesign removed that
> branch. `git log` has the original design.

## Store & Undo

### Granular DocStore Operations

The `Doc` class already knows the exact intent (insert row, change cell
style, etc.). Passing that intent to the store lets `YorkieDocStore` emit
the minimal Yorkie Tree edit, while a diff-based `updateBlock` inside the
store would be fragile for structural changes and wasteful since the
intent was already known.

```typescript
interface DocStore {
  // ... existing methods ...

  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void;
  deleteTableRow(tableBlockId: string, rowIndex: number): void;
  insertTableColumn(tableBlockId: string, atIndex: number, cells: TableCell[]): void;
  deleteTableColumn(tableBlockId: string, colIndex: number): void;
  updateTableCell(
    tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell,
  ): void;
  updateTableAttrs(tableBlockId: string, attrs: { cols: number[] }): void;
}
```

### Yorkie Tree Path Mapping

```text
doc (root)
├─ [0] block(paragraph)
├─ [1] block(table)            ← tableIndex (tIdx)
│   ├─ [0] row
│   │   ├─ [0] cell
│   │   │   └─ [0] block → [0] inline → text
│   │   └─ [1] cell
│   └─ [1] row
│       ├─ [0] cell
│       └─ [1] cell
└─ [2] block(paragraph)
```

| Operation | `editByPath` call |
|---|---|
| Insert row at index 1 | `editByPath([tIdx, 1], [tIdx, 1], rowNode)` |
| Delete row at index 0 | `editByPath([tIdx, 0], [tIdx, 1])` |
| Insert column at index 1 | Per row: `editByPath([tIdx, r, 1], [tIdx, r, 1], cellNode)` |
| Delete column at index 0 | Per row: `editByPath([tIdx, r, 0], [tIdx, r, 1])` |
| Update cell (row 0, col 1) | `editByPath([tIdx, 0, 1], [tIdx, 0, 2], cellNode)` |
| Update table attrs | Whole-block replacement (no attribute-only Yorkie API) |

Column insert/delete iterates all rows within a single `doc.update()`
callback for atomicity.

### Serialization / Deserialization

```typescript
// YorkieDocStore.buildBlockNode — block(type='table') case
if (block.type === 'table' && block.tableData) {
  return {
    type: 'block',
    attributes: {
      id: block.id,
      type: 'table',
      cols: block.tableData.columnWidths.join(','),
    },
    children: block.tableData.rows.map((row) => ({
      type: 'row',
      attributes: {},
      children: row.cells.map((cell) => ({
        type: 'cell',
        attributes: serializeCellStyle(cell),
        children: cell.blocks.map(buildBlockNode),
      })),
    })),
  };
}

// YorkieDocStore.treeNodeToBlock — table case (sketch)
function treeNodeToBlock(node: TreeNode): Block { /* recursive walk */ }
function treeNodeToRow(node: TreeNode): TableRow { /* filter type==='row' */ }
function treeNodeToCell(node: TreeNode): TableCell {
  return {
    blocks: (node.children ?? [])
      .filter((c) => c.type === 'block')
      .map(treeNodeToBlock),
    style: parseCellStyle(node.attributes ?? {}),
    colSpan: Number(node.attributes?.colSpan ?? 1),
    rowSpan: Number(node.attributes?.rowSpan ?? 1),
  };
}
```

### Undo Strategy

Snapshot-based, unchanged. Remote change reception is unchanged — the
`subscribe` callback sets `dirty = true` and the next `getDocument()`
re-reads the full Tree.

### Cell Merge Rules

- Merge selection: rectangular cell range. The top-left cell of the
  range absorbs `colSpan = w` / `rowSpan = h`; covered cells are marked
  `colSpan: 0` (and `blocks: []`).
- Unmerge: clear `colSpan`/`rowSpan` on the anchor and re-seed each
  covered cell with one empty paragraph.
- Adjacent merged regions may not overlap. Merge over an existing merge
  expands the outer rect; the inner anchor's content is preserved on the
  new outer anchor.

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large tables slow down layout | High | Dirty-block cache skips unchanged tables; per-cell cache is a future optimization |
| Cell merge creates inconsistent state | Medium | Validate merge/split operations; covered cells always have `colSpan: 0` |
| Pagination edge case: row taller than page | Low | Default places oversized row on its own page; opt-in splitting lives in [`tables/docs-table-row-splitting.md`](tables/docs-table-row-splitting.md) |
| Cursor navigation across merged cells | Medium | Skip merged cells in Tab/arrow navigation; jump to next visible cell |
| Undo granularity too coarse (whole table snapshot) | Low | Acceptable for Phase 3; cell-level snapshots can be added if needed |
| Yorkie Tree `editByPath` complexity for column operations | Medium | Column ops iterate rows sequentially — atomic within `doc.update()` |
| Performance regression from deeper tree traversal | Low | Cache `BlockParentMap`; existing dirty-block optimization applies |
| Cell blocks with no content (empty cell) | Low | Every cell starts with one empty paragraph block |
| `deleteRow`/`deleteColumn` span adjustment requires multiple store calls | Medium | Span-adjusted cells updated via `updateTableCell()` within the same `Doc` method call |
| `updateTableAttrs` still replaces whole table block | Low | Column-width changes are infrequent and low-conflict |
| Same-cell concurrent text loses one edit (LWW) | Low | True character-level merge within a single cell is deferred as a rare scenario |
