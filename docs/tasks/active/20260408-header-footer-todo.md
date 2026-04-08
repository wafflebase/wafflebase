# Header & Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable header/footer regions with page number support to the paginated document editor.

**Architecture:** Extend the Document model with `header?` and `footer?` fields containing Block arrays. Reuse `computeLayout()` for header/footer layout. TextEditor gains an `editContext` to route editing operations to the correct block array. MemDocStore finds blocks across body/header/footer arrays by ID.

**Tech Stack:** TypeScript, Canvas 2D API, Vitest

**Design doc:** [docs-header-footer.md](../../design/docs/docs-header-footer.md)

---

### Task 1: Data Model — HeaderFooter type, Document extension, pageNumber inline

**Files:**
- Modify: `packages/docs/src/model/types.ts`
- Test: `packages/docs/test/model/types.test.ts`

- [ ] **Step 1: Write failing tests for HeaderFooter types**

Add to the end of `packages/docs/test/model/types.test.ts`:

```typescript
describe('HeaderFooter', () => {
  it('should include header and footer in Document type', () => {
    const doc: Document = {
      blocks: [createEmptyBlock()],
      header: {
        blocks: [createEmptyBlock()],
        marginFromEdge: 48,
      },
      footer: {
        blocks: [createEmptyBlock()],
        marginFromEdge: 48,
      },
    };
    expect(doc.header).toBeDefined();
    expect(doc.header!.blocks).toHaveLength(1);
    expect(doc.header!.marginFromEdge).toBe(48);
    expect(doc.footer).toBeDefined();
    expect(doc.footer!.blocks).toHaveLength(1);
  });

  it('should support pageNumber in InlineStyle', () => {
    const inline: Inline = {
      text: '#',
      style: { pageNumber: true },
    };
    expect(inline.style.pageNumber).toBe(true);
  });

  it('should allow Document without header/footer', () => {
    const doc: Document = { blocks: [createEmptyBlock()] };
    expect(doc.header).toBeUndefined();
    expect(doc.footer).toBeUndefined();
  });
});
```

Add `Inline` to the import from `../src/model/types.js` if not already imported.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/model/types.test.ts`
Expected: FAIL — `HeaderFooter` type does not exist, `pageNumber` not in InlineStyle.

- [ ] **Step 3: Implement the types**

In `packages/docs/src/model/types.ts`:

Add after the `Document` interface (line 14):

```typescript
/**
 * Header or footer region containing editable blocks.
 */
export interface HeaderFooter {
  blocks: Block[];
  marginFromEdge: number;
}
```

Extend `Document`:

```typescript
export interface Document {
  blocks: Block[];
  pageSetup?: PageSetup;
  header?: HeaderFooter;
  footer?: HeaderFooter;
}
```

Add `pageNumber` to `InlineStyle` (after `href`):

```typescript
export interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  superscript?: boolean;
  subscript?: boolean;
  href?: string;
  pageNumber?: boolean;
}
```

Add default constant (near the PageSetup defaults):

```typescript
export const DEFAULT_HEADER_MARGIN_FROM_EDGE = 48;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/model/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/test/model/types.test.ts
git commit -m "Add HeaderFooter type, Document extension, pageNumber inline"
```

---

### Task 2: Store — DocStore interface + MemDocStore header/footer support

**Files:**
- Modify: `packages/docs/src/store/store.ts`
- Modify: `packages/docs/src/store/memory.ts`
- Test: `packages/docs/test/store/memory.test.ts` (create if needed)

- [ ] **Step 1: Write failing tests for store header/footer operations**

Create `packages/docs/test/store/memory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { createEmptyBlock } from '../../src/model/types.js';
import type { HeaderFooter } from '../../src/model/types.js';

