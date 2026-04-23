# Phase 8: Cell Structural Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate cell-internal block insert/delete from `updateTableCell` (full cell replacement) to `editByPath` (block-level CRDT operations) so concurrent edits within the same cell are preserved.

**Architecture:** Add `insertBlockAfter(siblingBlockId, block)` to the DocStore interface and both implementations. Extend `deleteBlock` in MemDocStore to support cell-internal blocks (YorkieDocStore already handles it). Update 3 Doc class call sites to use the new intent-preserving methods instead of `updateTableCell`.

**Tech Stack:** TypeScript, Yorkie CRDT Tree API (`editByPath`), Vitest/node:test

---

## File Structure

| File | Responsibility | Change |
|------|---------------|--------|
| `packages/docs/src/store/store.ts` | DocStore interface | Add `insertBlockAfter` |
| `packages/docs/src/store/memory.ts` | MemDocStore implementation | Add `insertBlockAfter`, fix `deleteBlock` for cell blocks |
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | YorkieDocStore implementation | Add `insertBlockAfter` |
| `packages/docs/src/model/document.ts` | Doc class (editing entry point) | Migrate 3 call sites |
| `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts` | Unit tests | Add `insertBlockAfter` tests |
| `packages/frontend/tests/app/docs/yorkie-doc-store-concurrent.integration.ts` | Concurrent tests | Add cell block insert + concurrent text edit test |
| `docs/design/docs/docs-intent-preserving-edits.md` | Design doc | Mark Phase 8 shipped |

---

### Task 1: Add `insertBlockAfter` to DocStore interface and MemDocStore

**Files:**
- Modify: `packages/docs/src/store/store.ts:97-100`
- Modify: `packages/docs/src/store/memory.ts:63-67`
- Test: `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`

- [ ] **Step 1: Add `insertBlockAfter` to DocStore interface**

In `packages/docs/src/store/store.ts`, add after the `insertImageInline` method (line 99):

```typescript
  /** Insert a block after the given sibling block (works for top-level and cell-internal blocks). */
  insertBlockAfter(siblingBlockId: string, block: Block): void;
```

- [ ] **Step 2: Implement `insertBlockAfter` in MemDocStore**

In `packages/docs/src/store/memory.ts`, add after the `insertBlock` method (after line 67):

```typescript
  insertBlockAfter(siblingBlockId: string, block: Block): void {
    const { blocks, index } = this.findBlockInAnyArray(siblingBlockId);
    blocks.splice(index + 1, 0, JSON.parse(JSON.stringify(block)));
  }
```

- [ ] **Step 3: Write unit test for MemDocStore `insertBlockAfter` (top-level)**

In `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts`, add a new `describe('insertBlockAfter')` section. Use the existing test patterns (local `doc` + `store` from `beforeEach`):

```typescript
  describe('insertBlockAfter', () => {
    it('should insert a block after a top-level sibling', () => {
      const b1 = makeBlock('First');
      const b2 = makeBlock('Second');
      store.setDocument({ blocks: [b1, b2] });

      const newBlock = makeBlock('Inserted');
      store.insertBlockAfter(b1.id, newBlock);

      const result = store.getDocument();
      assert.equal(result.blocks.length, 3);
      assert.equal(result.blocks[0].inlines[0].text, 'First');
      assert.equal(result.blocks[1].inlines[0].text, 'Inserted');
      assert.equal(result.blocks[2].inlines[0].text, 'Second');
    });

    it('should insert a block after a cell-internal sibling', () => {
      const { tableBlock, doc } = makeTableDoc();
      store.setDocument(doc);

      const cellBlockId = tableBlock.tableData!.rows[0].cells[0].blocks[0].id;
      const newBlock = makeBlock('CellInserted');
      store.insertBlockAfter(cellBlockId, newBlock);

      const result = store.getDocument();
      const cell = result.blocks[1].tableData!.rows[0].cells[0];
      assert.equal(cell.blocks.length, 2);
      assert.equal(cell.blocks[1].inlines[0].text, 'CellInserted');
    });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflebase && pnpm frontend test -- --test-name-pattern "insertBlockAfter"`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/store/store.ts packages/docs/src/store/memory.ts packages/frontend/tests/app/docs/yorkie-doc-store.test.ts
git commit -m $'Add insertBlockAfter to DocStore interface and MemDocStore\n\nNew method inserts a block after a sibling identified by blockId,\nworking for both top-level and cell-internal blocks. This enables\nintent-preserving cell structural edits (Phase 8).'
```

---

### Task 2: Implement `insertBlockAfter` in YorkieDocStore

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts:1330` (after `insertBlock`)

- [ ] **Step 1: Implement `insertBlockAfter` in YorkieDocStore**

Add after the existing `insertBlock` method (around line 1330):

