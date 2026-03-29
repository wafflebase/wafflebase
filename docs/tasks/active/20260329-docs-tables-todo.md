# Docs Table Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add table support (creation, cell editing, merge/split, styling, layout, rendering) to Wafflebase Docs.

**Architecture:** Tables are a single Block type with embedded `TableData`. Each cell contains `Inline[]` reusing existing formatting. Layout reuses `layoutBlock()` for cell content. Store/Undo unchanged (Block-level operations).

**Tech Stack:** TypeScript, Canvas 2D, Vitest

**Spec:** [docs/design/docs-tables.md](../../design/docs-tables.md)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/docs/src/model/types.ts` | Add table types (TableData, TableCell, CellStyle, etc.) |
| Modify | `packages/docs/src/model/document.ts` | Add Doc table methods (CRUD, merge, style) |
| Create | `packages/docs/src/view/table-layout.ts` | Table layout computation (cell sizes, row heights) |
| Modify | `packages/docs/src/view/layout.ts` | Branch on `'table'` block type, delegate to table-layout |
| Create | `packages/docs/src/view/table-renderer.ts` | Table Canvas rendering (backgrounds, text, borders) |
| Modify | `packages/docs/src/view/doc-canvas.ts` | Call table renderer for table blocks |
| Modify | `packages/docs/src/view/pagination.ts` | Row-level page splitting for tables |
| Modify | `packages/docs/src/view/text-editor.ts` | Table cursor navigation (Tab, arrows, Enter) |
| Modify | `packages/docs/src/view/editor.ts` | Wire table APIs to EditorAPI |
| Modify | `packages/docs/src/index.ts` | Export new table types |
| Create | `packages/docs/test/model/table.test.ts` | Doc table method unit tests |
| Create | `packages/docs/test/view/table-layout.test.ts` | Table layout computation tests |

---

### Task 1: Data Model — Table Types

**Files:**
- Modify: `packages/docs/src/model/types.ts`
- Modify: `packages/docs/src/index.ts`
- Test: `packages/docs/test/model/types.test.ts`

- [ ] **Step 1: Write failing tests for table type factories**

Add to `packages/docs/test/model/types.test.ts`:

```typescript
import {
  createTableBlock,
  createTableCell,
  DEFAULT_CELL_STYLE,
  DEFAULT_BORDER_STYLE,
} from '../../src/model/types.js';

