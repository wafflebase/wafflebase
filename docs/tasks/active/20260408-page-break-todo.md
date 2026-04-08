# Page Break (Phase 4.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual page break support (`Block.type = 'page-break'`) with Ctrl+Enter shortcut.

**Architecture:** Follow the existing `horizontal-rule` content-free block pattern. Add `'page-break'` to `BlockType`, handle it in layout (fixed-height line), pagination (force new page), rendering (dashed line + label), and input (Ctrl+Enter).

**Tech Stack:** TypeScript, Canvas API, Vitest

---

### Task 1: Add `page-break` to data model and createBlock

**Files:**
- Modify: `packages/docs/src/model/types.ts:19` (BlockType union)
- Modify: `packages/docs/src/model/types.ts:192` (createBlock inlines)
- Test: `packages/docs/test/model/types.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/docs/test/model/types.test.ts`, add after the horizontal-rule test (line ~84):

```typescript
  it('creates a page-break block with empty inlines', () => {
    const block = createBlock('page-break');
    expect(block.type).toBe('page-break');
    expect(block.inlines).toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm vitest run test/model/types.test.ts`

Expected: FAIL — `'page-break'` is not assignable to `BlockType`.

- [ ] **Step 3: Add `page-break` to BlockType and createBlock**

In `packages/docs/src/model/types.ts`, line 19:

```typescript
export type BlockType = 'paragraph' | 'title' | 'subtitle' | 'heading' | 'list-item' | 'horizontal-rule' | 'table' | 'page-break';
```

In `packages/docs/src/model/types.ts`, line 192 — update the `inlines` condition:

```typescript
    inlines: type === 'horizontal-rule' || type === 'table' || type === 'page-break' ? [] : [{ text: '', style: {} }],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm vitest run test/model/types.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/test/model/types.test.ts
git commit -m "Add page-break to BlockType union

Content-free block type following the horizontal-rule pattern.
createBlock('page-break') produces empty inlines."
```

---

### Task 2: Add page-break handling to document model (Doc class)

**Files:**
- Modify: `packages/docs/src/model/document.ts:168-174` (deleteBackward HR check)
- Modify: `packages/docs/src/model/document.ts:201-210` (splitBlock HR check)
- Modify: `packages/docs/src/model/document.ts:394-398` (setBlockType HR check)
- Modify: `packages/docs/src/model/document.ts:806-812` (splitBlock table-cell HR check)
- Test: `packages/docs/test/model/document.test.ts`

- [ ] **Step 1: Write failing tests**

In `packages/docs/test/model/document.test.ts`, add a new describe block after the horizontal-rule tests:

```typescript
  describe('page-break', () => {
    it('should create paragraph after page-break on splitBlock', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'page-break');
      const newId = doc.splitBlock(blockId, 0);
      expect(newId).not.toBe(blockId);
      expect(doc.document.blocks[1].type).toBe('paragraph');
    });

    it('should delete page-break when backspacing from paragraph after it', () => {
      const doc = Doc.create();
      const firstId = doc.document.blocks[0].id;
      doc.setBlockType(firstId, 'page-break');
      const paraId = doc.splitBlock(firstId, 0);
      doc.insertText({ blockId: paraId, offset: 0 }, 'Hello');
      // Backspace at offset 0 should delete the page-break
      doc.deleteBackward({ blockId: paraId, offset: 0 });
      expect(doc.document.blocks).toHaveLength(1);
      expect(doc.document.blocks[0].type).toBe('paragraph');
      expect(doc.document.blocks[0].inlines[0].text).toBe('Hello');
    });

    it('should clear inlines when converting to page-break', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.insertText({ blockId, offset: 0 }, 'text');
      doc.setBlockType(blockId, 'page-break');
      expect(doc.document.blocks[0].inlines).toHaveLength(0);
    });

    it('should restore empty inline when converting page-break back to paragraph', () => {
      const doc = Doc.create();
      const blockId = doc.document.blocks[0].id;
      doc.setBlockType(blockId, 'page-break');
      expect(doc.document.blocks[0].inlines).toHaveLength(0);
      doc.setBlockType(blockId, 'paragraph');
      expect(doc.document.blocks[0].inlines).toHaveLength(1);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && pnpm vitest run test/model/document.test.ts`

Expected: FAIL — `page-break` not handled in splitBlock, deleteBackward, setBlockType.

- [ ] **Step 3: Update document.ts — add page-break alongside horizontal-rule checks**