```typescript
  insertBlockAfter(siblingBlockId: string, block: Block): void {
    const currentDoc = this.getDocument();
    const { path: siblingPath, region } = this.resolveBlockTreePath(siblingBlockId, currentDoc);

    // Insert position is immediately after the sibling
    const insertPath = [...siblingPath];
    insertPath[insertPath.length - 1] += 1;

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath(insertPath, insertPath, buildBlockNode(block));
    });

    // Update cache in-place
    const blocksArray = this.getBlocksArrayForPath(currentDoc, siblingPath, region);
    const localIdx = siblingPath[siblingPath.length - 1];
    blocksArray.splice(localIdx + 1, 0, block);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }
```

- [ ] **Step 2: Run existing `insertBlockAfter` tests to verify YorkieDocStore also passes**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflebase && pnpm frontend test -- --test-name-pattern "insertBlockAfter"`
Expected: PASS (2 tests — both top-level and cell-internal cases)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m $'Implement insertBlockAfter in YorkieDocStore\n\nUses resolveBlockTreePath to find the sibling, then editByPath to\ninsert at the next position. Works for both top-level and\ncell-internal blocks.'
```

---

### Task 3: Migrate Doc class call sites

**Files:**
- Modify: `packages/docs/src/model/document.ts:277-283` (splitBlock HR in cell)
- Modify: `packages/docs/src/model/document.ts:551-567` (insertTableInCell)
- Modify: `packages/docs/src/model/document.ts:574-595` (deleteTableInCell)

- [ ] **Step 1: Migrate `splitBlock` HR/page-break in cell**

In `packages/docs/src/model/document.ts`, replace the cell branch of the HR/page-break handler (lines 277-283):

Before:
```typescript
      if (cellInfo) {
        const tableBlock = this.getBlock(cellInfo.tableBlockId);
        const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
        const idx = cell.blocks.findIndex((b) => b.id === blockId);
        cell.blocks.splice(idx + 1, 0, newBlock);
        this.store.updateTableCell(cellInfo.tableBlockId, cellInfo.rowIndex, cellInfo.colIndex, cell);
      } else {
```

After:
```typescript
      if (cellInfo) {
        this.store.insertBlockAfter(blockId, newBlock);
      } else {
```

- [ ] **Step 2: Migrate `insertTableInCell`**

In `packages/docs/src/model/document.ts`, replace the `insertTableInCell` method body (lines 551-567):

Before:
```typescript
  insertTableInCell(blockId: string, rows: number, cols: number): Block {
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
    return newTable;
  }
```

After:
```typescript
  insertTableInCell(blockId: string, rows: number, cols: number): Block {
    const cellInfo = this._blockParentMap.get(blockId);
    if (!cellInfo) {
      throw new Error(`Block ${blockId} is not inside a table cell`);
    }

    const newTable = createTableBlock(rows, cols);
    this.store.insertBlockAfter(blockId, newTable);
    this.refresh();
    return newTable;
  }
```

- [ ] **Step 3: Migrate `deleteTableInCell`**

In `packages/docs/src/model/document.ts`, replace the `deleteTableInCell` method body (lines 574-595):

Before:
```typescript
  deleteTableInCell(tableBlockId: string): string {
    const parentCellInfo = this._blockParentMap.get(tableBlockId);
    if (!parentCellInfo) {
      throw new Error(`Block ${tableBlockId} is not inside a table cell`);
    }
    const parentTableBlock = this.getBlock(parentCellInfo.tableBlockId);
    const parentCell = parentTableBlock.tableData!.rows[parentCellInfo.rowIndex].cells[parentCellInfo.colIndex];
    const idx = parentCell.blocks.findIndex((b) => b.id === tableBlockId);
    if (idx !== -1) {
      parentCell.blocks.splice(idx, 1);
    }
    // Ensure cell still has at least one block
    if (parentCell.blocks.length === 0) {
      const emptyBlock = createTableCell().blocks[0];
      parentCell.blocks.push(emptyBlock);
    }
    this.store.updateTableCell(
      parentCellInfo.tableBlockId, parentCellInfo.rowIndex, parentCellInfo.colIndex, parentCell,
    );
    this.refresh();
    return parentCell.blocks[0].id;
  }
```

After:
```typescript
  deleteTableInCell(tableBlockId: string): string {
    const parentCellInfo = this._blockParentMap.get(tableBlockId);
    if (!parentCellInfo) {
      throw new Error(`Block ${tableBlockId} is not inside a table cell`);
    }
    const parentTableBlock = this.getBlock(parentCellInfo.tableBlockId);
    const parentCell = parentTableBlock.tableData!.rows[parentCellInfo.rowIndex].cells[parentCellInfo.colIndex];
    const cellBlockCount = parentCell.blocks.length;

    if (cellBlockCount <= 1) {
      // Only block in cell — replace with empty paragraph instead of deleting
      const emptyBlock = createTableCell().blocks[0];
      this.store.updateBlock(tableBlockId, emptyBlock);
      this.refresh();
      return emptyBlock.id;
    }

    // Multiple blocks — safe to delete; find cursor target before removal
    const idx = parentCell.blocks.findIndex((b) => b.id === tableBlockId);
    const cursorBlockId = idx > 0
      ? parentCell.blocks[idx - 1].id
      : parentCell.blocks[1].id;
    this.store.deleteBlock(tableBlockId);
    this.refresh();
    return cursorBlockId;
  }
```

