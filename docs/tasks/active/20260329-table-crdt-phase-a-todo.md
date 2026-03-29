# Table CRDT Phase A: Data Model + Store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JSON-stringified `tableData` with Yorkie Tree node hierarchy (`row → cell → block → inline → text`) and change `TableCell` from `Inline[]` to `Block[]` containers.

**Architecture:** Three layers of change: (1) data model types — `TableCell.inlines` → `TableCell.blocks`, (2) `Doc` class — replace `*InCell` methods with block-level operations that work on cell blocks, (3) `YorkieDocStore` — serialize/deserialize table as tree nodes instead of JSON attribute. This phase does NOT touch the editor or layout/rendering — those continue to work via a thin adapter that extracts `Inline[]` from the first block in each cell until Phase B updates them.

**Tech Stack:** TypeScript, Vitest, Yorkie Tree CRDT

**Spec:** [docs/design/docs-table-crdt.md](../../design/docs-table-crdt.md)

**Prerequisites:** Merge current `feat/docs-table-support` PR first. Start this work on a new branch.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/docs/src/model/types.ts` | `TableCell.inlines` → `TableCell.blocks`, update factories |
| Modify | `packages/docs/src/model/document.ts` | Remove `*InCell` methods, add cell-block helpers |
| Modify | `packages/docs/src/view/table-layout.ts` | Layout cell blocks instead of cell inlines |
| Modify | `packages/docs/src/view/table-renderer.ts` | Render multi-block cells |
| Modify | `packages/docs/src/index.ts` | Update exports |
| Modify | `packages/frontend/src/app/docs/yorkie-doc-store.ts` | Tree node serialization for tables |
| Modify | `packages/docs/test/model/table.test.ts` | Update tests for new cell model |
| Modify | `packages/docs/test/model/types.test.ts` | Update table type factory tests |
| Modify | `packages/docs/test/view/table-layout.test.ts` | Update layout tests |
| Modify | `packages/docs/test/view/table-selection.test.ts` | Update selection tests |

---

### Task 1: Change `TableCell` from `inlines` to `blocks`

**Files:**
- Modify: `packages/docs/src/model/types.ts`

- [ ] **Step 1: Update `TableCell` interface**

Change:
```typescript
export interface TableCell {
  inlines: Inline[];
  style: CellStyle;
  colSpan?: number;
  rowSpan?: number;
}
```

To:
```typescript
export interface TableCell {
  blocks: Block[];
  style: CellStyle;
  colSpan?: number;
  rowSpan?: number;
}
```

- [ ] **Step 2: Update `createTableCell` factory**

Change:
```typescript
export function createTableCell(): TableCell {
  return {
    inlines: [{ text: '', style: {} }],
    style: { ...DEFAULT_CELL_STYLE },
  };
}
```

To:
```typescript
export function createTableCell(): TableCell {
  return {
    blocks: [{
      id: generateBlockId(),
      type: 'paragraph',
      inlines: [{ text: '', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    }],
    style: { ...DEFAULT_CELL_STYLE },
  };
}
```

- [ ] **Step 3: Add `getCellText` helper function**

Add a utility function to extract text from a cell's blocks (needed during migration of merge/split and tests):

```typescript
/**
 * Get the concatenated text content of a table cell.
 */
export function getCellText(cell: TableCell): string {
  return cell.blocks.flatMap(b => b.inlines).map(i => i.text).join('');
}
```

- [ ] **Step 4: Verify it compiles (expect errors in downstream files)**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: Compilation errors in document.ts, table-layout.ts, table-renderer.ts, and test files referencing `.inlines` on cells. Note the count — all subsequent tasks will fix these.

- [ ] **Step 5: Commit (with `--no-verify` since code won't compile yet)**

```bash
git add packages/docs/src/model/types.ts
git commit --no-verify -m "refactor(docs): change TableCell from inlines to blocks"
```

---

### Task 2: Update `Doc` Table Methods

**Files:**
- Modify: `packages/docs/src/model/document.ts`

The `*InCell` methods operate on `cell.inlines`. They need to operate on the first block in `cell.blocks` instead. Also update `mergeCells`/`splitCell` which reference `cell.inlines`.

- [ ] **Step 1: Update `insertTextInCell` to use cell blocks**

Replace the method to insert text into the first block of the cell:

```typescript
  insertTextInCell(
    blockId: string,
    cell: CellAddress,
    offset: number,
    text: string,
  ): void {
    const block = this.getBlock(blockId);
    const tableCell = this.getTableCell(block, cell);
    const targetBlock = tableCell.blocks[0];
    if (!targetBlock) return;
    const { inlineIndex, charOffset } = this.resolveOffsetInInlines(
      targetBlock.inlines,
      offset,
    );
    const inline = targetBlock.inlines[inlineIndex];
    inline.text =
      inline.text.slice(0, charOffset) + text + inline.text.slice(charOffset);
    this.store.updateBlock(blockId, block);
    this.refresh();
  }
```

- [ ] **Step 2: Update `deleteTextInCell` to use cell blocks**

Replace the method to delete text from the first block of the cell:

```typescript
  deleteTextInCell(
    blockId: string,
    cell: CellAddress,
    offset: number,
    length: number,
  ): void {
    const block = this.getBlock(blockId);
    const tableCell = this.getTableCell(block, cell);
    const targetBlock = tableCell.blocks[0];
    if (!targetBlock) return;
    const totalLen = targetBlock.inlines.reduce((s, i) => s + i.text.length, 0);
    let remaining = Math.min(length, totalLen - offset);
    if (remaining <= 0) return;

    let curOffset = offset;
    while (remaining > 0) {
      const { inlineIndex, charOffset } = this.resolveOffsetInInlines(
        targetBlock.inlines,
        curOffset,
      );
      const inline = targetBlock.inlines[inlineIndex];
      const available = inline.text.length - charOffset;
      if (available <= 0) break;
      const toDelete = Math.min(remaining, available);
      inline.text =
        inline.text.slice(0, charOffset) +
        inline.text.slice(charOffset + toDelete);
      remaining -= toDelete;
      if (inline.text.length === 0 && targetBlock.inlines.length > 1) {
        targetBlock.inlines.splice(inlineIndex, 1);
      }
    }

    targetBlock.inlines = this.normalizeInlinesArray(targetBlock.inlines);
    this.store.updateBlock(blockId, block);
    this.refresh();
  }
```

- [ ] **Step 3: Update `applyCellInlineStyle` to use cell blocks**

```typescript
  applyCellInlineStyle(
    blockId: string,
    cell: CellAddress,
    start: number,
    end: number,
    style: Partial<InlineStyle>,
  ): void {
    const block = this.getBlock(blockId);
    const tableCell = this.getTableCell(block, cell);
    const targetBlock = tableCell.blocks[0];
    if (!targetBlock) return;
    targetBlock.inlines = this.applyStyleToInlines(
      targetBlock.inlines,
      start,
      end,
      style,
    );
    this.store.updateBlock(blockId, block);
    this.refresh();
  }
```

- [ ] **Step 4: Update `mergeCells` to use cell blocks**

Replace `cell.inlines` references with `cell.blocks`:

```typescript
  mergeCells(blockId: string, range: CellRange): void {
    const block = this.getBlock(blockId);
    const td = block.tableData!;
    const { start, end } = range;
    const topLeft = td.rows[start.rowIndex].cells[start.colIndex];

    const rowSpan = end.rowIndex - start.rowIndex + 1;
    const colSpan = end.colIndex - start.colIndex + 1;

    // Collect text from all cells in range (row-major, skip top-left)
    for (let r = start.rowIndex; r <= end.rowIndex; r++) {
      for (let c = start.colIndex; c <= end.colIndex; c++) {
        if (r === start.rowIndex && c === start.colIndex) continue;
        const cell = td.rows[r].cells[c];
        const cellText = getCellText(cell);
        if (cellText.length > 0) {
          // Append non-empty inlines from the first block to top-left's first block
          const srcBlock = cell.blocks[0];
          if (srcBlock) {
            topLeft.blocks[0].inlines.push(
              ...srcBlock.inlines.filter((i) => i.text.length > 0),
            );
          }
        }
        // Mark as covered
        cell.blocks = [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }];
        cell.colSpan = 0;
        cell.rowSpan = undefined;
      }
    }

    topLeft.blocks[0].inlines = this.normalizeInlinesArray(topLeft.blocks[0].inlines);
    topLeft.colSpan = colSpan;
    topLeft.rowSpan = rowSpan;
    this.store.updateBlock(blockId, block);
    this.refresh();
  }
```

- [ ] **Step 5: Update `splitCell` to use cell blocks**

```typescript
  splitCell(blockId: string, cell: CellAddress): void {
    const block = this.getBlock(blockId);
    const td = block.tableData!;
    const target = td.rows[cell.rowIndex].cells[cell.colIndex];
    const rowSpan = target.rowSpan ?? 1;
    const colSpan = target.colSpan ?? 1;

    delete target.colSpan;
    delete target.rowSpan;

    for (let r = cell.rowIndex; r < cell.rowIndex + rowSpan; r++) {
      for (let c = cell.colIndex; c < cell.colIndex + colSpan; c++) {
        if (r === cell.rowIndex && c === cell.colIndex) continue;
        const covered = td.rows[r].cells[c];
        delete covered.colSpan;
        delete covered.rowSpan;
        covered.blocks = [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }];
      }
    }

    this.store.updateBlock(blockId, block);
    this.refresh();
  }
