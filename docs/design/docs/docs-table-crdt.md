---
title: docs-table-crdt
target-version: 0.3.1
---

# Table CRDT Collaboration & Container Cells

## Summary

Replace the current JSON-stringified `tableData` attribute with a proper
Yorkie Tree node hierarchy (`row → cell → block → inline → text`). This
enables character-level CRDT merging for concurrent cell edits and transforms
cells from flat `Inline[]` holders into `Block[]` containers that support
paragraphs, lists, and headings — matching Google Docs table cell
capabilities.

## Goals

- Cell-level concurrent editing via Yorkie Tree CRDT (no more last-writer-wins
  on the entire table)
- Cells as `Block[]` containers — multiple paragraphs, lists, headings inside
  a single cell
- Remove `cellAddress` from `DocPosition` and all `*InCell` methods — unify
  editing pipeline
- Maintain existing table features: cell merge, cell styling, Tab/Arrow
  navigation, pagination

## Non-Goals

- ~~Nested tables (cells containing tables) — blocked at insertion time~~ —
  **implemented**: nested tables are now supported; see
  [docs-nested-tables.md](docs-nested-tables.md)
- Cell-level images — deferred to future work
- Yorkie-native undo/redo — remains snapshot-based (separate project)
- Horizontal rules inside cells

## Current Problem

### JSON-Stringified Table Data

```typescript
// Current: entire table serialized as one attribute
attrs.tableData = JSON.stringify(block.tableData);
```

`updateBlock` replaces the entire block node in Yorkie Tree. Two users
editing different cells simultaneously both call `updateBlock`, which
triggers last-writer-wins on the whole `tableData` string. The later write
silently overwrites the earlier one.

### Flat Inline-Only Cells

```typescript
// Current: cells hold only Inline[]
interface TableCell {
  inlines: Inline[];
  style: CellStyle;
  colSpan?: number;
  rowSpan?: number;
}
```

Cells cannot contain multiple paragraphs, lists, or headings. All cell
editing requires separate `*InCell` methods (`insertTextInCell`,
`deleteTextInCell`, `applyCellInlineStyle`) and pervasive `cellAddress`
branching in `TextEditor`.

## Design

### Yorkie Tree Node Structure

```
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
│       ├─ cell(...)
│       │   └─ block(type=paragraph) → inline → text
│       └─ cell(...)
│           └─ block(type=paragraph) → inline → text
└─ block(type=paragraph)
    └─ inline → text("below table")
```

**New node types:** `row` and `cell` are Yorkie Tree element nodes.

**Table-level attributes** (on the `block` node):
- `cols` — comma-separated proportional widths (e.g., `"0.5,0.5"`)

**Cell-level attributes** (on each `cell` node, individually for LWW):
- `backgroundColor` — CSS color string
- `verticalAlign` — `"top"` | `"middle"` | `"bottom"`
- `padding` — pixel value as string
- `colSpan` — span count as string (default `"1"`)
- `rowSpan` — span count as string (default `"1"`)
- `borderTop`, `borderBottom`, `borderLeft`, `borderRight` — encoded as
  `"width,style,color"` (e.g., `"1,solid,#000000"`)

**Cell children:** Standard `block → inline → text` hierarchy, identical to
top-level document blocks.

### Concurrent Editing Behavior

| Scenario | Current (JSON) | New (Tree nodes) |
|----------|---------------|-----------------|
| Different cells edited simultaneously | LWW — one edit lost | Independent node edits — **merged** |
| Same cell text edited simultaneously | LWW — one edit lost | Text node CRDT — **character-level merge** |
| Cell styles changed simultaneously | LWW — entire style lost | Per-attribute LWW — **property-level merge** |
| Rows/columns added simultaneously | LWW — structure lost | Tree structure edit — **merged** |

### Data Model Changes

#### Types

```typescript
// Before
interface TableCell {
  inlines: Inline[];
  style: CellStyle;
  colSpan?: number;
  rowSpan?: number;
}

// After
interface TableCell {
  blocks: Block[];     // Mini-document: paragraphs, lists, headings
  style: CellStyle;
  colSpan?: number;
  rowSpan?: number;
}
```

#### `DocPosition` — Remove `cellAddress`

```typescript
// Before
interface DocPosition {
  blockId: string;
  offset: number;
  cellAddress?: CellAddress;  // REMOVED
}

// After
interface DocPosition {
  blockId: string;
  offset: number;
}
```

Cell-internal blocks are referenced by `blockId` like any other block.
The `CellAddress` type is retained for navigation helpers but removed from
the position model.

### Removed APIs

All `*InCell` methods on `Doc`:
- `insertTextInCell` — use `insertText` with cell block's ID
- `deleteTextInCell` — use `deleteText` with cell block's ID
- `applyCellInlineStyle` — use `applyInlineStyle` with cell block's ID

