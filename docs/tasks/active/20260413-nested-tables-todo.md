# Nested Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support recursively nested tables in the Docs editor — a table cell can contain another table.

**Architecture:** Remove the insertion guard, make `layoutCellBlocks()` and `computeTableLayout()` mutually recursive, extend rendering to recurse into nested tables, and build `BlockParentMap` recursively so all existing cell operations (merge, split, navigate) work at any nesting depth. CRDT sync via `resolveTreePath()` utility.

**Tech Stack:** TypeScript, Vitest, Canvas 2D, Yorkie CRDT Tree

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/docs/src/view/table-layout.ts:183-232` | `layoutCellBlocks()` — handle `block.type === 'table'` via recursive `computeTableLayout()` |
| Modify | `packages/docs/src/view/table-layout.ts:350-360` | `computeTableLayout()` — recursive `blockParentMap` construction |
| Modify | `packages/docs/src/view/layout.ts:81-86` | `LayoutLine` — add `nestedTable?: LayoutTable` field |
| Modify | `packages/docs/src/view/table-renderer.ts:260-358` | `renderTableContent()` — recurse when line has `nestedTable` |
| Modify | `packages/docs/src/view/table-renderer.ts:93-148` | `renderTableBackgrounds()` — recurse for nested tables |
| Modify | `packages/docs/src/view/editor.ts:1849-1873` | `insertTable()` — support insertion inside cells |
| Modify | `packages/docs/src/view/editor.ts:1874-1889` | `deleteTable()` — handle nested table deletion |
| Modify | `packages/docs/src/model/document.ts:121-167` | `getBlock()`/`findBlock()` — recursive cell search for deeply nested blocks |
| Modify | `packages/docs/src/view/text-editor.ts:3290-3380` | `moveToNextCell()`/`moveToPrevCell()` — already scoped to direct parent; verify with nested tables |
| Create | `packages/docs/test/model/nested-table.test.ts` | Unit tests for nested table data model operations |
| Create | `packages/docs/test/view/nested-table-layout.test.ts` | Unit tests for nested table layout computation |

---

### Task 1: Data Model — Recursive BlockParentMap

Enable `BlockParentMap` to register blocks inside nested tables and make `getBlock()`/`findBlock()` find them.

**Files:**
- Modify: `packages/docs/src/view/table-layout.ts:350-360`
- Modify: `packages/docs/src/model/document.ts:121-167`
- Create: `packages/docs/test/model/nested-table.test.ts`

- [ ] **Step 1: Write failing test — nested table block lookup**

Create `packages/docs/test/model/nested-table.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Doc } from '../../src/model/document.js';
import type { BlockCellInfo } from '../../src/model/types.js';
import { createTableBlock } from '../../src/model/types.js';

/**
 * Build a recursive BlockParentMap that registers blocks
 * inside nested tables (mirrors what computeTableLayout will do).
 */
function buildParentMapRecursive(
  doc: Doc,
  tableBlockId: string,
): Map<string, BlockCellInfo> {
  const map = new Map<string, BlockCellInfo>();
  const block = doc.getBlock(tableBlockId);
  if (!block.tableData) return map;
  for (let r = 0; r < block.tableData.rows.length; r++) {
    for (let c = 0; c < block.tableData.rows[r].cells.length; c++) {
      const cell = block.tableData.rows[r].cells[c];
      for (const b of cell.blocks) {
        map.set(b.id, { tableBlockId, rowIndex: r, colIndex: c });
        // Recurse into nested tables
        if (b.type === 'table' && b.tableData) {
          for (let ir = 0; ir < b.tableData.rows.length; ir++) {
            for (let ic = 0; ic < b.tableData.rows[ir].cells.length; ic++) {
              const innerCell = b.tableData.rows[ir].cells[ic];
              for (const ib of innerCell.blocks) {
                map.set(ib.id, { tableBlockId: b.id, rowIndex: ir, colIndex: ic });
              }
            }
          }
        }
      }
    }
  }
  return map;
}