describe('MemDocStore header/footer', () => {
  it('should return undefined when no header/footer set', () => {
    const store = new MemDocStore({ blocks: [createEmptyBlock()] });
    expect(store.getHeader()).toBeUndefined();
    expect(store.getFooter()).toBeUndefined();
  });

  it('should set and get header', () => {
    const store = new MemDocStore({ blocks: [createEmptyBlock()] });
    const header: HeaderFooter = {
      blocks: [createEmptyBlock()],
      marginFromEdge: 48,
    };
    store.setHeader(header);
    const got = store.getHeader();
    expect(got).toBeDefined();
    expect(got!.blocks).toHaveLength(1);
    expect(got!.marginFromEdge).toBe(48);
  });

  it('should set and get footer', () => {
    const store = new MemDocStore({ blocks: [createEmptyBlock()] });
    const footer: HeaderFooter = {
      blocks: [createEmptyBlock()],
      marginFromEdge: 48,
    };
    store.setFooter(footer);
    const got = store.getFooter();
    expect(got).toBeDefined();
    expect(got!.blocks).toHaveLength(1);
  });

  it('should remove header when set to undefined', () => {
    const store = new MemDocStore({ blocks: [createEmptyBlock()] });
    store.setHeader({ blocks: [createEmptyBlock()], marginFromEdge: 48 });
    expect(store.getHeader()).toBeDefined();
    store.setHeader(undefined);
    expect(store.getHeader()).toBeUndefined();
  });

  it('should find blocks in header for text operations', () => {
    const store = new MemDocStore({ blocks: [createEmptyBlock()] });
    const headerBlock = createEmptyBlock();
    store.setHeader({ blocks: [headerBlock], marginFromEdge: 48 });
    // insertText should work on header blocks
    store.insertText(headerBlock.id, 0, 'Header text');
    const header = store.getHeader()!;
    expect(header.blocks[0].inlines[0].text).toBe('Header text');
  });

  it('should split block in header', () => {
    const store = new MemDocStore({ blocks: [createEmptyBlock()] });
    const headerBlock = createEmptyBlock();
    store.setHeader({ blocks: [headerBlock], marginFromEdge: 48 });
    store.insertText(headerBlock.id, 0, 'AB');
    store.splitBlock(headerBlock.id, 1, 'new-id', 'paragraph');
    const header = store.getHeader()!;
    expect(header.blocks).toHaveLength(2);
    expect(header.blocks[0].inlines[0].text).toBe('A');
    expect(header.blocks[1].inlines[0].text).toBe('B');
  });

  it('should merge blocks in header', () => {
    const store = new MemDocStore({ blocks: [createEmptyBlock()] });
    const b1 = createEmptyBlock();
    const b2 = createEmptyBlock();
    store.setHeader({ blocks: [b1, b2], marginFromEdge: 48 });
    store.insertText(b1.id, 0, 'A');
    store.insertText(b2.id, 0, 'B');
    store.mergeBlock(b1.id, b2.id);
    const header = store.getHeader()!;
    expect(header.blocks).toHaveLength(1);
    expect(header.blocks[0].inlines[0].text).toBe('AB');
  });

  it('should include header/footer in undo/redo snapshots', () => {
    const store = new MemDocStore({ blocks: [createEmptyBlock()] });
    store.setHeader({ blocks: [createEmptyBlock()], marginFromEdge: 48 });
    store.snapshot();
    store.setHeader(undefined);
    expect(store.getHeader()).toBeUndefined();
    store.undo();
    expect(store.getHeader()).toBeDefined();
  });

  it('should clone header/footer in getDocument', () => {
    const store = new MemDocStore({ blocks: [createEmptyBlock()] });
    const headerBlock = createEmptyBlock();
    store.setHeader({ blocks: [headerBlock], marginFromEdge: 48 });
    const doc1 = store.getDocument();
    doc1.header!.blocks[0].inlines[0].text = 'mutated';
    const doc2 = store.getDocument();
    expect(doc2.header!.blocks[0].inlines[0].text).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/store/memory.test.ts`
Expected: FAIL — getHeader/getFooter do not exist.

- [ ] **Step 3: Add header/footer to DocStore interface**

In `packages/docs/src/store/store.ts`, add to the `DocStore` interface:

```typescript
  getHeader(): HeaderFooter | undefined;
  getFooter(): HeaderFooter | undefined;
  setHeader(header: HeaderFooter | undefined): void;
  setFooter(footer: HeaderFooter | undefined): void;
```

Add the import: `import type { HeaderFooter } from '../model/types.js';`

- [ ] **Step 4: Implement in MemDocStore**

In `packages/docs/src/store/memory.ts`:

Add import of `HeaderFooter` type.

Update `cloneDocument` to also clone header/footer:

```typescript
function cloneDocument(doc: Document): Document {
  const cloned: Document = JSON.parse(JSON.stringify(doc));
  for (const block of cloned.blocks) {
    block.style = normalizeBlockStyle(block.style);
  }
  if (cloned.header) {
    for (const block of cloned.header.blocks) {
      block.style = normalizeBlockStyle(block.style);
    }
  }
  if (cloned.footer) {
    for (const block of cloned.footer.blocks) {
      block.style = normalizeBlockStyle(block.style);
    }
  }
  return cloned;
}
```

Add a `findBlockAndArray` helper method to MemDocStore that searches body, header, and footer:

```typescript
  /**
   * Find a block by ID across body, header, and footer arrays.
   * Returns the block array and index within that array.
   */
  private findBlockInAnyArray(id: string): { blocks: Block[]; index: number } {
    const bodyIdx = this.doc.blocks.findIndex((b) => b.id === id);
    if (bodyIdx !== -1) return { blocks: this.doc.blocks, index: bodyIdx };
    if (this.doc.header) {
      const hIdx = this.doc.header.blocks.findIndex((b) => b.id === id);
      if (hIdx !== -1) return { blocks: this.doc.header.blocks, index: hIdx };
    }
    if (this.doc.footer) {
      const fIdx = this.doc.footer.blocks.findIndex((b) => b.id === id);
      if (fIdx !== -1) return { blocks: this.doc.footer.blocks, index: fIdx };
    }
    throw new Error(`Block not found: ${id}`);
  }
```

Add the header/footer getters/setters:

```typescript
  getHeader(): HeaderFooter | undefined {
    return this.doc.header ? JSON.parse(JSON.stringify(this.doc.header)) : undefined;
  }

  getFooter(): HeaderFooter | undefined {
    return this.doc.footer ? JSON.parse(JSON.stringify(this.doc.footer)) : undefined;
  }

  setHeader(header: HeaderFooter | undefined): void {
    this.doc.header = header ? JSON.parse(JSON.stringify(header)) : undefined;
  }

  setFooter(footer: HeaderFooter | undefined): void {
    this.doc.footer = footer ? JSON.parse(JSON.stringify(footer)) : undefined;
  }
```

Update the existing block-mutating methods to use `findBlockInAnyArray` instead of searching only `this.doc.blocks`. Replace the pattern `this.doc.blocks.findIndex((b) => b.id === id)` with `findBlockInAnyArray(id)` in these methods:

- `getBlock(id)`: use `findBlockInAnyArray(id).blocks[result.index]`
- `updateBlock(id, block)`: use `findBlockInAnyArray`
- `deleteBlock(id)`: use `findBlockInAnyArray`, splice from correct array
- `insertText(blockId, ...)`: use `findBlockInAnyArray`
- `deleteText(blockId, ...)`: use `findBlockInAnyArray`
- `applyStyle(blockId, ...)`: use `findBlockInAnyArray`
- `splitBlock(blockId, ...)`: use `findBlockInAnyArray`, splice into correct array
- `mergeBlock(blockId, nextBlockId)`: use `findBlockInAnyArray` for both
- `findBlock(id)` (private): update to use `findBlockInAnyArray`

Example for `insertText`:
```typescript
  insertText(blockId: string, offset: number, text: string): void {
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    blocks[index] = applyInsertText(blocks[index], offset, text);
  }
```

Example for `splitBlock`:
```typescript
  splitBlock(blockId: string, offset: number, newBlockId: string, newBlockType: BlockType): void {
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    const [before, after] = applySplitBlock(blocks[index], offset, newBlockId, newBlockType);
    blocks[index] = before;
    blocks.splice(index + 1, 0, after);
  }
```

Example for `mergeBlock`:
```typescript
  mergeBlock(blockId: string, nextBlockId: string): void {
    if (blockId === nextBlockId) throw new Error('Cannot merge a block with itself');
    const { blocks: arr1, index: idx1 } = this.findBlockInAnyArray(blockId);
    const { blocks: arr2, index: idx2 } = this.findBlockInAnyArray(nextBlockId);
    if (arr1 !== arr2) throw new Error('Cannot merge blocks from different regions');
    arr1[idx1] = applyMergeBlocks(arr1[idx1], arr2[idx2]);
    arr2.splice(idx2, 1);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/store/memory.test.ts`
Expected: PASS

- [ ] **Step 6: Run all existing tests to verify no regressions**

Run: `cd packages/docs && npx vitest run`
Expected: All existing tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/docs/src/store/store.ts packages/docs/src/store/memory.ts packages/docs/test/store/memory.test.ts
git commit -m "Add header/footer support to DocStore and MemDocStore"
```

---

### Task 3: Doc class — editContext and header/footer block routing

**Files:**
- Modify: `packages/docs/src/model/document.ts`
- Test: `packages/docs/test/model/document.test.ts`

- [ ] **Step 1: Write failing tests for Doc editContext**

Add to `packages/docs/test/model/document.test.ts`:

```typescript
describe('Doc editContext', () => {
  it('should default to body context', () => {
    const doc = Doc.create();
    expect(doc.editContext).toBe('body');
  });

  it('should find header blocks via getBlock', () => {
    const store = new MemDocStore();
    const headerBlock = createEmptyBlock();
    store.setDocument({
      blocks: [createEmptyBlock()],
      header: { blocks: [headerBlock], marginFromEdge: 48 },
    });
    const doc = new Doc(store);
    const found = doc.getBlock(headerBlock.id);
    expect(found.id).toBe(headerBlock.id);
  });

  it('should use context blocks for getBlockIndex', () => {
    const store = new MemDocStore();
    const bodyBlock = createEmptyBlock();
    const headerBlock = createEmptyBlock();
    store.setDocument({
      blocks: [bodyBlock],
      header: { blocks: [headerBlock], marginFromEdge: 48 },
    });
    const doc = new Doc(store);
    expect(doc.getBlockIndex(headerBlock.id)).toBe(-1); // not in body
    doc.editContext = 'header';
    expect(doc.getBlockIndex(headerBlock.id)).toBe(0);
  });

  it('should return context blocks via getContextBlocks', () => {
    const store = new MemDocStore();
    const bodyBlock = createEmptyBlock();
    const headerBlock = createEmptyBlock();
    const footerBlock = createEmptyBlock();
    store.setDocument({
      blocks: [bodyBlock],
      header: { blocks: [headerBlock], marginFromEdge: 48 },
      footer: { blocks: [footerBlock], marginFromEdge: 48 },
    });
    const doc = new Doc(store);
    expect(doc.getContextBlocks()).toHaveLength(1);
    expect(doc.getContextBlocks()[0].id).toBe(bodyBlock.id);
    doc.editContext = 'header';
    expect(doc.getContextBlocks()).toHaveLength(1);
    expect(doc.getContextBlocks()[0].id).toBe(headerBlock.id);
    doc.editContext = 'footer';
    expect(doc.getContextBlocks()[0].id).toBe(footerBlock.id);
  });

  it('should ensureHeader create header with empty paragraph', () => {
    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    const doc = new Doc(store);
    expect(doc.document.header).toBeUndefined();
    doc.ensureHeader();
    doc.refresh();
    expect(doc.document.header).toBeDefined();
    expect(doc.document.header!.blocks).toHaveLength(1);
    expect(doc.document.header!.blocks[0].type).toBe('paragraph');
  });

  it('should ensureFooter create footer with empty paragraph', () => {
    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    const doc = new Doc(store);
    doc.ensureFooter();
    doc.refresh();
    expect(doc.document.footer).toBeDefined();
    expect(doc.document.footer!.blocks).toHaveLength(1);
  });

  it('should insertText in header context', () => {
    const store = new MemDocStore();
    const headerBlock = createEmptyBlock();
    store.setDocument({
      blocks: [createEmptyBlock()],
      header: { blocks: [headerBlock], marginFromEdge: 48 },
    });
    const doc = new Doc(store);
    doc.editContext = 'header';
    doc.insertText({ blockId: headerBlock.id, offset: 0 }, 'Hello');
    expect(doc.document.header!.blocks[0].inlines[0].text).toBe('Hello');
  });

  it('should deleteBackward merge header blocks', () => {
    const store = new MemDocStore();
    const b1 = createEmptyBlock();
    const b2 = createEmptyBlock();
    store.setDocument({
      blocks: [createEmptyBlock()],
      header: { blocks: [b1, b2], marginFromEdge: 48 },
    });
    const doc = new Doc(store);
    doc.editContext = 'header';
    store.insertText(b1.id, 0, 'A');
    store.insertText(b2.id, 0, 'B');
    doc.refresh();
    const newPos = doc.deleteBackward({ blockId: b2.id, offset: 0 });
    expect(newPos.blockId).toBe(b1.id);
    expect(newPos.offset).toBe(1);
    expect(doc.document.header!.blocks).toHaveLength(1);
  });
});
```

Add imports at the top: `import { MemDocStore } from '../../src/store/memory.js';`, `import { createEmptyBlock } from '../../src/model/types.js';`

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/model/document.test.ts`
Expected: FAIL — `editContext`, `getContextBlocks`, `ensureHeader`, `ensureFooter` do not exist.

- [ ] **Step 3: Implement editContext and context routing in Doc**

In `packages/docs/src/model/document.ts`:

Add the type export:
```typescript
export type EditContext = 'body' | 'header' | 'footer';
```

Add to the `Doc` class, after the `_blockParentMap` field:

```typescript
  editContext: EditContext = 'body';
```

Add `getContextBlocks` method:

```typescript
  /**
   * Get the block array for the current edit context.
   */
  getContextBlocks(): Block[] {
    if (this.editContext === 'header') return this._document.header?.blocks ?? [];
    if (this.editContext === 'footer') return this._document.footer?.blocks ?? [];
    return this._document.blocks;
  }
```

Add `ensureHeader` and `ensureFooter`:

```typescript
  /**
   * Ensure header exists, creating one with an empty paragraph if needed.
   */
  ensureHeader(): void {
    if (!this._document.header) {
      this.store.setHeader({
        blocks: [createEmptyBlock()],
        marginFromEdge: DEFAULT_HEADER_MARGIN_FROM_EDGE,
      });
      this.refresh();
    }
  }

  /**
   * Ensure footer exists, creating one with an empty paragraph if needed.
   */
  ensureFooter(): void {
    if (!this._document.footer) {
      this.store.setFooter({
        blocks: [createEmptyBlock()],
        marginFromEdge: DEFAULT_HEADER_MARGIN_FROM_EDGE,
      });
      this.refresh();
    }
  }
```

Add `DEFAULT_HEADER_MARGIN_FROM_EDGE` to the import from `./types.js`.

Update `getBlock` to also search header/footer blocks:

```typescript
  getBlock(blockId: string): Block {
    const block = this._document.blocks.find((b) => b.id === blockId);
    if (block) return block;

    // Search header/footer blocks
    const hBlock = this._document.header?.blocks.find((b) => b.id === blockId);
    if (hBlock) return hBlock;
    const fBlock = this._document.footer?.blocks.find((b) => b.id === blockId);
    if (fBlock) return fBlock;

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

Update `getBlockIndex` to use context blocks:

```typescript
  getBlockIndex(blockId: string): number {
    return this.getContextBlocks().findIndex((b) => b.id === blockId);
  }
```

Update `deleteBackward` to use `getContextBlocks()` instead of `this._document.blocks`:

Replace `this._document.blocks[blockIndex - 1]` and `this._document.blocks[blockIndex]` with:
```typescript
    const blocks = this.getContextBlocks();
    const blockIndex = this.getBlockIndex(pos.blockId);
    if (blockIndex <= 0) return pos;

    const prevBlock = blocks[blockIndex - 1];
    const currentBlock = blocks[blockIndex];
```

Update `splitBlock` similarly — replace `this._document.blocks[blockIndex]` with `this.getContextBlocks()[blockIndex]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/model/document.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `cd packages/docs && npx vitest run`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/test/model/document.test.ts
git commit -m "Add editContext to Doc for header/footer block routing"
```

---

### Task 4: Pagination helpers — header/footer Y positioning

**Files:**
- Modify: `packages/docs/src/view/pagination.ts`
- Test: `packages/docs/test/view/pagination.test.ts`

- [ ] **Step 1: Write failing tests for header/footer positioning**

Add to `packages/docs/test/view/pagination.test.ts`:

```typescript
import { getHeaderYStart, getFooterYStart } from '../../src/view/pagination.js';

describe('header/footer positioning', () => {
  it('should return header Y start within top margin', () => {
    const paginatedLayout = buildPaginatedLayout(1); // helper
    const y = getHeaderYStart(paginatedLayout, 0, 48);
    const pageY = getPageYOffset(paginatedLayout, 0);
    expect(y).toBe(pageY + 48);
  });

  it('should return footer Y start within bottom margin', () => {
    const paginatedLayout = buildPaginatedLayout(1);
    const pageY = getPageYOffset(paginatedLayout, 0);
    const pageHeight = paginatedLayout.pages[0].height;
    const footerHeight = 20;
    const y = getFooterYStart(paginatedLayout, 0, footerHeight, 48);
    expect(y).toBe(pageY + pageHeight - 48 - footerHeight);
  });
});
```

Where `buildPaginatedLayout` creates a simple PaginatedLayout — use the existing test helpers or create a minimal one:

```typescript
function buildPaginatedLayout(pageCount: number): PaginatedLayout {
  const pageSetup = DEFAULT_PAGE_SETUP;
  const dims = getEffectiveDimensions(pageSetup);
  const pages: LayoutPage[] = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push({ pageIndex: i, lines: [], width: dims.width, height: dims.height });
  }
  return { pages, pageSetup };
}
```

Add necessary imports: `DEFAULT_PAGE_SETUP`, `getEffectiveDimensions`, `LayoutPage`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/view/pagination.test.ts`
Expected: FAIL — `getHeaderYStart`, `getFooterYStart` do not exist.

- [ ] **Step 3: Implement the helper functions**

In `packages/docs/src/view/pagination.ts`, add:

```typescript
/**
 * Get the absolute Y start position for the header on a given page.
 * Header starts at marginFromEdge from the page's top edge.
 */
export function getHeaderYStart(
  paginatedLayout: PaginatedLayout,
  pageIndex: number,
  marginFromEdge: number,
): number {
  const pageY = getPageYOffset(paginatedLayout, pageIndex);
  return pageY + marginFromEdge;
}

/**
 * Get the absolute Y start position for the footer on a given page.
 * Footer ends at marginFromEdge from the page's bottom edge.
 */
export function getFooterYStart(
  paginatedLayout: PaginatedLayout,
  pageIndex: number,
  footerHeight: number,
  marginFromEdge: number,
): number {
  const pageY = getPageYOffset(paginatedLayout, pageIndex);
  const pageHeight = paginatedLayout.pages[pageIndex]?.height ?? 0;
  return pageY + pageHeight - marginFromEdge - footerHeight;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/view/pagination.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/view/pagination.ts packages/docs/test/view/pagination.test.ts
git commit -m "Add header/footer Y positioning helpers to pagination"
```

---

### Task 5: Canvas rendering — header/footer per page + page number substitution

**Files:**
- Modify: `packages/docs/src/view/doc-canvas.ts`
- Modify: `packages/docs/src/view/theme.ts`

- [ ] **Step 1: Add theme constants for header/footer edit mode**

In `packages/docs/src/view/theme.ts`, add to the `DocTheme` interface:

```typescript
  headerFooterBorderColor: string;
  headerFooterDimAlpha: number;
```

Add to the light theme object:

```typescript
  headerFooterBorderColor: '#cccccc',
  headerFooterDimAlpha: 0.4,
```

Add to the dark theme object (same or slightly adjusted values):

```typescript
  headerFooterBorderColor: '#555555',
  headerFooterDimAlpha: 0.4,
```

- [ ] **Step 2: Extend DocCanvas.render() signature**

In `packages/docs/src/view/doc-canvas.ts`, add new parameters to the `render` method signature (before the closing `): void {`):

```typescript
    headerLayout?: DocumentLayout | null,
    footerLayout?: DocumentLayout | null,
    headerFooter?: { header?: { marginFromEdge: number }; footer?: { marginFromEdge: number } },
    editContext?: 'body' | 'header' | 'footer',
    headerCursor?: { x: number; y: number; height: number; visible: boolean },
    footerCursor?: { x: number; y: number; height: number; visible: boolean },
```

Add imports at the top:

```typescript
import { getHeaderYStart, getFooterYStart } from './pagination.js';
```

- [ ] **Step 3: Implement header/footer rendering in the page loop**

Inside the page loop, after drawing the page background and before the content clip, add header/footer rendering:

```typescript
      // Draw header
      if (headerLayout && headerFooter?.header) {
        const hfMargin = headerFooter.header.marginFromEdge;
        const headerY = getHeaderYStart(paginatedLayout, page.pageIndex, hfMargin);
        const headerClipHeight = margins.top - hfMargin;

        this.ctx.save();
        if (editContext && editContext !== 'header') {
          // Dim when not editing header
        }
        this.ctx.beginPath();
        this.ctx.rect(contentX, pageY + hfMargin, contentWidth, headerClipHeight);
        this.ctx.clip();

        for (const lb of headerLayout.blocks) {
          for (const line of lb.lines) {
            for (const run of line.runs) {
              this.renderRunWithPageNumber(
                run, contentX + run.x, headerY + lb.y + line.y, line.height,
                page.pageIndex + 1,
              );
            }
          }
        }

        // Draw cursor if editing header on this page
        if (editContext === 'header' && headerCursor?.visible) {
          this.ctx.fillStyle = Theme.cursorColor;
          this.ctx.fillRect(headerCursor.x, headerCursor.y, Theme.cursorWidth, headerCursor.height);
        }

        this.ctx.restore();

        // Draw dashed border when editing header
        if (editContext === 'header') {
          this.ctx.save();
          this.ctx.strokeStyle = Theme.headerFooterBorderColor;
          this.ctx.lineWidth = 1;
          this.ctx.setLineDash([4, 4]);
          this.ctx.strokeRect(contentX, pageY + hfMargin, contentWidth, headerClipHeight);
          this.ctx.setLineDash([]);
          this.ctx.restore();
        }
      }

      // Draw footer
      if (footerLayout && headerFooter?.footer) {
        const fMargin = headerFooter.footer.marginFromEdge;
        const footerTotalH = footerLayout.totalHeight;
        const footerY = getFooterYStart(paginatedLayout, page.pageIndex, footerTotalH, fMargin);
        const footerClipHeight = margins.bottom - fMargin;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(contentX, pageY + page.height - margins.bottom, contentWidth, footerClipHeight);
        this.ctx.clip();

        for (const lb of footerLayout.blocks) {
          for (const line of lb.lines) {
            for (const run of line.runs) {
              this.renderRunWithPageNumber(
                run, contentX + run.x, footerY + lb.y + line.y, line.height,
                page.pageIndex + 1,
              );
            }
          }
        }

        // Draw cursor if editing footer on this page
        if (editContext === 'footer' && footerCursor?.visible) {
          this.ctx.fillStyle = Theme.cursorColor;
          this.ctx.fillRect(footerCursor.x, footerCursor.y, Theme.cursorWidth, footerCursor.height);
        }

        this.ctx.restore();

        // Draw dashed border when editing footer
        if (editContext === 'footer') {
          this.ctx.save();
          this.ctx.strokeStyle = Theme.headerFooterBorderColor;
          this.ctx.lineWidth = 1;
          this.ctx.setLineDash([4, 4]);
          this.ctx.strokeRect(contentX, pageY + page.height - margins.bottom, contentWidth, footerClipHeight);
          this.ctx.setLineDash([]);
          this.ctx.restore();
        }
      }

      // Dim body content when editing header/footer
      if (editContext === 'header' || editContext === 'footer') {
        // Apply dimming alpha before the existing content clip section
      }
```

- [ ] **Step 4: Add renderRunWithPageNumber helper**

Add a private method to `DocCanvas`:

```typescript
  /**
   * Render a run, substituting page number token if applicable.
   */
  private renderRunWithPageNumber(
    run: LayoutRun,
    lineX: number,
    lineY: number,
    lineHeight: number,
    pageNumber: number,
  ): void {
    if (run.inline.style.pageNumber) {
      // Create a temporary run with substituted text
      const substituted = {
        ...run,
        text: String(pageNumber),
        inline: { ...run.inline, text: String(pageNumber) },
      };
      this.renderRun(substituted, lineX, lineY, lineHeight);
    } else {
      this.renderRun(run, lineX, lineY, lineHeight);
    }
  }
```

- [ ] **Step 5: Add body dimming for header/footer edit mode**

In the content area rendering section, when `editContext` is `'header'` or `'footer'`, wrap the existing content drawing with alpha:

After the content clip `this.ctx.clip()` and before drawing content, add:

```typescript
      if (editContext === 'header' || editContext === 'footer') {
        this.ctx.globalAlpha = Theme.headerFooterDimAlpha;
      }
```

Before the content clip `this.ctx.restore()`, reset alpha:

```typescript
      this.ctx.globalAlpha = 1;
```

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/doc-canvas.ts packages/docs/src/view/theme.ts
git commit -m "Render header/footer per page with page number substitution"
```

---

### Task 6: TextEditor — edit context switching and operation routing

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`
- Modify: `packages/docs/src/view/pagination.ts` (click target resolution)

- [ ] **Step 1: Add EditContext type and field to TextEditor**

In `packages/docs/src/view/text-editor.ts`:

Import `EditContext` from `../model/document.js` and add `getHeaderYStart`, `getFooterYStart` from `./pagination.js`.

Add field:

```typescript
  private editContext: EditContext = 'body';
```

Add getter/setter:

```typescript
  getEditContext(): EditContext {
    return this.editContext;
  }

  setEditContext(context: EditContext): void {
    this.editContext = context;
    this.doc.editContext = context;
  }
```

- [ ] **Step 2: Add click target resolution**

In `packages/docs/src/view/pagination.ts`, add a function to determine which region a click falls in:

```typescript
/**
 * Determine whether a click at absolute (px, py) targets the header, footer, or body.
 */
export function resolveClickTarget(
  paginatedLayout: PaginatedLayout,
  px: number,
  py: number,
  canvasWidth: number,
  headerMarginFromEdge?: number,
  footerMarginFromEdge?: number,
): 'header' | 'footer' | 'body' {
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;

  for (const page of paginatedLayout.pages) {
    const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
    if (py < pageY || py > pageY + page.height) continue;
    if (px < pageX || px > pageX + page.width) continue;

    const localY = py - pageY;

    if (headerMarginFromEdge !== undefined && localY < margins.top) {
      return 'header';
    }
    if (footerMarginFromEdge !== undefined && localY > page.height - margins.bottom) {
      return 'footer';
    }
    return 'body';
  }
  return 'body';
}
```

- [ ] **Step 3: Handle double-click for context switching**

In the `handleDblClick` handler of TextEditor (or add one if it routes through `handleMouseDown`):

After detecting a double-click in the margin area, switch context:

```typescript
  // In the mousedown / dblclick handler:
  private handleDoubleClick(canvasX: number, canvasY: number): void {
    const target = resolveClickTarget(
      this.getPaginatedLayout(),
      canvasX,
      canvasY,
      this.getCanvasWidth(),
      this.doc.document.header?.marginFromEdge,
      this.doc.document.footer?.marginFromEdge,
    );

    if (target === 'header') {
      this.doc.ensureHeader();
      this.setEditContext('header');
      const headerBlocks = this.doc.document.header!.blocks;
      this.cursor.moveTo({ blockId: headerBlocks[0].id, offset: 0 });
      this.selection.setRange(null);
      this.requestRender();
      return;
    }

    if (target === 'footer') {
      this.doc.ensureFooter();
      this.setEditContext('footer');
      const footerBlocks = this.doc.document.footer!.blocks;
      this.cursor.moveTo({ blockId: footerBlocks[0].id, offset: 0 });
      this.selection.setRange(null);
      this.requestRender();
      return;
    }

    // If clicking body while in header/footer, switch back
    if (this.editContext !== 'body') {
      this.setEditContext('body');
    }

    // Existing double-click word selection logic...
  }
```

- [ ] **Step 4: Handle single-click body click to exit header/footer**

In the mousedown handler, before processing the click:

```typescript
    if (this.editContext !== 'body') {
      const target = resolveClickTarget(...);
      if (target === 'body') {
        this.setEditContext('body');
        // Fall through to normal body click handling
      } else if (target !== this.editContext) {
        // Clicked different header/footer region without double-click — ignore
        return;
      }
      // If target === this.editContext, fall through to normal click handling within header/footer
    }
```

- [ ] **Step 5: Handle Escape to exit header/footer**

In `handleKeyDown`, add before the existing key handling:

```typescript
    if (e.key === 'Escape' && this.editContext !== 'body') {
      this.setEditContext('body');
      // Move cursor to body block
      const bodyBlocks = this.doc.document.blocks;
      if (bodyBlocks.length > 0) {
        this.cursor.moveTo({ blockId: bodyBlocks[0].id, offset: 0 });
      }
      this.selection.setRange(null);
      this.requestRender();
      e.preventDefault();
      return;
    }
```

- [ ] **Step 6: Block forbidden operations in header/footer**

In `handleKeyDown`, for `Ctrl+Enter` (page break):

```typescript
    // In the Enter case:
    if (e.ctrlKey || e.metaKey) {
      if (this.editContext !== 'body') return; // No page breaks in header/footer
      this.handlePageBreak();
    }
```

In `setBlockType` or wherever block type changes are routed:

```typescript
    if (this.editContext !== 'body') {
      const forbidden: BlockType[] = ['table', 'page-break', 'horizontal-rule'];
      if (forbidden.includes(type)) return;
    }
```

- [ ] **Step 7: Commit**

```bash
git add packages/docs/src/view/text-editor.ts packages/docs/src/view/pagination.ts
git commit -m "Add edit context switching for header/footer in TextEditor"
```

---

### Task 7: Yorkie serialization — header/footer nodes

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [ ] **Step 1: Update treeToDocument to parse header/footer nodes**

In the `treeToDocument` function, after parsing body blocks, check for `header` and `footer` container nodes:

```typescript
function treeToDocument(root: TreeNode): Document {
  const doc: Document = { blocks: [] };
  for (const child of root.children ?? []) {
    if (child.type === 'header') {
      doc.header = {
        blocks: (child.children ?? []).map(treeNodeToBlock),
        marginFromEdge: Number(child.attributes?.marginFromEdge ?? '48'),
      };
    } else if (child.type === 'footer') {
      doc.footer = {
        blocks: (child.children ?? []).map(treeNodeToBlock),
        marginFromEdge: Number(child.attributes?.marginFromEdge ?? '48'),
      };
    } else if (child.type === 'block') {
      doc.blocks.push(treeNodeToBlock(child));
    }
  }
  // ... existing pageSetup parsing
  return doc;
}
```

- [ ] **Step 2: Update document-to-tree serialization for header/footer**

In the `writeFullDocument` function (or wherever the Tree is built), add header/footer container nodes:

```typescript
function buildDocumentTree(doc: Document): ElementNode {
  const children: ElementNode[] = [];

  if (doc.header) {
    children.push({
      type: 'header',
      attributes: { marginFromEdge: String(doc.header.marginFromEdge) },
      children: doc.header.blocks.map(buildBlockNode),
    });
  }

  if (doc.footer) {
    children.push({
      type: 'footer',
      attributes: { marginFromEdge: String(doc.footer.marginFromEdge) },
      children: doc.footer.blocks.map(buildBlockNode),
    });
  }

  // Add body blocks
  for (const block of doc.blocks) {
    children.push(buildBlockNode(block));
  }

  return { type: 'root', children };
}
```

- [ ] **Step 3: Update inline style serialization for pageNumber**

In `serializeInlineStyle`:

```typescript
  if (style.pageNumber) result.pageNumber = 'true';
```

In `parseInlineStyle`:

```typescript
  if (attrs.pageNumber === 'true') style.pageNumber = true;
```

- [ ] **Step 4: Update YorkieDocStore header/footer methods**

Add `getHeader`, `getFooter`, `setHeader`, `setFooter` implementations:

```typescript
  getHeader(): HeaderFooter | undefined {
    const doc = this.getDocument();
    return doc.header;
  }

  getFooter(): HeaderFooter | undefined {
    const doc = this.getDocument();
    return doc.footer;
  }

  setHeader(header: HeaderFooter | undefined): void {
    // Write header container to Yorkie Tree
    this.dirty = true;
    this.cachedDoc = null;
    this.doc.update((root) => {
      // Remove existing header node if present, then add new one
      // Implementation depends on Yorkie Tree API for adding/removing subtrees
    });
  }

  setFooter(footer: HeaderFooter | undefined): void {
    // Similar to setHeader
    this.dirty = true;
    this.cachedDoc = null;
    this.doc.update((root) => {
      // Remove existing footer node if present, then add new one
    });
  }
```

Note: The exact Yorkie Tree manipulation API calls depend on the current `yorkie-js-sdk` version. Follow the existing patterns used for `setDocument` / `writeFullDocument`.

- [ ] **Step 5: Update deserialization empty-inlines check**

In the block deserialization logic, ensure `pageNumber` inline content is preserved:
The existing deserialization already handles arbitrary InlineStyle properties via `parseInlineStyle`, so no additional changes needed for the text content.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Add Yorkie serialization for header/footer and pageNumber inline"
```

---

### Task 8: Editor API wiring — integrate header/footer into the render pipeline

**Files:**
- Modify: `packages/docs/src/view/editor.ts`

- [ ] **Step 1: Compute header/footer layouts in recomputeLayout**

In the `recomputeLayout` function in `editor.ts`, add header/footer layout computation:

```typescript
  let headerLayout: DocumentLayout | null = null;
  let footerLayout: DocumentLayout | null = null;

  const recomputeLayout = () => {
    const pageSetup = resolvePageSetup(doc.document.pageSetup);
    const dims = getEffectiveDimensions(pageSetup);
    const contentWidth = dims.width - pageSetup.margins.left - pageSetup.margins.right;

    // Body layout (existing)
    const result = computeLayout(
      doc.document.blocks,
      docCanvas.getContext(),
      contentWidth,
      dirtyBlockIds,
      layoutCache,
    );
    layout = result.layout;
    layoutCache = result.cache;
    dirtyBlockIds = undefined;
    doc.setBlockParentMap(layout.blockParentMap);
    paginatedLayout = paginateLayout(layout, pageSetup);

    // Header/footer layouts
    if (doc.document.header) {
      headerLayout = computeLayout(
        doc.document.header.blocks,
        docCanvas.getContext(),
        contentWidth,
      ).layout;
    } else {
      headerLayout = null;
    }
    if (doc.document.footer) {
      footerLayout = computeLayout(
        doc.document.footer.blocks,
        docCanvas.getContext(),
        contentWidth,
      ).layout;
    } else {
      footerLayout = null;
    }
  };
```

- [ ] **Step 2: Pass header/footer data to DocCanvas.render()**

In the `paint()` function, extend the `docCanvas.render()` call:

```typescript
    // Compute header/footer cursor if in that context
    let headerCursor: typeof cursorPixel = undefined;
    let footerCursor: typeof cursorPixel = undefined;
    const editCtx = textEditor?.getEditContext() ?? 'body';

    if (editCtx === 'header' && headerLayout) {
      // Compute cursor pixel within header layout for the nearest visible page
      headerCursor = computeHeaderFooterCursor(
        cursor, headerLayout, paginatedLayout, doc.document.header!,
        docCanvas.getContext(), logicalCanvasWidth, scrollY, canvasHeight,
      );
    }
    if (editCtx === 'footer' && footerLayout) {
      footerCursor = computeHeaderFooterCursor(
        cursor, footerLayout, paginatedLayout, doc.document.footer!,
        docCanvas.getContext(), logicalCanvasWidth, scrollY, canvasHeight,
      );
    }

    docCanvas.render(
      paginatedLayout, scrollY, logicalCanvasWidth, canvasHeight,
      editCtx === 'body' ? cursorPixel : undefined,
      editCtx === 'body' ? selectionRects : undefined,
      focused,
      resolvedPeers, peerSelections, layout,
      searchHighlightRects, activeMatchIndex, scaleFactor,
      headerLayout, footerLayout,
      {
        header: doc.document.header ? { marginFromEdge: doc.document.header.marginFromEdge } : undefined,
        footer: doc.document.footer ? { marginFromEdge: doc.document.footer.marginFromEdge } : undefined,
      },
      editCtx,
      headerCursor ?? undefined,
      footerCursor ?? undefined,
    );
```

- [ ] **Step 3: Add header/footer cursor position helper**

Add a helper function in `editor.ts`:

```typescript
function computeHeaderFooterCursor(
  cursor: Cursor,
  hfLayout: DocumentLayout,
  paginatedLayout: PaginatedLayout,
  hf: HeaderFooter,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  scrollY: number,
  viewportHeight: number,
): { x: number; y: number; height: number; visible: boolean } | undefined {
  // Find which block/line the cursor is on within the header/footer layout
  const blockId = cursor.position.blockId;
  const offset = cursor.position.offset;
  const lb = hfLayout.blocks.find(b => b.block.id === blockId);
  if (!lb) return undefined;

  // Find the line and x offset within the line
  let lineY = 0;
  let lineHeight = 0;
  let cursorX = 0;
  for (const line of lb.lines) {
    for (const run of line.runs) {
      if (offset >= run.charStart && offset <= run.charEnd) {
        const localOffset = offset - run.charStart;
        cursorX = run.x + (run.charOffsets[localOffset] ?? 0);
        lineY = lb.y + line.y;
        lineHeight = line.height;
        break;
      }
    }
    if (lineHeight > 0) break;
  }
  if (lineHeight === 0 && lb.lines.length > 0) {
    lineY = lb.y + lb.lines[0].y;
    lineHeight = lb.lines[0].height;
  }

  // Find the best visible page
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const margins = paginatedLayout.pageSetup.margins;
  const visibleTop = scrollY;
  const visibleBottom = scrollY + viewportHeight;

  for (const page of paginatedLayout.pages) {
    const pageYOff = getPageYOffset(paginatedLayout, page.pageIndex);
    if (pageYOff + page.height < visibleTop || pageYOff > visibleBottom) continue;

    const isHeader = hf === (undefined as any); // Detect via caller
    // Determine Y base for header vs footer
    const hfY = getHeaderYStart(paginatedLayout, page.pageIndex, hf.marginFromEdge);
    // For footer, caller should use getFooterYStart instead

    return {
      x: pageX + margins.left + cursorX,
      y: hfY + lineY,
      height: lineHeight,
      visible: cursor.visible,
    };
  }
  return undefined;
}
```

Note: This helper needs refinement based on whether it's a header or footer. Consider splitting into two helpers or passing a type parameter.

- [ ] **Step 4: Expose page number insertion in EditorAPI**

Add to `EditorAPI` interface:

```typescript
  /** Insert a page number token at the current cursor position */
  insertPageNumber(): void;
  /** Get the current edit context */
  getEditContext(): 'body' | 'header' | 'footer';
```

Implement in the returned API object:

```typescript
  insertPageNumber(): void {
    if (!textEditor) return;
    const ctx = textEditor.getEditContext();
    if (ctx !== 'header' && ctx !== 'footer') return;
    docStore.snapshot();
    doc.insertText(cursor.position, '#');
    doc.applyInlineStyle(
      {
        anchor: { blockId: cursor.position.blockId, offset: cursor.position.offset },
        focus: { blockId: cursor.position.blockId, offset: cursor.position.offset + 1 },
      },
      { pageNumber: true },
    );
    cursor.moveTo({ blockId: cursor.position.blockId, offset: cursor.position.offset + 1 });
    render();
  },
  getEditContext(): 'body' | 'header' | 'footer' {
    return textEditor?.getEditContext() ?? 'body';
  },
```

- [ ] **Step 5: Run verify:fast to confirm everything builds and tests pass**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/editor.ts packages/docs/src/view/doc-canvas.ts
git commit -m "Wire header/footer rendering and editing into editor pipeline"
```

---

### Task 9: Mark Phase 4.1 complete and update task tracking

**Files:**
- Modify: `docs/tasks/active/20260325-docs-wordprocessor-todo.md`

- [ ] **Step 1: Update roadmap tracking**

In `docs/tasks/active/20260325-docs-wordprocessor-todo.md`, mark 4.1 as complete:

```markdown
- [x] 4.1 Header / Footer — fixed regions, page numbers
```

- [ ] **Step 2: Run pnpm verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/tasks/active/20260325-docs-wordprocessor-todo.md
git commit -m "Mark Phase 4.1 Header/Footer as complete"
```