All `cellAddress` branches in `TextEditor`:
- Movement helpers (`moveLeft`, `moveRight`, `moveWordLeft`, `moveWordRight`)
- Visual line helpers (`getVisualLineStart`, `getVisualLineEnd`)
- `handleArrow` cell branch
- `updateDragSelection` cell branch
- `handleMouseDown` cell click handler
- `deleteSelection` cell branch
- `handleCompositionEnd` / `handleInput` / `applyHangulResult` cell routing
- `resolveOffsetInCell`, `resolveOffsetInCellAtX`, `resolveTableCellClick`
- `getCellText`, `getCellTextLength`
- `moveToNextCell`, `moveToPrevCell`

### Block→Cell Reverse Lookup

Cell-internal blocks need to know which table/cell they belong to for
navigation (Tab between cells, Enter at cell boundary, Arrow exit from
table).

```typescript
interface BlockCellInfo {
  tableBlockId: string;
  rowIndex: number;
  colIndex: number;
}

// Built during layout computation, cached on DocumentLayout
type BlockParentMap = Map<string, BlockCellInfo>;
```

Built during layout computation from the document model by walking the
table structure. Cached and invalidated when the table block is dirty.

**Usage:** Only for navigation decisions (Tab, Shift+Tab, Enter, Arrow at
cell/table boundaries). Normal text editing uses `blockId` directly.

### Navigation Behavior

Navigation uses the `BlockParentMap` to determine cell context:

| Action | Behavior |
|--------|----------|
| **Tab** | Move to first block of next cell. At last cell, insert new row |
| **Shift+Tab** | Move to last block of previous cell |
| **Arrow at block boundary** | If block is last/first in cell, move to adjacent cell. If cell is at table edge, exit table |
| **Enter** | Insert new paragraph block within the cell (not move to next cell) |
| **Backspace at cell start** | If cell has multiple blocks, merge with previous block in same cell. At first block of cell, no-op |

### YorkieDocStore Changes

#### Serialization (`buildBlockNode`)

Table blocks produce a tree of children instead of a `tableData` attribute:

```typescript
function buildBlockNode(block: Block): ElementNode {
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
  // ... existing paragraph/list/heading logic
}
```

#### Deserialization (`treeNodeToBlock`)

```typescript
function treeNodeToBlock(node: TreeNode): Block {
  const el = node as ElementNode;
  const attrs = el.attributes as Record<string, string>;
  if (attrs.type === 'table') {
    const rows = (el.children ?? [])
      .filter((c) => c.type === 'row')
      .map(treeNodeToRow);
    const cols = (attrs.cols ?? '').split(',').map(Number);
    return {
      id: attrs.id,
      type: 'table',
      inlines: [],
      style: parseBlockStyle(attrs),
      tableData: { rows, columnWidths: cols },
    };
  }
  // ... existing logic
}

function treeNodeToRow(node: TreeNode): TableRow {
  const el = node as ElementNode;
  return {
    cells: (el.children ?? [])
      .filter((c) => c.type === 'cell')
      .map(treeNodeToCell),
  };
}

function treeNodeToCell(node: TreeNode): TableCell {
  const el = node as ElementNode;
  return {
    blocks: (el.children ?? [])
      .filter((c) => c.type === 'block')
      .map(treeNodeToBlock),
    style: parseCellStyle(el.attributes as Record<string, string>),
    colSpan: Number(el.attributes?.colSpan ?? 1),
    rowSpan: Number(el.attributes?.rowSpan ?? 1),
  };
}
```

#### Granular Updates

See Phase C below for the full design of granular table operations.

### Layout Changes

`computeTableLayout` currently uses `cell.inlines` for line layout. Updated
to use `cell.blocks`:

```typescript
// Before: single layoutBlock() call per cell
const lines = layoutInlines(cell.inlines, cellWidth);

// After: layout each block in the cell, stack vertically
const cellLines: LayoutLine[] = [];
for (const block of cell.blocks) {
  const blockLines = layoutBlock(block, cellWidth);
  cellLines.push(...blockLines);
}
```

Row height = max cell content height across all cells in the row.

### Rendering Changes

`renderTable` currently iterates `cell.inlines`. Updated to render
multi-block cell content using the same run-rendering logic as top-level
blocks. Each block in a cell produces layout lines that are rendered
sequentially within the cell bounds.

### Allowed Cell Content

| Block type | Allowed in cell |
|------------|----------------|
| `paragraph` | Yes |
| `list-item` | Yes |
| `heading` | Yes |
| `table` | **Yes** — nested tables are supported at any depth; `BlockParentMap` is recursive and CRDT path resolution handles arbitrarily nested `row → cell → block` chains. See [docs-nested-tables.md](docs-nested-tables.md). |
| `horizontal-rule` | No |

