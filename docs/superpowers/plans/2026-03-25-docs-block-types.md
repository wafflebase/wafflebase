# Phase 1: Block Type Extensions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Wafflebase Docs to support headings (H1–H6), ordered/unordered lists, and horizontal rules — the foundational block types for a word processor.

**Architecture:** Extend the existing `Block.type` discriminated union with new types (`'heading'`, `'list-item'`, `'horizontal-rule'`). Each type adds optional fields to Block. The layout engine and renderer branch on block type, reusing the paragraph pipeline where possible. Input handling adds type-specific Enter/Tab behavior.

**Tech Stack:** TypeScript, Canvas 2D API, Vitest, React (toolbar), Yorkie Tree CRDT

**Spec:** [docs-wordprocessor-roadmap.md](../../design/docs-wordprocessor-roadmap.md) — Phase 1

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/docs/src/model/types.ts` | Modify | Add `BlockType` union, heading/list fields to `Block`, heading style defaults |
| `packages/docs/src/model/document.ts` | Modify | Add `setBlockType()`, type-aware `splitBlock()` |
| `packages/docs/src/view/layout.ts` | Modify | Heading defaults, list marker area, horizontal rule layout |
| `packages/docs/src/view/doc-canvas.ts` | Modify | List marker rendering, horizontal rule rendering |
| `packages/docs/src/view/text-editor.ts` | Modify | Enter/Tab/Backspace behavior for headings, lists, HR |
| `packages/docs/src/view/editor.ts` | Modify | Expose `setBlockType()`, `toggleList()`, `getBlockType()` on EditorAPI |
| `packages/docs/src/index.ts` | Modify | Export new types |
| `packages/docs/test/model/document.test.ts` | Modify | Tests for new block type operations |
| `packages/docs/test/model/types.test.ts` | Modify | Tests for heading defaults, block creation |
| `packages/docs/test/view/layout.test.ts` | Create | Tests for heading/list/HR layout |
| `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` | Modify | Heading dropdown, list toggle buttons |
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | Modify | Serialize/deserialize heading/list attributes |

---

## Task 1: Extend Block data model

**Files:**
- Modify: `packages/docs/src/model/types.ts`
- Modify: `packages/docs/test/model/types.test.ts`

- [ ] **Step 1: Write failing tests for new block types**

Add to `packages/docs/test/model/types.test.ts`:

```typescript
describe('BlockType', () => {
  it('should create a heading block', () => {
    const block = createBlock('heading', { headingLevel: 1 });
    expect(block.type).toBe('heading');
    expect(block.headingLevel).toBe(1);
  });

  it('should create a list-item block', () => {
    const block = createBlock('list-item', { listKind: 'unordered', listLevel: 0 });
    expect(block.type).toBe('list-item');
    expect(block.listKind).toBe('unordered');
    expect(block.listLevel).toBe(0);
  });

  it('should create a horizontal-rule block', () => {
    const block = createBlock('horizontal-rule');
    expect(block.type).toBe('horizontal-rule');
    expect(block.inlines).toHaveLength(0);
  });

  it('should return default heading style for H1', () => {
    expect(getHeadingDefaults(1)).toEqual({ fontSize: 24, bold: true });
  });

  it('should return default heading style for H6', () => {
    expect(getHeadingDefaults(6)).toEqual({ fontSize: 11 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run packages/docs/test/model/types.test.ts`
Expected: FAIL — `createBlock` and `getHeadingDefaults` not found

- [ ] **Step 3: Implement BlockType extension**

In `packages/docs/src/model/types.ts`:

1. Add `BlockType` union type:
```typescript
export type BlockType = 'paragraph' | 'heading' | 'list-item' | 'horizontal-rule';
```

2. Extend `Block` interface — change `type: 'paragraph'` to `type: BlockType` and add optional fields:
```typescript
export interface Block {
  id: string;
  type: BlockType;
  inlines: Inline[];
  style: BlockStyle;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  listKind?: 'ordered' | 'unordered';
  listLevel?: number;
}
```

3. Add heading defaults:
```typescript
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

const HEADING_DEFAULTS: Record<HeadingLevel, Partial<InlineStyle>> = {
  1: { fontSize: 24, bold: true },
  2: { fontSize: 20, bold: true },
  3: { fontSize: 16, bold: true },
  4: { fontSize: 14, bold: true },
  5: { fontSize: 12 },
  6: { fontSize: 11 },
};

export function getHeadingDefaults(level: HeadingLevel): Partial<InlineStyle> {
  return { ...HEADING_DEFAULTS[level] };
}
```

4. Add list constants:
```typescript
export const LIST_INDENT_PX = 36;
export const UNORDERED_MARKERS = ['●', '○', '■'];
export const ORDERED_FORMATS = ['decimal', 'lower-alpha', 'lower-roman'] as const;
```

5. Add `createBlock()` factory:
```typescript
export function createBlock(
  type: BlockType = 'paragraph',
  opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number },
): Block {
  const block: Block = {
    id: generateBlockId(),
    type,
    inlines: type === 'horizontal-rule' ? [] : [{ text: '', style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  if (type === 'heading' && opts?.headingLevel) {
    block.headingLevel = opts.headingLevel;
  }
  if (type === 'list-item') {
    block.listKind = opts?.listKind ?? 'unordered';
    block.listLevel = opts?.listLevel ?? 0;
  }
  return block;
}
```

Keep the existing `createEmptyBlock()` unchanged (it still creates paragraphs).

- [ ] **Step 4: Export new types from index.ts**

In `packages/docs/src/index.ts`, add to the model exports:
```typescript
export type { BlockType, HeadingLevel } from './model/types.js';
export {
  createBlock,
  getHeadingDefaults,
  LIST_INDENT_PX,
  UNORDERED_MARKERS,
  ORDERED_FORMATS,
} from './model/types.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- --run packages/docs/test/model/types.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/src/index.ts packages/docs/test/model/types.test.ts
git commit -m "feat(docs): extend Block type with heading, list-item, horizontal-rule"
```

---

## Task 2: Type-aware document manipulation

**Files:**
- Modify: `packages/docs/src/model/document.ts`
- Modify: `packages/docs/test/model/document.test.ts`

- [ ] **Step 1: Write failing tests for type-aware splitBlock**

Add to `packages/docs/test/model/document.test.ts`:

```typescript
describe('splitBlock — type-aware', () => {
  it('should create a paragraph when splitting a heading', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.setBlockType(blockId, 'heading', { headingLevel: 1 });
    doc.insertText({ blockId, offset: 0 }, 'Title');
    const newId = doc.splitBlock(blockId, 5);
    expect(doc.document.blocks[0].type).toBe('heading');
    expect(doc.document.blocks[1].type).toBe('paragraph');
  });

  it('should create another list-item when splitting a list-item', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.setBlockType(blockId, 'list-item', { listKind: 'unordered', listLevel: 0 });
    doc.insertText({ blockId, offset: 0 }, 'Item one');
    const newId = doc.splitBlock(blockId, 8);
    expect(doc.document.blocks[1].type).toBe('list-item');
    expect(doc.document.blocks[1].listKind).toBe('unordered');
    expect(doc.document.blocks[1].listLevel).toBe(0);
  });

  it('should convert empty list-item to paragraph on split', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.setBlockType(blockId, 'list-item', { listKind: 'unordered', listLevel: 0 });
    // Empty list item — Enter should exit list
    const newId = doc.splitBlock(blockId, 0);
    expect(doc.document.blocks[0].type).toBe('paragraph');
  });
});

describe('setBlockType', () => {
  it('should change a paragraph to heading', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.setBlockType(blockId, 'heading', { headingLevel: 2 });
    expect(doc.document.blocks[0].type).toBe('heading');
    expect(doc.document.blocks[0].headingLevel).toBe(2);
  });

  it('should change a heading back to paragraph', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.setBlockType(blockId, 'heading', { headingLevel: 1 });
    doc.setBlockType(blockId, 'paragraph');
    expect(doc.document.blocks[0].type).toBe('paragraph');
    expect(doc.document.blocks[0].headingLevel).toBeUndefined();
  });

  it('should set list-item type with kind and level', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.setBlockType(blockId, 'list-item', { listKind: 'ordered', listLevel: 1 });
    const block = doc.document.blocks[0];
    expect(block.type).toBe('list-item');
    expect(block.listKind).toBe('ordered');
    expect(block.listLevel).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run packages/docs/test/model/document.test.ts`
Expected: FAIL — `setBlockType` not found

- [ ] **Step 3: Implement setBlockType and update splitBlock**

In `packages/docs/src/model/document.ts`:

1. Add `setBlockType()` method to `Doc` class:
```typescript
setBlockType(
  blockId: string,
  type: BlockType,
  opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number },
): void {
  const block = this.getBlock(blockId);
  block.type = type;
  // Clear type-specific fields
  delete block.headingLevel;
  delete block.listKind;
  delete block.listLevel;
  // Set new type-specific fields
  if (type === 'heading' && opts?.headingLevel) {
    block.headingLevel = opts.headingLevel;
  }
  if (type === 'list-item') {
    block.listKind = opts?.listKind ?? 'unordered';
    block.listLevel = opts?.listLevel ?? 0;
  }
  this.store.updateBlock(blockId, block);
  this.refresh();
}
```

Import `BlockType` and `HeadingLevel` from `types.js`.

2. Update `splitBlock()` — change the new block creation logic (around line 165):
```typescript
// Determine new block type based on current block type
let newType: BlockType = 'paragraph';
const newBlockExtra: Partial<Block> = {};

if (block.type === 'list-item') {
  const blockText = getBlockText(block);
  if (blockText.length === 0 && offset === 0) {
    // Empty list item — exit list: convert THIS block to paragraph
    block.type = 'paragraph';
    delete block.listKind;
    delete block.listLevel;
    this.store.updateBlock(blockId, block);
    this.refresh();
    return blockId; // Return same block, no new block created
  }
  // Non-empty list-item: new block inherits list type
  newType = 'list-item';
  newBlockExtra.listKind = block.listKind;
  newBlockExtra.listLevel = block.listLevel;
}
// Headings always produce a paragraph on Enter (type stays 'paragraph')

const newBlock: Block = {
  id: generateBlockId(),
  type: newType,
  inlines: afterInlines.length > 0
    ? afterInlines
    : [{ text: '', style: this.getStyleAtOffset(block, offset) }],
  style: { ...block.style },
  ...newBlockExtra,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run packages/docs/test/model/document.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/test/model/document.test.ts
git commit -m "feat(docs): add setBlockType and type-aware splitBlock"
```

---

## Task 3: Heading layout and rendering

**Files:**
- Modify: `packages/docs/src/view/layout.ts`
- Modify: `packages/docs/src/view/doc-canvas.ts`
- Create: `packages/docs/test/view/layout.test.ts`

- [ ] **Step 1: Write failing test for heading layout**

Create `packages/docs/test/view/layout.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeLayout } from '../../src/view/layout.js';
import { createBlock, createEmptyBlock, getHeadingDefaults } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

// Minimal mock canvas context for measureText
function mockCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
}

describe('heading layout', () => {
  it('should use heading default font size for line height', () => {
    const block = createBlock('heading', { headingLevel: 1 });
    block.inlines = [{ text: 'Title', style: {} }];
    const { layout } = computeLayout([block], mockCtx(), 600);
    // H1 default is 24pt — line height should be larger than paragraph
    const h1Block = layout.blocks[0];
    expect(h1Block.lines.length).toBe(1);
    expect(h1Block.height).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run packages/docs/test/view/layout.test.ts`
Expected: FAIL or incorrect height (heading defaults not applied in layout)

- [ ] **Step 3: Implement heading defaults in layout**

In `packages/docs/src/view/layout.ts`, modify `computeLayout()` — before calling `layoutBlock()`, apply heading defaults to inlines temporarily for measurement:

Add a helper function:
```typescript
import { getHeadingDefaults, type HeadingLevel } from '../model/types.js';

/**
 * For heading blocks, return inlines with heading default styles merged in.
 * This ensures headings render at the correct font size/weight without
 * requiring the user to manually set these styles.
 */
function resolveBlockInlines(block: Block): Inline[] {
  if (block.type === 'heading' && block.headingLevel) {
    const defaults = getHeadingDefaults(block.headingLevel as HeadingLevel);
    return block.inlines.map((inline) => ({
      text: inline.text,
      style: { ...defaults, ...inline.style },
    }));
  }
  return block.inlines;
}
```

Then in `layoutBlock()`, use resolved inlines instead of raw `block.inlines`:
```typescript
function layoutBlock(
  block: Block,
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): LayoutLine[] {
  const inlines = resolveBlockInlines(block);
  const segments = measureSegments(inlines, ctx);
  // ... rest unchanged but references to block.inlines in run creation
  // should use the resolved inlines
```

Update `measureSegments()` to accept `Inline[]` instead of reading from `block`:
```typescript
function measureSegments(
  inlines: Inline[],
  ctx: CanvasRenderingContext2D,
): MeasuredSegment[] {
```

Update run creation in `layoutBlock()` to reference the resolved inlines array.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run packages/docs/test/view/layout.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/layout.ts packages/docs/test/view/layout.test.ts
git commit -m "feat(docs): apply heading default styles in layout engine"
```

---

## Task 4: List layout and marker rendering

**Files:**
- Modify: `packages/docs/src/view/layout.ts`
- Modify: `packages/docs/src/view/doc-canvas.ts`
- Modify: `packages/docs/test/view/layout.test.ts`

- [ ] **Step 1: Write failing tests for list layout**

Add to `packages/docs/test/view/layout.test.ts`:

```typescript
describe('list-item layout', () => {
  it('should offset text by marker area width', () => {
    const block = createBlock('list-item', { listKind: 'unordered', listLevel: 0 });
    block.inlines = [{ text: 'Item', style: {} }];
    const { layout } = computeLayout([block], mockCtx(), 600);
    const firstRun = layout.blocks[0].lines[0].runs[0];
    // List items should have left offset for marker (LIST_INDENT_PX)
    expect(firstRun.x).toBeGreaterThan(0);
  });

  it('should increase indent for nested list levels', () => {
    const l0 = createBlock('list-item', { listKind: 'unordered', listLevel: 0 });
    l0.inlines = [{ text: 'Level 0', style: {} }];
    const l1 = createBlock('list-item', { listKind: 'unordered', listLevel: 1 });
    l1.inlines = [{ text: 'Level 1', style: {} }];
    const { layout } = computeLayout([l0, l1], mockCtx(), 600);
    const x0 = layout.blocks[0].lines[0].runs[0].x;
    const x1 = layout.blocks[1].lines[0].runs[0].x;
    expect(x1).toBeGreaterThan(x0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run packages/docs/test/view/layout.test.ts`
Expected: FAIL — list indent not applied yet

- [ ] **Step 3: Implement list indent in layout**

In `packages/docs/src/view/layout.ts`, modify `computeLayout()` — for list items, add left margin based on level:

In the `computeLayout()` loop, before calling `layoutBlock()`:
```typescript
// Apply list indent as additional marginLeft for layout purposes
let effectiveBlock = block;
if (block.type === 'list-item') {
  const listIndent = LIST_INDENT_PX * ((block.listLevel ?? 0) + 1);
  effectiveBlock = {
    ...block,
    style: { ...block.style, marginLeft: (block.style.marginLeft ?? 0) + listIndent },
  };
}
```

Import `LIST_INDENT_PX` from types.

- [ ] **Step 4: Implement list marker rendering**

In `packages/docs/src/view/doc-canvas.ts`, add a method to render list markers:

```typescript
private renderListMarker(
  block: Block,
  lineX: number,
  lineY: number,
  lineHeight: number,
  markerX: number,
): void {
  const level = block.listLevel ?? 0;
  const fontSizePx = ptToPx(block.inlines[0]?.style.fontSize ?? Theme.defaultFontSize);
  const baselineY = Math.round(lineY + (lineHeight + fontSizePx * 0.8) / 2);

  this.ctx.font = buildFont(
    block.inlines[0]?.style.fontSize,
    block.inlines[0]?.style.fontFamily,
    false,
    false,
  );
  this.ctx.fillStyle = block.inlines[0]?.style.color ?? Theme.defaultColor;

  if (block.listKind === 'unordered') {
    const markers = ['●', '○', '■'];
    const marker = markers[level % markers.length];
    this.ctx.fillText(marker, markerX, baselineY);
  } else {
    // Ordered — marker text computed from sequential index (passed as param or computed)
    // For now, use a simple index placeholder; real numbering computed in render loop
    this.ctx.fillText('1.', markerX, baselineY);
  }
}
```

In the `render()` method, after drawing text runs for each page line, check if the line is the first line of a list-item block and render the marker:

```typescript
// Inside the page lines loop, after rendering runs:
if (pl.line === layoutBlock.lines[0] && layoutBlock.block.type === 'list-item') {
  const markerX = pageX + margins.left + LIST_INDENT_PX * (layoutBlock.block.listLevel ?? 0);
  this.renderListMarker(layoutBlock.block, pageX + pl.x, pageY + pl.y, pl.line.height, markerX);
}
```

Note: This requires passing block context to the page-line render loop. The `PageLine` type may need a reference to its parent block, or the render method needs to look it up. Check the existing `PaginatedLayout` structure and adapt accordingly.

- [ ] **Step 5: Run tests**

Run: `pnpm test -- --run packages/docs/test/view/layout.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/layout.ts packages/docs/src/view/doc-canvas.ts packages/docs/test/view/layout.test.ts
git commit -m "feat(docs): add list-item indent and marker rendering"
```

---

## Task 5: Horizontal rule layout and rendering

**Files:**
- Modify: `packages/docs/src/view/layout.ts`
- Modify: `packages/docs/src/view/doc-canvas.ts`
- Modify: `packages/docs/test/view/layout.test.ts`

- [ ] **Step 1: Write failing test for HR layout**

Add to `packages/docs/test/view/layout.test.ts`:

```typescript
describe('horizontal-rule layout', () => {
  it('should have a fixed height with no text runs', () => {
    const block = createBlock('horizontal-rule');
    const { layout } = computeLayout([block], mockCtx(), 600);
    const hrBlock = layout.blocks[0];
    expect(hrBlock.lines).toHaveLength(1);
    expect(hrBlock.lines[0].runs).toHaveLength(0);
    expect(hrBlock.height).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run packages/docs/test/view/layout.test.ts`

- [ ] **Step 3: Implement HR layout**

In `packages/docs/src/view/layout.ts`, add HR handling in `computeLayout()`:

```typescript
if (block.type === 'horizontal-rule') {
  const HR_HEIGHT = 20; // 1px line + padding
  lines = [{ runs: [], y: 0, height: HR_HEIGHT, width: availableWidth }];
} else {
  // existing layoutBlock() call
}
```

- [ ] **Step 4: Implement HR rendering**

In `packages/docs/src/view/doc-canvas.ts`, add HR rendering in the page line loop:

```typescript
// When rendering a page line that belongs to a horizontal-rule block:
if (layoutBlock.block.type === 'horizontal-rule') {
  const lineY = pageY + pl.y + pl.line.height / 2;
  this.ctx.beginPath();
  this.ctx.strokeStyle = Theme.defaultColor;
  this.ctx.lineWidth = 1;
  this.ctx.moveTo(pageX + margins.left, lineY);
  this.ctx.lineTo(pageX + page.width - margins.right, lineY);
  this.ctx.stroke();
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test -- --run packages/docs/test/view/layout.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/docs/src/view/layout.ts packages/docs/src/view/doc-canvas.ts packages/docs/test/view/layout.test.ts
git commit -m "feat(docs): add horizontal rule layout and rendering"
```

---

## Task 6: Input handling for new block types

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

- [ ] **Step 1: Update Enter handling for headings**

In `text-editor.ts`, find `handleEnter()` method. After calling `doc.splitBlock()`, the new block is already a paragraph (from Task 2). No additional changes needed for heading Enter behavior — it's handled in `document.ts`.

- [ ] **Step 2: Update Enter handling for empty list items**

The `splitBlock()` in Task 2 already handles empty list-item → paragraph conversion. However, the TextEditor needs to handle the case where `splitBlock` returns the same blockId (meaning the block was converted, not split). Update `handleEnter()`:

```typescript
private handleEnter(): void {
  this.saveSnapshot();
  this.deleteSelection();
  this.invalidateLayout();

  const pos = this.cursor.position;
  const block = this.doc.getBlock(pos.blockId);

  // Empty list-item: splitBlock converts it to paragraph and returns same ID
  const newBlockId = this.doc.splitBlock(pos.blockId, pos.offset);

  if (newBlockId === pos.blockId) {
    // Block was converted in-place (empty list → paragraph)
    this.cursor.moveTo({ blockId: pos.blockId, offset: 0 });
  } else {
    this.cursor.moveTo({ blockId: newBlockId, offset: 0 });
  }
  this.selection.setRange(null);
  this.requestRender();
}
```

- [ ] **Step 3: Add Tab / Shift+Tab for list level**

In `handleKeyDown()`, add a `Tab` case:

```typescript
case 'Tab':
  e.preventDefault();
  this.handleTab(shiftKey);
  break;
```

Add `handleTab()` method:

```typescript
private handleTab(shift: boolean): void {
  const block = this.doc.getBlock(this.cursor.position.blockId);
  if (block.type !== 'list-item') return;

  this.saveSnapshot();
  const currentLevel = block.listLevel ?? 0;
  const newLevel = shift ? Math.max(0, currentLevel - 1) : Math.min(8, currentLevel + 1);
  if (newLevel === currentLevel) return;

  this.doc.setBlockType(block.id, 'list-item', {
    listKind: block.listKind,
    listLevel: newLevel,
  });
  this.invalidateLayout();
  this.requestRender();
}
```

- [ ] **Step 4: Prevent editing inside horizontal-rule blocks**

In `handleKeyDown()` and `handleInput()`, check if cursor is inside an HR block and skip text insertion:

```typescript
// At the top of handleInput:
const currentBlock = this.doc.getBlock(this.cursor.position.blockId);
if (currentBlock.type === 'horizontal-rule') return;
```

Similarly guard `handleBackspace()` and `handleDelete()` to skip if inside HR (or navigate away).

- [ ] **Step 5: Run full test suite**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "feat(docs): add input handling for headings, lists, and HR"
```

---

## Task 7: Editor API extensions

**Files:**
- Modify: `packages/docs/src/view/editor.ts`
- Modify: `packages/docs/src/index.ts`

- [ ] **Step 1: Add new methods to EditorAPI**

In `packages/docs/src/view/editor.ts`, extend the `EditorAPI` interface:

```typescript
/** Get the block type at the cursor position */
getBlockType(): { type: BlockType; headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number };
/** Set the block type for the block at cursor */
setBlockType(type: BlockType, opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number }): void;
/** Toggle list type on the block at cursor */
toggleList(kind: 'ordered' | 'unordered'): void;
```

Import `BlockType`, `HeadingLevel` from types.

- [ ] **Step 2: Implement the methods in initialize()**

Inside the returned API object:

```typescript
getBlockType() {
  const block = doc.getBlock(cursor.position.blockId);
  return {
    type: block.type,
    headingLevel: block.headingLevel,
    listKind: block.listKind,
    listLevel: block.listLevel,
  };
},

setBlockType(type, opts) {
  docStore.snapshot();
  doc.setBlockType(cursor.position.blockId, type, opts);
  invalidateLayout();
  render();
},

toggleList(kind) {
  const block = doc.getBlock(cursor.position.blockId);
  docStore.snapshot();
  if (block.type === 'list-item' && block.listKind === kind) {
    // Toggle off — convert back to paragraph
    doc.setBlockType(block.id, 'paragraph');
  } else {
    doc.setBlockType(block.id, 'list-item', { listKind: kind, listLevel: block.listLevel ?? 0 });
  }
  invalidateLayout();
  render();
},
```

- [ ] **Step 3: Export new types from index.ts** (if not already done in Task 1)

Verify `BlockType` and `HeadingLevel` are exported.

- [ ] **Step 4: Run full test suite**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/editor.ts packages/docs/src/index.ts
git commit -m "feat(docs): expose setBlockType, toggleList, getBlockType on EditorAPI"
```

---

## Task 8: Toolbar — heading dropdown and list buttons

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`

- [ ] **Step 1: Add heading dropdown**

After the alignment dropdown, add a heading-level dropdown:

```tsx
{/* Heading Dropdown */}
<DropdownMenu>
  <Tooltip>
    <TooltipTrigger asChild>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-7 cursor-pointer items-center justify-center gap-0 rounded-md px-1 text-sm hover:bg-muted"
          aria-label="Heading level"
        >
          <IconH1 size={16} />
          <IconChevronDown size={12} className="ml-0.5 opacity-50" />
        </button>
      </DropdownMenuTrigger>
    </TooltipTrigger>
    <TooltipContent>Heading level</TooltipContent>
  </Tooltip>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={() => handleBlockType('paragraph')}>
      Normal text
    </DropdownMenuItem>
    {([1, 2, 3, 4, 5, 6] as const).map((level) => (
      <DropdownMenuItem
        key={level}
        onClick={() => handleBlockType('heading', { headingLevel: level })}
      >
        Heading {level}
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

Add the handler:
```tsx
const handleBlockType = useCallback(
  (type: string, opts?: { headingLevel?: number }) => {
    editor?.setBlockType(type as any, opts as any);
  },
  [editor],
);
```

Import `IconH1` from `@tabler/icons-react`. Also import `IconList`, `IconListNumbers`.

- [ ] **Step 2: Add list toggle buttons**

```tsx
<Separator orientation="vertical" className="mx-1 h-6" />

{/* List Buttons */}
<Tooltip>
  <TooltipTrigger asChild>
    <button
      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
      onClick={() => editor?.toggleList('unordered')}
      aria-label="Bulleted list"
    >
      <IconList size={16} />
    </button>
  </TooltipTrigger>
  <TooltipContent>Bulleted list</TooltipContent>
</Tooltip>

<Tooltip>
  <TooltipTrigger asChild>
    <button
      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted"
      onClick={() => editor?.toggleList('ordered')}
      aria-label="Numbered list"
    >
      <IconListNumbers size={16} />
    </button>
  </TooltipTrigger>
  <TooltipContent>Numbered list</TooltipContent>
</Tooltip>
```

- [ ] **Step 3: Run lint and build**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/docs-formatting-toolbar.tsx
git commit -m "feat(frontend): add heading dropdown and list toggle buttons to docs toolbar"
```

---

## Task 9: Yorkie serialization

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [ ] **Step 1: Update buildBlockNode to serialize new attributes**

In `buildBlockNode()`, add heading/list attributes:

```typescript
function buildBlockNode(block: Block): ElementNode {
  const attrs: Record<string, string> = {
    id: block.id,
    type: block.type,
    ...serializeBlockStyle(block.style),
  };
  if (block.headingLevel !== undefined) {
    attrs.headingLevel = String(block.headingLevel);
  }
  if (block.listKind !== undefined) {
    attrs.listKind = block.listKind;
  }
  if (block.listLevel !== undefined) {
    attrs.listLevel = String(block.listLevel);
  }
  return {
    type: 'block',
    attributes: attrs,
    children: block.inlines.map(buildInlineNode),
  };
}
```

- [ ] **Step 2: Update treeNodeToBlock to deserialize new attributes**

In `treeNodeToBlock()`, parse the new attributes:

```typescript
function treeNodeToBlock(node: TreeNode): Block {
  const el = node as ElementNode;
  const attrs = (el.attributes ?? {}) as Record<string, string>;
  const inlines = (el.children ?? [])
    .filter((c) => c.type === 'inline')
    .map(treeNodeToInline);
  const block: Block = {
    id: attrs.id ?? '',
    type: (attrs.type as Block['type']) ?? 'paragraph',
    inlines: inlines.length > 0 ? inlines : [{ text: '', style: {} }],
    style: parseBlockStyle(attrs),
  };
  if ('headingLevel' in attrs) {
    block.headingLevel = Number(attrs.headingLevel) as Block['headingLevel'];
  }
  if ('listKind' in attrs) {
    block.listKind = attrs.listKind as Block['listKind'];
  }
  if ('listLevel' in attrs) {
    block.listLevel = Number(attrs.listLevel);
  }
  return block;
}
```

- [ ] **Step 3: Run verify**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "feat(frontend): serialize heading/list attributes in Yorkie doc store"
```

---

## Task 10: Ordered list numbering

**Files:**
- Modify: `packages/docs/src/view/doc-canvas.ts`
- Modify: `packages/docs/src/view/layout.ts` (or pagination)

- [ ] **Step 1: Compute ordered list counters**

Ordered lists need sequential numbering. Add a helper that, given the document blocks, computes the display number for each ordered list-item:

In `layout.ts`, add and export:

```typescript
/**
 * Compute display numbers for ordered list items.
 * Returns a map of blockId → display number string.
 * Consecutive ordered list-items at the same level share a counter.
 */
export function computeListCounters(blocks: Block[]): Map<string, string> {
  const counters = new Map<string, string>();
  const levelCounters: number[] = [];

  for (const block of blocks) {
    if (block.type !== 'list-item' || block.listKind !== 'ordered') {
      levelCounters.length = 0; // Reset on non-list block
      continue;
    }
    const level = block.listLevel ?? 0;
    // Trim counters above this level
    levelCounters.length = Math.max(levelCounters.length, level + 1);
    if (levelCounters[level] === undefined) levelCounters[level] = 0;
    levelCounters[level]++;
    // Reset deeper levels
    for (let i = level + 1; i < levelCounters.length; i++) {
      levelCounters[i] = 0;
    }
    counters.set(block.id, formatOrderedMarker(levelCounters[level], level));
  }
  return counters;
}

function formatOrderedMarker(num: number, level: number): string {
  const format = level % 3;
  if (format === 0) return `${num}.`;
  if (format === 1) return `${String.fromCharCode(96 + ((num - 1) % 26) + 1)}.`;
  // lower-roman for level 2, 5, 8...
  return `${toRoman(num)}.`;
}

function toRoman(num: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) {
      result += syms[i];
      num -= vals[i];
    }
  }
  return result;
}
```

- [ ] **Step 2: Pass counters to renderer**

The list counters need to be available during rendering. Compute them in `editor.ts` during the render pipeline and pass to `DocCanvas.render()`, or compute them within the render method itself from `paginatedLayout`.

Simplest approach: compute in the render function and store alongside layout. The DocCanvas `render()` method already has access to `paginatedLayout` which contains blocks. Add counter computation at the start of render and use it in `renderListMarker()`.

- [ ] **Step 3: Update renderListMarker to use counter**

```typescript
private renderListMarker(
  block: Block,
  lineX: number,
  lineY: number,
  lineHeight: number,
  markerX: number,
  orderedMarker?: string,
): void {
  // ... same as before, but for ordered:
  if (block.listKind === 'ordered' && orderedMarker) {
    this.ctx.fillText(orderedMarker, markerX, baselineY);
  }
}
```

- [ ] **Step 4: Write test for ordered numbering**

Add to `packages/docs/test/view/layout.test.ts`:

```typescript
import { computeListCounters } from '../../src/view/layout.js';

describe('computeListCounters', () => {
  it('should number consecutive ordered items', () => {
    const blocks = [
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
    ];
    const counters = computeListCounters(blocks);
    expect(counters.get(blocks[0].id)).toBe('1.');
    expect(counters.get(blocks[1].id)).toBe('2.');
    expect(counters.get(blocks[2].id)).toBe('3.');
  });

  it('should reset counter after a non-list block', () => {
    const blocks = [
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
      createBlock('paragraph'),
      createBlock('list-item', { listKind: 'ordered', listLevel: 0 }),
    ];
    blocks[0].inlines = [{ text: 'A', style: {} }];
    blocks[1].inlines = [{ text: 'break', style: {} }];
    blocks[2].inlines = [{ text: 'B', style: {} }];
    const counters = computeListCounters(blocks);
    expect(counters.get(blocks[0].id)).toBe('1.');
    expect(counters.get(blocks[2].id)).toBe('1.');
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/layout.ts packages/docs/src/view/doc-canvas.ts packages/docs/test/view/layout.test.ts
git commit -m "feat(docs): add ordered list numbering with level-based format"
```

---

## Task 11: Keyboard shortcuts for headings

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

- [ ] **Step 1: Add Ctrl+Alt+1–6 shortcuts**

In `handleKeyDown()`, add cases for heading shortcuts. The key values for number keys are `'1'` through `'6'`:

```typescript
case '1': case '2': case '3': case '4': case '5': case '6':
  if (mod && altKey) {
    e.preventDefault();
    const level = Number(key) as HeadingLevel;
    const block = this.doc.getBlock(this.cursor.position.blockId);
    if (block.type === 'heading' && block.headingLevel === level) {
      this.doc.setBlockType(block.id, 'paragraph');
    } else {
      this.doc.setBlockType(block.id, 'heading', { headingLevel: level });
    }
    this.invalidateLayout();
    this.requestRender();
  }
  break;
```

Import `HeadingLevel` from types.

Note: The `saveSnapshot` call needs to be added for undo support. Add `this.saveSnapshot()` before `setBlockType`.

- [ ] **Step 2: Add Ctrl+Alt+0 to reset to paragraph**

```typescript
case '0':
  if (mod && altKey) {
    e.preventDefault();
    this.saveSnapshot();
    this.doc.setBlockType(this.cursor.position.blockId, 'paragraph');
    this.invalidateLayout();
    this.requestRender();
  }
  break;
```

- [ ] **Step 3: Run verify**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "feat(docs): add Ctrl+Alt+0-6 shortcuts for heading levels"
```

---

## Task 12: Markdown-style auto-conversion

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

- [ ] **Step 1: Add auto-conversion on Enter/Space**

When the user types a recognized pattern at the start of a block and presses Space, auto-convert:
- `# ` → H1, `## ` → H2, ... `###### ` → H6
- `- ` or `* ` → unordered list
- `1. ` → ordered list
- `---` + Enter → horizontal rule

In `handleInput()` or a new helper called after text insertion, check the block text:

```typescript
private tryAutoConvert(blockId: string): boolean {
  const block = this.doc.getBlock(blockId);
  if (block.type !== 'paragraph') return false;
  const text = getBlockText(block);

  // Heading: "# " through "###### "
  const headingMatch = text.match(/^(#{1,6}) $/);
  if (headingMatch) {
    const level = headingMatch[1].length as HeadingLevel;
    this.doc.deleteText({ blockId, offset: 0 }, text.length);
    this.doc.setBlockType(blockId, 'heading', { headingLevel: level });
    this.cursor.moveTo({ blockId, offset: 0 });
    this.invalidateLayout();
    return true;
  }

  // Unordered list: "- " or "* "
  if (text === '- ' || text === '* ') {
    this.doc.deleteText({ blockId, offset: 0 }, text.length);
    this.doc.setBlockType(blockId, 'list-item', { listKind: 'unordered', listLevel: 0 });
    this.cursor.moveTo({ blockId, offset: 0 });
    this.invalidateLayout();
    return true;
  }

  // Ordered list: "1. "
  if (text === '1. ') {
    this.doc.deleteText({ blockId, offset: 0 }, text.length);
    this.doc.setBlockType(blockId, 'list-item', { listKind: 'ordered', listLevel: 0 });
    this.cursor.moveTo({ blockId, offset: 0 });
    this.invalidateLayout();
    return true;
  }

  return false;
}
```

Call `tryAutoConvert()` after each space character insertion in `handleInput()`.

For `---` + Enter → HR, add in `handleEnter()`:
```typescript
// Before the normal splitBlock logic:
const block = this.doc.getBlock(pos.blockId);
const text = getBlockText(block);
if (block.type === 'paragraph' && text === '---') {
  this.doc.deleteText({ blockId: pos.blockId, offset: 0 }, 3);
  this.doc.setBlockType(pos.blockId, 'horizontal-rule');
  // Insert a new paragraph after the HR
  const newId = this.doc.splitBlock(pos.blockId, 0);
  this.cursor.moveTo({ blockId: newId, offset: 0 });
  this.invalidateLayout();
  this.requestRender();
  return;
}
```

- [ ] **Step 2: Run verify**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "feat(docs): add Markdown-style auto-conversion for headings, lists, HR"
```

---

## Task 13: Final integration and cleanup

**Files:**
- All modified files
- Modify: `docs/tasks/active/20260325-docs-wordprocessor-todo.md`

- [ ] **Step 1: Run full verification**

Run: `pnpm verify:fast`
Expected: ALL PASS

- [ ] **Step 2: Manual smoke test**

Run: `pnpm dev`
Test in browser:
1. Type `# ` → should convert to H1
2. Type `## ` → should convert to H2
3. Ctrl+Alt+3 → should convert current block to H3
4. Type `- ` → should convert to unordered list
5. Type `1. ` → should convert to ordered list
6. Tab in list → should increase level
7. Shift+Tab in list → should decrease level
8. Enter on empty list item → should exit list
9. Enter on heading → new block should be paragraph
10. Type `---` then Enter → should create horizontal rule
11. Test with real-time collaboration (two browser tabs)

- [ ] **Step 3: Update task tracking**

Mark Phase 1 items as complete in `docs/tasks/active/20260325-docs-wordprocessor-todo.md`.

- [ ] **Step 4: Final commit**

```bash
git add docs/tasks/active/20260325-docs-wordprocessor-todo.md
git commit -m "docs: mark Phase 1 block type extensions as complete"
```
