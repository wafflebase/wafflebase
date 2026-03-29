---
title: docs-tables
target-version: 0.4.0
---

# Docs Table Support

## Summary

Add table support to Wafflebase Docs. Tables are the most critical missing
feature for representing structured documents — analysis of a real-world .docx
file (government application form) showed 46 tables with cell merges, background
colors, and borders forming the majority of the document's layout.

This design covers Phase 3.2 of the
[word processor roadmap](docs-wordprocessor-roadmap.md) with scope **(B)**:
basic tables, cell editing, cell merge/split, cell background color, and
borders.

## Goals

- Represent tables as a single Block type with embedded cell data
- Support cell merge (colSpan/rowSpan) and cell styling (background, borders)
- Reuse existing inline formatting engine inside cells
- Integrate with pagination (row-level page splitting)
- Maintain Store/Undo compatibility with zero interface changes

## Non-Goals

- Nested blocks inside cells (lists, headings, images) — deferred to future
  migration (see [Extensibility Path](#extensibility-path))
- Column resize via drag handle — future enhancement
- Table of contents auto-generation from table content
- CSV/spreadsheet import into tables

## Design Approach

### Approach 1 (Chosen): Block-Embedded Table

```
Document → Block[] → Block.type = 'table', Block.tableData = TableData
```

A table is a single Block. `tableData` holds rows, columns, and cells. Each
cell contains `Inline[]` — the same inline formatting model used by paragraphs.

**Advantages:**
- Minimal model change — one new field on Block
- Store/Undo works automatically (Block-level deep clone)
- Pagination treats the table as one large block, split at row boundaries
- Existing `layoutBlock()` logic reusable for cell content

**Disadvantages:**
- Cells cannot contain nested blocks (lists, headings, sub-tables)
- Cell editing requires separate cursor/selection handling

### Approach 2 (Future): Nested Blocks

```
Document → Block[] → Block.type = 'table' → cells[] → Block[]
```

Each cell holds its own `Block[]` array, acting as a mini-document. This
enables lists, headings, images, and even nested tables inside cells.

**Advantages:**
- Full Google Docs-level cell content
- Cell editing reuses the full Doc editing pipeline

**Disadvantages:**
- Model complexity: recursive Block structure
- Cursor/selection/undo must handle recursive document trees
- 2–3x implementation effort

Approach 1 is chosen for Phase 3. The migration path to Approach 2 is
documented in the [Extensibility Path](#extensibility-path) section.

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
  columnWidths: number[];  // Proportional ratios (0–1), sum = 1.0
}

interface TableRow {
  cells: TableCell[];
}

interface TableCell {
  inlines: Inline[];       // Inline-only content (Phase 3)
  style: CellStyle;
  colSpan?: number;        // Default 1
  rowSpan?: number;        // Default 1
}

interface CellStyle {
  backgroundColor?: string;
  borderTop?: BorderStyle;
  borderBottom?: BorderStyle;
  borderLeft?: BorderStyle;
  borderRight?: BorderStyle;
  verticalAlign?: 'top' | 'middle' | 'bottom';  // Default 'top'
  padding?: number;        // Default 4px
}

interface BorderStyle {
  width: number;           // px, default 1
  color: string;           // Default '#000000'
  style: 'solid' | 'none'; // Default 'solid'
}
```

### Key Decisions

- **Proportional column widths**: `columnWidths` stores ratios (e.g.,
  `[0.3, 0.7]`). Pixel widths are computed at layout time as
  `ratio × (contentWidth - totalBorderWidth)`. This ensures tables scale
  with page width and orientation changes.

- **Independent cell borders**: Each cell has 4 border sides. When adjacent
  cells share an edge, the renderer picks the thicker/darker border (CSS
  border-collapse semantics).

- **Merged cell representation**: The top-left cell of a merged region
  carries `colSpan`/`rowSpan` > 1. Cells covered by the merge are marked
  with `colSpan: 0` (and `inlines: []`). The renderer skips cells with
  `colSpan: 0`.

## Cursor & Cell Position

### Position Model

```typescript
// Cell address within a table
interface CellAddress {
  rowIndex: number;
  colIndex: number;
}

// Extend DocPosition with optional cell context
interface DocPosition {
  blockId: string;
  offset: number;
  cellAddress?: CellAddress;  // Present only inside table blocks
}

// Cell range selection (multi-cell drag)
interface CellRange {
  start: CellAddress;
  end: CellAddress;
}
```

### Editing Behavior

| Action | Behavior |
|--------|----------|
| Click cell | Enter cell, place cursor in cell's `Inline[]` |
| Tab | Move to next cell (left-to-right, top-to-bottom). Add new row at end. |
| Shift+Tab | Move to previous cell |
| Arrow at text boundary | Move to adjacent cell |
| Enter | Move to cell below (not line break within cell) |
| Click outside table | Exit table, place cursor in nearest paragraph |
| Backspace at cell start | No-op (does not merge with previous cell) |

### Selection Behavior

| Action | Behavior |
|--------|----------|
| Drag within cell | Text selection within cell (reuse existing logic) |
| Drag across cell boundary | Switch to cell-range selection (blue overlay) |
| Delete with cell range | Clear content of selected cells (keep structure) |
| Cmd+A inside cell | Select all text in cell; second Cmd+A selects entire table |

## Layout & Rendering

### Layout Types

```typescript
interface LayoutTable {
  cells: LayoutTableCell[][];  // [row][col]
  columnXOffsets: number[];
  columnPixelWidths: number[];
  rowYOffsets: number[];
  rowHeights: number[];
}

interface LayoutTableCell {
  lines: LayoutLine[];         // Reuse existing line layout
  width: number;
  height: number;
  merged: boolean;             // Covered by another cell's span
}
```

### Layout Computation

1. Convert `columnWidths` ratios to pixel widths:
   `ratio × (contentWidth - totalBorderWidth)`
2. For each non-merged cell: lay out `Inline[]` within cell width using
   existing `layoutBlock()` word-wrap logic (minus cell padding)
3. Compute row heights: max cell height among cells in the row.
   For `rowSpan` cells, distribute height across spanned rows.
4. Compute cumulative Y offsets for rows
5. Store result as `LayoutTable` in the `LayoutBlock`

### Rendering Order (DocCanvas)

1. **Cell backgrounds**: Fill merged-cell-aware rectangles with
   `CellStyle.backgroundColor`
2. **Cell text**: Render `LayoutLine[]` runs per cell, applying
   `verticalAlign` offset (`top` = 0, `middle` = (cellH - textH) / 2,
   `bottom` = cellH - textH)
3. **Borders**: Draw cell borders. For shared edges, use the thicker border
   (border-collapse). Draw once per shared edge to avoid double-drawing.
4. **Cell selection overlay**: Blue translucent fill over selected cell range
5. **Cursor**: Blinking caret inside the active cell

### Pagination

- Tables split at **row boundaries** only — a row is never cut in half
- If a single row is taller than the page content area, it gets its own page
- When a table spans multiple pages, column headers are **not** repeated
  (future enhancement)
- Block margins above/below the table are suppressed at page boundaries
  (existing behavior)

### Dirty Block Cache

- When the table block's ID is in the dirty set, the entire table is
  re-laid-out
- Per-cell incremental layout is a future optimization — for now, table
  re-layout is acceptable because most tables are small relative to document
  size

## Store & Undo

### Store Interface

No changes to `DocStore`. Tables are Blocks, so existing methods work:

- `updateBlock(id, block)` — cell edits, row/column ops, style changes
- `insertBlock(index, block)` — new table creation
- `deleteBlock(id)` — table deletion
- `snapshot()` / `undo()` / `redo()` — block-level deep clone captures
  `tableData`

### Doc Class API Extensions

```typescript
class Doc {
  // Table creation
  insertTable(blockIndex: number, rows: number, cols: number): string;

  // Cell text editing
  insertTextInCell(blockId: string, cell: CellAddress,
    offset: number, text: string): void;
  deleteTextInCell(blockId: string, cell: CellAddress,
    offset: number, length: number): void;

  // Cell inline styling
  applyCellInlineStyle(blockId: string, cell: CellAddress,
    start: number, end: number, style: Partial<InlineStyle>): void;

  // Structural operations
  insertRow(blockId: string, atIndex: number): void;
  deleteRow(blockId: string, rowIndex: number): void;
  insertColumn(blockId: string, atIndex: number): void;
  deleteColumn(blockId: string, colIndex: number): void;

  // Cell merge / split
  mergeCells(blockId: string, range: CellRange): void;
  splitCell(blockId: string, cell: CellAddress): void;

  // Cell styling
  applyCellStyle(blockId: string, cell: CellAddress,
    style: Partial<CellStyle>): void;

  // Column width
  setColumnWidth(blockId: string, colIndex: number, ratio: number): void;
}
```

### Undo Strategy

- All table operations call `store.snapshot()` before mutation (existing
  pattern)
- Cell text input groups snapshots by typing sequence (existing behavior)
- Structural ops (insert/delete row/column, merge/split) are each one Undo
  unit

### Cell Merge Rules

- `mergeCells(range)`: Set `colSpan`/`rowSpan` on the top-left cell of the
  range. Mark covered cells with `colSpan: 0, inlines: []`. Content from
  covered cells is concatenated into the top-left cell.
- `splitCell(cell)`: Reset `colSpan`/`rowSpan` to 1. Restore covered cells
  with default `inlines: [{ text: '', style: {} }]`.

## Extensibility Path

### Current: Inline-Only Cells (Phase 3)

```typescript
interface TableCell {
  inlines: Inline[];
  style: CellStyle;
  colSpan?: number;
  rowSpan?: number;
}
```

Cells support bold, italic, underline, color, font, links, superscript,
subscript — all existing inline styles.

### Future: Block-Level Cells (Phase 6+)

```typescript
interface TableCell {
  blocks: Block[];       // Mini-document per cell
  style: CellStyle;
  colSpan?: number;
  rowSpan?: number;
}
```

Cells support lists, headings, images, nested tables — full document
capabilities.

### Migration Strategy

1. **Data migration** is mechanical — wrap existing `inlines` in a paragraph:
   ```typescript
   cell.blocks = [{
     id: generateBlockId(),
     type: 'paragraph',
     inlines: cell.inlines,
     style: DEFAULT_BLOCK_STYLE,
   }];
   ```

2. **API compatibility**: Current `insertTextInCell()` etc. can delegate to
   a cell-local `Doc` instance. External API signatures remain stable.

3. **Rendering compatibility**: Current cell layout uses `layoutBlock()`
   logic. Future version calls `computeLayout(cell.blocks)` — same pipeline.

4. **Yorkie compatibility**: Cell data lives inside `Block.tableData`. CRDT
   serialization extends `tableData` structure without changing the Block
   envelope.

### Trigger Criteria for Migration

- User requests for lists or headings inside table cells
- Need for nested tables (e.g., complex form layouts)
- Phase 6 work (multi-column, footnotes) that benefits from recursive
  Block structure

### Design Rules to Ease Future Migration

- Keep cell text editing logic parallel to `Doc` class methods
- Isolate cell layout into a dedicated `layoutTableCell()` function —
  replaceable with `computeLayout()` later
- Do NOT pre-add `blocks` field to `TableCell` (YAGNI) — add when needed

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large tables slow down layout | High | Dirty-block cache skips unchanged tables; per-cell cache is a future optimization |
| Cell merge creates inconsistent state | Medium | Validate merge/split operations; covered cells always have `colSpan: 0` |
| Pagination edge case: row taller than page | Low | Place oversized row on its own page |
| Cursor navigation across merged cells | Medium | Skip merged cells in Tab/arrow navigation; jump to next visible cell |
| Undo granularity too coarse (whole table snapshot) | Low | Acceptable for Phase 3; cell-level ops can use finer snapshots if needed |
