---
title: docs-tables
target-version: 0.3.1
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
  migration (see [Extensibility Path](#extensibility-path)) — **Note:** nested
  tables inside cells are now supported (see
  [docs-nested-tables.md](docs-nested-tables.md))
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
- The input range to `mergeCells` is assumed to be rectangular and to fully
  contain any merged cells it touches. This invariant is enforced upstream
  by [Cell Range Normalization](#cell-range-normalization), which expands
  the user's drag selection so it never partially overlaps an existing
  merged cell.

## Cell Range Normalization

`expandCellRangeForMerges` in `selection.ts` is a fixed-point loop that
grows a cell range's bounding rectangle until no merged cell crosses its
boundary:

1. Order `start`/`end` so that `rowStart ≤ rowEnd` and `colStart ≤ colEnd`.
2. For every cell `(r, c)` inside the current bounding rect:
   - If the cell is a merge **top-left** (`colSpan > 1` or `rowSpan > 1`)
     and its span extends past `rowEnd`/`colEnd`, expand the bounding rect.
   - If the cell is **covered** (`colSpan === 0`), walk back (←, ↑) to find
     its merge top-left and expand the bounding rect to include that
     position.
3. Repeat step 2 until no expansion happens (typically 1–2 passes).

`findMergeTopLeft(table, r, c)` is a small helper that scans backwards to
locate the merge anchor for a covered cell. The current data model has no
back-pointer; the scan is bounded by table size and is acceptable because
tables are small.

Normalization is applied in two places:

- **Write-time** — the drag handler in `text-editor.ts` and the Shift+Arrow
  cross-cell branch call `expandCellRangeForMerges` before storing the
  range on the selection, so `selection.range.tableCellRange` already
  contains the expanded rectangle. This is what drives the drag-time hover
  highlight, which therefore previews the exact area that will be merged.
- **Read-time** — `normalizeRange` in `selection.ts` re-applies the
  expansion when a consumer reads the selection (rendering, copy, peer
  cursor projection, `computeTableMergeContext`). This is a defensive pass
  for programmatic writers: `Selection.setRange()` itself does not mutate
  the supplied range, so callers that bypass the write-time handlers still
  get a normalized view.

## Cell Merge UX

Merge and unmerge are exposed through a single context-menu slot whose
label, icon, and enabled state follow the cursor and selection.

| State | Trigger | Label | Enabled |
|-------|---------|-------|---------|
| `none` | In a single non-merged cell, no cell range | "Merge cells" | ❌ |
| `canMerge` | Cell range with area ≥ 2 (post-normalization) | "Merge cells" | ✅ |
| `canUnmerge` | Cursor in a merged cell, no cell range | "Unmerge cells" | ✅ |

When the cursor is inside a merged cell **and** a cell range is also active,
`canMerge` wins — the user's intent is to grow the existing merge into a
larger one.

The frontend reads this through a new editor API:

```typescript
type TableMergeContext =
  | { state: 'none' }
  | { state: 'canMerge'; tableBlockId: string; range: CellRange }
  | { state: 'canUnmerge'; tableBlockId: string; cell: CellAddress };

interface EditorAPI {
  getTableMergeContext(): TableMergeContext;
}
```

The context menu (`docs-table-context-menu.tsx`) calls
`getTableMergeContext()` once when opening, caches the result for the
lifetime of the popup, and renders a single slot whose label/icon/disabled
state follow the table above. Out-of-scope for this iteration: keyboard
shortcuts, top menu integration, floating table toolbar.

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
- ~~Need for nested tables (e.g., complex form layouts)~~ — **implemented**:
  nested tables are now supported; see [docs-nested-tables.md](docs-nested-tables.md)
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
| Text selection broken inside cells | High | Propagate `cellAddress` through all position-creating code paths (see below) |

## Cell-Aware Text Selection

### Problem

`DocPosition.cellAddress` is set when a user clicks inside a table cell, but
many code paths that **create or transform** positions drop the field. This
breaks drag selection, Shift+Arrow, Shift+Home/End, double/triple-click, and
word-boundary movement inside cells.

The root cause: every helper that returns a new `DocPosition` constructs it
with only `{ blockId, offset }`, losing the `cellAddress` context.

### Invariant

> When the cursor is inside a table cell, **every `DocPosition` produced by
> movement, hit-testing, or selection helpers must preserve `cellAddress`**.
> Selection must never span across cell boundaries — if anchor and focus have
> different `cellAddress` values, constrain focus to the anchor's cell.

### Changes

Seven areas need fixes. All changes are in `packages/docs/src/view/text-editor.ts` except (1) which
touches `packages/docs/src/view/selection.ts`.

#### 1. Movement helpers — propagate `cellAddress`

`moveLeft`, `moveRight`, `moveWordLeft`, `moveWordRight` receive a
`DocPosition` but return `{ blockId, offset }` without `cellAddress`.

**Fix:** When `pos.cellAddress` exists, clamp movement to cell boundaries and
include `cellAddress` in the returned position.

```typescript
private moveLeft(pos: DocPosition): DocPosition {
  if (pos.cellAddress) {
    // Clamp to cell start — do not cross cell boundary
    if (pos.offset > 0) {
      return { blockId: pos.blockId, offset: pos.offset - 1, cellAddress: pos.cellAddress };
    }
    return pos;
  }
  // ... existing block-level logic
}

private moveRight(pos: DocPosition): DocPosition {
  if (pos.cellAddress) {
    const cellLen = this.getCellTextLength(pos.blockId, pos.cellAddress);
    if (pos.offset < cellLen) {
      return { blockId: pos.blockId, offset: pos.offset + 1, cellAddress: pos.cellAddress };
    }
    return pos;
  }
  // ... existing block-level logic
}

private moveWordLeft(pos: DocPosition): DocPosition {
  if (pos.cellAddress) {
    const text = this.getCellText(pos.blockId, pos.cellAddress);
    return { blockId: pos.blockId, offset: findPrevWordBoundary(text, pos.offset), cellAddress: pos.cellAddress };
  }
  // ... existing block-level logic
}

private moveWordRight(pos: DocPosition): DocPosition {
  if (pos.cellAddress) {
    const text = this.getCellText(pos.blockId, pos.cellAddress);
    return { blockId: pos.blockId, offset: findNextWordBoundary(text, pos.offset), cellAddress: pos.cellAddress };
  }
  // ... existing block-level logic
}
```

#### 2. Visual line helpers — propagate `cellAddress`

`getVisualLineStart` and `getVisualLineEnd` return `{ blockId, offset }`
without `cellAddress`. Used by Home/End/Shift+Home/Shift+End and line
backspace.

**Fix:** Append `cellAddress` from the input position. When inside a cell,
the visual line range is the cell's full text extent (cells are single-line
in the layout model).

```typescript
private getVisualLineStart(pos: DocPosition): DocPosition {
  if (pos.cellAddress) {
    return { blockId: pos.blockId, offset: 0, cellAddress: pos.cellAddress };
  }
  const [start] = this.getVisualLineRange(pos);
  return { blockId: pos.blockId, offset: start };
}

private getVisualLineEnd(pos: DocPosition): DocPosition {
  if (pos.cellAddress) {
    const cellLen = this.getCellTextLength(pos.blockId, pos.cellAddress);
    return { blockId: pos.blockId, offset: cellLen, cellAddress: pos.cellAddress };
  }
  // ... existing block-level logic
}
```

#### 3. Drag selection — resolve `cellAddress` from pixel coordinates

`updateDragSelection` calls `paginatedPixelToPosition` which returns
`{ blockId, offset }` without `cellAddress`. The drag position loses cell
context.

**Fix:** After `paginatedPixelToPosition`, if the anchor has `cellAddress`,
resolve the drag position's cell context and clamp the focus to the same
cell.

```typescript
private updateDragSelection(clientX: number, clientY: number): void {
  // ... existing pixel calculation ...
  const result = paginatedPixelToPosition(...);
  if (result && this.selection.range) {
    const anchor = this.selection.range.anchor;
    let pos: DocPosition = { blockId: result.blockId, offset: result.offset };

    if (anchor.cellAddress) {
      // Constrain drag selection within the same cell
      const cellLen = this.getCellTextLength(anchor.blockId, anchor.cellAddress);
      pos = {
        blockId: anchor.blockId,
        offset: Math.max(0, Math.min(result.offset, cellLen)),
        cellAddress: anchor.cellAddress,
      };
    }

    this.cursor.moveTo(pos, result.lineAffinity);
    this.selection.setRange({ anchor, focus: pos });
    this.requestRender();
  }
}
```

#### 4. Double/triple-click — preserve `cellAddress`

Double-click (word select) and triple-click (paragraph select) create
positions without `cellAddress`.

**Fix:** When the click position has `cellAddress`, include it in the
selection endpoints and scope the text to cell content.

```typescript
if (this.clickCount === 3) {
  if (pos.cellAddress) {
    const cellLen = this.getCellTextLength(pos.blockId, pos.cellAddress);
    const start: DocPosition = { blockId: pos.blockId, offset: 0, cellAddress: pos.cellAddress };
    const end: DocPosition = { blockId: pos.blockId, offset: cellLen, cellAddress: pos.cellAddress };
    this.selection.setRange({ anchor: start, focus: end });
    this.cursor.moveTo(end);
  } else {
    // ... existing block-level logic
  }
} else if (this.clickCount === 2) {
  if (pos.cellAddress) {
    const text = this.getCellText(pos.blockId, pos.cellAddress);
    const [start, end] = getWordRange(text, pos.offset);
    const anchor: DocPosition = { blockId: pos.blockId, offset: start, cellAddress: pos.cellAddress };
    const focus: DocPosition = { blockId: pos.blockId, offset: end, cellAddress: pos.cellAddress };
    this.selection.setRange({ anchor, focus });
    this.cursor.moveTo(focus);
  } else {
    // ... existing block-level logic
  }
}
```

#### 5. Shift+click — constrain to same cell

When Shift+clicking, the anchor may be in a cell but the new focus may
resolve outside it.

**Fix:** If anchor has `cellAddress`, clamp the Shift+click focus to the
same cell.

#### 6. Selection rendering — handle cell positions

`packages/docs/src/view/selection.ts` functions (`normalizeRange`, `positionToPagePixel`,
`buildRects`, `getSelectedText`) compare positions by `blockId` and `offset`
only. When positions include `cellAddress`, offset refers to within-cell
offset, not block-level offset.

**Fix:** Add cell-aware branches:
- `normalizeRange`: When both positions have the same `cellAddress`, compare
  offsets directly (they are cell-relative). When `cellAddress` differs,
  no valid within-cell selection exists — return null.
- `positionToPagePixel`: When `cellAddress` is present, find the cell's
  layout lines and compute pixel position relative to the cell's origin.
- `buildRects`: When positions have `cellAddress`, compute rects within the
  cell's layout bounds.
- `getSelectedText`: When positions have `cellAddress`, extract text from
  the cell's inlines, not block inlines.

#### 7. Arrow key handler — delegate to movement helpers for Shift case

The table-cell arrow key handler (lines 1207–1265) currently handles
Shift+Arrow only for basic left/right/up/down. It should also delegate
Ctrl+Shift+Arrow (word movement) to the cell-aware `moveWordLeft` /
`moveWordRight`.

### What NOT to Change

- `paginatedPixelToPosition` — this function resolves block-level positions
  from pixels. Cell address resolution happens at a higher level
  (`resolveTableCellClick` in `handleMouseDown`), so the function's return
  type stays unchanged.
- `handleDocStart` / `handleDocEnd` — Ctrl+Home/End should exit the cell
  and go to document boundaries. No `cellAddress` needed.

### Testing

| Test case | Expected |
|-----------|----------|
| Shift+Left/Right inside cell | Text selection extends within cell, stops at cell boundary |
| Shift+Up/Down inside cell | Selection extends to cell above/below (if exists) |
| Ctrl+Shift+Left/Right in cell | Word-boundary selection within cell |
| Shift+Home/End in cell | Select to start/end of cell content |
| Mouse drag within cell | Text highlighted within cell only |
| Mouse drag across cell boundary | Selection clamped to anchor cell |
| Double-click in cell | Word selected within cell |
| Triple-click in cell | Entire cell text selected |
| Shift+click in cell | Selection extended within same cell |
| Selection highlight rendering | Blue rects appear within cell bounds |
| Copy selected cell text | Clipboard contains only selected cell text |
