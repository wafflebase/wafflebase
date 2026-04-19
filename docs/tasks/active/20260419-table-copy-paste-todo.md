# Table Copy-Paste (Phase 1: Cell-to-Cell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable copy-paste of table cell ranges within and between tables in the Docs editor.

**Architecture:** Extend `ClipboardPayload` with optional `tableCells: TableCell[][]` field. Add cell-range extraction in copy, cell-range writing in paste. Reuse existing `tableCellRange` selection, `store.updateTableCell()`, and `getSelectedText()`.

**Tech Stack:** TypeScript, Vitest (jsdom), existing Docs model/view layer.

**Design doc:** `docs/design/docs/docs-table-copy-paste.md`

---

### Task 1: Extend clipboard serialization for table cells

**Files:**
- Modify: `packages/docs/src/view/clipboard.ts:3-21`
- Test: `packages/docs/test/view/clipboard.test.ts`

- [ ] **Step 1: Write failing test for tableCells round-trip**

In `packages/docs/test/view/clipboard.test.ts`, add to the `clipboard JSON serialization` describe block:

```typescript
it('should round-trip tableCells payload', () => {
  const cells: TableCell[][] = [
    [
      {
        blocks: [{
          id: 'c1',
          type: 'paragraph' as const,
          inlines: [{ text: 'A1', style: { bold: true } }],
          style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
        }],
        style: { padding: 4 },
      },
      {
        blocks: [{
          id: 'c2',
          type: 'paragraph' as const,
          inlines: [{ text: 'B1', style: {} }],
          style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
        }],
        style: { padding: 4 },
      },
    ],
  ];
  const json = serializeClipboard({ blocks: [], tableCells: cells });
  const result = deserializeClipboard(json);
  expect(result.tableCells).toBeDefined();
  expect(result.tableCells).toHaveLength(1);
  expect(result.tableCells![0]).toHaveLength(2);
  expect(result.tableCells![0][0].blocks[0].inlines[0].text).toBe('A1');
  expect(result.tableCells![0][0].blocks[0].inlines[0].style.bold).toBe(true);
  expect(result.tableCells![0][1].blocks[0].inlines[0].text).toBe('B1');
});

it('should return empty tableCells when absent in payload', () => {
  const json = serializeClipboard({ blocks: [] });
  const result = deserializeClipboard(json);
  expect(result.tableCells).toBeUndefined();
});
```

Add the `TableCell` import at the top of the test file:

```typescript
import type { TableCell } from '../../src/model/types.js';
```

And update the existing import to include the new functions:

```typescript
import { serializeClipboard, deserializeClipboard, serializeBlocks, deserializeBlocks, parseHtmlToInlines } from '../../src/view/clipboard.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && npx vitest run test/view/clipboard.test.ts`
Expected: FAIL — `serializeClipboard` and `deserializeClipboard` not exported.

- [ ] **Step 3: Implement serialization changes**

In `packages/docs/src/view/clipboard.ts`, update the `ClipboardPayload` interface and add new functions:

```typescript
import type { Block, BlockType, Inline, InlineStyle, HeadingLevel, TableCell } from '../model/types.js';
```

Update the interface:

```typescript
interface ClipboardPayload {
  version: 1;
  blocks: Block[];
  tableCells?: TableCell[][];
}
```

Add new serialize/deserialize functions after the existing ones (keep old ones for backward compat):

```typescript
export interface ClipboardData {
  blocks: Block[];
  tableCells?: TableCell[][];
}

export function serializeClipboard(data: ClipboardData): string {
  const payload: ClipboardPayload = { version: 1, blocks: data.blocks };
  if (data.tableCells) {
    payload.tableCells = data.tableCells;
  }
  return JSON.stringify(payload);
}

export function deserializeClipboard(json: string): ClipboardData {
  try {
    const payload = JSON.parse(json) as Partial<ClipboardPayload>;
    if (payload.version !== 1) return { blocks: [] };
    return {
      blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
      tableCells: Array.isArray(payload.tableCells) ? payload.tableCells : undefined,
    };
  } catch {
    return { blocks: [] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && npx vitest run test/view/clipboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/clipboard.ts packages/docs/test/view/clipboard.test.ts
git commit -m "Add clipboard serialization support for table cells"
```