```

- [ ] **Step 6: Add imports**

At the top of `document.ts`, ensure `getCellText`, `generateBlockId`, `DEFAULT_BLOCK_STYLE` are imported from `types.ts`.

- [ ] **Step 7: Verify it compiles (fewer errors now)**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: Errors now only in table-layout.ts, table-renderer.ts, and test files.

- [ ] **Step 8: Commit**

```bash
git add packages/docs/src/model/document.ts
git commit --no-verify -m "refactor(docs): update Doc table methods for block-based cells"
```

---

### Task 3: Update Table Layout for Block-Based Cells

**Files:**
- Modify: `packages/docs/src/view/table-layout.ts`

The `layoutCellInlines` function takes `Inline[]`. Update to take a cell's `Block[]` and lay out each block's inlines sequentially.

- [ ] **Step 1: Rename and update `layoutCellInlines` to `layoutCellBlocks`**

```typescript
import type { TableData, Block } from '../model/types.js';

/**
 * Layout blocks within a table cell into wrapped lines.
 */
function layoutCellBlocks(
  blocks: Block[],
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): LayoutLine[] {
  if (blocks.length === 0) {
    const defaultHeight = ptToPx(Theme.defaultFontSize) * 1.5;
    return [{ runs: [], y: 0, height: defaultHeight, width: 0 }];
  }

  const allLines: LayoutLine[] = [];

  for (const block of blocks) {
    const blockLines = layoutCellInlines(block.inlines, ctx, maxWidth);
    allLines.push(...blockLines);
  }

  // Recalculate cumulative y offsets
  let y = 0;
  for (const line of allLines) {
    line.y = y;
    y += line.height;
  }

  return allLines;
}
```

Keep the existing `layoutCellInlines` function as-is (it's now a private helper called by `layoutCellBlocks`).

- [ ] **Step 2: Update `computeTableLayout` to use `layoutCellBlocks`**

Change line 184:
```typescript
// Before
const lines = layoutCellInlines(cell?.inlines ?? [], ctx, innerWidth);