describe('Table types', () => {
  it('createTableCell returns cell with empty inline and default style', () => {
    const cell = createTableCell();
    expect(cell.inlines).toEqual([{ text: '', style: {} }]);
    expect(cell.style).toEqual(DEFAULT_CELL_STYLE);
    expect(cell.colSpan).toBeUndefined();
    expect(cell.rowSpan).toBeUndefined();
  });

  it('createTableBlock creates a table with given dimensions', () => {
    const block = createTableBlock(3, 4);
    expect(block.type).toBe('table');
    expect(block.tableData).toBeDefined();
    expect(block.tableData!.rows).toHaveLength(3);
    expect(block.tableData!.rows[0].cells).toHaveLength(4);
    expect(block.tableData!.columnWidths).toHaveLength(4);
    // Column widths sum to 1.0
    const sum = block.tableData!.columnWidths.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
  });

  it('createTableBlock columns have equal widths', () => {
    const block = createTableBlock(2, 3);
    for (const w of block.tableData!.columnWidths) {
      expect(w).toBeCloseTo(1 / 3);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && npx vitest run test/model/types.test.ts`
Expected: FAIL — `createTableBlock`, `createTableCell`, `DEFAULT_CELL_STYLE`, `DEFAULT_BORDER_STYLE` not exported.

- [ ] **Step 3: Add table types and factories to types.ts**

Add to `packages/docs/src/model/types.ts`:

```typescript
// --- Table types ---

export interface BorderStyle {
  width: number;
  color: string;
  style: 'solid' | 'none';
}

export const DEFAULT_BORDER_STYLE: BorderStyle = {
  width: 1,
  color: '#000000',
  style: 'solid',
};

export interface CellStyle {
  backgroundColor?: string;
  borderTop?: BorderStyle;
  borderBottom?: BorderStyle;
  borderLeft?: BorderStyle;
  borderRight?: BorderStyle;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  padding?: number;
}

export const DEFAULT_CELL_STYLE: CellStyle = {
  padding: 4,
};

export interface TableCell {
  inlines: Inline[];
  style: CellStyle;
  colSpan?: number;
  rowSpan?: number;
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableData {
  rows: TableRow[];
  columnWidths: number[];
}

export interface CellAddress {
  rowIndex: number;
  colIndex: number;
}

export interface CellRange {
  start: CellAddress;
  end: CellAddress;
}
```

Update `BlockType`:

```typescript
export type BlockType = 'paragraph' | 'title' | 'subtitle' | 'heading'
  | 'list-item' | 'horizontal-rule' | 'table';
```

Add `tableData` to `Block`:

```typescript
export interface Block {
  // ... existing fields
  tableData?: TableData;
}
```

Add `cellAddress` to `DocPosition`:

```typescript
export interface DocPosition {
  blockId: string;
  offset: number;
  cellAddress?: CellAddress;
}
```

Add factory functions:

```typescript
export function createTableCell(): TableCell {
  return {
    inlines: [{ text: '', style: {} }],
    style: { ...DEFAULT_CELL_STYLE },
  };
}

export function createTableBlock(rows: number, cols: number): Block {
  const columnWidths = Array(cols).fill(1 / cols);
  const tableRows: TableRow[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: TableCell[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(createTableCell());
    }
    tableRows.push({ cells });
  }
  return {
    id: generateBlockId(),
    type: 'table',
    inlines: [],
    style: { ...DEFAULT_BLOCK_STYLE },
    tableData: { rows: tableRows, columnWidths },
  };
}
```

- [ ] **Step 4: Export new types from index.ts**

Add to `packages/docs/src/index.ts`:

```typescript
export type {
  TableData,
  TableRow,
  TableCell,
  CellStyle,
  BorderStyle,
  CellAddress,
  CellRange,
} from './model/types.js';
export {
  DEFAULT_CELL_STYLE,
  DEFAULT_BORDER_STYLE,
  createTableBlock,
  createTableCell,
} from './model/types.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/model/types.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/src/index.ts packages/docs/test/model/types.test.ts
git commit -m "feat(docs): add table data model types and factories"
```

---

### Task 2: Doc Table Manipulation Methods

**Files:**
- Modify: `packages/docs/src/model/document.ts`
- Create: `packages/docs/test/model/table.test.ts`

- [ ] **Step 1: Write failing tests for table CRUD**

Create `packages/docs/test/model/table.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Doc } from '../../src/model/document.js';
import { getBlockText, createTableBlock } from '../../src/model/types.js';
import type { CellAddress, CellRange } from '../../src/model/types.js';

function getCellText(doc: Doc, blockId: string, cell: CellAddress): string {
  const block = doc.getBlock(blockId);
  return block.tableData!.rows[cell.rowIndex].cells[cell.colIndex]
    .inlines.map(i => i.text).join('');
}

describe('Doc table operations', () => {
  describe('insertTable', () => {
    it('should insert a 2x3 table at index 0', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 3);
      const block = doc.getBlock(tableId);
      expect(block.type).toBe('table');
      expect(block.tableData!.rows).toHaveLength(2);
      expect(block.tableData!.rows[0].cells).toHaveLength(3);
      expect(block.tableData!.columnWidths).toHaveLength(3);
    });
  });

  describe('insertTextInCell', () => {
    it('should insert text into a cell', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 0, 'Hello');
      expect(getCellText(doc, tableId, { rowIndex: 0, colIndex: 0 })).toBe('Hello');
    });

    it('should insert text in the middle of cell text', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 0, 'Helo');
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 2, 'l');
      expect(getCellText(doc, tableId, { rowIndex: 0, colIndex: 0 })).toBe('Hello');
    });
  });

  describe('deleteTextInCell', () => {
    it('should delete text from a cell', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 0, 'Hello World');
      doc.deleteTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 5, 6);
      expect(getCellText(doc, tableId, { rowIndex: 0, colIndex: 0 })).toBe('Hello');
    });
  });

  describe('insertRow', () => {
    it('should insert a row at the given index', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 3);
      doc.insertRow(tableId, 1);
      const block = doc.getBlock(tableId);
      expect(block.tableData!.rows).toHaveLength(3);
      expect(block.tableData!.rows[1].cells).toHaveLength(3);
    });
  });

  describe('deleteRow', () => {
    it('should delete a row at the given index', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 3, 2);
      doc.insertTextInCell(tableId, { rowIndex: 1, colIndex: 0 }, 0, 'Middle');
      doc.deleteRow(tableId, 1);
      const block = doc.getBlock(tableId);
      expect(block.tableData!.rows).toHaveLength(2);
      // The "Middle" text should be gone
      expect(getCellText(doc, tableId, { rowIndex: 1, colIndex: 0 })).toBe('');
    });
  });

  describe('insertColumn', () => {
    it('should insert a column and re-normalize widths', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.insertColumn(tableId, 1);
      const block = doc.getBlock(tableId);
      expect(block.tableData!.columnWidths).toHaveLength(3);
      expect(block.tableData!.rows[0].cells).toHaveLength(3);
      const sum = block.tableData!.columnWidths.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0);
    });
  });

  describe('deleteColumn', () => {
    it('should delete a column and re-normalize widths', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 3);
      doc.deleteColumn(tableId, 1);
      const block = doc.getBlock(tableId);
      expect(block.tableData!.columnWidths).toHaveLength(2);
      expect(block.tableData!.rows[0].cells).toHaveLength(2);
      const sum = block.tableData!.columnWidths.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0);
    });
  });

  describe('mergeCells', () => {
    it('should merge a 2x2 range', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 3, 3);
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 0, 'A');
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 1 }, 0, 'B');
      doc.insertTextInCell(tableId, { rowIndex: 1, colIndex: 0 }, 0, 'C');
      const range: CellRange = {
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 1, colIndex: 1 },
      };
      doc.mergeCells(tableId, range);
      const block = doc.getBlock(tableId);
      const topLeft = block.tableData!.rows[0].cells[0];
      expect(topLeft.colSpan).toBe(2);
      expect(topLeft.rowSpan).toBe(2);
      // Content concatenated
      const text = topLeft.inlines.map(i => i.text).join('');
      expect(text).toBe('ABC');
      // Covered cells marked with colSpan: 0
      expect(block.tableData!.rows[0].cells[1].colSpan).toBe(0);
      expect(block.tableData!.rows[1].cells[0].colSpan).toBe(0);
      expect(block.tableData!.rows[1].cells[1].colSpan).toBe(0);
    });
  });

  describe('splitCell', () => {
    it('should split a previously merged cell', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 3, 3);
      const range: CellRange = {
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 1, colIndex: 1 },
      };
      doc.mergeCells(tableId, range);
      doc.splitCell(tableId, { rowIndex: 0, colIndex: 0 });
      const block = doc.getBlock(tableId);
      const topLeft = block.tableData!.rows[0].cells[0];
      expect(topLeft.colSpan).toBeUndefined();
      expect(topLeft.rowSpan).toBeUndefined();
      // Covered cells restored
      expect(block.tableData!.rows[0].cells[1].colSpan).toBeUndefined();
      expect(block.tableData!.rows[0].cells[1].inlines[0].text).toBe('');
    });
  });

  describe('applyCellStyle', () => {
    it('should apply background color to a cell', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.applyCellStyle(tableId, { rowIndex: 0, colIndex: 0 }, {
        backgroundColor: '#FF0000',
      });
      const block = doc.getBlock(tableId);
      expect(block.tableData!.rows[0].cells[0].style.backgroundColor).toBe('#FF0000');
    });
  });

  describe('applyCellInlineStyle', () => {
    it('should apply bold to a range within a cell', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 2);
      doc.insertTextInCell(tableId, { rowIndex: 0, colIndex: 0 }, 0, 'Hello');
      doc.applyCellInlineStyle(tableId, { rowIndex: 0, colIndex: 0 }, 0, 3, { bold: true });
      const block = doc.getBlock(tableId);
      const cell = block.tableData!.rows[0].cells[0];
      expect(cell.inlines[0].style.bold).toBe(true);
      expect(cell.inlines[0].text).toBe('Hel');
      expect(cell.inlines[1].text).toBe('lo');
    });
  });

  describe('setColumnWidth', () => {
    it('should update a column width and renormalize', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 2, 3);
      doc.setColumnWidth(tableId, 0, 0.5);
      const block = doc.getBlock(tableId);
      expect(block.tableData!.columnWidths[0]).toBeCloseTo(0.5);
      const sum = block.tableData!.columnWidths.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/model/table.test.ts`
Expected: FAIL — `doc.insertTable` is not a function.

- [ ] **Step 3: Implement Doc table methods**

Add to `packages/docs/src/model/document.ts`:

```typescript
import {
  // ... existing imports, add:
  type CellAddress,
  type CellRange,
  type CellStyle,
  type InlineStyle,
  type TableCell,
  type TableRow,
  createTableBlock,
  createTableCell,
} from './types.js';

// Add these methods to the Doc class:

  /**
   * Insert a table block at the given index.
   * Returns the new block's ID.
   */
  insertTable(blockIndex: number, rows: number, cols: number): string {
    const block = createTableBlock(rows, cols);
    this.store.insertBlock(blockIndex, block);
    this.refresh();
    return block.id;
  }

  /**
   * Get a table cell. Throws if block is not a table or cell is out of range.
   */
  private getTableCell(blockId: string, cell: CellAddress): TableCell {
    const block = this.getBlock(blockId);
    if (!block.tableData) throw new Error(`Block ${blockId} is not a table`);
    const row = block.tableData.rows[cell.rowIndex];
    if (!row) throw new Error(`Row ${cell.rowIndex} out of range`);
    const tc = row.cells[cell.colIndex];
    if (!tc) throw new Error(`Col ${cell.colIndex} out of range`);
    return tc;
  }

  /**
   * Insert text into a table cell at the given offset.
   */
  insertTextInCell(blockId: string, cell: CellAddress, offset: number, text: string): void {
    const block = this.getBlock(blockId);
    const tc = this.getTableCell(blockId, cell);
    const { inlineIndex, charOffset } = this.resolveOffsetInInlines(tc.inlines, offset);
    const inline = tc.inlines[inlineIndex];
    inline.text = inline.text.slice(0, charOffset) + text + inline.text.slice(charOffset);
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Delete text from a table cell.
   */
  deleteTextInCell(blockId: string, cell: CellAddress, offset: number, length: number): void {
    const block = this.getBlock(blockId);
    const tc = this.getTableCell(blockId, cell);
    let remaining = length;
    let curOffset = offset;
    while (remaining > 0) {
      const { inlineIndex, charOffset } = this.resolveOffsetInInlines(tc.inlines, curOffset);
      const inline = tc.inlines[inlineIndex];
      const available = inline.text.length - charOffset;
      if (available <= 0) break;
      const toDelete = Math.min(remaining, available);
      inline.text = inline.text.slice(0, charOffset) + inline.text.slice(charOffset + toDelete);
      remaining -= toDelete;
      if (inline.text.length === 0 && tc.inlines.length > 1) {
        tc.inlines.splice(inlineIndex, 1);
      }
    }
    this.normalizeInlinesArray(tc.inlines);
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Apply inline style to a range within a table cell.
   */
  applyCellInlineStyle(
    blockId: string, cell: CellAddress,
    start: number, end: number, style: Partial<InlineStyle>,
  ): void {
    const block = this.getBlock(blockId);
    const tc = this.getTableCell(blockId, cell);
    tc.inlines = this.applyStyleToInlines(tc.inlines, start, end, style);
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Insert a row into a table.
   */
  insertRow(blockId: string, atIndex: number): void {
    const block = this.getBlock(blockId);
    if (!block.tableData) throw new Error(`Block ${blockId} is not a table`);
    const colCount = block.tableData.columnWidths.length;
    const cells: TableCell[] = [];
    for (let c = 0; c < colCount; c++) {
      cells.push(createTableCell());
    }
    block.tableData.rows.splice(atIndex, 0, { cells });
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Delete a row from a table.
   */
  deleteRow(blockId: string, rowIndex: number): void {
    const block = this.getBlock(blockId);
    if (!block.tableData) throw new Error(`Block ${blockId} is not a table`);
    block.tableData.rows.splice(rowIndex, 1);
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Insert a column into a table and renormalize widths.
   */
  insertColumn(blockId: string, atIndex: number): void {
    const block = this.getBlock(blockId);
    if (!block.tableData) throw new Error(`Block ${blockId} is not a table`);
    const newWidth = 1 / (block.tableData.columnWidths.length + 1);
    // Scale existing widths down
    const scale = 1 - newWidth;
    block.tableData.columnWidths = block.tableData.columnWidths.map(w => w * scale);
    block.tableData.columnWidths.splice(atIndex, 0, newWidth);
    for (const row of block.tableData.rows) {
      row.cells.splice(atIndex, 0, createTableCell());
    }
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Delete a column from a table and renormalize widths.
   */
  deleteColumn(blockId: string, colIndex: number): void {
    const block = this.getBlock(blockId);
    if (!block.tableData) throw new Error(`Block ${blockId} is not a table`);
    const removed = block.tableData.columnWidths.splice(colIndex, 1)[0];
    // Distribute removed width proportionally
    if (block.tableData.columnWidths.length > 0) {
      const scale = 1 / (1 - removed);
      block.tableData.columnWidths = block.tableData.columnWidths.map(w => w * scale);
    }
    for (const row of block.tableData.rows) {
      row.cells.splice(colIndex, 1);
    }
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Merge cells in the given range.
   */
  mergeCells(blockId: string, range: CellRange): void {
    const block = this.getBlock(blockId);
    if (!block.tableData) throw new Error(`Block ${blockId} is not a table`);
    const { start, end } = range;
    const minR = Math.min(start.rowIndex, end.rowIndex);
    const maxR = Math.max(start.rowIndex, end.rowIndex);
    const minC = Math.min(start.colIndex, end.colIndex);
    const maxC = Math.max(start.colIndex, end.colIndex);
    const topLeft = block.tableData.rows[minR].cells[minC];
    // Collect text from all cells in range
    const texts: string[] = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const cell = block.tableData.rows[r].cells[c];
        const text = cell.inlines.map(i => i.text).join('');
        if (text) texts.push(text);
        if (r === minR && c === minC) continue;
        // Mark as covered
        cell.colSpan = 0;
        cell.inlines = [];
      }
    }
    topLeft.colSpan = maxC - minC + 1;
    topLeft.rowSpan = maxR - minR + 1;
    if (texts.length > 0) {
      topLeft.inlines = [{ text: texts.join(''), style: {} }];
    }
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Split a previously merged cell.
   */
  splitCell(blockId: string, cell: CellAddress): void {
    const block = this.getBlock(blockId);
    if (!block.tableData) throw new Error(`Block ${blockId} is not a table`);
    const tc = block.tableData.rows[cell.rowIndex].cells[cell.colIndex];
    const colSpan = tc.colSpan ?? 1;
    const rowSpan = tc.rowSpan ?? 1;
    if (colSpan <= 1 && rowSpan <= 1) return;
    // Reset top-left
    delete tc.colSpan;
    delete tc.rowSpan;
    // Restore covered cells
    for (let r = cell.rowIndex; r < cell.rowIndex + rowSpan; r++) {
      for (let c = cell.colIndex; c < cell.colIndex + colSpan; c++) {
        if (r === cell.rowIndex && c === cell.colIndex) continue;
        const covered = block.tableData.rows[r].cells[c];
        delete covered.colSpan;
        covered.inlines = [{ text: '', style: {} }];
      }
    }
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Apply cell-level style.
   */
  applyCellStyle(blockId: string, cell: CellAddress, style: Partial<CellStyle>): void {
    const block = this.getBlock(blockId);
    const tc = this.getTableCell(blockId, cell);
    tc.style = { ...tc.style, ...style };
    this.store.updateBlock(blockId, block);
    this.refresh();
  }

  /**
   * Set a column width and renormalize remaining columns.
   */
  setColumnWidth(blockId: string, colIndex: number, ratio: number): void {
    const block = this.getBlock(blockId);
    if (!block.tableData) throw new Error(`Block ${blockId} is not a table`);
    const widths = block.tableData.columnWidths;
    const oldWidth = widths[colIndex];
    const remaining = 1 - ratio;
    const othersTotal = 1 - oldWidth;
    if (othersTotal > 0) {
      const scale = remaining / othersTotal;
      for (let i = 0; i < widths.length; i++) {
        widths[i] = i === colIndex ? ratio : widths[i] * scale;
      }
    }
    this.store.updateBlock(blockId, block);
    this.refresh();
  }
```

Also extract two private helpers (refactored from existing private methods):

```typescript
  /**
   * Resolve an offset to inline index + char offset in an arbitrary inlines array.
   */
  private resolveOffsetInInlines(
    inlines: Inline[], offset: number,
  ): { inlineIndex: number; charOffset: number } {
    let remaining = offset;
    for (let i = 0; i < inlines.length; i++) {
      if (remaining <= inlines[i].text.length) {
        return { inlineIndex: i, charOffset: remaining };
      }
      remaining -= inlines[i].text.length;
    }
    const last = inlines.length - 1;
    return { inlineIndex: last, charOffset: inlines[last].text.length };
  }

  /**
   * Apply style to a range within an inlines array. Returns the new array.
   */
  private applyStyleToInlines(
    inlines: Inline[], start: number, end: number, style: Partial<InlineStyle>,
  ): Inline[] {
    const newInlines: Inline[] = [];
    let pos = 0;
    for (const inline of inlines) {
      const inlineEnd = pos + inline.text.length;
      if (inlineEnd <= start || pos >= end) {
        newInlines.push({ text: inline.text, style: { ...inline.style } });
      } else {
        const overlapStart = Math.max(0, start - pos);
        const overlapEnd = Math.min(inline.text.length, end - pos);
        if (overlapStart > 0) {
          newInlines.push({ text: inline.text.slice(0, overlapStart), style: { ...inline.style } });
        }
        newInlines.push({
          text: inline.text.slice(overlapStart, overlapEnd),
          style: { ...inline.style, ...style },
        });
        if (overlapEnd < inline.text.length) {
          newInlines.push({ text: inline.text.slice(overlapEnd), style: { ...inline.style } });
        }
      }
      pos = inlineEnd;
    }
    this.normalizeInlinesArray(newInlines);
    return newInlines.length > 0 ? newInlines : [{ text: '', style: {} }];
  }

  /**
   * Merge adjacent inlines with identical styles (operates on any array).
   */
  private normalizeInlinesArray(inlines: Inline[]): void {
    let i = 0;
    while (i < inlines.length) {
      if (inlines[i].text.length === 0 && inlines.length > 1) {
        inlines.splice(i, 1);
        continue;
      }
      if (i > 0 && inlineStylesEqual(inlines[i - 1].style, inlines[i].style)) {
        inlines[i - 1].text += inlines[i].text;
        inlines.splice(i, 1);
        continue;
      }
      i++;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/model/table.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/test/model/table.test.ts
git commit -m "feat(docs): add Doc table manipulation methods"
```

---

### Task 3: Table Layout Computation

**Files:**
- Create: `packages/docs/src/view/table-layout.ts`
- Modify: `packages/docs/src/view/layout.ts`
- Create: `packages/docs/test/view/table-layout.test.ts`

- [ ] **Step 1: Write failing tests for table layout**

Create `packages/docs/test/view/table-layout.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeTableLayout, type LayoutTable } from '../../src/view/table-layout.js';
import { createTableBlock } from '../../src/model/types.js';
import type { TableData } from '../../src/model/types.js';

// Stub canvas context for measureText
function stubCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as CanvasRenderingContext2D;
}

describe('computeTableLayout', () => {
  it('should compute column pixel widths from ratios', () => {
    const block = createTableBlock(2, 3);
    const result = computeTableLayout(block.tableData!, stubCtx(), 300);
    expect(result.columnPixelWidths).toHaveLength(3);
    expect(result.columnPixelWidths[0]).toBeCloseTo(100);
    expect(result.columnPixelWidths[1]).toBeCloseTo(100);
    expect(result.columnPixelWidths[2]).toBeCloseTo(100);
  });

  it('should compute row heights based on cell content', () => {
    const block = createTableBlock(2, 2);
    block.tableData!.rows[0].cells[0].inlines = [{ text: 'Hello', style: {} }];
    const result = computeTableLayout(block.tableData!, stubCtx(), 200);
    // Row heights should be > 0 (based on default font height)
    expect(result.rowHeights[0]).toBeGreaterThan(0);
    expect(result.rowHeights[1]).toBeGreaterThan(0);
  });

  it('should mark merged cells', () => {
    const block = createTableBlock(2, 2);
    const td = block.tableData!;
    td.rows[0].cells[0].colSpan = 2;
    td.rows[0].cells[0].rowSpan = 1;
    td.rows[0].cells[1].colSpan = 0;
    td.rows[0].cells[1].inlines = [];
    const result = computeTableLayout(td, stubCtx(), 200);
    expect(result.cells[0][0].merged).toBe(false);
    expect(result.cells[0][1].merged).toBe(true);
  });

  it('should compute cumulative X and Y offsets', () => {
    const block = createTableBlock(2, 2);
    block.tableData!.columnWidths = [0.4, 0.6];
    const result = computeTableLayout(block.tableData!, stubCtx(), 100);
    expect(result.columnXOffsets[0]).toBe(0);
    expect(result.columnXOffsets[1]).toBeCloseTo(40);
    expect(result.rowYOffsets[0]).toBe(0);
    expect(result.rowYOffsets[1]).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && npx vitest run test/view/table-layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement table-layout.ts**

Create `packages/docs/src/view/table-layout.ts`:

```typescript
import type { TableData, Inline } from '../model/types.js';
import type { LayoutLine } from './layout.js';
import { resolveBlockInlines, cachedMeasureText } from './layout.js';
import { buildFont, ptToPx, Theme } from './theme.js';

export interface LayoutTableCell {
  lines: LayoutLine[];
  width: number;
  height: number;
  merged: boolean;
}

export interface LayoutTable {
  cells: LayoutTableCell[][];
  columnXOffsets: number[];
  columnPixelWidths: number[];
  rowYOffsets: number[];
  rowHeights: number[];
  totalWidth: number;
  totalHeight: number;
}

const DEFAULT_CELL_PADDING = 4;
const MIN_ROW_HEIGHT = 20;

/**
 * Compute full table layout from TableData.
 */
export function computeTableLayout(
  tableData: TableData,
  ctx: CanvasRenderingContext2D,
  contentWidth: number,
): LayoutTable {
  const { rows, columnWidths } = tableData;
  const colCount = columnWidths.length;
  const rowCount = rows.length;

  // 1. Compute column pixel widths
  const columnPixelWidths = columnWidths.map(r => r * contentWidth);

  // 2. Compute column X offsets
  const columnXOffsets: number[] = [0];
  for (let c = 1; c < colCount; c++) {
    columnXOffsets.push(columnXOffsets[c - 1] + columnPixelWidths[c - 1]);
  }

  // 3. Layout each cell
  const cells: LayoutTableCell[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const row: LayoutTableCell[] = [];
    for (let c = 0; c < colCount; c++) {
      const cell = rows[r].cells[c];
      if (cell.colSpan === 0) {
        row.push({ lines: [], width: 0, height: 0, merged: true });
        continue;
      }
      const span = cell.colSpan ?? 1;
      let cellWidth = 0;
      for (let s = 0; s < span && c + s < colCount; s++) {
        cellWidth += columnPixelWidths[c + s];
      }
      const padding = cell.style.padding ?? DEFAULT_CELL_PADDING;
      const availableWidth = Math.max(cellWidth - padding * 2, 1);
      const lines = layoutCellInlines(cell.inlines, ctx, availableWidth);
      const textHeight = lines.reduce((sum, l) => sum + l.height, 0);
      row.push({
        lines,
        width: cellWidth,
        height: textHeight + padding * 2,
        merged: false,
      });
    }
    cells.push(row);
  }

  // 4. Compute row heights (max cell height per row, respecting rowSpan)
  const rowHeights = new Array(rowCount).fill(0);

  // First pass: cells without rowSpan
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const cell = rows[r].cells[c];
      if (cell.colSpan === 0) continue;
      const rSpan = cell.rowSpan ?? 1;
      if (rSpan === 1) {
        rowHeights[r] = Math.max(rowHeights[r], cells[r][c].height);
      }
    }
  }

  // Ensure minimum height
  for (let r = 0; r < rowCount; r++) {
    rowHeights[r] = Math.max(rowHeights[r], MIN_ROW_HEIGHT);
  }

  // Second pass: distribute rowSpan cell heights
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const cell = rows[r].cells[c];
      if (cell.colSpan === 0) continue;
      const rSpan = cell.rowSpan ?? 1;
      if (rSpan <= 1) continue;
      const cellHeight = cells[r][c].height;
      let spannedHeight = 0;
      for (let s = 0; s < rSpan && r + s < rowCount; s++) {
        spannedHeight += rowHeights[r + s];
      }
      if (cellHeight > spannedHeight) {
        // Distribute extra height to last spanned row
        const extra = cellHeight - spannedHeight;
        const lastRow = Math.min(r + rSpan - 1, rowCount - 1);
        rowHeights[lastRow] += extra;
      }
    }
  }

  // 5. Row Y offsets
  const rowYOffsets: number[] = [0];
  for (let r = 1; r < rowCount; r++) {
    rowYOffsets.push(rowYOffsets[r - 1] + rowHeights[r - 1]);
  }

  const totalHeight = rowYOffsets.length > 0
    ? rowYOffsets[rowCount - 1] + rowHeights[rowCount - 1]
    : 0;

  return {
    cells,
    columnXOffsets,
    columnPixelWidths,
    rowYOffsets,
    rowHeights,
    totalWidth: contentWidth,
    totalHeight,
  };
}

/**
 * Layout cell inlines into wrapped lines (simplified version of layoutBlock).
 */
function layoutCellInlines(
  inlines: Inline[],
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): LayoutLine[] {
  if (inlines.length === 0 || (inlines.length === 1 && inlines[0].text === '')) {
    const defaultFontSize = ptToPx(Theme.defaultFontSize);
    return [{ runs: [], y: 0, height: defaultFontSize * 1.5, width: 0 }];
  }

  const lines: LayoutLine[] = [];
  let currentRuns: LayoutLine['runs'] = [];
  let lineWidth = 0;

  for (let i = 0; i < inlines.length; i++) {
    const inline = inlines[i];
    const font = buildFont(
      inline.style.fontSize,
      inline.style.fontFamily,
      inline.style.bold,
      inline.style.italic,
    );
    const words = splitWords(inline.text);
    let charPos = 0;

    for (const word of words) {
      const wordWidth = cachedMeasureText(ctx, word, font);
      if (lineWidth + wordWidth > maxWidth && currentRuns.length > 0) {
        lines.push(finishLine(currentRuns, lineWidth));
        currentRuns = [];
        lineWidth = 0;
      }
      currentRuns.push({
        inline,
        text: word,
        x: lineWidth,
        width: wordWidth,
        inlineIndex: i,
        charStart: charPos,
        charEnd: charPos + word.length,
      });
      lineWidth += wordWidth;
      charPos += word.length;
    }
  }

  if (currentRuns.length > 0) {
    lines.push(finishLine(currentRuns, lineWidth));
  }

  // Set Y offsets
  let y = 0;
  for (const line of lines) {
    line.y = y;
    y += line.height;
  }

  return lines;
}

function finishLine(runs: LayoutLine['runs'], width: number): LayoutLine {
  let maxFontSize = 0;
  for (const run of runs) {
    const size = ptToPx(run.inline.style.fontSize ?? Theme.defaultFontSize);
    if (size > maxFontSize) maxFontSize = size;
  }
  if (maxFontSize === 0) maxFontSize = ptToPx(Theme.defaultFontSize);
  return { runs, y: 0, height: maxFontSize * 1.5, width };
}

function splitWords(text: string): string[] {
  if (text.length === 0) return [];
  const words: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    current += text[i];
    if (text[i] === ' ' && i + 1 < text.length && text[i + 1] !== ' ') {
      words.push(current);
      current = '';
    }
  }
  if (current.length > 0) words.push(current);
  return words;
}
```

- [ ] **Step 4: Integrate into layout.ts computeLayout()**

In `packages/docs/src/view/layout.ts`, add a branch for table blocks inside the `computeLayout()` function's block loop:

```typescript
import { computeTableLayout, type LayoutTable } from './table-layout.js';

// Add layoutTable field to LayoutBlock interface:
export interface LayoutBlock {
  block: Block;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: LayoutLine[];
  layoutTable?: LayoutTable;
}
```

Inside the `for (const block of blocks)` loop in `computeLayout()`, add before the existing `if (block.type === 'horizontal-rule')`:

```typescript
    if (block.type === 'table' && block.tableData) {
      const tableLayout = computeTableLayout(block.tableData, ctx, availableWidth);
      lines = [{ runs: [], y: 0, height: tableLayout.totalHeight, width: availableWidth }];
      const lb: LayoutBlock = {
        block,
        x: 0,
        y,
        width: availableWidth,
        height: tableLayout.totalHeight,
        lines,
        layoutTable: tableLayout,
      };
      layoutBlocks.push(lb);
      newCacheBlocks.set(block.id, lb);
      y += tableLayout.totalHeight + block.style.marginBottom;
      continue;
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/view/table-layout.test.ts`
Expected: PASS

Run: `cd packages/docs && npx vitest run`
Expected: All existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/table-layout.ts packages/docs/src/view/layout.ts packages/docs/test/view/table-layout.test.ts
git commit -m "feat(docs): add table layout computation"
```

---

### Task 4: Table Canvas Rendering

**Files:**
- Create: `packages/docs/src/view/table-renderer.ts`
- Modify: `packages/docs/src/view/doc-canvas.ts`

- [ ] **Step 1: Create table-renderer.ts**

Create `packages/docs/src/view/table-renderer.ts`:

```typescript
import type { LayoutTable } from './table-layout.js';
import type { TableData } from '../model/types.js';
import { DEFAULT_BORDER_STYLE } from '../model/types.js';
import type { BorderStyle } from '../model/types.js';
import { Theme, buildFont, ptToPx } from './theme.js';

/**
 * Render a table block on the canvas.
 *
 * @param ctx - Canvas 2D context
 * @param tableData - The table's data model
 * @param tableLayout - Pre-computed layout
 * @param tableX - X origin (page left margin)
 * @param tableY - Y origin (block Y position)
 */
export function renderTable(
  ctx: CanvasRenderingContext2D,
  tableData: TableData,
  tableLayout: LayoutTable,
  tableX: number,
  tableY: number,
): void {
  const { rows } = tableData;
  const {
    cells: layoutCells,
    columnXOffsets,
    columnPixelWidths,
    rowYOffsets,
    rowHeights,
  } = tableLayout;

  // 1. Draw cell backgrounds
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].cells.length; c++) {
      const cell = rows[r].cells[c];
      if (cell.colSpan === 0) continue;
      const bg = cell.style.backgroundColor;
      if (!bg) continue;
      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;
      let w = 0;
      for (let s = 0; s < colSpan; s++) w += columnPixelWidths[c + s] ?? 0;
      let h = 0;
      for (let s = 0; s < rowSpan; s++) h += rowHeights[r + s] ?? 0;
      ctx.fillStyle = bg;
      ctx.fillRect(
        tableX + columnXOffsets[c],
        tableY + rowYOffsets[r],
        w, h,
      );
    }
  }

  // 2. Draw cell text
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].cells.length; c++) {
      const cell = rows[r].cells[c];
      if (cell.colSpan === 0) continue;
      const lc = layoutCells[r][c];
      if (lc.merged) continue;
      const padding = cell.style.padding ?? 4;
      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;
      let cellHeight = 0;
      for (let s = 0; s < rowSpan; s++) cellHeight += rowHeights[r + s] ?? 0;
      const textHeight = lc.lines.reduce((sum, l) => sum + l.height, 0);

      // Vertical alignment offset
      let vOffset = padding;
      const vAlign = cell.style.verticalAlign ?? 'top';
      if (vAlign === 'middle') {
        vOffset = (cellHeight - textHeight) / 2;
      } else if (vAlign === 'bottom') {
        vOffset = cellHeight - textHeight - padding;
      }

      const cellX = tableX + columnXOffsets[c] + padding;
      const cellY = tableY + rowYOffsets[r] + vOffset;

      for (const line of lc.lines) {
        for (const run of line.runs) {
          const style = run.inline.style;
          const fontSize = style.fontSize ?? Theme.defaultFontSize;
          ctx.font = buildFont(fontSize, style.fontFamily, style.bold, style.italic);
          ctx.fillStyle = style.color ?? Theme.textColor;
          const baseline = cellY + line.y + line.height * 0.75;
          ctx.fillText(run.text, cellX + run.x, baseline);

          // Underline
          if (style.underline) {
            const underY = baseline + 2;
            ctx.beginPath();
            ctx.moveTo(cellX + run.x, underY);
            ctx.lineTo(cellX + run.x + run.width, underY);
            ctx.strokeStyle = style.color ?? Theme.textColor;
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          // Strikethrough
          if (style.strikethrough) {
            const strikeY = baseline - line.height * 0.25;
            ctx.beginPath();
            ctx.moveTo(cellX + run.x, strikeY);
            ctx.lineTo(cellX + run.x + run.width, strikeY);
            ctx.strokeStyle = style.color ?? Theme.textColor;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
    }
  }

  // 3. Draw borders
  ctx.lineWidth = 1;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].cells.length; c++) {
      const cell = rows[r].cells[c];
      if (cell.colSpan === 0) continue;
      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;
      let w = 0;
      for (let s = 0; s < colSpan; s++) w += columnPixelWidths[c + s] ?? 0;
      let h = 0;
      for (let s = 0; s < rowSpan; s++) h += rowHeights[r + s] ?? 0;
      const x = tableX + columnXOffsets[c];
      const y = tableY + rowYOffsets[r];

      const drawBorder = (border: BorderStyle | undefined, x1: number, y1: number, x2: number, y2: number) => {
        const b = border ?? DEFAULT_BORDER_STYLE;
        if (b.style === 'none') return;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width;
        ctx.stroke();
      };

      drawBorder(cell.style.borderTop, x, y, x + w, y);
      drawBorder(cell.style.borderBottom, x, y + h, x + w, y + h);
      drawBorder(cell.style.borderLeft, x, y, x, y + h);
      drawBorder(cell.style.borderRight, x + w, y, x + w, y + h);
    }
  }
}
```

- [ ] **Step 2: Integrate into doc-canvas.ts**

In `packages/docs/src/view/doc-canvas.ts`, in the block rendering loop (where it iterates over page lines and draws text runs), add a branch that detects table blocks and calls `renderTable()`. The table block appears as a single line in the paginated layout. When rendering a line whose block is a table:

```typescript
import { renderTable } from './table-renderer.js';

// Inside the page rendering loop, after checking if block is table:
// (Add check when iterating lines — if the block has layoutTable, render it)
```

In the section where blocks are rendered per page, add before the regular text rendering:

```typescript
if (lb.block.type === 'table' && lb.layoutTable && lb.block.tableData) {
  renderTable(
    this.ctx,
    lb.block.tableData,
    lb.layoutTable,
    pageX + margins.left,
    pageY + pageLine.y,
  );
  continue; // Skip regular text rendering for this block
}
```

- [ ] **Step 3: Run all tests to verify nothing broke**

Run: `cd packages/docs && npx vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/view/table-renderer.ts packages/docs/src/view/doc-canvas.ts
git commit -m "feat(docs): add table Canvas rendering"
```

---

### Task 5: Table Pagination

**Files:**
- Modify: `packages/docs/src/view/pagination.ts`
- Modify: `packages/docs/test/view/pagination.test.ts`

- [ ] **Step 1: Write failing test for table pagination**

Add to `packages/docs/test/view/pagination.test.ts`:

```typescript
describe('table pagination', () => {
  it('should split a table at row boundaries', () => {
    // Create a layout with a table block that has multiple rows
    // where total height exceeds one page
    const tableLayout: LayoutBlock = {
      block: {
        id: 'table-1',
        type: 'table',
        inlines: [],
        style: { ...DEFAULT_BLOCK_STYLE, marginTop: 0, marginBottom: 0 },
        tableData: {
          rows: [
            { cells: [{ inlines: [{ text: 'Row 1', style: {} }], style: {} }] },
            { cells: [{ inlines: [{ text: 'Row 2', style: {} }], style: {} }] },
            { cells: [{ inlines: [{ text: 'Row 3', style: {} }], style: {} }] },
          ],
          columnWidths: [1.0],
        },
      },
      x: 0,
      y: 0,
      width: 600,
      height: 300,
      lines: [
        { runs: [], y: 0, height: 100, width: 600 },   // row 0
        { runs: [], y: 100, height: 100, width: 600 },  // row 1
        { runs: [], y: 200, height: 100, width: 600 },  // row 2
      ],
      layoutTable: {
        cells: [[{ lines: [], width: 600, height: 100, merged: false }],
                [{ lines: [], width: 600, height: 100, merged: false }],
                [{ lines: [], width: 600, height: 100, merged: false }]],
        columnXOffsets: [0],
        columnPixelWidths: [600],
        rowYOffsets: [0, 100, 200],
        rowHeights: [100, 100, 100],
        totalWidth: 600,
        totalHeight: 300,
      },
    };
    // Page height = 250 (content area), so rows 0+1 (200px) fit, row 2 goes to page 2
    const layout: DocumentLayout = { blocks: [tableLayout], totalHeight: 300 };
    const pageSetup = {
      paperSize: { name: 'Test', width: 700, height: 300 },
      orientation: 'portrait' as const,
      margins: { top: 25, bottom: 25, left: 50, right: 50 },
    };
    const result = paginateLayout(layout, pageSetup);
    expect(result.pages.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes if already compatible)**

Run: `cd packages/docs && npx vitest run test/view/pagination.test.ts`

- [ ] **Step 3: Update pagination to expand table blocks into per-row lines**

In `packages/docs/src/view/pagination.ts`, modify the block iteration to handle table blocks specially. When a table block is encountered, expand it into one "line" per row (using `layoutTable.rowHeights`) so pagination can split at row boundaries:

```typescript
// Inside paginateLayout, replace the inner for-loop over lb.lines:
if (lb.block.type === 'table' && lb.layoutTable) {
  // Expand table into per-row pseudo-lines for pagination
  const tl = lb.layoutTable;
  for (let ri = 0; ri < tl.rowHeights.length; ri++) {
    const rowHeight = tl.rowHeights[ri];
    if (currentY + rowHeight > contentHeight && !isPageTop) {
      startNewPage();
    }
    currentLines.push({
      blockIndex: bi,
      lineIndex: ri,
      line: lb.lines[0] ?? { runs: [], y: tl.rowYOffsets[ri], height: rowHeight, width: availableWidth },
      x: margins.left,
      y: margins.top + currentY,
    });
    currentY += rowHeight;
    isPageTop = false;
  }
} else {
  // ... existing line-by-line pagination
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/docs && npx vitest run test/view/pagination.test.ts`
Expected: PASS

Run: `cd packages/docs && npx vitest run`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/pagination.ts packages/docs/test/view/pagination.test.ts
git commit -m "feat(docs): add row-level table pagination"
```

---

### Task 6: Table Cursor Navigation (TextEditor)

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`
- Modify: `packages/docs/src/view/editor.ts`

This task wires keyboard/mouse interaction for tables. Due to the complexity of `TextEditor`, changes are described as behavioral patches rather than full code listings.

- [ ] **Step 1: Add table-aware click handling**

In `TextEditor`'s mouse click handler (`handleMouseDown` or equivalent), after resolving a `DocPosition` via `paginatedPixelToPosition()`:

- Check if the resolved position's block is a table block
- If so, determine which cell was clicked using the table layout's `columnXOffsets`, `rowYOffsets`, `columnPixelWidths`, `rowHeights`
- Set `cursor.position` with `cellAddress` set to the clicked cell
- The click coordinate within the cell determines the text offset within that cell's inlines

Add a helper method to TextEditor:

```typescript
/**
 * Resolve a click inside a table block to a CellAddress.
 */
private resolveTableCellClick(
  block: Block,
  layout: DocumentLayout,
  localX: number,
  localY: number,
): CellAddress | undefined {
  if (block.type !== 'table' || !block.tableData) return undefined;
  const lb = layout.blocks.find(b => b.block.id === block.id);
  if (!lb?.layoutTable) return undefined;
  const tl = lb.layoutTable;
  // Find row
  let rowIndex = tl.rowHeights.length - 1;
  for (let r = 0; r < tl.rowYOffsets.length; r++) {
    if (localY < tl.rowYOffsets[r] + tl.rowHeights[r]) {
      rowIndex = r;
      break;
    }
  }
  // Find column
  let colIndex = tl.columnPixelWidths.length - 1;
  for (let c = 0; c < tl.columnXOffsets.length; c++) {
    if (localX < tl.columnXOffsets[c] + tl.columnPixelWidths[c]) {
      colIndex = c;
      break;
    }
  }
  // Skip merged cells — find the owning cell
  const cell = block.tableData.rows[rowIndex]?.cells[colIndex];
  if (cell?.colSpan === 0) {
    // Walk backward to find the merge owner
    for (let r = rowIndex; r >= 0; r--) {
      for (let c = colIndex; c >= 0; c--) {
        const candidate = block.tableData.rows[r].cells[c];
        if (candidate.colSpan !== 0) {
          const cs = candidate.colSpan ?? 1;
          const rs = candidate.rowSpan ?? 1;
          if (r + rs > rowIndex && c + cs > colIndex) {
            return { rowIndex: r, colIndex: c };
          }
        }
      }
    }
  }
  return { rowIndex, colIndex };
}
```

- [ ] **Step 2: Add Tab/Shift+Tab cell navigation**

In the keyboard handler, when cursor is inside a table (cursor.position.cellAddress is set):

```typescript
// Tab: move to next cell
if (key === 'Tab' && !e.shiftKey && cursor.position.cellAddress) {
  e.preventDefault();
  const block = doc.getBlock(cursor.position.blockId);
  const td = block.tableData!;
  let { rowIndex, colIndex } = cursor.position.cellAddress;
  colIndex++;
  if (colIndex >= td.columnWidths.length) {
    colIndex = 0;
    rowIndex++;
    if (rowIndex >= td.rows.length) {
      // Add new row at end
      this.saveSnapshot();
      doc.insertRow(block.id, td.rows.length);
      this.invalidateLayout();
    }
  }
  // Skip merged cells
  while (td.rows[rowIndex]?.cells[colIndex]?.colSpan === 0) {
    colIndex++;
    if (colIndex >= td.columnWidths.length) {
      colIndex = 0;
      rowIndex++;
    }
  }
  cursor.moveTo({
    blockId: block.id,
    offset: 0,
    cellAddress: { rowIndex, colIndex },
  });
  this.requestRender();
  return;
}

// Shift+Tab: move to previous cell
if (key === 'Tab' && e.shiftKey && cursor.position.cellAddress) {
  e.preventDefault();
  const block = doc.getBlock(cursor.position.blockId);
  const td = block.tableData!;
  let { rowIndex, colIndex } = cursor.position.cellAddress;
  colIndex--;
  if (colIndex < 0) {
    colIndex = td.columnWidths.length - 1;
    rowIndex--;
    if (rowIndex < 0) return; // At very start of table
  }
  while (td.rows[rowIndex]?.cells[colIndex]?.colSpan === 0) {
    colIndex--;
    if (colIndex < 0) {
      colIndex = td.columnWidths.length - 1;
      rowIndex--;
      if (rowIndex < 0) return;
    }
  }
  cursor.moveTo({
    blockId: block.id,
    offset: 0,
    cellAddress: { rowIndex, colIndex },
  });
  this.requestRender();
  return;
}
```

- [ ] **Step 3: Add Enter key (move to cell below) and text input routing**

When cursor is in a table cell:
- **Enter**: Move to cell below (same column), or no-op if at last row
- **Text input** (`handleInput`): Route to `doc.insertTextInCell()` instead of `doc.insertText()`
- **Backspace**: Route to `doc.deleteTextInCell()`, no-op at cell start (don't merge blocks)

- [ ] **Step 4: Wire table cursor rendering in editor.ts**

In `editor.ts`, update `getSelectionStyle()` to handle table cells — when `cursor.position.cellAddress` is set, read the inline style from the cell's inlines instead of the block's inlines.

- [ ] **Step 5: Manual testing**

Run: `pnpm dev` and test:
- Click inside a table cell → cursor appears in cell
- Type text → text appears in cell
- Tab → moves to next cell
- Shift+Tab → moves to previous cell
- Enter → moves to cell below

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/text-editor.ts packages/docs/src/view/editor.ts
git commit -m "feat(docs): add table cursor navigation and cell editing"
```

---

### Task 7: EditorAPI Table Methods & Exports

**Files:**
- Modify: `packages/docs/src/view/editor.ts`
- Modify: `packages/docs/src/index.ts`

- [ ] **Step 1: Add table methods to EditorAPI interface**

```typescript
// Add to EditorAPI interface in editor.ts:
/** Insert a table at the current cursor position */
insertTable(rows: number, cols: number): void;
/** Insert a row above or below current cell */
insertTableRow(above: boolean): void;
/** Delete the current row */
deleteTableRow(): void;
/** Insert a column left or right of current cell */
insertTableColumn(left: boolean): void;
/** Delete the current column */
deleteTableColumn(): void;
/** Merge selected cells */
mergeTableCells(range: CellRange): void;
/** Split the current cell */
splitTableCell(): void;
/** Apply style to current cell */
applyTableCellStyle(style: Partial<CellStyle>): void;
/** Check if cursor is inside a table */
isInTable(): boolean;
/** Get the current cell address (if in table) */
getCellAddress(): CellAddress | undefined;
```

- [ ] **Step 2: Implement the methods in the return object**

```typescript
insertTable: (rows: number, cols: number) => {
  docStore.snapshot();
  const blockIndex = doc.getBlockIndex(cursor.position.blockId);
  const tableId = doc.insertTable(blockIndex + 1, rows, cols);
  cursor.moveTo({ blockId: tableId, offset: 0, cellAddress: { rowIndex: 0, colIndex: 0 } });
  invalidateLayout();
  render();
},
isInTable: () => cursor.position.cellAddress != null,
getCellAddress: () => cursor.position.cellAddress,
insertTableRow: (above: boolean) => {
  const ca = cursor.position.cellAddress;
  if (!ca) return;
  docStore.snapshot();
  const idx = above ? ca.rowIndex : ca.rowIndex + 1;
  doc.insertRow(cursor.position.blockId, idx);
  invalidateLayout();
  render();
},
deleteTableRow: () => {
  const ca = cursor.position.cellAddress;
  if (!ca) return;
  docStore.snapshot();
  doc.deleteRow(cursor.position.blockId, ca.rowIndex);
  invalidateLayout();
  render();
},
insertTableColumn: (left: boolean) => {
  const ca = cursor.position.cellAddress;
  if (!ca) return;
  docStore.snapshot();
  const idx = left ? ca.colIndex : ca.colIndex + 1;
  doc.insertColumn(cursor.position.blockId, idx);
  invalidateLayout();
  render();
},
deleteTableColumn: () => {
  const ca = cursor.position.cellAddress;
  if (!ca) return;
  docStore.snapshot();
  doc.deleteColumn(cursor.position.blockId, ca.colIndex);
  invalidateLayout();
  render();
},
mergeTableCells: (range: CellRange) => {
  docStore.snapshot();
  doc.mergeCells(cursor.position.blockId, range);
  invalidateLayout();
  render();
},
splitTableCell: () => {
  const ca = cursor.position.cellAddress;
  if (!ca) return;
  docStore.snapshot();
  doc.splitCell(cursor.position.blockId, ca);
  invalidateLayout();
  render();
},
applyTableCellStyle: (style: Partial<CellStyle>) => {
  const ca = cursor.position.cellAddress;
  if (!ca) return;
  docStore.snapshot();
  doc.applyCellStyle(cursor.position.blockId, ca, style);
  markDirty(cursor.position.blockId);
  render();
},
```

- [ ] **Step 3: Export LayoutTable type from index.ts**

```typescript
export type { LayoutTable, LayoutTableCell } from './view/table-layout.js';
```

- [ ] **Step 4: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS (lint + unit tests)

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/editor.ts packages/docs/src/index.ts
git commit -m "feat(docs): expose table operations in EditorAPI"
```

---

### Task 8: Integration Verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 2: Manual smoke test**

Run: `pnpm dev`, open the docs editor, and verify:
1. Create a document, programmatically insert a table (via browser console: `editor.insertTable(3, 4)`)
2. Click cells and type text
3. Tab through cells
4. Verify table renders with borders
5. Undo/Redo works after table edits

- [ ] **Step 3: Final commit with all remaining changes**

```bash
git add -A
git commit -m "feat(docs): complete table support (Phase 3.2)"
```
