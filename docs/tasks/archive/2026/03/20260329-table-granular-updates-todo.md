# Table Granular Store Updates (Phase C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose whole-block `updateBlock()` for tables into fine-grained Yorkie Tree `editByPath` operations so concurrent cell edits merge instead of triggering last-writer-wins.

**Architecture:** Extend `DocStore` interface with six table-specific methods (`insertTableRow`, `deleteTableRow`, `insertTableColumn`, `deleteTableColumn`, `updateTableCell`, `updateTableAttrs`). `YorkieDocStore` implements each using nested-path `editByPath`. `Doc` class calls the appropriate granular method instead of `updateBlock()`.

**Tech Stack:** TypeScript, Yorkie JS SDK (Tree CRDT, `editByPath`), Vitest (docs package), Node test runner (frontend package)

**Design doc:** `docs/design/docs/docs-table-crdt.md` — Phase C section

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/docs/src/store/store.ts` | Add 6 table methods to `DocStore` interface |
| Modify | `packages/docs/src/store/memory.ts` | Implement 6 methods in `MemDocStore` |
| Modify | `packages/frontend/src/app/docs/yorkie-doc-store.ts` | Extract `buildRowNode`/`buildCellNode`, implement 6 methods with `editByPath` |
| Modify | `packages/docs/src/model/document.ts` | Switch table methods from `updateBlock()` to granular store calls |
| Modify | `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts` | Add tests for 6 granular methods |
| Verify | `packages/docs/test/model/table.test.ts` | Existing tests must pass unchanged |

---

### Task 1: Extract `buildRowNode` / `buildCellNode` helpers

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts:148-169`

- [ ] **Step 1: Extract helpers from `buildBlockNode`**

In `yorkie-doc-store.ts`, add two new functions before `buildBlockNode` and update `buildBlockNode` to call them:

```typescript
function buildCellNode(cell: TableCell): ElementNode {
  return {
    type: 'cell' as const,
    attributes: serializeCellStyle(cell),
    children: cell.blocks.map(buildBlockNode),
  };
}

function buildRowNode(row: TableRow): ElementNode {
  return {
    type: 'row' as const,
    attributes: {},
    children: row.cells.map(buildCellNode),
  };
}
```

Update `buildBlockNode` table branch (lines 150-169) to use the new helpers:

```typescript
if (block.type === 'table' && block.tableData) {
  return {
    type: 'block',
    attributes: {
      id: block.id,
      type: 'table',
      cols: block.tableData.columnWidths.join(','),
      ...serializeBlockStyle(block.style),
    },
    children: block.tableData.rows.map(buildRowNode),
  };
}
```

Add `TableRow` to the import from `@wafflebase/docs` (it's already exported).

- [ ] **Step 2: Run tests to verify no behavior change**

Run: `pnpm verify:fast`
Expected: All tests pass — this is a pure refactor.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Extract buildRowNode/buildCellNode helpers from buildBlockNode

Prepare for Phase C granular table updates by extracting row and cell
node builders into standalone functions."
```

---

### Task 2: Add 6 table methods to `DocStore` interface

**Files:**
- Modify: `packages/docs/src/store/store.ts`

- [ ] **Step 1: Add method signatures to `DocStore` interface**

Append before the closing `}` of the interface:

```typescript
  // --- Table granular updates (Phase C) ---
  /** Insert a row into a table at the given index. */
  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void;
  /** Delete a row from a table. */
  deleteTableRow(tableBlockId: string, rowIndex: number): void;
  /** Insert a column (one cell per row) at the given index. */
  insertTableColumn(tableBlockId: string, atIndex: number, cells: TableCell[]): void;
  /** Delete a column from a table. */
  deleteTableColumn(tableBlockId: string, colIndex: number): void;
  /** Update a single cell (content + style). */
  updateTableCell(
    tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell,
  ): void;
  /** Update table-level attributes (column widths). */
  updateTableAttrs(tableBlockId: string, attrs: { cols: number[] }): void;