There are 4 locations in `document.ts` that check `horizontal-rule`. Each one needs `page-break` added:

**Location 1 — deleteBackward (line ~168):**

```typescript
    if (prevBlock.type === 'horizontal-rule' || prevBlock.type === 'page-break') {
```

**Location 2 — splitBlock (line ~201):**

```typescript
    if (block.type === 'horizontal-rule' || block.type === 'page-break') {
```

**Location 3 — setBlockType (line ~394):**

```typescript
    if (type === 'horizontal-rule' || type === 'page-break') {
```

**Location 4 — splitBlock in table cell (line ~806):**

```typescript
    if (targetBlock.type === 'horizontal-rule' || targetBlock.type === 'page-break') {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && pnpm vitest run test/model/document.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/test/model/document.test.ts
git commit -m "Handle page-break in Doc model operations

Add page-break to splitBlock, deleteBackward, and setBlockType
following the same non-editable pattern as horizontal-rule."
```

---

### Task 3: Add page-break layout in computeLayout

**Files:**
- Modify: `packages/docs/src/view/layout.ts:191-193` (HR layout branch)
- Test: `packages/docs/test/view/layout.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/docs/test/view/layout.test.ts`, add after the `horizontal-rule layout` describe block:

```typescript
describe('page-break layout', () => {
  it('should have fixed height with no text runs', () => {
    const block = createBlock('page-break');
    const { layout } = computeLayout([block], mockCtx(), 600);
    const pbBlock = layout.blocks[0];
    expect(pbBlock.lines).toHaveLength(1);
    expect(pbBlock.lines[0].runs).toHaveLength(0);
    expect(pbBlock.lines[0].height).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm vitest run test/view/layout.test.ts`

Expected: FAIL — page-break falls through to the normal text layout path, produces different output.

- [ ] **Step 3: Add page-break to layout branch**

In `packages/docs/src/view/layout.ts`, line ~191, extend the condition:

```typescript
    if (block.type === 'horizontal-rule' || block.type === 'page-break') {
      const HR_HEIGHT = 20;
      lines = [{ runs: [], y: 0, height: HR_HEIGHT, width: availableWidth }];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm vitest run test/view/layout.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/layout.ts packages/docs/test/view/layout.test.ts
git commit -m "Add page-break to layout as fixed-height content-free block

Same 20px height as horizontal-rule, no text runs."
```

---

### Task 4: Force page split in paginateLayout for page-break blocks

**Files:**
- Modify: `packages/docs/src/view/pagination.ts:53-100` (block iteration loop)
- Test: `packages/docs/test/view/pagination.test.ts`

- [ ] **Step 1: Write failing tests**

In `packages/docs/test/view/pagination.test.ts`, add a new describe block. Use the existing `mockBlock` helper but override the block type:

```typescript
function mockPageBreakBlock(id: string): LayoutBlock {
  return {
    block: {
      id,
      type: 'page-break',
      inlines: [],
      style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 0, textIndent: 0, marginLeft: 0 },
    },
    x: 0,
    y: 0,
    width: 624,
    height: 20,
    lines: [{ runs: [], y: 0, height: 20, width: 624 }],
  };
}

describe('paginateLayout — page-break', () => {
  const setup = DEFAULT_PAGE_SETUP;

  it('page-break forces content after it onto next page', () => {
    const b1 = mockBlock('b1', [mockLine(24)]);
    const pb = mockPageBreakBlock('pb');
    const b2 = mockBlock('b2', [mockLine(24)]);
    const layout: DocumentLayout = {
      blocks: [b1, pb, b2],
      totalHeight: 68,
      blockParentMap: new Map(),
    };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(2);
    // Page 1: b1 line + page-break line
    expect(result.pages[0].lines).toHaveLength(2);
    expect(result.pages[0].lines[0].blockIndex).toBe(0);
    expect(result.pages[0].lines[1].blockIndex).toBe(1);
    // Page 2: b2 line
    expect(result.pages[1].lines).toHaveLength(1);
    expect(result.pages[1].lines[0].blockIndex).toBe(2);
  });

  it('page-break at start of document creates empty first page with only the break', () => {
    const pb = mockPageBreakBlock('pb');
    const b1 = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = {
      blocks: [pb, b1],
      totalHeight: 44,
      blockParentMap: new Map(),
    };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].lines).toHaveLength(1); // page-break line
    expect(result.pages[1].lines).toHaveLength(1); // b1
  });

  it('consecutive page-breaks create one page per break', () => {
    const pb1 = mockPageBreakBlock('pb1');
    const pb2 = mockPageBreakBlock('pb2');
    const b1 = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = {
      blocks: [pb1, pb2, b1],
      totalHeight: 64,
      blockParentMap: new Map(),
    };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0].lines).toHaveLength(1); // pb1
    expect(result.pages[1].lines).toHaveLength(1); // pb2
    expect(result.pages[2].lines).toHaveLength(1); // b1
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && pnpm vitest run test/view/pagination.test.ts`