// After
const lines = layoutCellBlocks(cell?.blocks ?? [], ctx, innerWidth);
```

- [ ] **Step 3: Update import to include `Block`**

Change the import at line 1:
```typescript
import type { TableData, Block } from '../model/types.js';
```

- [ ] **Step 4: Verify it compiles**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: Errors now only in table-renderer.ts and test files.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/table-layout.ts
git commit --no-verify -m "refactor(docs): layout cell blocks instead of cell inlines"
```

---

### Task 4: Update Table Renderer for Block-Based Cells

**Files:**
- Modify: `packages/docs/src/view/table-renderer.ts`

The renderer accesses `cell.inlines` in the text rendering section (to get inline styles). Since cell layout now produces lines from `cell.blocks`, and `LayoutLine.runs` already contain the inline references, the renderer mostly works — but any direct `cell.inlines` access needs updating.

- [ ] **Step 1: Check and fix any `cell.inlines` references**

Search `table-renderer.ts` for `.inlines` — the renderer uses `rows[r].cells[c]` for style access but should not access `.inlines` directly (it uses `layoutCell.lines` for run data). Verify no `.inlines` references exist.

If none: no changes needed. If found, replace with `cell.blocks[0]?.inlines ?? []`.

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/docs && npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: Errors now only in test files.

