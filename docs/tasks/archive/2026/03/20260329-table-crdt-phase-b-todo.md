# Table CRDT Phase B: Unified Editing Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `cellAddress` from `DocPosition` and eliminate all `*InCell` methods so cell blocks are addressed by `blockId` alone, unifying the editing pipeline.

**Architecture:** Three layers of change: (1) `BlockParentMap` — reverse lookup from cell block ID to parent table/cell, built during layout, (2) `Doc` class — extend `getBlock`/`splitBlock`/`mergeBlocks` to handle cell blocks, remove `*InCell` methods, (3) Editor/TextEditor — replace `cellAddress` branches with `BlockParentMap` queries. Bottom-up approach: model first, then editor, using type errors to find all call sites.

**Tech Stack:** TypeScript, Vitest, Canvas layout

**Spec:** [docs/design/docs/docs-table-crdt.md](../../../../design/docs/docs-table-crdt.md) — Phase B section

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/docs/src/model/types.ts` | Add `BlockCellInfo`, remove `cellAddress`/`cellBlockIndex` from `DocPosition` and `SearchMatch` |
| Modify | `packages/docs/src/model/document.ts` | Extend `getBlock`/`splitBlock`/`mergeBlocks` for cell blocks, remove `*InCell` methods |
| Modify | `packages/docs/src/view/table-layout.ts` | Build `BlockParentMap` during `computeTableLayout`, export from `LayoutTable` |
| Modify | `packages/docs/src/view/layout.ts` | Add `blockParentMap` to `DocumentLayout` |
| Modify | `packages/docs/src/view/text-editor.ts` | Replace all `cellAddress` branches with `BlockParentMap` lookups |
| Modify | `packages/docs/src/view/editor.ts` | Replace all `cellAddress` branches with `BlockParentMap` lookups |
| Modify | `packages/docs/src/view/selection.ts` | Remove `cellAddress` branches from `normalizeRange` and `buildRects` |
| Modify | `packages/docs/src/view/find-replace.ts` | Remove `cellAddress` branch from `replaceMatch` |
| Modify | `packages/docs/src/view/peer-cursor.ts` | Remove `cellAddress` branch from `resolvePositionPixel` |
| Modify | `packages/docs/src/index.ts` | Export `BlockCellInfo` |
| Modify | `packages/docs/test/model/table.test.ts` | Update tests for unified API |
| Modify | `packages/docs/test/view/table-layout.test.ts` | Add `BlockParentMap` tests |
| Modify | `packages/docs/test/view/table-selection.test.ts` | Update selection tests |

---

### Task 1: Add `BlockCellInfo` type and `BlockParentMap` to layout

**Files:**
- Modify: `packages/docs/src/model/types.ts`
- Modify: `packages/docs/src/view/table-layout.ts`
- Modify: `packages/docs/src/view/layout.ts`

- [ ] **Step 1: Add `BlockCellInfo` type to `types.ts`**

Add after the `CellAddress` interface (around line 287):

```typescript
/**
 * Reverse lookup: maps a cell-internal block ID to its parent table/cell.
 */
export interface BlockCellInfo {
  tableBlockId: string;
  rowIndex: number;
  colIndex: number;
}
```

- [ ] **Step 2: Add `blockParentMap` to `LayoutTable`**

In `packages/docs/src/view/table-layout.ts`, update the `LayoutTable` interface (line 15):

```typescript
export interface LayoutTable {
  cells: LayoutTableCell[][]; // [row][col]
  columnXOffsets: number[];
  columnPixelWidths: number[];
  rowYOffsets: number[];
  rowHeights: number[];
  totalWidth: number;
  totalHeight: number;
  blockParentMap: Map<string, BlockCellInfo>;
}
```

Add import at line 1:

```typescript
import type { TableData, Inline, Block, BlockCellInfo } from '../model/types.js';
```

- [ ] **Step 3: Build `BlockParentMap` in `computeTableLayout`**

In `computeTableLayout` (line 199), add a `tableBlockId` parameter and build the map. Change the signature:

```typescript
export function computeTableLayout(
  tableData: TableData,
  tableBlockId: string,
  ctx: CanvasRenderingContext2D,
  contentWidth: number,
): LayoutTable {
```

Before the return statement (around line 310), add:

```typescript
  // 7. Build BlockParentMap
  const blockParentMap = new Map<string, BlockCellInfo>();
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cell = rows[r]?.cells[c];
      if (!cell || (cell.colSpan === 0)) continue;
      for (const block of cell.blocks) {
        blockParentMap.set(block.id, { tableBlockId, rowIndex: r, colIndex: c });
      }
    }
  }