Expected: FAIL — page-break blocks don't trigger page split.

- [ ] **Step 3: Add page-break handling in paginateLayout**

In `packages/docs/src/view/pagination.ts`, inside the `else` branch (line ~83) that handles non-table blocks, add a check after the line is pushed. The page-break line should be added to the current page, then force a new page:

```typescript
    } else {
      for (let li = 0; li < lb.lines.length; li++) {
        const line = lb.lines[li];

        // Check if line fits on current page
        if (currentY + line.height > contentHeight && !isPageTop) {
          startNewPage();
        }

        currentLines.push({
          blockIndex: bi,
          lineIndex: li,
          line,
          x: margins.left,
          y: margins.top + currentY,
        });

        currentY += line.height;
        isPageTop = false;
      }

      // Page-break: force next content onto a new page
      if (block.type === 'page-break') {
        startNewPage();
      }

      // Apply marginBottom after the block's last line.
      if (lb.lines.length > 0 && block.type !== 'page-break') {
        currentY += block.style.marginBottom;
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && pnpm vitest run test/view/pagination.test.ts`

Expected: PASS

- [ ] **Step 5: Run full docs test suite for regressions**

Run: `cd packages/docs && pnpm vitest run`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/pagination.ts packages/docs/test/view/pagination.test.ts
git commit -m "Force page split after page-break blocks in pagination

Page-break line is placed on the current page, then startNewPage()
is called so subsequent content begins on a fresh page."
```

---

### Task 5: Render page-break visual indicator in doc-canvas

**Files:**
- Modify: `packages/docs/src/view/doc-canvas.ts:156-167` (after HR rendering branch)

- [ ] **Step 1: Add page-break rendering branch**

In `packages/docs/src/view/doc-canvas.ts`, after the `horizontal-rule` block (line ~167, before the `continue`-ending HR block closes), add a new condition. Insert right after the HR `if` block:

```typescript
          if (block && block.type === 'page-break') {
            const lineY = Math.round(pageY + pl.y + pl.line.height / 2);
            // Draw "Page break" label centered
            this.ctx.font = '9px Arial';
            this.ctx.fillStyle = '#aaa';
            this.ctx.textAlign = 'center';
            const centerX = pageX + page.width / 2;
            this.ctx.fillText('Page break', centerX, lineY - 2);
            // Draw dashed line on both sides of the label
            const labelWidth = this.ctx.measureText('Page break').width + 16;
            this.ctx.beginPath();
            this.ctx.strokeStyle = '#ccc';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([4, 4]);
            this.ctx.moveTo(pageX + margins.left, lineY);
            this.ctx.lineTo(centerX - labelWidth / 2, lineY);
            this.ctx.moveTo(centerX + labelWidth / 2, lineY);
            this.ctx.lineTo(pageX + page.width - margins.right, lineY);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
            this.ctx.textAlign = 'left';
            continue;
          }
```

- [ ] **Step 2: Run full docs test suite**

Run: `cd packages/docs && pnpm vitest run`

Expected: All tests pass (rendering is not unit-tested, but no regressions).

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/view/doc-canvas.ts
git commit -m "Render page-break as dashed line with centered label

Google Docs style: gray dashed lines flanking a centered 'Page break'
text label. Uses setLineDash([4,4]) with #ccc stroke color."
```

---

### Task 6: Add Ctrl+Enter shortcut and non-editable input handling

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts:251-253` (input blocking)
- Modify: `packages/docs/src/view/text-editor.ts:358-361` (Enter key handler)
- Modify: `packages/docs/src/view/text-editor.ts:2143-2149` (ensureEditableBlock)

- [ ] **Step 1: Block text input on page-break blocks**

In `packages/docs/src/view/text-editor.ts`, line ~253:

```typescript
    if (currentBlock.type === 'horizontal-rule' || currentBlock.type === 'page-break') return;