```

Add the necessary type imports at the top:

```typescript
import type { Block, Document, PageSetup, TableRow, TableCell } from '../model/types.js';
```

- [ ] **Step 2: Verify typecheck fails for MemDocStore and YorkieDocStore**

Run: `pnpm sheets typecheck 2>&1 | head -5` (docs package uses the same typecheck)

Actually, run: `cd packages/docs && npx tsc --noEmit 2>&1 | head -20`

Expected: Type errors because `MemDocStore` doesn't implement the new methods yet.

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/store/store.ts
git commit -m "Add 6 table granular update methods to DocStore interface

Phase C: insertTableRow, deleteTableRow, insertTableColumn,
deleteTableColumn, updateTableCell, updateTableAttrs."
```

---

### Task 3: Implement 6 methods in `MemDocStore`

**Files:**
- Modify: `packages/docs/src/store/memory.ts`
- Verify: `packages/docs/test/model/table.test.ts`

- [ ] **Step 1: Add imports**

Update the import at top of `memory.ts`:

```typescript
import type { Block, Document, PageSetup, TableRow, TableCell } from '../model/types.js';
```

- [ ] **Step 2: Implement all 6 methods**

Add before the `private pushUndo()` method:

```typescript
  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.splice(atIndex, 0, JSON.parse(JSON.stringify(row)));
  }

  deleteTableRow(tableBlockId: string, rowIndex: number): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.splice(rowIndex, 1);
  }

  insertTableColumn(tableBlockId: string, atIndex: number, cells: TableCell[]): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.forEach((row, i) => {
      row.cells.splice(atIndex, 0, JSON.parse(JSON.stringify(cells[i])));
    });
  }

  deleteTableColumn(tableBlockId: string, colIndex: number): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.forEach((row) => {
      row.cells.splice(colIndex, 1);
    });
  }

  updateTableCell(
    tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell,
  ): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows[rowIndex].cells[colIndex] = JSON.parse(JSON.stringify(cell));
  }

  updateTableAttrs(tableBlockId: string, attrs: { cols: number[] }): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.columnWidths = [...attrs.cols];
  }

  private findBlock(id: string): Block {
    const block = this.doc.blocks.find((b) => b.id === id);
    if (!block) throw new Error(`Block not found: ${id}`);
    return block;
  }
```

- [ ] **Step 3: Run existing table tests to verify no regression**

Run: `pnpm test -- --reporter verbose 2>&1 | grep -E 'table|PASS|FAIL'`
Expected: All existing table tests still pass.

- [ ] **Step 4: Run full verify**

Run: `pnpm verify:fast`
Expected: All tests pass, typecheck passes.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/store/memory.ts
git commit -m "Implement 6 table granular update methods in MemDocStore

Direct in-memory mutations with deep cloning for consistency
with existing MemDocStore patterns."
```

---

### Task 4: Implement 6 methods in `YorkieDocStore`

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts:412-428`

- [ ] **Step 1: Add `findTableIndex` helper**

Add as a private method of `YorkieDocStore`:

```typescript
  private findTableIndex(tableBlockId: string): number {
    const currentDoc = this.getDocument();
    const index = currentDoc.blocks.findIndex((b) => b.id === tableBlockId);
    if (index === -1) throw new Error(`Table block not found: ${tableBlockId}`);
    return index;
  }
```

- [ ] **Step 2: Implement `insertTableRow`**

```typescript
  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void {
    const tIdx = this.findTableIndex(tableBlockId);
    const rowNode = buildRowNode(row);
    this.doc.update((root) => {
      root.content.editByPath([tIdx, atIndex], [tIdx, atIndex], rowNode);
    });
    const currentDoc = this.getDocument();
    currentDoc.blocks[tIdx].tableData!.rows.splice(atIndex, 0, row);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }
```

- [ ] **Step 3: Implement `deleteTableRow`**