---

### Task 2: Add cloneTableCells helper

**Files:**
- Modify: `packages/docs/src/view/clipboard.ts`
- Test: `packages/docs/test/view/clipboard.test.ts`

- [ ] **Step 1: Write failing test for cloneTableCells**

In `packages/docs/test/view/clipboard.test.ts`, add a new describe block:

```typescript
import { cloneTableCells } from '../../src/view/clipboard.js';

describe('cloneTableCells', () => {
  it('should deep clone cells with new block IDs', () => {
    const cells: TableCell[][] = [
      [
        {
          blocks: [{
            id: 'original-id',
            type: 'paragraph' as const,
            inlines: [{ text: 'hello', style: { bold: true } }],
            style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
          }],
          style: { padding: 4 },
        },
      ],
    ];
    const cloned = cloneTableCells(cells);

    // Different block ID
    expect(cloned[0][0].blocks[0].id).not.toBe('original-id');
    // Same content
    expect(cloned[0][0].blocks[0].inlines[0].text).toBe('hello');
    expect(cloned[0][0].blocks[0].inlines[0].style.bold).toBe(true);
    // Deep clone — mutating original does not affect clone
    cells[0][0].blocks[0].inlines[0].text = 'mutated';
    expect(cloned[0][0].blocks[0].inlines[0].text).toBe('hello');
  });

  it('should clone cell style independently', () => {
    const cells: TableCell[][] = [
      [{
        blocks: [{
          id: 'b1',
          type: 'paragraph' as const,
          inlines: [{ text: '', style: {} }],
          style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
        }],
        style: { padding: 8 },
      }],
    ];
    const cloned = cloneTableCells(cells);
    cells[0][0].style.padding = 99;
    expect(cloned[0][0].style.padding).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && npx vitest run test/view/clipboard.test.ts`
Expected: FAIL — `cloneTableCells` not exported.

- [ ] **Step 3: Implement cloneTableCells**

In `packages/docs/src/view/clipboard.ts`, add:

```typescript
export function cloneTableCells(cells: TableCell[][]): TableCell[][] {
  return cells.map(row =>
    row.map(cell => ({
      style: { ...cell.style },
      ...(cell.colSpan != null ? { colSpan: cell.colSpan } : {}),
      ...(cell.rowSpan != null ? { rowSpan: cell.rowSpan } : {}),
      blocks: cell.blocks.map(b => ({
        ...b,
        id: generateBlockId(),
        inlines: b.inlines.map(il => ({ text: il.text, style: { ...il.style } })),
        style: { ...b.style },
      })),
    }))
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && npx vitest run test/view/clipboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/clipboard.ts packages/docs/test/view/clipboard.test.ts
git commit -m "Add cloneTableCells deep-clone helper for clipboard"
```

---

### Task 3: Implement copy for table cell ranges

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts:696-715`

- [ ] **Step 1: Add getSelectedTableCells method**

In `packages/docs/src/view/text-editor.ts`, add the following method near `getSelectedBlocks()` (around line 2553):

```typescript
/**
 * Extract selected table cells as a 2D array when a tableCellRange is active.
 */