- [ ] **Step 4: Run all docs tests**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflebase && pnpm verify:fast`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/model/document.ts
git commit -m $'Migrate 3 Doc call sites from updateTableCell to intent-preserving ops\n\nsplitBlock HR/page-break in cell: insertBlockAfter\ninsertTableInCell: insertBlockAfter\ndeleteTableInCell: deleteBlock (or updateBlock for last-block case)\n\nThis eliminates LWW full-cell replacement for these operations,\npreserving concurrent edits within the same cell.'
```

---

### Task 4: Concurrent integration test

**Files:**
- Modify: `packages/frontend/tests/app/docs/yorkie-doc-store-concurrent.integration.ts`

- [ ] **Step 1: Add concurrent insertBlockAfter + text insert test**

Append before the closing `});` of the test file:

```typescript
  // -------------------------------------------------------------------------
  // Phase 8: Cell structural edits — concurrent insertBlockAfter + text edit
  // -------------------------------------------------------------------------

  it('concurrent insertBlockAfter in cell and text insert in same cell should both be preserved', async () => {
    const tableBlock = createTableBlock(2, 2);
    const cellBlock = tableBlock.tableData!.rows[0].cells[0].blocks[0];
    // Put some text in the cell block so we can verify it's preserved
    cellBlock.inlines = [{ text: 'Hello', style: {} }];

    const ctx = await createTwoUserDocs('cell-insert-block-and-text', [tableBlock]);
    try {
      // Client A: insert a new block after the cell block
      const newBlock: Block = {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'NewBlock', style: {} }],
        style: { alignment: 'left', lineHeight: 1.15, marginTop: 0, marginBottom: 0, textIndent: 0, marginLeft: 0 },
      };
      ctx.storeA.insertBlockAfter(cellBlock.id, newBlock);

      // Client B: insert text into the same cell block
      ctx.storeB.insertText(cellBlock.id, 5, 'World');

      await ctx.sync();

      const docA = ctx.storeA.getDocument();
      const docB = ctx.storeB.getDocument();

      // Both clients should see 2 blocks in the cell
      const cellA = docA.blocks[0].tableData!.rows[0].cells[0];
      const cellB = docB.blocks[0].tableData!.rows[0].cells[0];
      assert.equal(cellA.blocks.length, 2, `Cell should have 2 blocks, got ${cellA.blocks.length}`);
      assert.equal(cellB.blocks.length, 2, `Cell should have 2 blocks, got ${cellB.blocks.length}`);

      // Original block should have both original text and inserted text
      const origTextA = cellA.blocks[0].inlines.map((i) => i.text).join('');
      assert.ok(origTextA.includes('Hello'), `Original text should be preserved, got "${origTextA}"`);
      assert.ok(origTextA.includes('World'), `Inserted text should be preserved, got "${origTextA}"`);

      // New block should be present
      const newBlockTextA = cellA.blocks[1].inlines.map((i) => i.text).join('');
      assert.equal(newBlockTextA, 'NewBlock', `New block text should be preserved, got "${newBlockTextA}"`);

      // Both clients should converge
      assert.deepEqual(
        cellA.blocks.map((b) => b.inlines.map((i) => i.text).join('')),
        cellB.blocks.map((b) => b.inlines.map((i) => i.text).join('')),
        'Cell blocks should converge across clients',
      );
    } finally {
      await ctx.cleanup();
    }
  });
```

- [ ] **Step 2: Run concurrent integration test**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflebase && YORKIE_RPC_ADDR=http://localhost:8080 pnpm frontend test:integration -- --test-name-pattern "insertBlockAfter in cell"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/tests/app/docs/yorkie-doc-store-concurrent.integration.ts
git commit -m $'Add concurrent integration test for cell block insert + text edit\n\nVerifies that insertBlockAfter in a cell and concurrent text insert\nin the same cell both converge correctly via Yorkie CRDT.'
```

---

### Task 5: Mark Phase 8 shipped in design doc

**Files:**
- Modify: `docs/design/docs/docs-intent-preserving-edits.md`

- [ ] **Step 1: Update Phase 8 status**

In `docs/design/docs/docs-intent-preserving-edits.md`, change:

```text
| 8 | Cell structural edits (editByPath) | In Progress |
```

to:

```text
| 8 | Cell structural edits (editByPath) | ✅ Shipped |
```

- [ ] **Step 2: Run full verify**

Run: `cd /Users/hackerwins/Development/wafflebase/wafflebase && pnpm verify:fast`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/design/docs/docs-intent-preserving-edits.md
git commit -m 'Mark Phase 8 (cell structural edits) as shipped'
```