```typescript
  deleteTableRow(tableBlockId: string, rowIndex: number): void {
    const tIdx = this.findTableIndex(tableBlockId);
    this.doc.update((root) => {
      root.content.editByPath([tIdx, rowIndex], [tIdx, rowIndex + 1]);
    });
    const currentDoc = this.getDocument();
    currentDoc.blocks[tIdx].tableData!.rows.splice(rowIndex, 1);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }
```

- [ ] **Step 4: Implement `insertTableColumn`**

```typescript
  insertTableColumn(tableBlockId: string, atIndex: number, cells: TableCell[]): void {
    const tIdx = this.findTableIndex(tableBlockId);
    this.doc.update((root) => {
      const tree = root.content;
      for (let r = 0; r < cells.length; r++) {
        tree.editByPath([tIdx, r, atIndex], [tIdx, r, atIndex], buildCellNode(cells[r]));
      }
    });
    const currentDoc = this.getDocument();
    const td = currentDoc.blocks[tIdx].tableData!;
    td.rows.forEach((row, i) => {
      row.cells.splice(atIndex, 0, cells[i]);
    });
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }
```

- [ ] **Step 5: Implement `deleteTableColumn`**

```typescript
  deleteTableColumn(tableBlockId: string, colIndex: number): void {
    const tIdx = this.findTableIndex(tableBlockId);
    const currentDoc = this.getDocument();
    const rowCount = currentDoc.blocks[tIdx].tableData!.rows.length;
    this.doc.update((root) => {
      const tree = root.content;
      for (let r = 0; r < rowCount; r++) {
        tree.editByPath([tIdx, r, colIndex], [tIdx, r, colIndex + 1]);
      }
    });
    currentDoc.blocks[tIdx].tableData!.rows.forEach((row) => {
      row.cells.splice(colIndex, 1);
    });
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }
```

- [ ] **Step 6: Implement `updateTableCell`**

```typescript
  updateTableCell(
    tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell,
  ): void {
    const tIdx = this.findTableIndex(tableBlockId);
    const cellNode = buildCellNode(cell);
    this.doc.update((root) => {
      root.content.editByPath(
        [tIdx, rowIndex, colIndex],
        [tIdx, rowIndex, colIndex + 1],
        cellNode,
      );
    });
    const currentDoc = this.getDocument();
    currentDoc.blocks[tIdx].tableData!.rows[rowIndex].cells[colIndex] = cell;
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }
```

- [ ] **Step 7: Implement `updateTableAttrs`**

```typescript
  updateTableAttrs(tableBlockId: string, attrs: { cols: number[] }): void {
    const tIdx = this.findTableIndex(tableBlockId);
    const currentDoc = this.getDocument();
    const block = currentDoc.blocks[tIdx];
    block.tableData!.columnWidths = attrs.cols;
    this.doc.update((root) => {
      root.content.editByPath([tIdx], [tIdx + 1], buildBlockNode(block));
    });
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }
```

- [ ] **Step 8: Run verify**

Run: `pnpm verify:fast`
Expected: All tests pass. (No callers yet, so this just verifies compilation.)

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Implement 6 table granular update methods in YorkieDocStore

Each method uses targeted editByPath with nested paths instead of
whole-block replacement. Column operations iterate rows within a
single doc.update() for atomicity."
```

---

### Task 5: Update `Doc` class to call granular methods

**Files:**
- Modify: `packages/docs/src/model/document.ts:530-752`
- Verify: `packages/docs/test/model/table.test.ts`

- [ ] **Step 1: Update `insertRow`**

Replace `this.store.updateBlock(blockId, block)` (line 539) with:

```typescript
    this.store.insertTableRow(blockId, atIndex, td.rows[atIndex]);