```

Include `blockParentMap` in the return object.

- [ ] **Step 4: Add `blockParentMap` to `DocumentLayout`**

In `packages/docs/src/view/layout.ts` (line 96):

```typescript
export interface DocumentLayout {
  blocks: LayoutBlock[];
  totalHeight: number;
  blockParentMap: Map<string, BlockCellInfo>;
}
```

Add import:

```typescript
import type { BlockCellInfo } from '../model/types.js';
```

- [ ] **Step 5: Fix all callers of `computeTableLayout` to pass `tableBlockId`**

Search for `computeTableLayout(` calls — they need the new parameter. The main caller is in the layout computation code. Add `block.id` as the second argument.

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | head -30`

Fix all callers that construct `DocumentLayout` to include `blockParentMap`. Merge all per-table maps into one document-level map.

- [ ] **Step 6: Export `BlockCellInfo` from `index.ts`**

Add `BlockCellInfo` to the exports in `packages/docs/src/index.ts`.

- [ ] **Step 7: Verify it compiles**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: 0 errors (this is an additive change).

- [ ] **Step 8: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/src/view/table-layout.ts packages/docs/src/view/layout.ts packages/docs/src/index.ts
git commit --no-verify -m "feat(docs): add BlockParentMap built during table layout"
```

---

### Task 2: Extend `Doc` to find and update cell blocks by ID

**Files:**
- Modify: `packages/docs/src/model/document.ts`

The `Doc` class needs a `BlockParentMap` reference so `getBlock()` can find cell blocks. Since `BlockParentMap` is built during layout (view layer), `Doc` (model layer) needs it injected.

- [ ] **Step 1: Add `blockParentMap` setter to `Doc`**

Add after line 54 in `document.ts`:

```typescript
  private _blockParentMap: Map<string, import('./types.js').BlockCellInfo> = new Map();

  /**
   * Set the block parent map (built during layout).
   * Enables getBlock() to find cell-internal blocks.
   */
  setBlockParentMap(map: Map<string, import('./types.js').BlockCellInfo>): void {
    this._blockParentMap = map;
  }

  get blockParentMap(): Map<string, import('./types.js').BlockCellInfo> {
    return this._blockParentMap;
  }
```

- [ ] **Step 2: Extend `getBlock()` to find cell blocks**

Replace `getBlock` (line 68):

```typescript
  getBlock(blockId: string): Block {
    const block = this._document.blocks.find((b) => b.id === blockId);
    if (block) return block;

    // Cell block lookup via BlockParentMap
    const cellInfo = this._blockParentMap.get(blockId);
    if (cellInfo) {
      const tableBlock = this._document.blocks.find((b) => b.id === cellInfo.tableBlockId);
      if (tableBlock?.tableData) {
        const cell = tableBlock.tableData.rows[cellInfo.rowIndex]?.cells[cellInfo.colIndex];
        const found = cell?.blocks.find((b) => b.id === blockId);
        if (found) return found;
      }
    }

    throw new Error(`Block not found: ${blockId}`);
  }
```

- [ ] **Step 3: Add `getParentTableBlock` helper**

Add after `getBlock`:

```typescript
  /**
   * If blockId is inside a table cell, return the parent table block.
   * Returns undefined for top-level blocks.
   */
  getParentTableBlock(blockId: string): Block | undefined {
    const cellInfo = this._blockParentMap.get(blockId);
    if (!cellInfo) return undefined;
    return this._document.blocks.find((b) => b.id === cellInfo.tableBlockId);
  }
```

- [ ] **Step 4: Extend `splitBlock` to handle cell blocks**

The current `splitBlock` (line 165) uses `this.getBlockIndex(blockId)` and `this.store.insertBlock()` which only work on top-level blocks. Add cell-block handling at the top of the method:

```typescript
  splitBlock(blockId: string, offset: number): string {
    // Cell block: split within the cell's blocks array
    const cellInfo = this._blockParentMap.get(blockId);
    if (cellInfo) {
      return this.splitBlockInCellInternal(cellInfo, blockId, offset);
    }

    // Existing top-level logic unchanged...
    const blockIndex = this.getBlockIndex(blockId);
    // ... rest of existing code
  }

  /**
   * Split a block inside a table cell. Returns the new block's ID.
   */
  private splitBlockInCellInternal(
    cellInfo: import('./types.js').BlockCellInfo,
    blockId: string,
    offset: number,
  ): string {
    const tableBlock = this.getBlock(cellInfo.tableBlockId);
    const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
    const cellBlockIndex = cell.blocks.findIndex((b) => b.id === blockId);
    const targetBlock = cell.blocks[cellBlockIndex];
    if (!targetBlock) return blockId;

    const blockText = getBlockText(targetBlock);

    // Empty list-item: exit list by converting to paragraph
    if (targetBlock.type === 'list-item' && blockText.length === 0) {
      targetBlock.type = 'paragraph';
      delete targetBlock.listKind;
      delete targetBlock.listLevel;
      this.store.updateBlock(cellInfo.tableBlockId, tableBlock);
      this.refresh();
      return blockId;
    }

    const beforeInlines = this.buildInlinesFromSplit(targetBlock, 0, offset);
    const afterInlines = this.buildInlinesFromSplit(targetBlock, offset, blockText.length);
    const cursorStyle = this.getStyleAtOffset(targetBlock, offset);

    targetBlock.inlines = beforeInlines.length > 0
      ? beforeInlines
      : [{ text: '', style: cursorStyle }];

    let newType: BlockType = 'paragraph';
    const extra: Partial<Block> = {};
    if (targetBlock.type === 'list-item') {
      newType = 'list-item';
      extra.listKind = targetBlock.listKind;
      extra.listLevel = targetBlock.listLevel;
    }

    const newBlock: Block = {
      id: generateBlockId(),
      type: newType,
      inlines: afterInlines.length > 0
        ? afterInlines
        : [{ text: '', style: cursorStyle }],
      style: { ...targetBlock.style },
      ...extra,
    };

    cell.blocks.splice(cellBlockIndex + 1, 0, newBlock);
    this.store.updateBlock(cellInfo.tableBlockId, tableBlock);
    this.refresh();
    return newBlock.id;
  }
```

- [ ] **Step 5: Extend `mergeBlocks` to handle cell blocks**

Add cell handling at the top of `mergeBlocks` (line 234):

```typescript
  mergeBlocks(blockId: string, nextBlockId: string): void {
    // Cell block: merge within cell's blocks array
    const cellInfo = this._blockParentMap.get(blockId);
    if (cellInfo) {
      const tableBlock = this.getBlock(cellInfo.tableBlockId);
      const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
      const idx = cell.blocks.findIndex((b) => b.id === blockId);
      const nextIdx = cell.blocks.findIndex((b) => b.id === nextBlockId);
      if (idx === -1 || nextIdx === -1) return;

      const block = cell.blocks[idx];
      const nextBlock = cell.blocks[nextIdx];
      block.inlines = this.normalizeInlinesArray([...block.inlines, ...nextBlock.inlines]);
      cell.blocks.splice(nextIdx, 1);
      this.store.updateBlock(cellInfo.tableBlockId, tableBlock);
      this.refresh();
      return;
    }

    // Existing top-level logic unchanged...
    const block = this.getBlock(blockId);
    // ... rest of existing code
  }
```

- [ ] **Step 6: Extend `insertText` and `deleteText` for cell blocks**

These methods call `this.getBlock(pos.blockId)` which now finds cell blocks. But they also call `this.store.updateBlock(pos.blockId, block)` — for cell blocks, we need to update the parent table block instead.

Add a private helper:

```typescript
  /**
   * Update a block through the store. For cell blocks, updates the parent table block.
   */
  private updateBlockInStore(blockId: string, block: Block): void {
    const cellInfo = this._blockParentMap.get(blockId);
    if (cellInfo) {
      // Cell block: find and update the parent table block
      const tableBlock = this._document.blocks.find((b) => b.id === cellInfo.tableBlockId);
      if (tableBlock) {
        this.store.updateBlock(cellInfo.tableBlockId, tableBlock);
      }
    } else {
      this.store.updateBlock(blockId, block);
    }
  }
```

Then replace `this.store.updateBlock(pos.blockId, block)` with `this.updateBlockInStore(pos.blockId, block)` in:
- `insertText` (line 90)
- `deleteText` (line 123)

- [ ] **Step 7: Extend remaining Doc methods for cell blocks**

Update `this.store.updateBlock` calls to use `this.updateBlockInStore` in:
- `applyBlockStyle` (line 283)
- `setBlockType` (line 337)

For `applyInlineStyle` (line 249), it iterates top-level blocks by index. Cell blocks need different handling — when the range is within a single cell block, apply directly:

```typescript
  applyInlineStyle(range: DocRange, style: Partial<InlineStyle>): void {
    const anchorCellInfo = this._blockParentMap.get(range.anchor.blockId);
    const focusCellInfo = this._blockParentMap.get(range.focus.blockId);

    // Same cell block or same top-level block — simple case
    if (range.anchor.blockId === range.focus.blockId) {
      const block = this.getBlock(range.anchor.blockId);
      const [start, end] = range.anchor.offset <= range.focus.offset
        ? [range.anchor.offset, range.focus.offset]
        : [range.focus.offset, range.anchor.offset];
      if (start < end) {
        this.applyStyleToBlock(block, start, end, style);
        this.updateBlockInStore(block.id, block);
      }
      this.refresh();
      return;
    }

    // Cross-block within same cell
    if (anchorCellInfo && focusCellInfo &&
        anchorCellInfo.tableBlockId === focusCellInfo.tableBlockId &&
        anchorCellInfo.rowIndex === focusCellInfo.rowIndex &&
        anchorCellInfo.colIndex === focusCellInfo.colIndex) {
      const tableBlock = this.getBlock(anchorCellInfo.tableBlockId);
      const cell = tableBlock.tableData!.rows[anchorCellInfo.rowIndex].cells[anchorCellInfo.colIndex];
      const anchorIdx = cell.blocks.findIndex((b) => b.id === range.anchor.blockId);
      const focusIdx = cell.blocks.findIndex((b) => b.id === range.focus.blockId);
      const [fromIdx, toIdx, from, to] = anchorIdx <= focusIdx
        ? [anchorIdx, focusIdx, range.anchor, range.focus]
        : [focusIdx, anchorIdx, range.focus, range.anchor];

      for (let i = fromIdx; i <= toIdx; i++) {
        const block = cell.blocks[i];
        const blockLen = getBlockTextLength(block);
        const start = i === fromIdx ? from.offset : 0;
        const end = i === toIdx ? to.offset : blockLen;
        if (start < end) {
          this.applyStyleToBlock(block, start, end, style);
        }
      }
      this.store.updateBlock(anchorCellInfo.tableBlockId, tableBlock);
      this.refresh();
      return;
    }

    // Existing top-level cross-block logic
    const startBlock = this.getBlockIndex(range.anchor.blockId);
    const endBlock = this.getBlockIndex(range.focus.blockId);
    const [from, to] =
      startBlock < endBlock ||
      (startBlock === endBlock && range.anchor.offset <= range.focus.offset)
        ? [range.anchor, range.focus]
        : [range.focus, range.anchor];

    const fromBlockIdx = this.getBlockIndex(from.blockId);
    const toBlockIdx = this.getBlockIndex(to.blockId);

    for (let i = fromBlockIdx; i <= toBlockIdx; i++) {
      const block = this._document.blocks[i];
      const blockLen = getBlockTextLength(block);
      const start = i === fromBlockIdx ? from.offset : 0;
      const end = i === toBlockIdx ? to.offset : blockLen;
      if (start >= end) continue;
      this.applyStyleToBlock(block, start, end, style);
      this.store.updateBlock(block.id, block);
    }
    this.refresh();
  }
```

- [ ] **Step 8: Verify it compiles**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: 0 (the `*InCell` methods still exist, just also the new paths).

- [ ] **Step 9: Commit**

```bash
git add packages/docs/src/model/document.ts
git commit --no-verify -m "feat(docs): extend Doc methods to handle cell blocks via BlockParentMap"
```

---

### Task 3: Update `searchText` and `FindReplaceState` for cell block IDs

**Files:**
- Modify: `packages/docs/src/model/document.ts`
- Modify: `packages/docs/src/view/find-replace.ts`

- [ ] **Step 1: Update `searchText` to use cell block IDs**

In `document.ts`, change the table branch of `searchText` (line 391) to emit `blockId: cellBlock.id` instead of `blockId: block.id` with `cellAddress`:

```typescript
      if (block.type === 'table' && block.tableData) {
        for (let r = 0; r < block.tableData.rows.length; r++) {
          const row = block.tableData.rows[r];
          for (let c = 0; c < row.cells.length; c++) {
            const cell = row.cells[c];
            for (let bi = 0; bi < cell.blocks.length; bi++) {
              const cellBlock = cell.blocks[bi];
              const text = getBlockText(cellBlock);
              pattern.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = pattern.exec(text)) !== null) {
                if (match[0].length === 0) {
                  pattern.lastIndex++;
                  continue;
                }
                matches.push({
                  blockId: cellBlock.id,
                  startOffset: match.index,
                  endOffset: match.index + match[0].length,
                });
              }
            }
          }
        }