- [ ] **Step 3: Commit (if changes were made)**

```bash
git add packages/docs/src/view/table-renderer.ts
git commit --no-verify -m "refactor(docs): update table renderer for block-based cells"
```

---

### Task 5: Update YorkieDocStore Serialization

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

Replace JSON `tableData` attribute with tree node children: `row → cell → block → inline → text`.

- [ ] **Step 1: Add cell style serialization helpers**

```typescript
function serializeCellStyle(cell: TableCell): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (cell.colSpan !== undefined && cell.colSpan !== 1) attrs.colSpan = String(cell.colSpan);
  if (cell.rowSpan !== undefined && cell.rowSpan !== 1) attrs.rowSpan = String(cell.rowSpan);
  const s = cell.style;
  if (s.backgroundColor) attrs.backgroundColor = s.backgroundColor;
  if (s.verticalAlign) attrs.verticalAlign = s.verticalAlign;
  if (s.padding !== undefined) attrs.padding = String(s.padding);
  if (s.borderTop) attrs.borderTop = `${s.borderTop.width},${s.borderTop.style},${s.borderTop.color}`;
  if (s.borderBottom) attrs.borderBottom = `${s.borderBottom.width},${s.borderBottom.style},${s.borderBottom.color}`;
  if (s.borderLeft) attrs.borderLeft = `${s.borderLeft.width},${s.borderLeft.style},${s.borderLeft.color}`;
  if (s.borderRight) attrs.borderRight = `${s.borderRight.width},${s.borderRight.style},${s.borderRight.color}`;
  return attrs;
}

function parseBorderStyle(value: string): BorderStyle | undefined {
  const parts = value.split(',');
  if (parts.length !== 3) return undefined;
  return { width: Number(parts[0]), style: parts[1] as 'solid' | 'none', color: parts[2] };
}

function parseCellStyle(attrs: Record<string, string>): CellStyle {
  const style: CellStyle = {};
  if (attrs.backgroundColor) style.backgroundColor = attrs.backgroundColor;
  if (attrs.verticalAlign) style.verticalAlign = attrs.verticalAlign as 'top' | 'middle' | 'bottom';
  if (attrs.padding) style.padding = Number(attrs.padding);
  if (attrs.borderTop) style.borderTop = parseBorderStyle(attrs.borderTop);
  if (attrs.borderBottom) style.borderBottom = parseBorderStyle(attrs.borderBottom);
  if (attrs.borderLeft) style.borderLeft = parseBorderStyle(attrs.borderLeft);
  if (attrs.borderRight) style.borderRight = parseBorderStyle(attrs.borderRight);
  return style;
}
```

- [ ] **Step 2: Update `buildBlockNode` for table blocks**

Replace the `tableData` JSON serialization with tree children:

```typescript
function buildBlockNode(block: Block): ElementNode {
  // Table block: children are row → cell → block nodes
  if (block.type === 'table' && block.tableData) {
    return {
      type: 'block',
      attributes: {
        id: block.id,
        type: 'table',
        cols: block.tableData.columnWidths.join(','),
        ...serializeBlockStyle(block.style),
      },
      children: block.tableData.rows.map((row) => ({
        type: 'row' as const,
        attributes: {},
        children: row.cells.map((cell) => ({
          type: 'cell' as const,
          attributes: serializeCellStyle(cell),
          children: cell.blocks.map(buildBlockNode),
        })),
      })),
    };
  }

  // Existing non-table block logic (unchanged)
  const attrs: Record<string, string> = {
    id: block.id,
    type: block.type,
    ...serializeBlockStyle(block.style),
  };
  // ... rest unchanged
}
```

- [ ] **Step 3: Update `treeNodeToBlock` for table deserialization**

Replace the `tableData` JSON parsing with tree traversal:

```typescript
function treeNodeToBlock(node: TreeNode): Block {
  const el = node as ElementNode;
  const attrs = (el.attributes ?? {}) as Record<string, string>;
  const blockType = (attrs.type as Block['type']) ?? 'paragraph';

  // Table block: parse row → cell → block children
  if (blockType === 'table') {
    const rows = (el.children ?? [])
      .filter((c) => c.type === 'row')
      .map(treeNodeToRow);
    const cols = (attrs.cols ?? '').split(',').map(Number).filter(n => !isNaN(n));
    return {
      id: attrs.id ?? '',
      type: 'table',
      inlines: [],
      style: parseBlockStyle(attrs),
      tableData: { rows, columnWidths: cols },
    };
  }

  // Existing non-table logic (unchanged)
  // ...
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
  const attrs = (el.attributes ?? {}) as Record<string, string>;
  const blocks = (el.children ?? [])
    .filter((c) => c.type === 'block')
    .map(treeNodeToBlock);
  return {
    blocks: blocks.length > 0
      ? blocks
      : [{ id: '', type: 'paragraph', inlines: [{ text: '', style: {} }], style: { alignment: 'left', lineHeight: 1.5, marginTop: 0, marginBottom: 0, textIndent: 0, marginLeft: 0 } }],
    style: parseCellStyle(attrs),
    colSpan: attrs.colSpan ? Number(attrs.colSpan) : undefined,
    rowSpan: attrs.rowSpan ? Number(attrs.rowSpan) : undefined,
  };
}
```

- [ ] **Step 4: Remove old JSON tableData parsing**

Delete the `if ('tableData' in attrs && attrs.tableData)` block from `treeNodeToBlock`.

- [ ] **Step 5: Add imports**

Add imports for `TableRow`, `TableCell`, `CellStyle`, `BorderStyle` from `@wafflebase/docs`.

- [ ] **Step 6: Verify frontend compiles**

Run: `cd packages/frontend && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit --no-verify -m "refactor(frontend): serialize tables as Yorkie Tree nodes"
```

---

### Task 6: Update Tests

**Files:**
- Modify: `packages/docs/test/model/table.test.ts`
- Modify: `packages/docs/test/model/types.test.ts`
- Modify: `packages/docs/test/view/table-layout.test.ts`
- Modify: `packages/docs/test/view/table-selection.test.ts`

- [ ] **Step 1: Update `getCellText` helper in `table.test.ts`**

Change:
```typescript
function getCellText(doc: Doc, blockId: string, cell: CellAddress): string {
  const block = doc.getBlock(blockId);
  return block.tableData!.rows[cell.rowIndex].cells[cell.colIndex]
    .inlines.map(i => i.text).join('');
}
```

To:
```typescript
function getCellText(doc: Doc, blockId: string, cell: CellAddress): string {
  const block = doc.getBlock(blockId);
  const tc = block.tableData!.rows[cell.rowIndex].cells[cell.colIndex];
  return tc.blocks.flatMap(b => b.inlines).map(i => i.text).join('');
}
```

- [ ] **Step 2: Update merge test assertion**

The merge test checks `topLeft.inlines` — change to `topLeft.blocks[0].inlines`:

```typescript
expect(topLeft.blocks[0].inlines.map(i => i.text).join('')).toBe('ABC');
```