```

The in-memory mutation (`td.rows.splice(atIndex, 0, { cells })`) stays as-is on line 538.

- [ ] **Step 2: Update `deleteRow`**

Replace `this.store.updateBlock(blockId, block)` (line 563) with:

```typescript
    // Update cells with adjusted rowSpan
    for (let r = 0; r < rowIndex; r++) {
      for (let c = 0; c < td.rows[r].cells.length; c++) {
        const cell = td.rows[r].cells[c];
        const rs = cell.rowSpan ?? 1;
        if (r + rs > rowIndex) {
          // This cell had its rowSpan adjusted — update it in store
          this.store.updateTableCell(blockId, r, c, cell);
        }
      }
    }
    this.store.deleteTableRow(blockId, rowIndex);
```

The rowSpan adjustment loop (lines 553-560) already runs before the splice (line 562). The `updateTableCell` calls happen after in-memory adjustment but before the tree row deletion, so indices are correct. `deleteTableRow` then removes the row from the tree.

- [ ] **Step 3: Update `insertColumn`**

Replace `this.store.updateBlock(blockId, block)` (line 582) with:

```typescript
    const newCells = td.rows.map((row) => row.cells[atIndex]);
    this.store.insertTableColumn(blockId, atIndex, newCells);
    this.store.updateTableAttrs(blockId, { cols: td.columnWidths });
```

- [ ] **Step 4: Update `deleteColumn`**

Replace `this.store.updateBlock(blockId, block)` (line 614) with:

```typescript
    // Update cells with adjusted colSpan
    for (let ri = 0; ri < td.rows.length; ri++) {
      const row = td.rows[ri];
      for (let c = 0; c < colIndex; c++) {
        const cell = row.cells[c];
        const cs = cell.colSpan ?? 1;
        if (c + cs > colIndex) {
          this.store.updateTableCell(blockId, ri, c, cell);
        }
      }
    }
    this.store.deleteTableColumn(blockId, colIndex);
    this.store.updateTableAttrs(blockId, { cols: td.columnWidths });
```

The colSpan adjustment (lines 596-604) and width renormalization (lines 606-610) happen on the in-memory model first. The `updateTableCell` calls fire after adjustment but before the column is removed from the tree. Then `deleteTableColumn` removes the column, and `updateTableAttrs` updates the widths.

- [ ] **Step 5: Update `mergeCells`**

Replace `this.store.updateBlock(blockId, block)` (line 667) with:

```typescript
    // Update each affected cell in the store
    for (let r = start.rowIndex; r <= end.rowIndex; r++) {
      for (let c = start.colIndex; c <= end.colIndex; c++) {
        this.store.updateTableCell(blockId, r, c, td.rows[r].cells[c]);
      }
    }
```

- [ ] **Step 6: Update `splitCell`**

Replace `this.store.updateBlock(blockId, block)` (line 696) with:

```typescript
    for (let r = cell.rowIndex; r < cell.rowIndex + rowSpan; r++) {
      for (let c = cell.colIndex; c < cell.colIndex + colSpan; c++) {
        this.store.updateTableCell(blockId, r, c, td.rows[r].cells[c]);
      }
    }
```

- [ ] **Step 7: Update `applyCellStyle`**

Replace `this.store.updateBlock(blockId, block)` (line 711) with:

```typescript
    this.store.updateTableCell(blockId, cell.rowIndex, cell.colIndex, tableCell);
```

- [ ] **Step 8: Update `setColumnWidth`**

Replace `this.store.updateBlock(blockId, block)` (line 732) with:

```typescript
    this.store.updateTableAttrs(blockId, { cols: td.columnWidths });
```

- [ ] **Step 9: Update `updateBlockInStore`**

Replace the cell branch (lines 744-748) to use `updateTableCell` instead:

```typescript
  private updateBlockInStore(blockId: string, block: Block): void {
    const cellInfo = this._blockParentMap.get(blockId);
    if (cellInfo) {
      const tableBlock = this._document.blocks.find((b) => b.id === cellInfo.tableBlockId);
      if (tableBlock) {
        const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
        this.store.updateTableCell(cellInfo.tableBlockId, cellInfo.rowIndex, cellInfo.colIndex, cell);
      }
    } else {
      this.store.updateBlock(blockId, block);
    }
  }