```

- [ ] **Step 2: Simplify `FindReplaceState.replaceMatch`**

In `find-replace.ts` (line 78), remove the `cellAddress` branch:

```typescript
  private replaceMatch(match: SearchMatch, replacement: string): void {
    this.doc.deleteText(
      { blockId: match.blockId, offset: match.startOffset },
      match.endOffset - match.startOffset,
    );
    this.doc.insertText(
      { blockId: match.blockId, offset: match.startOffset },
      replacement,
    );
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/src/view/find-replace.ts
git commit --no-verify -m "refactor(docs): use cell block IDs in search/replace instead of cellAddress"
```

---

### Task 4: Remove `cellAddress`/`cellBlockIndex` from `DocPosition` and `SearchMatch`

**Files:**
- Modify: `packages/docs/src/model/types.ts`

This will cause type errors everywhere `cellAddress` is used — those errors guide the remaining tasks.

- [ ] **Step 1: Remove fields from `DocPosition`**

Change `DocPosition` (line 83):

```typescript
export interface DocPosition {
  blockId: string;
  offset: number;
}
```

- [ ] **Step 2: Remove fields from `SearchMatch`**

Change `SearchMatch` (line 348):

```typescript
export interface SearchMatch {
  blockId: string;
  startOffset: number;
  endOffset: number;
}
```

- [ ] **Step 3: Count type errors**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Note the count — Tasks 5–9 will fix all of them.

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/model/types.ts
git commit --no-verify -m "refactor(docs): remove cellAddress and cellBlockIndex from DocPosition/SearchMatch"
```

---

### Task 5: Remove `*InCell` methods from `Doc`

**Files:**
- Modify: `packages/docs/src/model/document.ts`

- [ ] **Step 1: Delete all `*InCell` methods**

Remove these methods entirely:
- `insertTextInCell` (lines 453-473)
- `deleteTextInCell` (lines 478-515)
- `applyCellInlineStyle` (lines 520-540)
- `applyBlockStyleInCell` (lines 290-303)
- `splitBlockInCell` (lines 546-600)
- `mergeBlocksInCell` (lines 606-625)
- `getCellBlockTextLength` (lines 630-640)
- `setBlockTypeInCell` (lines 645-681)
- `getTableCell` helper (lines 1025-1028)

Also remove the `CellAddress` import if no longer needed by remaining methods (check `mergeCells`/`splitCell` still use it).

- [ ] **Step 2: Check compilation — note remaining errors**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: Errors in editor.ts, text-editor.ts, selection.ts, peer-cursor.ts, and test files.

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/model/document.ts
git commit --no-verify -m "refactor(docs): remove *InCell methods from Doc class"
```

---

### Task 6: Update `peer-cursor.ts` and `selection.ts`

**Files:**
- Modify: `packages/docs/src/view/peer-cursor.ts`
- Modify: `packages/docs/src/view/selection.ts`

- [ ] **Step 1: Update `resolvePositionPixel` in `peer-cursor.ts`**

The current code (line 46) checks `position.cellAddress` to find the table cell for cursor rendering. Replace with `BlockParentMap` lookup:

```typescript
  // --- Table cell cursor ---
  const cellInfo = layout.blockParentMap.get(position.blockId);
  if (cellInfo) {
    const tableLb = layout.blocks.find((b) => b.block.id === cellInfo.tableBlockId);
    if (!tableLb?.layoutTable) return undefined;
    const tl = tableLb.layoutTable;
    const { rowIndex, colIndex } = cellInfo;
    const cell = tl.cells[rowIndex]?.[colIndex];
    if (!cell || cell.merged) return undefined;

    const cellPadding = tableLb.block.tableData?.rows[rowIndex]?.cells[colIndex]?.style.padding ?? 4;

    // Find which cell block this position belongs to
    const tableCell = tableLb.block.tableData!.rows[rowIndex].cells[colIndex];
    const cbi = tableCell.blocks.findIndex((b) => b.id === position.blockId);
    const startLine = cell.blockBoundaries[cbi] ?? 0;
    const endLine = cell.blockBoundaries[cbi + 1] ?? cell.lines.length;
```

The rest of the pixel resolution logic remains the same, but references to `position.cellAddress` become `cellInfo` fields, and `position.cellBlockIndex` becomes the computed `cbi`.

Update the `lb` variable to use `tableLb` (the table's LayoutBlock instead of looking up by `position.blockId` which is now a cell block ID not in layout.blocks directly).

- [ ] **Step 2: Update `normalizeRange` in `selection.ts`**

In `selection.ts` (line 46), replace the `cellAddress` branch. The new logic: if both positions are cell blocks in the same cell, compare by cell block index then offset:

```typescript
  // Cell-internal selection: both positions in same cell
  const anchorCell = layout.blockParentMap.get(range.anchor.blockId);
  const focusCell = layout.blockParentMap.get(range.focus.blockId);
  if (anchorCell && focusCell &&
      anchorCell.tableBlockId === focusCell.tableBlockId &&
      anchorCell.rowIndex === focusCell.rowIndex &&
      anchorCell.colIndex === focusCell.colIndex) {
    const tableBlock = layout.blocks.find((b) => b.block.id === anchorCell.tableBlockId);
    const cell = tableBlock?.block.tableData?.rows[anchorCell.rowIndex]?.cells[anchorCell.colIndex];
    if (cell) {
      const aIdx = cell.blocks.findIndex((b) => b.id === range.anchor.blockId);
      const fIdx = cell.blocks.findIndex((b) => b.id === range.focus.blockId);
      if (aIdx < fIdx || (aIdx === fIdx && range.anchor.offset <= range.focus.offset)) {
        return { start: range.anchor, end: range.focus };
      }
      return { start: range.focus, end: range.anchor };
    }
  }
```

Note: `normalizeRange` needs the `layout` parameter added — check current signature and add `DocumentLayout` if not present.

- [ ] **Step 3: Update `buildRects` in `selection.ts`**

Replace the `cellAddress` branch (line 147). The new logic checks if positions are cell blocks via `blockParentMap`:

```typescript
  const startCell = layout.blockParentMap.get(start.blockId);
  const endCell = layout.blockParentMap.get(end.blockId);
  if (startCell && endCell &&
      startCell.tableBlockId === endCell.tableBlockId &&
      startCell.rowIndex === endCell.rowIndex &&
      startCell.colIndex === endCell.colIndex) {
    // Cell-internal selection — same logic as before but without cellAddress
    const startPixel = resolvePositionPixel(start, 'forward', paginatedLayout, layout, ctx, canvasWidth);
    const endPixel = resolvePositionPixel(end, 'backward', paginatedLayout, layout, ctx, canvasWidth);
    // ... rest of multi-line cell selection logic unchanged
  }
```

- [ ] **Step 4: Verify it compiles**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: Errors only in editor.ts, text-editor.ts, and test files.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/peer-cursor.ts packages/docs/src/view/selection.ts
git commit --no-verify -m "refactor(docs): update peer-cursor and selection to use BlockParentMap"
```

---

### Task 7: Update `editor.ts` — remove `cellAddress` branches

**Files:**
- Modify: `packages/docs/src/view/editor.ts`

- [ ] **Step 1: Remove `applyCellStyleToRange` and update callers**

The function `applyCellStyleToRange` (line 157) routes to `doc.applyCellInlineStyle`. Replace callers with `doc.applyInlineStyle(range, style)` directly. Remove the function.

- [ ] **Step 2: Update `applyStyleToCellRange`**

The function `applyStyleToCellRange` (line 179) iterates cells in a range and applies style. This still needs `CellAddress` for the cell range concept, but should use `doc.applyInlineStyle` per cell block instead of `doc.applyCellInlineStyle`:

```typescript
function applyStyleToCellRange(
  cellRange: { blockId: string; start: CellAddress; end: CellAddress },
  style: Partial<InlineStyle>,
): void {
  const block = doc.getBlock(cellRange.blockId);
  if (!block.tableData) return;
  const minRow = Math.min(cellRange.start.rowIndex, cellRange.end.rowIndex);
  const maxRow = Math.max(cellRange.start.rowIndex, cellRange.end.rowIndex);
  const minCol = Math.min(cellRange.start.colIndex, cellRange.end.colIndex);
  const maxCol = Math.max(cellRange.start.colIndex, cellRange.end.colIndex);
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const cell = block.tableData.rows[r]?.cells[c];
      if (!cell || cell.colSpan === 0) continue;
      for (const cellBlock of cell.blocks) {
        const len = getBlockTextLength(cellBlock);
        if (len > 0) {
          doc.applyInlineStyle(
            { anchor: { blockId: cellBlock.id, offset: 0 }, focus: { blockId: cellBlock.id, offset: len } },
            style,
          );
        }
      }
    }
  }
}
```

- [ ] **Step 3: Update `getInlineStyleAtCursor` (line 640)**

Replace `cursor.position.cellAddress` branch:

```typescript
const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
if (cellInfo) {
  const block = doc.getBlock(cursor.position.blockId);
  // ... read style from block.inlines at offset
}
```

- [ ] **Step 4: Update `applyInlineStyle` (line 686)**

Remove `if (anchor.cellAddress)` branch. For cell range mode, use `applyStyleToCellRange`. For normal selection (even within cells), use `doc.applyInlineStyle(range, style)` directly.

- [ ] **Step 5: Update `applyBlockStyle`, `getBlockType`, `setBlockType`, `toggleList`, `indent`, `outdent`**

All follow the same pattern: remove `const ca = cursor.position.cellAddress` branches. The `doc.applyBlockStyle(pos.blockId, style)` and `doc.setBlockType(pos.blockId, type)` now work for cell blocks directly.

- [ ] **Step 6: Update `getCellAddress` API**

Replace `getCellAddress()` to use `BlockParentMap`:

```typescript
getCellAddress(): CellAddress | undefined {
  const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
  if (!cellInfo) return undefined;
  return { rowIndex: cellInfo.rowIndex, colIndex: cellInfo.colIndex };
}
```

- [ ] **Step 7: Update `insertTable` cursor positioning (line 1119)**

Currently sets `cellAddress` on cursor. Change to position cursor at the first block of the first cell:

```typescript
// After inserting table, move cursor to first cell's first block
const tableBlock = doc.getBlock(tableId);
const firstCellBlock = tableBlock.tableData!.rows[0].cells[0].blocks[0];
cursor.moveTo({ blockId: firstCellBlock.id, offset: 0 });
```

- [ ] **Step 8: Update search match highlighting (line 405)**

Remove `cellAddress` and `cellBlockIndex` from match-to-position mapping.

- [ ] **Step 9: Update `addLink` (line 937)**

Remove `cellAddress` branch — `doc.insertText(pos, url)` works for cell blocks now.

- [ ] **Step 10: Verify it compiles**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: Errors only in text-editor.ts and test files.

- [ ] **Step 11: Commit**

```bash
git add packages/docs/src/view/editor.ts
git commit --no-verify -m "refactor(docs): remove cellAddress branches from editor.ts"
```

---

### Task 8: Update `text-editor.ts` — the big one

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

This is the largest change. ~157 `cellAddress` references across ~50 methods. The pattern is consistent: replace `if (cellAddress)` routing with direct calls that work for both top-level and cell blocks.

- [ ] **Step 1: Add `BlockParentMap` accessor**

Add a helper to access the parent map from layout:

```typescript
private getBlockParentMap(): Map<string, BlockCellInfo> {
  return this.getLayout().blockParentMap;
}

private isInCell(blockId: string): boolean {
  return this.getBlockParentMap().has(blockId);
}

private getCellInfo(blockId: string): BlockCellInfo | undefined {
  return this.getBlockParentMap().get(blockId);
}
```

- [ ] **Step 2: Update `handleInput` (line 245)**

Remove the `if (this.cursor.position.cellAddress)` branch. `doc.insertText(pos, text)` now handles cell blocks:

```typescript
// Before:
if (this.cursor.position.cellAddress) {
  doc.insertTextInCell(pos.blockId, pos.cellAddress!, pos.offset, processed, cbi);
} else {
  doc.insertText(pos, processed);
}

// After:
doc.insertText(pos, processed);
```

Apply this pattern to all text input routing in `handleInput`.

- [ ] **Step 3: Update `handleCompositionEnd` (line 190)**

Same pattern — remove cell branches for delete/insert:

```typescript
// Before:
if (ca) {
  doc.deleteTextInCell(...);
} else {
  doc.deleteText(...);
}
// After:
doc.deleteText(startPosition, deleteLen);
```

- [ ] **Step 4: Update `applyHangulResult` (line 2881)**

Same pattern — remove all `cellAddress` branches.

- [ ] **Step 5: Update `handleBackspace` (line 1010)**

Replace `if (this.cursor.position.cellAddress)` block:

```typescript
const pos = this.cursor.position;
const cellInfo = this.getCellInfo(pos.blockId);

if (pos.offset > 0) {
  this.saveSnapshot();
  doc.deleteText({ blockId: pos.blockId, offset: pos.offset - 1 }, 1);
  this.cursor.moveTo({ blockId: pos.blockId, offset: pos.offset - 1 });
} else if (cellInfo) {
  // At start of a cell block — try to merge with previous block in same cell
  const tableBlock = doc.getBlock(cellInfo.tableBlockId);
  const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
  const blockIdx = cell.blocks.findIndex((b) => b.id === pos.blockId);
  if (blockIdx > 0) {
    const prevBlock = cell.blocks[blockIdx - 1];
    const prevLen = getBlockTextLength(prevBlock);
    this.saveSnapshot();
    doc.mergeBlocks(prevBlock.id, pos.blockId);
    this.invalidateLayout();
    this.cursor.moveTo({ blockId: prevBlock.id, offset: prevLen });
  }
  // At first block of cell: no-op
} else {
  // Existing top-level backspace-at-start logic (merge with previous block)
  // ... unchanged
}
```

- [ ] **Step 6: Update `handleDelete` (line 1058)**

Same pattern as backspace but forward:

```typescript
const pos = this.cursor.position;
const cellInfo = this.getCellInfo(pos.blockId);
const block = doc.getBlock(pos.blockId);
const textLen = getBlockTextLength(block);

if (pos.offset < textLen) {
  this.saveSnapshot();
  doc.deleteText(pos, 1);
} else if (cellInfo) {
  // At end of a cell block — try to merge next block into this one
  const tableBlock = doc.getBlock(cellInfo.tableBlockId);
  const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
  const blockIdx = cell.blocks.findIndex((b) => b.id === pos.blockId);
  if (blockIdx < cell.blocks.length - 1) {
    this.saveSnapshot();
    doc.mergeBlocks(pos.blockId, cell.blocks[blockIdx + 1].id);
    this.invalidateLayout();
  }
  // At last block of cell: no-op
} else {
  // Existing top-level delete-at-end logic
  // ... unchanged
}
```

- [ ] **Step 7: Update `handleEnter` (line 1146)**

Replace cell branch:

```typescript
const pos = this.cursor.position;
const cellInfo = this.getCellInfo(pos.blockId);
this.saveSnapshot();
const newBlockId = doc.splitBlock(pos.blockId, pos.offset);
this.invalidateLayout();
this.cursor.moveTo({ blockId: newBlockId, offset: 0 });
```

`splitBlock` now handles cell blocks internally. No special cell branch needed.

- [ ] **Step 8: Update `handleArrow` (line 1421)**

The arrow handler has complex cell navigation logic. Replace `if (pos.cellAddress)`:

```typescript
const cellInfo = this.getCellInfo(pos.blockId);
if (cellInfo) {
  // Arrow navigation within/across cells — use BlockParentMap
  // Left at block start: previous cell block or previous cell
  // Right at block end: next cell block or next cell
  // Up/Down: resolve at same X in adjacent row
  // ... use cellInfo + tableBlock.tableData for navigation
}
```

The navigation logic is largely the same but uses `cellInfo` instead of `pos.cellAddress`. Key changes:
- `pos.cellAddress.rowIndex` → `cellInfo.rowIndex`
- `pos.cellAddress.colIndex` → `cellInfo.colIndex`
- Position construction drops `cellAddress` field
- Next/prev cell block lookup uses `cell.blocks` array by finding current block index

- [ ] **Step 9: Update `handleMouseDown` (line 775)**

Replace `resolveTableCellClick` → `cellAddress` flow. The new flow:
1. `resolveTableCellClick` returns `{ blockId, offset }` (cell block's ID) instead of `CellAddress`
2. Cursor moves to `{ blockId: cellBlockId, offset }`

Update `resolveTableCellClick` to return `DocPosition | undefined`:

```typescript
private resolveTableCellClick(
  blockId: string,
  localX: number,
  localY: number,
): DocPosition | undefined {
  const block = this.doc.document.blocks.find((b) => b.id === blockId);
  if (!block || block.type !== 'table' || !block.tableData) return undefined;
  const layout = this.getLayout();
  const lb = layout.blocks.find((b) => b.block.id === blockId);
  if (!lb?.layoutTable) return undefined;
  const tl = lb.layoutTable;

  // Find row and column (same logic as before)
  let rowIndex = tl.rowHeights.length - 1;
  for (let r = 0; r < tl.rowYOffsets.length; r++) {
    if (localY < tl.rowYOffsets[r] + tl.rowHeights[r]) { rowIndex = r; break; }
  }
  let colIndex = tl.columnPixelWidths.length - 1;
  for (let c = 0; c < tl.columnXOffsets.length; c++) {
    if (localX < tl.columnXOffsets[c] + tl.columnPixelWidths[c]) { colIndex = c; break; }
  }

  // Handle merged cells (same owner-finding logic)
  const cell = block.tableData.rows[rowIndex]?.cells[colIndex];
  if (cell?.colSpan === 0) {
    // ... find owner cell, update rowIndex/colIndex
  }

  // Return position at first block of the target cell
  const targetCell = block.tableData.rows[rowIndex]?.cells[colIndex];
  if (!targetCell || targetCell.blocks.length === 0) return undefined;
  return { blockId: targetCell.blocks[0].id, offset: 0 };
}
```

- [ ] **Step 10: Update `updateDragSelection` (line 875)**

Replace cell branch. Drag within a cell: resolve position using `resolveOffsetInCellAtXY` but return `DocPosition` with cell block ID. Cross-cell drag: set `tableCellRange` using `BlockParentMap` to find cell addresses.

- [ ] **Step 11: Update `moveToNextCell` / `moveToPrevCell`**

These methods use `pos.cellAddress`. Rewrite to accept `BlockCellInfo`:

```typescript
private moveToNextCell(addRowAtEnd = false): boolean {
  const pos = this.cursor.position;
  const cellInfo = this.getCellInfo(pos.blockId);
  if (!cellInfo) return false;
  const tableBlock = this.doc.getBlock(cellInfo.tableBlockId);
  if (!tableBlock.tableData) return false;
  const td = tableBlock.tableData;

  // Try next column, skipping merged cells
  for (let c = cellInfo.colIndex + 1; c < td.columnWidths.length; c++) {
    const cell = td.rows[cellInfo.rowIndex]?.cells[c];
    if (cell && cell.colSpan !== 0) {
      this.cursor.moveTo({ blockId: cell.blocks[0].id, offset: 0 });
      return true;
    }
  }
  // Try next rows
  for (let r = cellInfo.rowIndex + 1; r < td.rows.length; r++) {
    for (let c = 0; c < td.columnWidths.length; c++) {
      const cell = td.rows[r]?.cells[c];
      if (cell && cell.colSpan !== 0) {
        this.cursor.moveTo({ blockId: cell.blocks[0].id, offset: 0 });
        return true;
      }
    }
  }
  // At last cell
  if (addRowAtEnd) {
    this.saveSnapshot();
    const newRowIndex = td.rows.length;
    this.doc.insertRow(cellInfo.tableBlockId, newRowIndex);
    this.invalidateLayout();
    const newCell = this.doc.getBlock(cellInfo.tableBlockId).tableData!.rows[newRowIndex].cells[0];
    this.cursor.moveTo({ blockId: newCell.blocks[0].id, offset: 0 });
    return true;
  }
  // Exit table
  const blockIndex = this.doc.getBlockIndex(cellInfo.tableBlockId);
  const blocks = this.doc.document.blocks;
  if (blockIndex < blocks.length - 1) {
    this.cursor.moveTo({ blockId: blocks[blockIndex + 1].id, offset: 0 });
  }
  return true;
}
```

- [ ] **Step 12: Remove `getCellText`, `getCellTextLength`, `resolveOffsetInCell` helpers**

These helpers use `CellAddress` parameters. Replace their callers with direct block access:
- `getCellText(blockId, cell)` → `getBlockText(doc.getBlock(cellBlockId))`
- `getCellTextLength(blockId, cell)` → `getBlockTextLength(doc.getBlock(cellBlockId))`
- `resolveOffsetInCell` callers should use `resolveOffsetInCellAtXY` adapted to take `BlockCellInfo`

Update `resolveOffsetInCellAtXY` signature to work with `BlockCellInfo` instead of `CellAddress`.

- [ ] **Step 13: Update Tab/Shift+Tab handling (line 1201)**

Tab calls `moveToNextCell(true)`, Shift+Tab calls `moveToPrevCell()`. These now use `BlockParentMap` internally. The call site just needs `cellAddress` removed from the guard:

```typescript
// Before:
if (this.cursor.position.cellAddress) { this.moveToNextCell(true); }

// After:
if (this.isInCell(this.cursor.position.blockId)) { this.moveToNextCell(true); }
```

- [ ] **Step 14: Update block alignment, list toggle, indent/outdent**

All follow the same pattern — remove `cellAddress` guards, use `doc.applyBlockStyle`/`doc.setBlockType` directly.

- [ ] **Step 15: Verify it compiles**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: Errors only in test files.

- [ ] **Step 16: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit --no-verify -m "refactor(docs): remove all cellAddress branches from text-editor.ts"
```

---

### Task 9: Update tests

**Files:**
- Modify: `packages/docs/test/model/table.test.ts`
- Modify: `packages/docs/test/view/table-layout.test.ts`
- Modify: `packages/docs/test/view/table-selection.test.ts`

- [ ] **Step 1: Update `table.test.ts` — remove `*InCell` calls**

Replace all `doc.insertTextInCell(tableId, { rowIndex: r, colIndex: c }, offset, text)` with:

```typescript
const cellBlock = doc.getBlock(tableId).tableData!.rows[r].cells[c].blocks[0];
doc.insertText({ blockId: cellBlock.id, offset }, text);
```

Same for `deleteTextInCell`, `applyCellInlineStyle`, `splitBlockInCell`, `mergeBlocksInCell`, `setBlockTypeInCell`.

Note: Tests need `doc.setBlockParentMap(map)` called with a map built from the table. Add a test helper:

```typescript
function buildParentMap(doc: Doc, tableBlockId: string): Map<string, BlockCellInfo> {
  const map = new Map<string, BlockCellInfo>();
  const block = doc.getBlock(tableBlockId);
  if (!block.tableData) return map;
  for (let r = 0; r < block.tableData.rows.length; r++) {
    for (let c = 0; c < block.tableData.rows[r].cells.length; c++) {
      const cell = block.tableData.rows[r].cells[c];
      for (const b of cell.blocks) {
        map.set(b.id, { tableBlockId, rowIndex: r, colIndex: c });
      }
    }
  }
  return map;
}
```

Call `doc.setBlockParentMap(buildParentMap(doc, tableId))` after creating the table and after operations that add new cell blocks (like `splitBlock`).

- [ ] **Step 2: Update `table-layout.test.ts`**

Add tests for `BlockParentMap` construction:

```typescript
it('computeTableLayout builds blockParentMap', () => {
  const tableData = createTableData(2, 2);
  const result = computeTableLayout(tableData, 'table-1', ctx, 600);
  const map = result.blockParentMap;

  // Each cell's blocks should be in the map
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      for (const block of tableData.rows[r].cells[c].blocks) {
        expect(map.get(block.id)).toEqual({
          tableBlockId: 'table-1',
          rowIndex: r,
          colIndex: c,
        });
      }
    }
  }
});
```

- [ ] **Step 3: Update `table-selection.test.ts`**

Remove `cellAddress` from position construction. Use cell block IDs instead.

- [ ] **Step 4: Run all tests**

Run: `cd packages/docs && npx vitest run`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/test/
git commit -m "test(docs): update table tests for unified editing pipeline"
```

---

### Task 10: Clean up exports and remaining references

**Files:**
- Modify: `packages/docs/src/index.ts`
- Modify: `packages/docs/src/model/types.ts`

- [ ] **Step 1: Clean up unused exports**

Check if `CellAddress` is still needed (yes — used by `TableCellRange`, `mergeCells`, `splitCell`, navigation). Keep it but verify no export references `cellBlockIndex`.

- [ ] **Step 2: Remove stale type references**

Grep for any remaining `cellAddress` or `cellBlockIndex` references outside of the retained `CellAddress` type and `TableCellRange`:

Run: `grep -rn 'cellAddress\|cellBlockIndex' packages/docs/src/ --include='*.ts' | grep -v 'CellAddress' | grep -v 'TableCellRange'`

Fix any remaining references.

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/
git commit -m "refactor(docs): clean up remaining cellAddress references"
```

---

### Task 11: Update frontend callers

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts` (if any cellAddress references)
- Modify: any other frontend files referencing cellAddress

- [ ] **Step 1: Search frontend for cellAddress references**

Run: `grep -rn 'cellAddress\|cellBlockIndex\|InCell' packages/frontend/src/ --include='*.ts' --include='*.tsx'`

Fix any references found.

- [ ] **Step 2: Verify full project compiles**

Run: `cd packages/docs && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/
git commit -m "refactor(frontend): update for cellAddress removal"
```

---

### Task 12: Final verification

- [ ] **Step 1: Run `pnpm verify:fast`**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 2: Run entropy check**

Run: `node scripts/verify-entropy.mjs`
Expected: All checks passed.

- [ ] **Step 3: Verify no cellAddress/cellBlockIndex in DocPosition usage**

Run: `grep -rn 'cellAddress\|cellBlockIndex' packages/docs/src/ packages/frontend/src/ --include='*.ts' --include='*.tsx'`

Expected: Only hits in `CellAddress` type definition, `TableCellRange`, and `BlockCellInfo`-related code. Zero hits in `DocPosition`, `SearchMatch`, or editor routing logic.

- [ ] **Step 4: Manual smoke test**

1. `pnpm dev`, open a Docs document
2. Insert table, type in cells (English + Korean IME)
3. Tab/Shift+Tab between cells
4. Arrow keys within and across cells
5. Enter to split blocks within cell
6. Backspace to merge blocks within cell
7. Select text within cell, apply bold/italic
8. Cell-range selection with Shift+Arrow
9. Find/Replace within table cells
10. Right-click context menu: insert/delete rows/columns
11. Undo/redo all operations
12. Multi-block cell content (lists, headings inside cells)
