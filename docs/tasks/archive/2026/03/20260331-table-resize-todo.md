# Table Column & Row Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add column and row resize via cell border drag handles (Google Docs style) to Docs tables.

**Architecture:** Detect mouse proximity to table cell borders, show resize cursor, let user drag with a guideline overlay, and apply the resize on mouse-up. Column resize adjusts the two adjacent column ratios in `columnWidths`. Row resize sets a user-specified minimum height in a new `rowHeights` array.

**Tech Stack:** TypeScript, Canvas 2D, Vitest

**Spec:** `docs/design/docs/docs-table-resize.md`

---

### Task 1: Data Model — Add `rowHeights` to `TableData`

**Files:**
- Modify: `packages/docs/src/model/types.ts:277-280`
- Test: `packages/docs/test/model/types.test.ts`

- [x] **Step 1: Write the failing test**

In `packages/docs/test/model/types.test.ts`, add:

```typescript
describe('createTableBlock rowHeights', () => {
  it('should not include rowHeights by default', () => {
    const block = createTableBlock(2, 3);
    expect(block.tableData!.rowHeights).toBeUndefined();
  });
});
```

- [x] **Step 2: Run test to verify it passes (baseline)**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/model/types.test.ts`

This test should already pass since `rowHeights` is not added yet and `createTableBlock` doesn't set it. This is a baseline sanity check.

- [x] **Step 3: Add `rowHeights` to `TableData`**

In `packages/docs/src/model/types.ts`, change the `TableData` interface:

```typescript
export interface TableData {
  rows: TableRow[];
  columnWidths: number[];
  rowHeights?: number[];
}
```

- [x] **Step 4: Run test to verify it still passes**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/model/types.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/test/model/types.test.ts
git commit -m "Add rowHeights field to TableData interface

Optional field for user-specified minimum row heights in pixels.
Undefined means content-based auto height (existing behavior)."
```

---

### Task 2: Doc API — Add `resizeColumn()` and `setRowHeight()`

**Files:**
- Modify: `packages/docs/src/model/document.ts:758-773`
- Test: `packages/docs/test/model/table.test.ts`

- [x] **Step 1: Write failing test for `resizeColumn()`**

In `packages/docs/test/model/table.test.ts`, add:

```typescript
describe('resizeColumn', () => {
  it('should resize adjacent columns without affecting others', () => {
    const doc = Doc.create();
    const tableId = doc.insertTable(0, 2, 4); // 4 columns, each 0.25
    const td = doc.getBlock(tableId).tableData!;
    expect(td.columnWidths).toEqual([0.25, 0.25, 0.25, 0.25]);

    doc.resizeColumn(tableId, 1, 0.35, 0.15); // widen col[1], shrink col[2]
    const after = doc.getBlock(tableId).tableData!;
    expect(after.columnWidths[0]).toBeCloseTo(0.25); // unchanged
    expect(after.columnWidths[1]).toBeCloseTo(0.35);
    expect(after.columnWidths[2]).toBeCloseTo(0.15);
    expect(after.columnWidths[3]).toBeCloseTo(0.25); // unchanged
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/model/table.test.ts`
Expected: FAIL with "doc.resizeColumn is not a function"

- [x] **Step 3: Implement `resizeColumn()`**

In `packages/docs/src/model/document.ts`, add after `setColumnWidth()` (line 773):

```typescript
/**
 * Resize adjacent columns by adjusting their ratios.
 * Only col[colIndex] and col[colIndex + 1] change.
 * Total ratio sum remains 1.0.
 */
resizeColumn(blockId: string, colIndex: number, leftRatio: number, rightRatio: number): void {
  const block = this.getBlock(blockId);
  const td = block.tableData!;
  td.columnWidths[colIndex] = leftRatio;
  td.columnWidths[colIndex + 1] = rightRatio;
  this.store.updateTableAttrs(blockId, { cols: td.columnWidths });
  this.refresh();
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/model/table.test.ts`
Expected: PASS

- [x] **Step 5: Write failing test for `setRowHeight()`**

In `packages/docs/test/model/table.test.ts`, add:

```typescript
describe('setRowHeight', () => {
  it('should set a row minimum height', () => {
    const doc = Doc.create();
    const tableId = doc.insertTable(0, 3, 2);
    doc.setRowHeight(tableId, 1, 60);
    const td = doc.getBlock(tableId).tableData!;
    expect(td.rowHeights).toBeDefined();
    expect(td.rowHeights![1]).toBe(60);
  });

  it('should initialize rowHeights array with undefined entries', () => {
    const doc = Doc.create();
    const tableId = doc.insertTable(0, 3, 2);
    doc.setRowHeight(tableId, 2, 80);
    const td = doc.getBlock(tableId).tableData!;
    expect(td.rowHeights).toHaveLength(3);
    expect(td.rowHeights![0]).toBeUndefined();
    expect(td.rowHeights![1]).toBeUndefined();
    expect(td.rowHeights![2]).toBe(80);
  });
});
```

- [x] **Step 6: Run test to verify it fails**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/model/table.test.ts`
Expected: FAIL with "doc.setRowHeight is not a function"

- [x] **Step 7: Implement `setRowHeight()`**

In `packages/docs/src/model/document.ts`, add after `resizeColumn()`:

```typescript
/**
 * Set a row's user-specified minimum height in pixels.
 * Initializes the rowHeights array if it doesn't exist.
 */
setRowHeight(blockId: string, rowIndex: number, height: number): void {
  const block = this.getBlock(blockId);
  const td = block.tableData!;
  if (!td.rowHeights) {
    td.rowHeights = new Array(td.rows.length).fill(undefined);
  }
  td.rowHeights[rowIndex] = height;
  this.store.updateTableAttrs(blockId, { cols: td.columnWidths, rowHeights: td.rowHeights });
  this.refresh();
}
```

- [x] **Step 8: Update `updateTableAttrs` signature to support `rowHeights`**

In `packages/docs/src/store/store.ts`, change line 49:

```typescript
updateTableAttrs(tableBlockId: string, attrs: { cols: number[]; rowHeights?: number[] }): void;
```

In `packages/docs/src/store/memory.ts`, update `updateTableAttrs`:

```typescript
updateTableAttrs(tableBlockId: string, attrs: { cols: number[]; rowHeights?: number[] }): void {
  const block = this.findBlock(tableBlockId);
  block.tableData!.columnWidths = [...attrs.cols];
  if (attrs.rowHeights !== undefined) {
    block.tableData!.rowHeights = [...attrs.rowHeights];
  }
}
```

In `packages/frontend/src/app/docs/yorkie-doc-store.ts`, update `updateTableAttrs`:

```typescript
updateTableAttrs(tableBlockId: string, attrs: { cols: number[]; rowHeights?: number[] }): void {
  const tIdx = this.findTableIndex(tableBlockId);
  const currentDoc = this.getDocument();
  const block = currentDoc.blocks[tIdx];
  block.tableData!.columnWidths = attrs.cols;
  if (attrs.rowHeights !== undefined) {
    block.tableData!.rowHeights = attrs.rowHeights;
  }
  this.doc.update((root) => {
    root.content.editByPath([tIdx], [tIdx + 1], buildBlockNode(block));
  });
  this.cachedDoc = currentDoc;
  this.dirty = false;
}
```

- [x] **Step 9: Run test to verify it passes**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/model/table.test.ts`
Expected: PASS

- [x] **Step 10: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/src/store/store.ts packages/docs/src/store/memory.ts packages/frontend/src/app/docs/yorkie-doc-store.ts packages/docs/test/model/table.test.ts
git commit -m "Add resizeColumn() and setRowHeight() to Doc API