```

- [ ] **Step 10: Update `splitBlockInCellInternal`**

Replace the three `this.store.updateBlock(cellInfo.tableBlockId, tableBlock)` calls (lines 775, 789, 821) with:

```typescript
    const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
    this.store.updateTableCell(cellInfo.tableBlockId, cellInfo.rowIndex, cellInfo.colIndex, cell);
```

Each of the three locations (empty list-item → paragraph conversion, horizontal-rule case, normal split) needs the same replacement pattern.

- [ ] **Step 11: Run existing table tests**

Run: `cd packages/docs && npx vitest run test/model/table.test.ts --reporter verbose`
Expected: All existing table tests pass.

- [ ] **Step 12: Run full verify**

Run: `pnpm verify:fast`
Expected: All tests pass.

- [ ] **Step 13: Commit**

```bash
git add packages/docs/src/model/document.ts
git commit -m "Switch Doc table methods from updateBlock to granular store calls

Each table operation now calls the appropriate DocStore method
(insertTableRow, updateTableCell, etc.) instead of replacing the
entire table block. This enables concurrent cell-level editing
when backed by YorkieDocStore."
```

---

### Task 6: Add YorkieDocStore granular method tests

**Files:**
- Modify: `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`

- [ ] **Step 1: Add table helper and imports**

Add at the top of the file, after existing imports and `makeBlock`:

```typescript
import { createTableBlock, createTableCell } from '@wafflebase/docs';
import type { TableRow, TableCell as TCell } from '@wafflebase/docs';

function makeTableDoc(): { tableBlock: Block; doc: { blocks: Block[] } } {
  const tableBlock = createTableBlock(2, 2);
  return { tableBlock, doc: { blocks: [makeBlock('before'), tableBlock, makeBlock('after')] } };
}
```

- [ ] **Step 2: Add `insertTableRow` test**

```typescript
  describe('insertTableRow', () => {
    it('should insert a row without affecting other rows', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      // Put text in cell (0,0) to verify it's preserved
      const cellBlock = tableBlock.tableData!.rows[0].cells[0].blocks[0];
      cellBlock.inlines[0].text = 'keep me';
      store.updateBlock(tableBlock.id, tableBlock);

      const newRow: TableRow = { cells: [createTableCell(), createTableCell()] };
      store.insertTableRow(tableBlock.id, 1, newRow);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.equal(td.rows.length, 3);
      assert.equal(td.rows[0].cells[0].blocks[0].inlines[0].text, 'keep me');
      assert.equal(td.rows[1].cells.length, 2);
      assert.equal(td.rows[2].cells[0].blocks[0].inlines[0].text, '');
    });
  });
```

- [ ] **Step 3: Add `deleteTableRow` test**

```typescript
  describe('deleteTableRow', () => {
    it('should delete a row and preserve others', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cell10 = tableBlock.tableData!.rows[1].cells[0].blocks[0];
      cell10.inlines[0].text = 'row 1';
      store.updateBlock(tableBlock.id, tableBlock);

      store.deleteTableRow(tableBlock.id, 0);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.equal(td.rows.length, 1);
      assert.equal(td.rows[0].cells[0].blocks[0].inlines[0].text, 'row 1');
    });
  });
```

- [ ] **Step 4: Add `insertTableColumn` test**

```typescript
  describe('insertTableColumn', () => {
    it('should insert a column in every row', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const newCells: TCell[] = [createTableCell(), createTableCell()];
      store.insertTableColumn(tableBlock.id, 1, newCells);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.equal(td.rows[0].cells.length, 3);
      assert.equal(td.rows[1].cells.length, 3);
    });
  });
```

- [ ] **Step 5: Add `deleteTableColumn` test**

```typescript
  describe('deleteTableColumn', () => {
    it('should delete a column from every row', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      store.deleteTableColumn(tableBlock.id, 0);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.equal(td.rows[0].cells.length, 1);
      assert.equal(td.rows[1].cells.length, 1);
    });
  });