describe('Nested table data model', () => {
  it('should find a block inside a nested table via getBlock()', () => {
    const doc = Doc.create();
    // Insert outer table
    const outerTableId = doc.insertTable(0, 2, 2);

    // Manually insert an inner table into cell (0,0)
    const outerBlock = doc.getBlock(outerTableId);
    const cell00 = outerBlock.tableData!.rows[0].cells[0];
    const innerTable = createTableBlock(2, 2);
    cell00.blocks.push(innerTable);
    doc.store.updateTableCell(outerTableId, 0, 0, cell00);

    // Build and set the recursive parent map
    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);

    // The inner table block itself should be found in outer cell (0,0)
    const foundInnerTable = doc.getBlock(innerTable.id);
    expect(foundInnerTable.id).toBe(innerTable.id);
    expect(foundInnerTable.type).toBe('table');

    // A block inside the inner table should be found
    const innerCellBlock = innerTable.tableData!.rows[0].cells[0].blocks[0];
    const foundInnerBlock = doc.getBlock(innerCellBlock.id);
    expect(foundInnerBlock.id).toBe(innerCellBlock.id);
  });

  it('BlockParentMap should map inner blocks to their direct parent table', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const cell00 = outerBlock.tableData!.rows[0].cells[0];
    const innerTable = createTableBlock(2, 2);
    cell00.blocks.push(innerTable);
    doc.store.updateTableCell(outerTableId, 0, 0, cell00);

    const map = buildParentMapRecursive(doc, outerTableId);

    // Inner table block → outer cell (0,0)
    const innerTableInfo = map.get(innerTable.id);
    expect(innerTableInfo?.tableBlockId).toBe(outerTableId);
    expect(innerTableInfo?.rowIndex).toBe(0);
    expect(innerTableInfo?.colIndex).toBe(0);

    // Inner cell's paragraph → inner table cell (0,0)
    const innerParagraph = innerTable.tableData!.rows[0].cells[0].blocks[0];
    const innerParagraphInfo = map.get(innerParagraph.id);
    expect(innerParagraphInfo?.tableBlockId).toBe(innerTable.id);
    expect(innerParagraphInfo?.rowIndex).toBe(0);
    expect(innerParagraphInfo?.colIndex).toBe(0);
  });

  it('should insert and retrieve text in a nested table cell', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const cell00 = outerBlock.tableData!.rows[0].cells[0];
    const innerTable = createTableBlock(2, 2);
    cell00.blocks.push(innerTable);
    doc.store.updateTableCell(outerTableId, 0, 0, cell00);

    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);

    const innerCellBlock = innerTable.tableData!.rows[0].cells[0].blocks[0];
    doc.insertText({ blockId: innerCellBlock.id, offset: 0 }, 'Nested!');
    const found = doc.getBlock(innerCellBlock.id);
    expect(found.inlines.map(i => i.text).join('')).toBe('Nested!');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && npx vitest run test/model/nested-table.test.ts`
Expected: FAIL — `getBlock()` cannot find blocks inside nested tables because `BlockParentMap` only maps one level and `getBlock()` only searches top-level table blocks.

- [ ] **Step 3: Make getBlock()/findBlock() support nested tables**

The current `getBlock()` at `document.ts:131-139` looks up `cellInfo.tableBlockId` only in `this._document.blocks` (top-level). For nested tables, the parent table is itself inside a cell. Change the lookup to be recursive:

In `packages/docs/src/model/document.ts`, replace the cell-search section in both `getBlock()` (lines 131-139) and `findBlock()` (lines 156-163) with a recursive helper:

```typescript
// Add this private method to the Doc class:
private findBlockInCells(blockId: string): Block | undefined {
  const cellInfo = this._blockParentMap.get(blockId);
  if (!cellInfo) return undefined;

  // The parent table might itself be nested — find it recursively
  let tableBlock: Block | undefined;
  // First check top-level blocks
  tableBlock = this._document.blocks.find((b) => b.id === cellInfo.tableBlockId);
  // Then check header/footer
  if (!tableBlock) {
    tableBlock = this._document.header?.blocks.find((b) => b.id === cellInfo.tableBlockId);
  }
  if (!tableBlock) {
    tableBlock = this._document.footer?.blocks.find((b) => b.id === cellInfo.tableBlockId);
  }
  // If still not found, the parent table is itself inside a cell — recurse
  if (!tableBlock) {
    tableBlock = this.findBlockInCells(cellInfo.tableBlockId);
  }

  if (tableBlock?.tableData) {
    const cell = tableBlock.tableData.rows[cellInfo.rowIndex]?.cells[cellInfo.colIndex];
    return cell?.blocks.find((b) => b.id === blockId);
  }
  return undefined;
}
```

Then update `getBlock()`:

```typescript
getBlock(blockId: string): Block {
  const block = this._document.blocks.find((b) => b.id === blockId);
  if (block) return block;

  const hBlock = this._document.header?.blocks.find((b) => b.id === blockId);
  if (hBlock) return hBlock;
  const fBlock = this._document.footer?.blocks.find((b) => b.id === blockId);
  if (fBlock) return fBlock;

  const found = this.findBlockInCells(blockId);
  if (found) return found;

  throw new Error(`Block not found: ${blockId}`);
}
```

And `findBlock()`:

```typescript
findBlock(blockId: string): Block | undefined {
  const block = this._document.blocks.find((b) => b.id === blockId);
  if (block) return block;

  const hBlock = this._document.header?.blocks.find((b) => b.id === blockId);
  if (hBlock) return hBlock;
  const fBlock = this._document.footer?.blocks.find((b) => b.id === blockId);
  if (fBlock) return fBlock;

  return this.findBlockInCells(blockId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && npx vitest run test/model/nested-table.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm verify:fast`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/test/model/nested-table.test.ts
git commit -m 'Support recursive block lookup for nested tables

getBlock()/findBlock() now walk the BlockParentMap chain to find
blocks inside arbitrarily nested table cells.'
```

---

### Task 2: Layout Engine — Recursive Cell Layout

Make `layoutCellBlocks()` handle `block.type === 'table'` by calling `computeTableLayout()` recursively, and merge inner `blockParentMap` entries into the outer map.

**Files:**
- Modify: `packages/docs/src/view/layout.ts:81-86` (LayoutLine type)
- Modify: `packages/docs/src/view/table-layout.ts:183-232` (layoutCellBlocks)
- Modify: `packages/docs/src/view/table-layout.ts:237-376` (computeTableLayout — blockParentMap merge)
- Create: `packages/docs/test/view/nested-table-layout.test.ts`

- [ ] **Step 1: Write failing test — nested table layout**

Create `packages/docs/test/view/nested-table-layout.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeTableLayout } from '../../src/view/table-layout.js';
import { createTableBlock, createTableCell } from '../../src/model/types.js';
import type { TableData } from '../../src/model/types.js';

function stubCtx(): CanvasRenderingContext2D {
  return {
    measureText: (text: string) => ({ width: text.length * 8 }),
    font: '',
  } as unknown as CanvasRenderingContext2D;
}

function makeNestedTableData(): { outer: TableData; innerBlockId: string } {
  // Create a 2x2 outer table, with a 2x2 inner table in cell (0,0)
  const innerTable = createTableBlock(2, 2);
  const outerCell00 = createTableCell();
  outerCell00.blocks.push(innerTable);

  const outerCell01 = createTableCell();
  const outerCell10 = createTableCell();
  const outerCell11 = createTableCell();

  const outer: TableData = {
    rows: [
      { cells: [outerCell00, outerCell01] },
      { cells: [outerCell10, outerCell11] },
    ],
    columnWidths: [0.5, 0.5],
  };

  return { outer, innerBlockId: innerTable.id };
}

describe('Nested table layout', () => {
  it('should compute layout for a table containing a nested table', () => {
    const { outer, innerBlockId } = makeNestedTableData();
    const ctx = stubCtx();
    const layout = computeTableLayout(outer, 'outer-table', ctx, 400);

    // Cell (0,0) should be taller than cell (0,1) due to the nested table
    expect(layout.cells[0][0].height).toBeGreaterThan(layout.cells[0][1].height);

    // The blockParentMap should contain entries from the inner table
    const innerTableInfo = layout.blockParentMap.get(innerBlockId);
    expect(innerTableInfo).toBeDefined();
    expect(innerTableInfo!.tableBlockId).toBe('outer-table');
    expect(innerTableInfo!.rowIndex).toBe(0);
    expect(innerTableInfo!.colIndex).toBe(0);
  });

  it('should include inner table cell blocks in blockParentMap', () => {
    const { outer } = makeNestedTableData();
    const innerTable = outer.rows[0].cells[0].blocks[1]; // index 1 = nested table
    const innerCellBlockId = innerTable.tableData!.rows[0].cells[0].blocks[0].id;

    const ctx = stubCtx();
    const layout = computeTableLayout(outer, 'outer-table', ctx, 400);

    const info = layout.blockParentMap.get(innerCellBlockId);
    expect(info).toBeDefined();
    expect(info!.tableBlockId).toBe(innerTable.id);
  });

  it('should produce a LayoutLine with nestedTable for the table block', () => {
    const { outer } = makeNestedTableData();
    const ctx = stubCtx();
    const layout = computeTableLayout(outer, 'outer-table', ctx, 400);

    // Cell (0,0) has 2 blocks: default paragraph + nested table.
    // The nested table block should produce a line with nestedTable set.
    const cell00 = layout.cells[0][0];
    const hasNestedTableLine = cell00.lines.some(
      (line) => (line as any).nestedTable !== undefined,
    );
    expect(hasNestedTableLine).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && npx vitest run test/view/nested-table-layout.test.ts`
Expected: FAIL — `layoutCellBlocks()` doesn't handle table blocks, so nested table height is 0 and no `nestedTable` field exists on `LayoutLine`.

- [ ] **Step 3: Add nestedTable field to LayoutLine**

In `packages/docs/src/view/layout.ts`, add the import and field:

```typescript
// Add import at top of file
import type { LayoutTable } from './table-layout.js';

// Extend LayoutLine interface (lines 81-86)
export interface LayoutLine {
  runs: LayoutRun[];
  y: number;
  height: number;
  width: number;
  nestedTable?: LayoutTable;
}
```

- [ ] **Step 4: Make layoutCellBlocks() handle table blocks recursively**

In `packages/docs/src/view/table-layout.ts`, modify `layoutCellBlocks()` (around line 199-221). The function needs access to the outer `tableBlockId` and an accumulator for the merged `blockParentMap`. Change the function signature and add the table block handling:

First, update `computeTableLayout()` to pass `tableBlockId` and a shared `blockParentMap` accumulator to `layoutCellBlocks()`:

```typescript
// In computeTableLayout(), replace the layoutCellBlocks call (around line 282):
const { lines, blockBoundaries } = layoutCellBlocks(
  cell?.blocks ?? [], ctx, innerWidth, tableBlockId, r, c, blockParentMap,
);
```

Then update `layoutCellBlocks()`:

```typescript
function layoutCellBlocks(
  blocks: Block[],
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
  parentTableBlockId?: string,
  parentRow?: number,
  parentCol?: number,
  parentMap?: Map<string, BlockCellInfo>,
): { lines: LayoutLine[]; blockBoundaries: number[] } {
  if (blocks.length === 0) {
    const defaultHeight = ptToPx(Theme.defaultFontSize) * 1.5;
    return {
      lines: [{ runs: [], y: 0, height: defaultHeight, width: 0 }],
      blockBoundaries: [0],
    };
  }

  const allLines: LayoutLine[] = [];
  const blockBoundaries: number[] = [];

  for (const block of blocks) {
    blockBoundaries.push(allLines.length);

    // Handle nested table blocks
    if (block.type === 'table' && block.tableData) {
      const nestedLayout = computeTableLayout(
        block.tableData, block.id, ctx, maxWidth,
      );
      // Merge inner blockParentMap into outer
      if (parentMap) {
        for (const [k, v] of nestedLayout.blockParentMap) {
          parentMap.set(k, v);
        }
      }
      const tableLine: LayoutLine = {
        runs: [],
        y: 0,
        height: nestedLayout.totalHeight,
        width: nestedLayout.totalWidth,
        nestedTable: nestedLayout,
      };
      allLines.push(tableLine);
      continue;
    }

    // Existing logic for text blocks
    const listIndent = block.type === 'list-item'
      ? LIST_INDENT_PX * ((block.listLevel ?? 0) + 1)
      : 0;
    const effectiveWidth = maxWidth - listIndent;
    const blockLines = layoutCellInlines(block.inlines, ctx, effectiveWidth);
    const alignment = block.style?.alignment ?? 'left';
    for (let li = 0; li < blockLines.length; li++) {
      applyAlignment(blockLines[li], effectiveWidth, alignment, li === blockLines.length - 1);
    }
    if (listIndent > 0) {
      for (const line of blockLines) {
        for (const run of line.runs) {
          run.x += listIndent;
        }
        line.width += listIndent;
      }
    }
    allLines.push(...blockLines);
  }

  // Recalculate cumulative y offsets
  let y = 0;
  for (const line of allLines) {
    line.y = y;
    y += line.height;
  }

  return { lines: allLines, blockBoundaries };
}
```

And in `computeTableLayout()`, update the `blockParentMap` construction (around line 350-360) to also pass the map to `layoutCellBlocks` and ensure it's initialized before the cell layout loop:

```typescript
// Move blockParentMap initialization to BEFORE the cell layout loop (before line 258)
const blockParentMap = new Map<string, BlockCellInfo>();

// In the cell layout loop, pass blockParentMap:
const { lines, blockBoundaries } = layoutCellBlocks(
  cell?.blocks ?? [], ctx, innerWidth, tableBlockId, r, c, blockParentMap,
);

// Keep the existing blockParentMap construction (lines 350-360) to register
// direct children. The nested maps are already merged via layoutCellBlocks.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/docs && npx vitest run test/view/nested-table-layout.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm verify:fast`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/docs/src/view/layout.ts packages/docs/src/view/table-layout.ts packages/docs/test/view/nested-table-layout.test.ts
git commit -m 'Add recursive layout for nested tables

layoutCellBlocks() now calls computeTableLayout() when it encounters
a table block, producing a LayoutLine with nestedTable. Inner
blockParentMap entries are merged into the outer map.'
```

---

### Task 3: Rendering — Recursive Table Rendering

Make `renderTableContent()` and `renderTableBackgrounds()` recurse when a line has `nestedTable`.

**Files:**
- Modify: `packages/docs/src/view/table-renderer.ts:93-148` (renderTableBackgrounds)
- Modify: `packages/docs/src/view/table-renderer.ts:260-358` (renderTableContent, per-line loop)

- [ ] **Step 1: Add nested table rendering in renderTableContent()**

In `packages/docs/src/view/table-renderer.ts`, inside the per-line loop (around line 260), add a check before the run loop:

```typescript
// Inside the per-line loop, before `for (const run of line.runs)`:
for (let li = 0; li < layoutCell.lines.length; li++) {
  const line = layoutCell.lines[li];
  let lineAbsoluteY: number;
  if (mergedLineLayouts) {
    const ll = mergedLineLayouts[li];
    if (ll.ownerRow < pageStart || ll.ownerRow >= rowEnd) continue;
    lineAbsoluteY = tableY + ll.runLineY;
  } else {
    lineAbsoluteY = cellY + textYOffset + line.y;
  }

  // Render nested table if this line contains one
  if (line.nestedTable) {
    const nestedX = cellX + padding;
    const nestedY = lineAbsoluteY;
    const innerTableData = cell.blocks.find(
      (b) => b.type === 'table' && b.tableData,
    );
    if (innerTableData?.tableData) {
      renderTableBackgrounds(
        ctx, innerTableData.tableData, line.nestedTable,
        nestedX, nestedY,
      );
      renderTableContent(
        ctx, innerTableData.tableData, line.nestedTable,
        nestedX, nestedY,
        0, undefined, undefined,
        requestRender, dragImageRun, selectionRects, focused,
      );
    }
    continue;
  }

  // Existing run rendering loop...
  for (const run of line.runs) {
    // ...existing code
  }
}
```

Note: The above approach of `cell.blocks.find()` is fragile when multiple nested tables exist. A more robust approach: track block index via `blockBoundaries`. For each line at index `li`, find which block it belongs to using `blockBoundaries`, then use `cell.blocks[blockIndex]`. Adjust accordingly:

```typescript
// Before the line loop, compute a helper to map line index → block index:
// (blockBoundaries[bi] is the first line of block bi)
function getBlockIndexForLine(blockBoundaries: number[], lineIndex: number): number {
  for (let bi = blockBoundaries.length - 1; bi >= 0; bi--) {
    if (lineIndex >= blockBoundaries[bi]) return bi;
  }
  return 0;
}

// Then in the nested table check:
if (line.nestedTable) {
  const blockIndex = getBlockIndexForLine(layoutCell.blockBoundaries, li);
  const nestedBlock = cell.blocks[blockIndex];
  if (nestedBlock?.tableData) {
    const nestedX = cellX + padding;
    const nestedY = lineAbsoluteY;
    renderTableBackgrounds(
      ctx, nestedBlock.tableData, line.nestedTable,
      nestedX, nestedY,
    );
    renderTableContent(
      ctx, nestedBlock.tableData, line.nestedTable,
      nestedX, nestedY,
      0, undefined, undefined,
      requestRender, dragImageRun, selectionRects, focused,
    );
  }
  continue;
}
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm verify:fast`
Expected: All tests pass. (Rendering tests may not cover nested tables yet, but no regressions.)

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/view/table-renderer.ts
git commit -m 'Add recursive rendering for nested tables

renderTableContent() now detects lines with nestedTable and
recursively calls renderTableBackgrounds() + renderTableContent()
to draw inner tables within cells.'
```

---

### Task 4: Editor — Allow Table Insertion Inside Cells

Modify the editor's `insertTable()` to work when the cursor is inside a table cell, inserting a nested table block into that cell's blocks array.

**Files:**
- Modify: `packages/docs/src/view/editor.ts:1849-1873`
- Modify: `packages/docs/src/model/document.ts` (add `insertTableInCell()`)

- [ ] **Step 1: Write failing test — insert table inside cell**

Add to `packages/docs/test/model/nested-table.test.ts`:

```typescript
describe('insertTableInCell', () => {
  it('should insert a nested table into a cell', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const cellBlock = outerBlock.tableData!.rows[0].cells[0].blocks[0];
    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);

    const innerTableId = doc.insertTableInCell(cellBlock.id, 2, 2);

    const cell = doc.getBlock(outerTableId).tableData!.rows[0].cells[0];
    expect(cell.blocks).toHaveLength(2);
    const innerBlock = cell.blocks.find((b) => b.id === innerTableId);
    expect(innerBlock).toBeDefined();
    expect(innerBlock!.type).toBe('table');
    expect(innerBlock!.tableData!.rows).toHaveLength(2);
    expect(innerBlock!.tableData!.rows[0].cells).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && npx vitest run test/model/nested-table.test.ts`
Expected: FAIL — `insertTableInCell` doesn't exist.

- [ ] **Step 3: Add insertTableInCell() to Doc**

In `packages/docs/src/model/document.ts`, add after the existing `insertTable()` method:

```typescript
/**
 * Insert a table block into the cell containing `blockId`.
 * The new table is inserted after the block at `blockId`.
 * Returns the new table block's ID.
 */
insertTableInCell(blockId: string, rows: number, cols: number): string {
  const cellInfo = this._blockParentMap.get(blockId);
  if (!cellInfo) {
    throw new Error(`Block ${blockId} is not inside a table cell`);
  }
  const tableBlock = this.getBlock(cellInfo.tableBlockId);
  const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
  const blockIndex = cell.blocks.findIndex((b) => b.id === blockId);

  const newTable = createTableBlock(rows, cols);
  cell.blocks.splice(blockIndex + 1, 0, newTable);
  this.store.updateTableCell(
    cellInfo.tableBlockId, cellInfo.rowIndex, cellInfo.colIndex, cell,
  );
  this.refresh();
  return newTable.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && npx vitest run test/model/nested-table.test.ts`
Expected: PASS

- [ ] **Step 5: Update editor insertTable() to handle cell context**

In `packages/docs/src/view/editor.ts`, modify the `insertTable` method (lines 1849-1873):

```typescript
insertTable: (rows: number, cols: number) => {
  docStore.snapshot();
  const pos = cursor.position;
  const cellInfo = layout.blockParentMap.get(pos.blockId);

  if (cellInfo) {
    // Cursor is inside a table cell — insert nested table
    const innerTableId = doc.insertTableInCell(pos.blockId, rows, cols);
    const innerBlock = doc.getBlock(innerTableId);
    const firstCellBlock = innerBlock.tableData!.rows[0].cells[0].blocks[0];
    cursor.moveTo({ blockId: firstCellBlock.id, offset: 0 });
    invalidateLayout();
    render();
    return;
  }

  // Top-level table insertion (existing logic)
  const block = doc.getBlock(pos.blockId);
  const blockLen = getBlockTextLength(block);
  if (pos.offset > 0 && pos.offset < blockLen) {
    doc.splitBlock(pos.blockId, pos.offset);
  }
  const blockIndex = doc.getBlockIndex(pos.blockId);
  const tableId = doc.insertTable(blockIndex + 1, rows, cols);
  const tableIndex = doc.getBlockIndex(tableId);
  doc.ensureBlockAfter(tableIndex);
  const tableBlock = doc.getBlock(tableId);
  const firstCellBlock = tableBlock.tableData!.rows[0].cells[0].blocks[0];
  cursor.moveTo({ blockId: firstCellBlock.id, offset: 0 });
  invalidateLayout();
  render();
},
```

- [ ] **Step 6: Update deleteTable() to handle nested tables**

In `packages/docs/src/view/editor.ts`, modify `deleteTable` (lines 1874-1889):

```typescript
deleteTable: () => {
  const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
  if (!cellInfo) return;
  const tableBlockId = cellInfo.tableBlockId;
  docStore.snapshot();

  // Check if this table is itself nested inside a cell
  const parentCellInfo = layout.blockParentMap.get(tableBlockId);
  if (parentCellInfo) {
    // Nested table — remove it from the parent cell's blocks
    const parentTableBlock = doc.getBlock(parentCellInfo.tableBlockId);
    const parentCell = parentTableBlock.tableData!.rows[parentCellInfo.rowIndex].cells[parentCellInfo.colIndex];
    const idx = parentCell.blocks.findIndex((b) => b.id === tableBlockId);
    if (idx !== -1) {
      parentCell.blocks.splice(idx, 1);
      // Ensure cell has at least one block
      if (parentCell.blocks.length === 0) {
        parentCell.blocks.push({
          id: generateBlockId(),
          type: 'paragraph',
          inlines: [{ text: '', style: {} }],
          style: { ...DEFAULT_BLOCK_STYLE },
        });
      }
      doc.store.updateTableCell(
        parentCellInfo.tableBlockId, parentCellInfo.rowIndex, parentCellInfo.colIndex, parentCell,
      );
      cursor.moveTo({ blockId: parentCell.blocks[0].id, offset: 0 });
    }
  } else {
    // Top-level table — existing logic
    const blockIndex = doc.getBlockIndex(tableBlockId);
    doc.deleteBlock(tableBlockId);
    const blocks = doc.document.blocks;
    if (blocks.length > 0) {
      const newIndex = Math.min(blockIndex, blocks.length - 1);
      cursor.moveTo({ blockId: blocks[newIndex].id, offset: 0 });
    }
  }
  invalidateLayout();
  render();
},
```

Note: You'll need to import `generateBlockId` and `DEFAULT_BLOCK_STYLE` at the top of editor.ts if not already imported.

- [ ] **Step 7: Run full test suite**

Run: `pnpm verify:fast`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/src/view/editor.ts packages/docs/test/model/nested-table.test.ts
git commit -m 'Allow table insertion and deletion inside cells

insertTableInCell() adds a table block to a cell. The editor
insertTable() detects cell context and delegates. deleteTable()
handles nested table removal from parent cells.'
```

---

### Task 5: Navigation — Verify and Fix Cell Navigation for Nested Tables

Verify that Tab/arrow navigation works correctly when the cursor is inside a nested table. The existing `moveToNextCell()`/`moveToPrevCell()` use `getCellInfo()` which returns the direct parent table — this should work, but needs verification and edge case handling.

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts:3290-3380` (if needed)
- Modify: `packages/docs/test/model/nested-table.test.ts` (add navigation tests)

- [ ] **Step 1: Write test for navigation context in nested tables**

Add to `packages/docs/test/model/nested-table.test.ts`:

```typescript
describe('Nested table navigation context', () => {
  it('getCellInfo should return inner table cell for inner block', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const cell00 = outerBlock.tableData!.rows[0].cells[0];
    const innerTable = createTableBlock(2, 2);
    cell00.blocks.push(innerTable);
    doc.store.updateTableCell(outerTableId, 0, 0, cell00);

    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);

    // Inner cell (1,1) paragraph
    const innerCellBlock = innerTable.tableData!.rows[1].cells[1].blocks[0];
    const info = map.get(innerCellBlock.id);
    expect(info).toBeDefined();
    expect(info!.tableBlockId).toBe(innerTable.id);
    expect(info!.rowIndex).toBe(1);
    expect(info!.colIndex).toBe(1);
  });

  it('getCellInfo for inner table block itself should return outer cell', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const cell00 = outerBlock.tableData!.rows[0].cells[0];
    const innerTable = createTableBlock(2, 2);
    cell00.blocks.push(innerTable);
    doc.store.updateTableCell(outerTableId, 0, 0, cell00);

    const map = buildParentMapRecursive(doc, outerTableId);

    const info = map.get(innerTable.id);
    expect(info).toBeDefined();
    expect(info!.tableBlockId).toBe(outerTableId);
    expect(info!.rowIndex).toBe(0);
    expect(info!.colIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/docs && npx vitest run test/model/nested-table.test.ts`
Expected: PASS — `BlockParentMap` already maps inner blocks to direct parent table. `moveToNextCell()` and `moveToPrevCell()` in text-editor.ts use `getCellInfo()` which reads from `blockParentMap`, so they will navigate within the inner table. No code changes needed if tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/docs/test/model/nested-table.test.ts
git commit -m 'Add navigation context tests for nested tables

Verify that BlockParentMap correctly maps inner table cell blocks
to their direct parent table for scoped navigation.'
```

---

### Task 6: CRDT — resolveTreePath() for Nested Tables

Add a `resolveTreePath()` utility that converts a blockId to a Yorkie Tree path, supporting arbitrarily nested tables.

**Files:**
- Modify: `packages/docs/src/store/yorkie.ts` (or create utility)
- Tests inline with the Yorkie store tests

This task depends on the existing YorkieDocStore implementation. The key change is:

- [ ] **Step 1: Identify current Yorkie path resolution**

Read `packages/docs/src/store/yorkie.ts` to understand how table operations currently map to tree paths.

- [ ] **Step 2: Add resolveTreePath() utility**

The utility walks up the `BlockParentMap` chain from a blockId to build the full Yorkie Tree path:

```typescript
/**
 * Resolve a block's Yorkie Tree path by walking up the BlockParentMap chain.
 * For a block inside a nested table, this produces a path like:
 *   [outerTableIdx, trIdx, tdIdx, innerTableBlockIdx, innerTrIdx, innerTdIdx, blockIdx]
 */
export function resolveTreePath(
  blockId: string,
  blockParentMap: Map<string, BlockCellInfo>,
  doc: Doc,
): number[] {
  const cellInfo = blockParentMap.get(blockId);
  if (!cellInfo) {
    // Top-level block — return its document-level index
    return [doc.getBlockIndex(blockId)];
  }

  // Build path from innermost to outermost
  const segments: number[] = [];

  // Find block index within its cell
  const tableBlock = doc.getBlock(cellInfo.tableBlockId);
  const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
  const blockIndex = cell.blocks.findIndex((b) => b.id === blockId);
  segments.unshift(blockIndex); // block within <td>
  segments.unshift(cellInfo.colIndex); // <td> index
  segments.unshift(cellInfo.rowIndex); // <tr> index

  // Now resolve the table block itself (may be nested)
  const parentPath = resolveTreePath(cellInfo.tableBlockId, blockParentMap, doc);
  return [...parentPath, ...segments];
}
```

- [ ] **Step 3: Update Yorkie store table operations to use resolveTreePath()**

Existing granular operations (`insertTableRow`, `updateTableCell`, etc.) in the Yorkie store should use `resolveTreePath()` to compute the correct path for nested tables instead of assuming a flat document structure.

- [ ] **Step 4: Write tests for path resolution**

Test that `resolveTreePath()` returns the correct path for:
- A block in a top-level table cell
- A block in a nested table cell
- A block in a 2-level nested table cell

- [ ] **Step 5: Run full test suite**

Run: `pnpm verify:fast`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/store/
git commit -m 'Add resolveTreePath() for nested table CRDT paths

Walks BlockParentMap chain to build Yorkie Tree paths for blocks
at any nesting depth.'
```

---

### Task 7: Integration Testing & Edge Cases

End-to-end verification of nested tables across the full pipeline.

**Files:**
- Modify: `packages/docs/test/model/nested-table.test.ts`

- [ ] **Step 1: Add integration tests**

```typescript
describe('Nested table integration', () => {
  it('should support row/column operations on inner table', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const cell00 = outerBlock.tableData!.rows[0].cells[0];
    const innerTable = createTableBlock(2, 2);
    cell00.blocks.push(innerTable);
    doc.store.updateTableCell(outerTableId, 0, 0, cell00);

    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);

    // Insert row in inner table
    doc.insertRow(innerTable.id, 1);
    const updatedInner = doc.getBlock(innerTable.id);
    expect(updatedInner.tableData!.rows).toHaveLength(3);

    // Insert column in inner table
    doc.insertColumn(innerTable.id, 1);
    expect(updatedInner.tableData!.columnWidths).toHaveLength(3);
  });

  it('should support merge/split in inner table', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const cell00 = outerBlock.tableData!.rows[0].cells[0];
    const innerTable = createTableBlock(3, 3);
    cell00.blocks.push(innerTable);
    doc.store.updateTableCell(outerTableId, 0, 0, cell00);

    const map = buildParentMapRecursive(doc, outerTableId);
    doc.setBlockParentMap(map);

    // Merge cells in inner table
    const range: CellRange = {
      start: { rowIndex: 0, colIndex: 0 },
      end: { rowIndex: 1, colIndex: 1 },
    };
    doc.mergeCells(innerTable.id, range);
    const updatedInner = doc.getBlock(innerTable.id);
    expect(updatedInner.tableData!.rows[0].cells[0].colSpan).toBe(2);
    expect(updatedInner.tableData!.rows[0].cells[0].rowSpan).toBe(2);

    // Split
    doc.splitCell(innerTable.id, { rowIndex: 0, colIndex: 0 });
    const afterSplit = doc.getBlock(innerTable.id);
    expect(afterSplit.tableData!.rows[0].cells[0].colSpan).toBeUndefined();
  });

  it('should support text editing in deeply nested table (2 levels)', () => {
    const doc = Doc.create();
    const outerTableId = doc.insertTable(0, 2, 2);
    const outerBlock = doc.getBlock(outerTableId);
    const cell00 = outerBlock.tableData!.rows[0].cells[0];

    // Level 1: inner table in outer cell (0,0)
    const innerTable = createTableBlock(2, 2);
    cell00.blocks.push(innerTable);
    doc.store.updateTableCell(outerTableId, 0, 0, cell00);

    // Level 2: innermost table in inner cell (0,0)
    const innerCell00 = innerTable.tableData!.rows[0].cells[0];
    const innermostTable = createTableBlock(2, 2);
    innerCell00.blocks.push(innermostTable);
    // Update the outer cell which contains the modified inner table
    doc.store.updateTableCell(outerTableId, 0, 0, cell00);

    // Build recursive map (must handle 3 levels)
    const map = buildParentMapRecursive(doc, outerTableId);
    // Extend map for level 2
    for (let r = 0; r < innermostTable.tableData!.rows.length; r++) {
      for (let c = 0; c < innermostTable.tableData!.rows[r].cells.length; c++) {
        for (const b of innermostTable.tableData!.rows[r].cells[c].blocks) {
          map.set(b.id, { tableBlockId: innermostTable.id, rowIndex: r, colIndex: c });
        }
      }
    }
    doc.setBlockParentMap(map);

    // Insert text in innermost cell
    const innermostBlock = innermostTable.tableData!.rows[0].cells[0].blocks[0];
    doc.insertText({ blockId: innermostBlock.id, offset: 0 }, 'Deep!');
    const found = doc.getBlock(innermostBlock.id);
    expect(found.inlines.map(i => i.text).join('')).toBe('Deep!');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/docs && npx vitest run test/model/nested-table.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `pnpm verify:fast`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/docs/test/model/nested-table.test.ts
git commit -m 'Add integration tests for nested table operations

Tests row/column insert, merge/split, and 2-level deep text editing
inside nested tables.'
```

---

### Task 8: Update Design Docs

Update the existing table design docs to reflect nested table support.

**Files:**
- Modify: `docs/design/docs/docs-tables.md` — add nested tables to the phase plan
- Already created: `docs/design/docs/docs-nested-tables.md`

- [ ] **Step 1: Update docs-tables.md phase plan**

Add a note in the extensibility/phase section that nested tables are now supported.

- [ ] **Step 2: Update docs-table-crdt.md**

Remove or update the "table type NOT allowed in cell" constraint to reflect the new capability.

- [ ] **Step 3: Commit**

```bash
git add docs/design/
git commit -m 'Update design docs to reflect nested table support'
```