private getSelectedTableCells(): TableCell[][] | null {
  const layout = this.getLayout();
  const normalized = this.selection.getNormalizedRange(layout);
  if (!normalized?.tableCellRange) return null;

  const cr = normalized.tableCellRange;
  const lb = layout.blocks.find((b) => b.block.id === cr.blockId);
  if (!lb?.block.tableData) return null;

  const td = lb.block.tableData;
  const rows: TableCell[][] = [];
  for (let r = cr.start.rowIndex; r <= cr.end.rowIndex; r++) {
    const row: TableCell[] = [];
    for (let c = cr.start.colIndex; c <= cr.end.colIndex; c++) {
      const cell = td.rows[r]?.cells[c];
      if (cell) {
        row.push(cell);
      }
    }
    rows.push(row);
  }
  return rows;
}
```

- [ ] **Step 2: Update handleCopy to handle cell ranges**

Replace `handleCopy` at line 696:

```typescript
private handleCopy = (e: ClipboardEvent): void => {
  if (!this.selection.hasSelection()) return;
  e.preventDefault();

  const tableCells = this.getSelectedTableCells();
  if (tableCells) {
    const cloned = cloneTableCells(tableCells);
    const json = serializeClipboard({ blocks: [], tableCells: cloned });
    e.clipboardData?.setData(WAFFLEDOCS_MIME, json);
    e.clipboardData?.setData('text/plain', this.selection.getSelectedText(this.getLayout()));
    return;
  }

  const selectedBlocks = this.getSelectedBlocks();
  const json = serializeClipboard({ blocks: selectedBlocks });
  e.clipboardData?.setData(WAFFLEDOCS_MIME, json);
  e.clipboardData?.setData('text/plain', this.selection.getSelectedText(this.getLayout()));
};
```

- [ ] **Step 3: Update handleCut to handle cell ranges**

Replace `handleCut` at line 705:

```typescript
private handleCut = (e: ClipboardEvent): void => {
  if (!this.selection.hasSelection()) return;
  e.preventDefault();

  const tableCells = this.getSelectedTableCells();
  if (tableCells) {
    const cloned = cloneTableCells(tableCells);
    const json = serializeClipboard({ blocks: [], tableCells: cloned });
    e.clipboardData?.setData(WAFFLEDOCS_MIME, json);
    e.clipboardData?.setData('text/plain', this.selection.getSelectedText(this.getLayout()));
    this.saveSnapshot();
    this.deleteSelection();
    this.requestRender();
    return;
  }

  const selectedBlocks = this.getSelectedBlocks();
  const json = serializeClipboard({ blocks: selectedBlocks });
  e.clipboardData?.setData(WAFFLEDOCS_MIME, json);
  e.clipboardData?.setData('text/plain', this.selection.getSelectedText(this.getLayout()));
  this.saveSnapshot();
  this.deleteSelection();
  this.requestRender();
};
```

- [ ] **Step 4: Update imports in text-editor.ts**

At the top of `text-editor.ts`, update the clipboard import:

```typescript
import { serializeClipboard, deserializeClipboard, cloneTableCells, parseHtmlToBlocks, WAFFLEDOCS_MIME } from './clipboard.js';
```

Remove the old `serializeBlocks` and `deserializeBlocks` imports.

- [ ] **Step 5: Update handlePaste to use deserializeClipboard**

In `handlePaste` at line 737, update the deserialization:

```typescript
const json = e.clipboardData?.getData(WAFFLEDOCS_MIME);
if (json) {
  const data = deserializeClipboard(json);
  if (data.tableCells && data.tableCells.length > 0) {
    this.saveSnapshot();
    this.deleteSelection();
    this.pasteTableCells(data.tableCells);
    this.selection.setRange(null);
    this.requestRender();
    return;
  }
  if (data.blocks.length > 0) {
    this.saveSnapshot();
    this.deleteSelection();
    this.insertBlocks(data.blocks);
    this.selection.setRange(null);
    this.requestRender();
    return;
  }
}
```

- [ ] **Step 6: Run lint to verify no compile errors**

Run: `cd packages/docs && npx tsc --noEmit`
Expected: PASS (ignore if `pasteTableCells` not yet defined — add stub next step)

- [ ] **Step 7: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "Add table cell range copy/cut support in clipboard handlers"
```

---

### Task 4: Implement paste for table cell ranges

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

- [ ] **Step 1: Add pasteTableCells method**

In `packages/docs/src/view/text-editor.ts`, add after `insertBlocks()` (around line 2711):