### Pagination

Unchanged from current design: tables split at **row boundaries** only.
A row is never split across pages. Cell content with multiple blocks may
make rows taller, but the row remains atomic for page-splitting purposes.

## Implementation Phases

### Phase A: Data Model + Store (Complete)

Changed `TableCell` from `Inline[]` to `Block[]` containers and updated
YorkieDocStore to serialize tables as Yorkie Tree node hierarchy
(`row → cell → block → inline → text`). Updated layout, renderer, and all
tests. The `*InCell` methods were adapted to operate on `cell.blocks[0]`
but not yet removed.

### Phase B: Unified Editing Pipeline (Complete)

Removed `cellAddress` from `DocPosition` and eliminated all `*InCell` methods.
Cell blocks are first-class blocks addressed by `blockId` alone. The
editing pipeline no longer distinguishes between top-level and cell blocks.

### Phase C: Granular Store Updates (Complete)

Decomposed `updateBlock()` for tables into fine-grained Yorkie Tree
operations (`editByPath`) for concurrent cell-level editing. Extended the
`DocStore` interface with operation-specific methods so the `Doc` class
expresses intent (insert row, update cell, etc.) instead of replacing
the entire table block.

#### DocStore Interface Extension

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

**Design rationale:** The `Doc` class already knows the exact operation
(insert row, change cell style, etc.). Passing that intent to the store
lets `YorkieDocStore` emit the minimal Yorkie Tree edit, while a diff-based
approach inside `updateBlock()` would be fragile for structural changes
and wasteful since the intent was already known.

#### Yorkie Tree Path Mapping

```
doc (root)
├─ [0] block(paragraph)
├─ [1] block(table)          ← tableIndex (tIdx)
│   ├─ [0] row
│   │   ├─ [0] cell
│   │   │   └─ [0] block → [0] inline → text
│   │   └─ [1] cell
│   └─ [1] row
│       ├─ [0] cell
│       └─ [1] cell
└─ [2] block(paragraph)
```

| Operation | editByPath call |
|-----------|-----------------|
| Insert row at index 1 | `editByPath([tIdx, 1], [tIdx, 1], rowNode)` |
| Delete row at index 0 | `editByPath([tIdx, 0], [tIdx, 1])` |
| Insert column at index 1 | Per row: `editByPath([tIdx, r, 1], [tIdx, r, 1], cellNode)` |
| Delete column at index 0 | Per row: `editByPath([tIdx, r, 0], [tIdx, r, 1])` |
| Update cell (row 0, col 1) | `editByPath([tIdx, 0, 1], [tIdx, 0, 2], cellNode)` |
| Update table attrs | Whole-block replacement (no attribute-only Yorkie API) |

Column insert/delete iterates all rows within a single `doc.update()`
callback for atomicity.

#### Concurrent Editing Behavior

| Scenario | Before (Phase B) | After (Phase C) |
|----------|------------------|-----------------|
| Different cells edited simultaneously | LWW — one edit lost | Cell-level replace — **both preserved** |
| Same cell text edited simultaneously | LWW — one edit lost | LWW on cell node — **last writer wins within cell** |
| Cell style + different cell text | LWW — one change lost | Independent nodes — **both preserved** |
| Row inserted + cell edited | LWW — one change lost | Independent tree ops — **both preserved** |
| Two rows inserted simultaneously | LWW — one insert lost | Adjacent tree inserts — **both preserved** |
| Column width + cell edit | LWW — one change lost | Table attrs vs cell node — **both preserved** |

Note: same-cell concurrent text edits remain LWW at the cell level. True
character-level merge within a single cell would require text-node-level
`editByPath` (targeting `[tIdx, row, col, blockIdx, inlineIdx]`), which
is deferred as it adds significant complexity for a rare scenario.

Undo/redo remains snapshot-based (unchanged). Remote change reception
is unchanged — the `subscribe` callback sets `dirty = true` and the
next `getDocument()` re-reads the full Tree.

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Yorkie Tree editByPath complexity for column operations | Medium | Column ops iterate rows sequentially — atomic within `doc.update()` |
| Performance regression from deeper tree traversal | Low | Cache `BlockParentMap`; existing dirty-block optimization applies |
| Cell blocks with no content (empty cell) | Low | Every cell starts with one empty paragraph block |
| deleteRow/deleteColumn span adjustment requires multiple store calls | Medium | Span-adjusted cells updated via `updateTableCell()` within same `Doc` method call |
| updateTableAttrs still replaces whole table block | Low | Column width changes are infrequent and low-conflict |