resizeColumn() adjusts only the two adjacent columns sharing a border,
keeping the total ratio sum at 1.0. setRowHeight() sets a user-specified
minimum height in pixels via a new rowHeights array on TableData."
```

---

### Task 3: Sync `rowHeights` on Row Insert/Delete

**Files:**
- Modify: `packages/docs/src/model/document.ts:555-591`
- Test: `packages/docs/test/model/table.test.ts`

- [x] **Step 1: Write failing test for row insert with rowHeights**

In `packages/docs/test/model/table.test.ts`, add:

```typescript
describe('rowHeights sync', () => {
  it('should splice rowHeights on insertRow', () => {
    const doc = Doc.create();
    const tableId = doc.insertTable(0, 3, 2);
    doc.setRowHeight(tableId, 0, 40);
    doc.setRowHeight(tableId, 2, 80);

    doc.insertRow(tableId, 1); // insert between row 0 and old row 1
    const td = doc.getBlock(tableId).tableData!;
    expect(td.rowHeights).toHaveLength(4);
    expect(td.rowHeights![0]).toBe(40);
    expect(td.rowHeights![1]).toBeUndefined(); // new row has no user height
    expect(td.rowHeights![3]).toBe(80);
  });

  it('should splice rowHeights on deleteRow', () => {
    const doc = Doc.create();
    const tableId = doc.insertTable(0, 3, 2);
    doc.setRowHeight(tableId, 0, 40);
    doc.setRowHeight(tableId, 1, 60);
    doc.setRowHeight(tableId, 2, 80);

    doc.deleteRow(tableId, 1);
    const td = doc.getBlock(tableId).tableData!;
    expect(td.rowHeights).toHaveLength(2);
    expect(td.rowHeights![0]).toBe(40);
    expect(td.rowHeights![1]).toBe(80);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/model/table.test.ts`
Expected: FAIL — rowHeights not synced after insert/delete

- [x] **Step 3: Update `insertRow()` to splice `rowHeights`**

In `packages/docs/src/model/document.ts`, in `insertRow()`, after `td.rows.splice(atIndex, 0, { cells });` (line 563), add:

```typescript
if (td.rowHeights) {
  td.rowHeights.splice(atIndex, 0, undefined as unknown as number);
}
```

- [x] **Step 4: Update `deleteRow()` to splice `rowHeights`**

In `packages/docs/src/model/document.ts`, in `deleteRow()`, after `td.rows.splice(rowIndex, 1);` (line 588), add:

```typescript
if (td.rowHeights) {
  td.rowHeights.splice(rowIndex, 1);
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/model/table.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/test/model/table.test.ts
git commit -m "Sync rowHeights array on row insert/delete

Splice the rowHeights array in insertRow() and deleteRow() to keep it
aligned with the rows array. New rows get undefined (auto height)."
```

---

### Task 4: Layout — Apply `rowHeights` Minimum in `computeTableLayout()`

**Files:**
- Modify: `packages/docs/src/view/table-layout.ts:288-293`
- Test: `packages/docs/test/view/table-layout.test.ts`

- [x] **Step 1: Write failing test**

In `packages/docs/test/view/table-layout.test.ts`, add:

```typescript
it('should apply user-specified rowHeights as minimum', () => {
  const block = createTableBlock(2, 2);
  block.tableData!.rowHeights = [60, undefined as unknown as number];
  const result = computeTableLayout(block.tableData!, 'test-table', stubCtx(), 200);
  expect(result.rowHeights[0]).toBeGreaterThanOrEqual(60);
  // Row 1 should use content-based height (at least MIN_ROW_HEIGHT = 20)
  expect(result.rowHeights[1]).toBeGreaterThanOrEqual(20);
});

it('should not shrink row below content height even with smaller rowHeights', () => {
  const block = createTableBlock(2, 2);
  // Add enough text to make content taller than 5px
  block.tableData!.rows[0].cells[0].blocks[0].inlines = [{ text: 'Hello World Long Text', style: {} }];
  block.tableData!.rowHeights = [5, undefined as unknown as number]; // 5px is less than content
  const result = computeTableLayout(block.tableData!, 'test-table', stubCtx(), 50); // narrow width forces wrapping
  // Row height should be content-based, not 5px
  expect(result.rowHeights[0]).toBeGreaterThan(5);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/view/table-layout.test.ts`
Expected: FAIL — first test fails because rowHeights[0] is less than 60

- [x] **Step 3: Implement rowHeights enforcement in `computeTableLayout()`**

In `packages/docs/src/view/table-layout.ts`, after the MIN_ROW_HEIGHT enforcement loop (after line 293), add:

```typescript
// 5b. Apply user-specified row heights as minimums
if (tableData.rowHeights) {
  for (let r = 0; r < numRows; r++) {
    const userHeight = tableData.rowHeights[r];
    if (userHeight !== undefined && userHeight > rowHeights[r]) {
      rowHeights[r] = userHeight;
    }
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/view/table-layout.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/table-layout.ts packages/docs/test/view/table-layout.test.ts
git commit -m "Apply user-specified rowHeights as minimum in table layout

User heights act as a floor; content height wins when it exceeds the
user value. Rows without a user height use content-based auto sizing."
```

---

### Task 5: Border Detection — `detectTableBorder()`

**Files:**
- Create: `packages/docs/src/view/table-resize.ts`
- Test: `packages/docs/test/view/table-resize.test.ts`

- [x] **Step 1: Write failing test for column border detection**

Create `packages/docs/test/view/table-resize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectTableBorder, type BorderHit } from '../../src/view/table-resize.js';
import { computeTableLayout } from '../../src/view/table-layout.js';
import { createTableBlock } from '../../src/model/types.js';

function stubCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as CanvasRenderingContext2D;
}

function makeLayout() {
  const block = createTableBlock(3, 3);
  block.tableData!.columnWidths = [1 / 3, 1 / 3, 1 / 3];
  return computeTableLayout(block.tableData!, 'tbl', stubCtx(), 300);
}

describe('detectTableBorder', () => {
  it('should detect column border between col 0 and col 1', () => {
    const layout = makeLayout();
    // Border between col 0 and col 1 is at x=100
    const hit = detectTableBorder(layout, 101, 10);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('column');
    expect(hit!.index).toBe(0);
  });

  it('should detect column border between col 1 and col 2', () => {
    const layout = makeLayout();
    // Border between col 1 and col 2 is at x=200
    const hit = detectTableBorder(layout, 199, 10);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('column');
    expect(hit!.index).toBe(1);
  });

  it('should not detect left edge of first column', () => {
    const layout = makeLayout();
    const hit = detectTableBorder(layout, 1, 10);
    expect(hit).toBeNull();
  });

  it('should not detect right edge of last column', () => {
    const layout = makeLayout();
    const hit = detectTableBorder(layout, 299, 10);
    expect(hit).toBeNull();
  });

  it('should detect row border between row 0 and row 1', () => {
    const layout = makeLayout();
    const borderY = layout.rowYOffsets[1];
    const hit = detectTableBorder(layout, 50, borderY + 1);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('row');
    expect(hit!.index).toBe(0);
  });

  it('should not detect top edge of first row', () => {
    const layout = makeLayout();
    const hit = detectTableBorder(layout, 50, 1);
    expect(hit).toBeNull();
  });

  it('should detect bottom edge of last row for height adjustment', () => {
    const layout = makeLayout();
    const bottomY = layout.totalHeight;
    const hit = detectTableBorder(layout, 50, bottomY - 1);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('row');
    expect(hit!.index).toBe(2); // last row index
  });

  it('should return null when not near any border', () => {
    const layout = makeLayout();
    const hit = detectTableBorder(layout, 50, 10); // center of cell (0,0)
    expect(hit).toBeNull();
  });

  it('should prioritize column over row at intersection', () => {
    const layout = makeLayout();
    // At intersection of col border (x=100) and row border
    const borderY = layout.rowYOffsets[1];
    const hit = detectTableBorder(layout, 101, borderY + 1);
    expect(hit).not.toBeNull();
    expect(hit!.type).toBe('column');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/view/table-resize.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement `detectTableBorder()`**

Create `packages/docs/src/view/table-resize.ts`:

```typescript
import type { LayoutTable } from './table-layout.js';

const BORDER_THRESHOLD = 4;
const MIN_COLUMN_WIDTH = 30;
const MIN_ROW_HEIGHT = 20;

export interface BorderHit {
  type: 'column' | 'row';
  index: number; // left/top index of the border
}

export interface BorderDragState {
  type: 'column' | 'row';
  tableBlockId: string;
  index: number;
  startPixel: number;
  currentPixel: number;
  minPixel: number;
  maxPixel: number;
}

/**
 * Detect if the given local coordinates (relative to table top-left)
 * are near a resizable column or row border.
 *
 * Returns a BorderHit if within BORDER_THRESHOLD of a border, or null.
 * Column borders take priority over row borders at intersections.
 */
export function detectTableBorder(
  layout: LayoutTable,
  localX: number,
  localY: number,
): BorderHit | null {
  const { columnXOffsets, columnPixelWidths, rowYOffsets, rowHeights } = layout;
  const numCols = columnPixelWidths.length;
  const numRows = rowHeights.length;

  // Check column borders (skip first left edge and last right edge)
  for (let c = 0; c < numCols - 1; c++) {
    const borderX = columnXOffsets[c] + columnPixelWidths[c];
    if (Math.abs(localX - borderX) <= BORDER_THRESHOLD) {
      return { type: 'column', index: c };
    }
  }

  // Check row borders (skip first top edge; include last bottom edge)
  for (let r = 0; r < numRows; r++) {
    const borderY = rowYOffsets[r] + rowHeights[r];
    if (Math.abs(localY - borderY) <= BORDER_THRESHOLD) {
      return { type: 'row', index: r };
    }
  }

  return null;
}

/**
 * Create a BorderDragState for a detected border hit.
 *
 * Computes min/max pixel bounds to enforce minimum size constraints.
 * For columns: both adjacent columns must stay >= MIN_COLUMN_WIDTH.
 * For rows: the row must stay >= MIN_ROW_HEIGHT.
 *
 * @param tableOriginPixel — the table's top-left X (for column) or Y (for row) in canvas coords
 * @param contentWidth — available content width for ratio computation
 */
export function createDragState(
  hit: BorderHit,
  tableBlockId: string,
  layout: LayoutTable,
  mousePixel: number,
  tableOriginPixel: number,
): BorderDragState {
  const { columnXOffsets, columnPixelWidths, rowYOffsets, rowHeights } = layout;

  if (hit.type === 'column') {
    const leftColStart = tableOriginPixel + columnXOffsets[hit.index];
    const rightColEnd = tableOriginPixel + columnXOffsets[hit.index + 1] + columnPixelWidths[hit.index + 1];
    return {
      type: 'column',
      tableBlockId,
      index: hit.index,
      startPixel: mousePixel,
      currentPixel: mousePixel,
      minPixel: leftColStart + MIN_COLUMN_WIDTH,
      maxPixel: rightColEnd - MIN_COLUMN_WIDTH,
    };
  } else {
    const rowStart = tableOriginPixel + rowYOffsets[hit.index];
    return {
      type: 'row',
      tableBlockId,
      index: hit.index,
      startPixel: mousePixel,
      currentPixel: mousePixel,
      minPixel: rowStart + MIN_ROW_HEIGHT,
      maxPixel: Number.MAX_SAFE_INTEGER, // rows can grow freely
    };
  }
}

export { MIN_COLUMN_WIDTH, MIN_ROW_HEIGHT, BORDER_THRESHOLD };
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run test/view/table-resize.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/table-resize.ts packages/docs/test/view/table-resize.test.ts
git commit -m "Add border detection for table column/row resize

detectTableBorder() checks if mouse coordinates are within 4px of a
resizable border. Column borders take priority at intersections.
createDragState() computes min/max pixel bounds for drag clamping."
```

---

### Task 6: Integrate Border Detection and Drag into TextEditor

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

This is the largest task. It wires border detection into mouse events.

- [x] **Step 1: Add imports and drag state field**

At the top of `packages/docs/src/view/text-editor.ts`, add import:

```typescript
import { detectTableBorder, createDragState, type BorderDragState } from './table-resize.js';
```

In the `TextEditor` class, after the existing `private lastClickY = 0;` field (line 50), add:

```typescript
private borderDragState: BorderDragState | null = null;
```

Add a callback field for guideline rendering and a public getter:

```typescript
/** Callback to update the drag guideline overlay in the editor paint loop. */
onDragGuideline?: (pos: { x?: number; y?: number } | null) => void;

getBorderDragState(): BorderDragState | null {
  return this.borderDragState;
}
```

- [x] **Step 2: Add helper to resolve table-local coordinates from mouse event**

Add a private helper in the TextEditor class:

```typescript
/**
 * Resolve mouse event to table-local coordinates and layout.
 * Returns null if the mouse is not over a table block.
 */
private resolveTableFromMouse(e: MouseEvent): {
  tableBlockId: string;
  localX: number;
  localY: number;
  layout: import('./table-layout.js').LayoutTable;
  tableOriginX: number;
  tableOriginY: number;
} | null {
  const rect = this.container.getBoundingClientRect();
  const s = this.getScaleFactor();
  const mouseX = (e.clientX - rect.left + this.container.scrollLeft) / s;
  const mouseY = (e.clientY - rect.top - this.getCanvasOffsetTop()) / s + this.container.scrollTop / s;

  const layout = this.getLayout();
  const paginatedLayout = this.getPaginatedLayout();
  const { margins } = paginatedLayout.pageSetup;
  const pageX = getPageXOffset(paginatedLayout, this.getCanvasWidth());

  for (const lb of layout.blocks) {
    if (lb.block.type !== 'table' || !lb.layoutTable) continue;
    const tl = lb.layoutTable;
    const blockIndex = layout.blocks.indexOf(lb);

    // Find table's page position
    let tablePageY = 0;
    for (const page of paginatedLayout.pages) {
      for (const pl of page.lines) {
        if (pl.blockIndex === blockIndex && pl.lineIndex === 0) {
          tablePageY = getPageYOffset(paginatedLayout, page.pageIndex) + pl.y;
          break;
        }
      }
      if (tablePageY !== 0) break;
    }

    const tableOriginX = pageX + margins.left;
    const tableOriginY = tablePageY;
    const localX = mouseX - tableOriginX;
    const localY = mouseY - tableOriginY;

    // Check if mouse is within table bounds
    if (localX >= 0 && localX <= tl.totalWidth && localY >= 0 && localY <= tl.totalHeight) {
      return {
        tableBlockId: lb.block.id,
        localX,
        localY,
        layout: tl,
        tableOriginX,
        tableOriginY,
      };
    }
  }
  return null;
}
```

- [x] **Step 3: Modify `handleMouseDown` for border drag initiation**

In `handleMouseDown`, after `e.preventDefault();` (line 673) and before `this.flushHangul();` (line 674), add:

```typescript
// Check for border resize drag
const tableInfo = this.resolveTableFromMouse(e);
if (tableInfo) {
  const hit = detectTableBorder(tableInfo.layout, tableInfo.localX, tableInfo.localY);
  if (hit) {
    const pixel = hit.type === 'column'
      ? tableInfo.tableOriginX + tableInfo.layout.columnXOffsets[hit.index] + tableInfo.layout.columnPixelWidths[hit.index]
      : tableInfo.tableOriginY + tableInfo.layout.rowYOffsets[hit.index] + tableInfo.layout.rowHeights[hit.index];
    this.borderDragState = createDragState(
      hit,
      tableInfo.tableBlockId,
      tableInfo.layout,
      pixel,
      hit.type === 'column' ? tableInfo.tableOriginX : tableInfo.tableOriginY,
    );
    this.isMouseDown = true;
    return;
  }
}
```

- [x] **Step 4: Modify `handleMouseMove` for border drag and cursor**

Replace the existing `handleMouseMove` (line 815-821) with:

```typescript
private handleMouseMove = (e: MouseEvent): void => {
  // During border drag: update drag position and guideline
  if (this.borderDragState) {
    const rect = this.container.getBoundingClientRect();
    const s = this.getScaleFactor();
    const pixel = this.borderDragState.type === 'column'
      ? (e.clientX - rect.left + this.container.scrollLeft) / s
      : (e.clientY - rect.top - this.getCanvasOffsetTop()) / s + this.container.scrollTop / s;
    this.borderDragState.currentPixel = Math.max(
      this.borderDragState.minPixel,
      Math.min(this.borderDragState.maxPixel, pixel),
    );
    // Update guideline via the existing dragGuideline mechanism in editor.ts
    if (this.borderDragState.type === 'column') {
      this.onDragGuideline?.({ x: this.borderDragState.currentPixel });
    } else {
      this.onDragGuideline?.({ y: this.borderDragState.currentPixel });
    }
    return;
  }

  // Cursor style: check for border proximity
  const tableInfo = this.resolveTableFromMouse(e);
  if (tableInfo) {
    const hit = detectTableBorder(tableInfo.layout, tableInfo.localX, tableInfo.localY);
    if (hit) {
      this.container.style.cursor = hit.type === 'column' ? 'col-resize' : 'row-resize';
    } else {
      this.container.style.cursor = '';
    }
  } else {
    this.container.style.cursor = '';
  }

  // Existing drag selection logic
  if (!this.isMouseDown || !this.selection.range) return;

  this.lastMouseClientY = e.clientY;
  this.updateDragSelection(e.clientX, e.clientY);
  this.startDragScroll();
};
```

- [x] **Step 5: Modify `handleMouseUp` for border drag completion**

Replace the existing `handleMouseUp` (line 823-826) with:

```typescript
private handleMouseUp = (): void => {
  if (this.borderDragState) {
    this.applyBorderDrag();
    this.borderDragState = null;
    this.isMouseDown = false;
    // Clear the guideline
    this.onDragGuideline?.(null);
    return;
  }
  this.isMouseDown = false;
  this.stopDragScroll();
};
```

- [x] **Step 6: Implement `applyBorderDrag()`**

Add a private method in TextEditor:

```typescript
private applyBorderDrag(): void {
  const drag = this.borderDragState;
  if (!drag) return;

  const deltaPx = drag.currentPixel - drag.startPixel;
  if (Math.abs(deltaPx) < 1) return; // ignore sub-pixel drags

  this.saveSnapshot();

  if (drag.type === 'column') {
    const layout = this.getLayout();
    const lb = layout.blocks.find((b) => b.block.id === drag.tableBlockId);
    if (!lb?.layoutTable) return;
    const tl = lb.layoutTable;
    const contentWidth = tl.totalWidth;
    const oldLeftWidth = tl.columnPixelWidths[drag.index];
    const oldRightWidth = tl.columnPixelWidths[drag.index + 1];
    const newLeftWidth = oldLeftWidth + deltaPx;
    const newRightWidth = oldRightWidth - deltaPx;
    const newLeftRatio = newLeftWidth / contentWidth;
    const newRightRatio = newRightWidth / contentWidth;
    this.doc.resizeColumn(drag.tableBlockId, drag.index, newLeftRatio, newRightRatio);
  } else {
    const layout = this.getLayout();
    const lb = layout.blocks.find((b) => b.block.id === drag.tableBlockId);
    if (!lb?.layoutTable) return;
    const tl = lb.layoutTable;
    const currentHeight = tl.rowHeights[drag.index];
    const newHeight = Math.max(currentHeight + deltaPx, 20);
    this.doc.setRowHeight(drag.tableBlockId, drag.index, newHeight);
  }

  this.markDirty(drag.tableBlockId);
  this.requestRender();
}
```

- [x] **Step 7: Run all tests to verify no regression**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm --filter @wafflebase/docs test -- --run`
Expected: All tests PASS

- [x] **Step 8: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "Integrate table border drag resize into TextEditor

Detect border proximity on mousemove (cursor change), initiate drag on
mousedown, update guideline position during drag, and apply resize on
mouseup. Column resize adjusts adjacent ratios; row resize sets minimum
height."
```

---

### Task 7: Wire Guideline Callback in Editor

**Files:**
- Modify: `packages/docs/src/view/editor.ts`

The `editor.ts` already has a `dragGuideline` variable and `renderPaintOnly()` for the ruler's drag guideline. We reuse the same mechanism for table border resize.

- [x] **Step 1: Wire `onDragGuideline` callback to TextEditor**

In `packages/docs/src/view/editor.ts`, after the TextEditor construction (around line 645), add:

```typescript
if (textEditor) {
  textEditor.onDragGuideline = (pos) => {
    dragGuideline = pos;
    renderPaintOnly();
  };
}
```

This reuses the existing `dragGuideline` → `paint()` → dashed line rendering that the ruler already uses (lines 482-501). No changes to the rendering code are needed — the guideline draws full-height/full-width dashed lines, which is exactly what we want.

- [x] **Step 2: Run the app and verify visually**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm dev`

1. Open a document, insert a table
2. Hover near a column border — cursor should change to `col-resize`
3. Hover near a row border — cursor should change to `row-resize`
4. Drag a column border — blue dashed guideline should appear
5. Release — column widths should update
6. Drag a row border — blue dashed guideline should appear
7. Release — row height should update

- [x] **Step 3: Run all tests**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflesheets && pnpm verify:fast`
Expected: All checks PASS

- [x] **Step 4: Commit**

```bash
git add packages/docs/src/view/editor.ts
git commit -m "Wire table resize guideline via existing dragGuideline mechanism

Reuse the ruler's dragGuideline variable and renderPaintOnly() for
table border drag feedback. No new rendering code needed."
```

---

### Task 8: Update Design Doc Index

**Files:**
- Modify: `docs/design/README.md`

- [x] **Step 1: Add docs-table-resize.md to the design docs table**

In `docs/design/README.md`, add a row to the table after the `docs-table-ui.md` entry:

```markdown
| [docs-table-resize.md](docs-table-resize.md)                       | Docs table resize — column/row border drag handles, guideline rendering          |
```

- [x] **Step 2: Commit**

```bash
git add docs/design/README.md docs/design/docs/docs-table-resize.md
git commit -m "Add table resize design doc to design index"
```