```

- [ ] **Step 2: Add Ctrl+Enter handler**

In `packages/docs/src/view/text-editor.ts`, modify the Enter case (line ~358):

```typescript
      case 'Enter':
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          this.handlePageBreak();
        } else {
          this.handleEnter();
        }
        break;
```

- [ ] **Step 3: Add createBlock import to text-editor.ts**

In `packages/docs/src/view/text-editor.ts`, line 2 — add `createBlock` to the import:

```typescript
import { generateBlockId, getBlockText, getBlockTextLength, DEFAULT_BLOCK_STYLE, createBlock } from '../model/types.js';
```

- [ ] **Step 4: Implement handlePageBreak method**

Add the method near `handleEnter` (after line ~1313):

```typescript
  private handlePageBreak(): void {
    // Cannot insert page-break inside table cell
    const cellInfo = this.getCellInfo(this.cursor.position.blockId);
    if (cellInfo) return;

    this.saveSnapshot();
    this.deleteSelection();
    this.invalidateLayout();

    const pos = this.cursor.position;
    // Split at cursor position first
    const newBlockId = this.doc.splitBlock(pos.blockId, pos.offset);

    // Insert a page-break block between the two halves
    const blocks = this.doc.document.blocks;
    const splitIndex = blocks.findIndex((b) => b.id === newBlockId);
    const pageBreakBlock = createBlock('page-break');
    this.doc.insertBlockAt(splitIndex, pageBreakBlock);

    // Move cursor to the block after the page-break
    this.cursor.moveTo({ blockId: newBlockId, offset: 0 });
    this.selection.setRange(null);
    this.requestRender();
  }
```

- [ ] **Step 5: Add page-break to ensureEditableBlock**

In `packages/docs/src/view/text-editor.ts`, line ~2145:

```typescript
    if (block.type === 'horizontal-rule' || block.type === 'page-break') {
```

- [ ] **Step 6: Run full docs test suite**

Run: `cd packages/docs && pnpm vitest run`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/docs/src/view/text-editor.ts packages/docs/src/model/document.ts
git commit -m "Add Ctrl+Enter page break insertion and non-editable handling

Ctrl+Enter (Cmd+Enter on Mac) splits the block at cursor and inserts
a page-break block between the halves. Text input is blocked on
page-break blocks, same as horizontal-rule."
```

---

### Task 7: Update Yorkie serialization for page-break

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [ ] **Step 1: Check current Yorkie serialization for block types**

The YorkieDocStore reads/writes block `type` as a Tree node attribute. Since `page-break` is just another string value for the `type` attribute, it should work without changes if the serialization is attribute-based.

Verify by searching for how `horizontal-rule` is serialized — if it's just stored as a string attribute, `page-break` will work automatically.

- [ ] **Step 2: If changes needed, add page-break to empty-inlines handling**

If the Yorkie store has special handling for content-free blocks (like skipping inline nodes for HR), add `page-break` to that condition.

- [ ] **Step 3: Run verify:fast**

Run: `pnpm verify:fast`

Expected: All lint + unit tests pass.

- [ ] **Step 4: Commit (if changes were needed)**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Add page-break to Yorkie serialization

Handle page-break as content-free block in YorkieDocStore,
same as horizontal-rule."
```

---

### Task 8: Update task tracking and final verification

**Files:**
- Modify: `docs/tasks/active/20260325-docs-wordprocessor-todo.md`

- [ ] **Step 1: Run pnpm verify:fast**

Run: `pnpm verify:fast`

Expected: All lint + unit tests pass.

- [ ] **Step 2: Manual verification**

Start the app (`pnpm dev`) and verify:
- [ ] Ctrl+Enter (Cmd+Enter) inserts a page break at cursor position
- [ ] Content after the page break appears on the next page
- [ ] Page break shows dashed line with "Page break" label
- [ ] Backspace on the line after page-break deletes it
- [ ] Arrow keys navigate through page-break blocks correctly
- [ ] Cannot type text into a page-break block

- [ ] **Step 3: Check off 4.2 in the wordprocessor todo**

In `docs/tasks/active/20260325-docs-wordprocessor-todo.md`, mark Phase 4.2 as complete:

```markdown
- [x] 4.2 Page Break — Ctrl+Enter, forced page split
```

- [ ] **Step 4: Commit**

```bash
git add docs/tasks/active/20260325-docs-wordprocessor-todo.md
git commit -m "Mark Phase 4.2 Page Break as complete"
```