```

- [ ] **Step 6: Add `updateTableCell` test**

```typescript
  describe('updateTableCell', () => {
    it('should update one cell without affecting others', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      // Set text in cell (0,0)
      const cell00 = tableBlock.tableData!.rows[0].cells[0];
      cell00.blocks[0].inlines[0].text = 'original 00';
      const cell11 = tableBlock.tableData!.rows[1].cells[1];
      cell11.blocks[0].inlines[0].text = 'original 11';
      store.updateBlock(tableBlock.id, tableBlock);

      // Update only cell (0,0)
      const updatedCell = createTableCell();
      updatedCell.blocks[0].inlines[0].text = 'updated 00';
      store.updateTableCell(tableBlock.id, 0, 0, updatedCell);

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.equal(td.rows[0].cells[0].blocks[0].inlines[0].text, 'updated 00');
      assert.equal(td.rows[1].cells[1].blocks[0].inlines[0].text, 'original 11');
    });
  });
```

- [ ] **Step 7: Add `updateTableAttrs` test**

```typescript
  describe('updateTableAttrs', () => {
    it('should update column widths without affecting cell content', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cell00 = tableBlock.tableData!.rows[0].cells[0];
      cell00.blocks[0].inlines[0].text = 'keep me';
      store.updateBlock(tableBlock.id, tableBlock);

      store.updateTableAttrs(tableBlock.id, { cols: [0.7, 0.3] });

      const result = store.getDocument();
      const td = result.blocks[1].tableData!;
      assert.deepEqual(td.columnWidths, [0.7, 0.3]);
      assert.equal(td.rows[0].cells[0].blocks[0].inlines[0].text, 'keep me');
    });
  });
```

- [ ] **Step 8: Add surrounding blocks preservation test**

```typescript
  describe('granular table ops preserve surrounding blocks', () => {
    it('should not affect blocks before and after the table', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      store.insertTableRow(tableBlock.id, 1, { cells: [createTableCell(), createTableCell()] });

      const result = store.getDocument();
      assert.equal(result.blocks[0].inlines[0].text, 'before');
      assert.equal(result.blocks[2].inlines[0].text, 'after');
    });
  });
```

- [ ] **Step 9: Run tests**

Run: `pnpm frontend test 2>&1 | tail -20`
Expected: All new and existing tests pass.

- [ ] **Step 10: Run full verify**

Run: `pnpm verify:fast`
Expected: All tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/frontend/tests/app/docs/yorkie-doc-store.test.ts
git commit -m "Add tests for YorkieDocStore granular table methods

Tests verify each of the 6 methods (insertTableRow, deleteTableRow,
insertTableColumn, deleteTableColumn, updateTableCell, updateTableAttrs)
preserves other cells and surrounding blocks."
```

---

### Task 7: Final verification and cleanup

- [ ] **Step 1: Run full verify**

Run: `pnpm verify:fast`
Expected: All tests pass.

- [ ] **Step 2: Verify existing Doc table tests**

Run: `cd packages/docs && npx vitest run test/model/table.test.ts --reporter verbose`
Expected: All tests pass — confirms `MemDocStore` granular methods work correctly through `Doc`.

- [ ] **Step 3: Verify no remaining whole-block updateBlock calls for tables**

Search for any remaining `store.updateBlock` calls in table methods of `document.ts`:

```bash
grep -n 'store.updateBlock' packages/docs/src/model/document.ts
```

Expected: Only non-table usages remain (e.g., `updateBlockInStore`'s else branch for top-level blocks, `insertText`, `deleteText`, etc.). No calls within `insertRow`, `deleteRow`, `insertColumn`, `deleteColumn`, `mergeCells`, `splitCell`, `applyCellStyle`, `setColumnWidth`.

- [ ] **Step 4: Update design doc Phase C status**

If all verifications pass, no further changes needed — the design doc was already updated at the start of this session.