- [ ] **Step 3: Update applyCellInlineStyle test**

Change `cell.inlines[0]` to `cell.blocks[0].inlines[0]`:

```typescript
const cell = doc.getBlock(tableId).tableData!.rows[0].cells[0];
expect(cell.blocks[0].inlines[0].style.bold).toBe(true);
expect(cell.blocks[0].inlines[0].text).toBe('Hel');
expect(cell.blocks[0].inlines[1].text).toBe('lo');
```

- [ ] **Step 4: Update `types.test.ts` table factory tests**

Change `createTableCell` assertions from `.inlines` to `.blocks`:

```typescript
it('createTableCell returns cell with empty block and default style', () => {
  const cell = createTableCell();
  expect(cell.blocks).toHaveLength(1);
  expect(cell.blocks[0].type).toBe('paragraph');
  expect(cell.blocks[0].inlines).toEqual([{ text: '', style: {} }]);
  expect(cell.style).toEqual(DEFAULT_CELL_STYLE);
});
```

- [ ] **Step 5: Update `table-selection.test.ts`**

Change cell text assertions from `.inlines` to `.blocks`:

```typescript
const text = block.tableData!.rows[0].cells[0].blocks
  .flatMap(b => b.inlines).map(i => i.text).join('');
```

- [ ] **Step 6: Update `table-layout.test.ts`**

If layout tests create cells with `inlines`, change to `blocks`. Check for any `cell.inlines` references.

- [ ] **Step 7: Run all tests**

Run: `cd packages/docs && npx vitest run`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add packages/docs/test/
git commit -m "test(docs): update table tests for block-based cells"
```

---

### Task 7: Update Exports and Remaining References

**Files:**
- Modify: `packages/docs/src/index.ts`
- Modify: `packages/docs/src/view/text-editor.ts` (cell text helpers)

- [ ] **Step 1: Export `getCellText` from index.ts**

Add `getCellText` to the exports in `packages/docs/src/index.ts`.

- [ ] **Step 2: Update `getCellText` and `getCellTextLength` in text-editor.ts**

These private helpers on TextEditor read `cell.inlines` — update to use `cell.blocks`:

```typescript
  private getCellTextLength(blockId: string, cell: CellAddress): number {
    const block = this.doc.getBlock(blockId);
    if (!block.tableData) return 0;
    const row = block.tableData.rows[cell.rowIndex];
    if (!row) return 0;
    const tc = row.cells[cell.colIndex];
    if (!tc) return 0;
    return tc.blocks.flatMap(b => b.inlines).reduce((s, i) => s + i.text.length, 0);
  }

  private getCellText(blockId: string, cell: CellAddress): string {
    const block = this.doc.getBlock(blockId);
    if (!block.tableData) return '';
    const row = block.tableData.rows[cell.rowIndex];
    if (!row) return '';
    const tc = row.cells[cell.colIndex];
    if (!tc) return '';
    return tc.blocks.flatMap(b => b.inlines).map(i => i.text).join('');
  }
```

- [ ] **Step 3: Update `mergeCells` reference in `editor.ts` context menu**

Check `docs-table-context-menu.tsx` for any `.inlines` references on cells — these should not exist (the component uses EditorAPI methods).

- [ ] **Step 4: Verify full compilation**

Run: `cd packages/docs && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Run all tests**

Run: `pnpm verify:fast`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/ packages/frontend/src/
git commit -m "refactor(docs): update remaining cell.inlines references to cell.blocks"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 2: Run verify:entropy**

Run: `node scripts/verify-entropy.mjs`
Expected: All entropy checks passed.

- [ ] **Step 3: Manual smoke test**

1. `pnpm dev`, open a Docs document
2. Insert table via toolbar grid picker
3. Type text in cells (English + Korean)
4. Tab between cells
5. Shift+Arrow selection within cells
6. Mouse drag selection within cells
7. Double/triple-click in cells
8. Right-click context menu: insert/delete rows/columns
9. Cell background color
10. Delete table
11. Undo/redo all operations