```typescript
/**
 * Paste table cells into the current table at the cursor position.
 * If cursor is not in a table, creates a new table block from the cells.
 */
private pasteTableCells(cells: TableCell[][]): void {
  if (cells.length === 0) return;

  const layout = this.getLayout();
  const pos = this.cursor.position;
  const cellInfo = layout.blockParentMap.get(pos.blockId);

  if (!cellInfo) {
    // Cursor not in a table — insert a new table block from the cells
    const rows = cells.length;
    const cols = Math.max(...cells.map(r => r.length));
    const tableBlock = createTableBlock(rows, cols);
    const td = tableBlock.tableData!;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cells[r].length; c++) {
        const cloned = cloneTableCells([[cells[r][c]]])[0][0];
        td.rows[r].cells[c] = cloned;
      }
    }
    const blockIdx = this.doc.getBlockIndex(pos.blockId);
    this.doc.insertBlockAt(blockIdx + 1, tableBlock);
    this.invalidateLayout();
    const firstCellBlock = td.rows[0].cells[0].blocks[0];
    this.cursor.moveTo({ blockId: firstCellBlock.id, offset: 0 }, 'before');
    return;
  }

  // Cursor is in a table — paste cells starting from current cell position
  const tableBlockId = cellInfo.tableBlockId;
  const tableBlock = this.doc.getBlock(tableBlockId);
  const td = tableBlock.tableData;
  if (!td) return;

  const startRow = cellInfo.rowIndex;
  const startCol = cellInfo.colIndex;

  for (let r = 0; r < cells.length; r++) {
    const targetRow = startRow + r;
    if (targetRow >= td.rows.length) break; // clamp

    for (let c = 0; c < cells[r].length; c++) {
      const targetCol = startCol + c;
      if (targetCol >= td.rows[targetRow].cells.length) continue; // clamp

      const cloned = cloneTableCells([[cells[r][c]]])[0][0];
      td.rows[targetRow].cells[targetCol] = cloned;
      this.doc.store.updateTableCell(tableBlockId, targetRow, targetCol, cloned);
    }
  }

  this.invalidateLayout();
  // Move cursor to the last pasted cell's first block
  const lastRow = Math.min(startRow + cells.length - 1, td.rows.length - 1);
  const lastCol = Math.min(startCol + cells[cells.length - 1].length - 1, td.rows[lastRow].cells.length - 1);
  const lastCell = td.rows[lastRow].cells[lastCol];
  if (lastCell?.blocks[0]) {
    this.cursor.moveTo({ blockId: lastCell.blocks[0].id, offset: 0 }, 'before');
  }
}
```

- [ ] **Step 2: Add createTableBlock import**

Ensure `text-editor.ts` imports `createTableBlock` from the model:

```typescript
import { ..., createTableBlock } from '../model/types.js';
```

- [ ] **Step 3: Verify store access pattern**

Check if `this.doc.store` is accessible. If the store is private, use `this.doc.updateTableCell()` instead. Look at how existing code calls `store.updateTableCell`:

The document model's existing pattern (seen in `document.ts:823`) is `this.store.updateTableCell(blockId, r, c, cell)`. Since `pasteTableCells` lives in `text-editor.ts` which has `this.doc` (a `Document` instance), we need to check if `Document` exposes a method we can use.

If `Document` doesn't expose `updateTableCell` directly, add a thin wrapper to `document.ts`:

```typescript
updateTableCell(tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell): void {
  this.store.updateTableCell(tableBlockId, rowIndex, colIndex, cell);
  this.refresh();
}
```

Then in `pasteTableCells`, replace `this.doc.store.updateTableCell(...)` with `this.doc.updateTableCell(...)` and remove `this.invalidateLayout()` since `refresh()` handles it.

- [ ] **Step 4: Run type check**

Run: `cd packages/docs && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/text-editor.ts packages/docs/src/model/document.ts
git commit -m "Add table cell paste support with clamp-to-bounds"
```

---

### Task 5: Verify and run full test suite

**Files:** None (verification only)

- [ ] **Step 1: Run clipboard tests**

Run: `cd packages/docs && npx vitest run test/view/clipboard.test.ts`
Expected: All tests PASS

- [ ] **Step 2: Run full docs package tests**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 3: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS — lint + unit tests clean

- [ ] **Step 4: Manual smoke test (if dev server available)**

1. Start dev server: `pnpm dev`
2. Create a new doc, insert a table (3x3)
3. Type text in several cells
4. Select a 2x2 cell range → Ctrl+C
5. Click a different cell → Ctrl+V
6. Verify: cells pasted correctly at target position
7. Select cells → Ctrl+X → verify cells cleared
8. Paste into a different table → verify cross-table paste works
9. Paste when cursor is on a normal paragraph → verify new table created
