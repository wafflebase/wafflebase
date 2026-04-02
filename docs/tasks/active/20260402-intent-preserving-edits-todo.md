# Intent-Preserving Yorkie Edits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Docs editor from full block replacement to character-level Yorkie Tree editing, eliminating last-writer-wins conflicts for same-block concurrent edits.

**Architecture:** DocStore gets fine-grained methods (`insertText`, `deleteText`, `applyStyle`, `splitBlock`, `mergeBlock`). Common pure helpers in `block-helpers.ts` handle model manipulation. MemDocStore uses helpers only; YorkieDocStore uses helpers + single-level Yorkie Tree API calls composed within `doc.update()`.

**Tech Stack:** TypeScript, Vitest, Yorkie Tree CRDT (`editByPath`, `styleByPath`, `splitByPath`, `mergeByPath`)

**Design doc:** `docs/design/docs-intent-preserving-edits.md`

---

## Phase 1: Character-Level Text Editing

### Task 1: Create block-helpers with resolveOffset and resolveDeleteRange

**Files:**
- Create: `packages/docs/src/store/block-helpers.ts`
- Create: `packages/docs/test/store/block-helpers.test.ts`

- [ ] **Step 1: Write failing tests for resolveOffset**

```typescript
// packages/docs/test/store/block-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { resolveOffset, resolveDeleteRange } from '../../src/store/block-helpers.js';
import type { Block } from '../../src/model/types.js';
import { DEFAULT_BLOCK_STYLE } from '../../src/model/types.js';

function makeBlock(...inlines: Array<{ text: string; style?: Record<string, unknown> }>): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: inlines.map((i) => ({ text: i.text, style: i.style ?? {} })),
    style: DEFAULT_BLOCK_STYLE,
  };
}

describe('resolveOffset', () => {
  it('resolves within single inline', () => {
    const block = makeBlock({ text: 'Hello' });
    expect(resolveOffset(block, 3)).toEqual({ inlineIndex: 0, charOffset: 3 });
  });

  it('resolves at inline boundary — lands on next inline', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World' });
    // offset 5 = end of inline[0] = start of inline[1]
    // Should resolve to inline[0] charOffset 5 (end) since <= length
    expect(resolveOffset(block, 5)).toEqual({ inlineIndex: 0, charOffset: 5 });
  });

  it('resolves in second inline', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World' });
    expect(resolveOffset(block, 7)).toEqual({ inlineIndex: 1, charOffset: 2 });
  });

  it('clamps past end to last inline', () => {
    const block = makeBlock({ text: 'Hi' });
    expect(resolveOffset(block, 99)).toEqual({ inlineIndex: 0, charOffset: 2 });
  });

  it('resolves offset 0 in empty inline', () => {
    const block = makeBlock({ text: '' });
    expect(resolveOffset(block, 0)).toEqual({ inlineIndex: 0, charOffset: 0 });
  });
});

describe('resolveDeleteRange', () => {
  it('resolves within single inline', () => {
    const block = makeBlock({ text: 'Hello' });
    expect(resolveDeleteRange(block, 1, 3)).toEqual([
      { inlineIndex: 0, charFrom: 1, charTo: 4 },
    ]);
  });

  it('resolves across two inlines', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World' });
    // offset=3, length=4 → delete "lo" from inline[0] + "Wo" from inline[1]
    expect(resolveDeleteRange(block, 3, 4)).toEqual([
      { inlineIndex: 0, charFrom: 3, charTo: 5 },
      { inlineIndex: 1, charFrom: 0, charTo: 2 },
    ]);
  });

  it('resolves across three inlines', () => {
    const block = makeBlock({ text: 'AA' }, { text: 'BB' }, { text: 'CC' });
    // offset=1, length=4 → "A" + "BB" + "C"
    expect(resolveDeleteRange(block, 1, 4)).toEqual([
      { inlineIndex: 0, charFrom: 1, charTo: 2 },
      { inlineIndex: 1, charFrom: 0, charTo: 2 },
      { inlineIndex: 2, charFrom: 0, charTo: 1 },
    ]);
  });

  it('clamps length to block text length', () => {
    const block = makeBlock({ text: 'Hi' });
    expect(resolveDeleteRange(block, 1, 100)).toEqual([
      { inlineIndex: 0, charFrom: 1, charTo: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/store/block-helpers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement resolveOffset and resolveDeleteRange**

```typescript
// packages/docs/src/store/block-helpers.ts
import type { Block } from '../model/types.js';

export interface InlinePosition {
  inlineIndex: number;
  charOffset: number;
}

export interface InlineSegment {
  inlineIndex: number;
  charFrom: number;
  charTo: number;
}

/**
 * Resolve a block-level character offset to an inline index + char offset.
 */
export function resolveOffset(block: Block, offset: number): InlinePosition {
  let remaining = offset;
  for (let i = 0; i < block.inlines.length; i++) {
    const len = block.inlines[i].text.length;
    if (remaining <= len) {
      return { inlineIndex: i, charOffset: remaining };
    }
    remaining -= len;
  }
  const last = block.inlines.length - 1;
  return { inlineIndex: last, charOffset: block.inlines[last].text.length };
}

/**
 * Resolve a delete range (offset + length) into per-inline segments.
 * Segments are returned in forward order (inline[0] first).
 */
export function resolveDeleteRange(
  block: Block,
  offset: number,
  length: number,
): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let remaining = length;
  let pos = 0;

  for (let i = 0; i < block.inlines.length && remaining > 0; i++) {
    const inlineLen = block.inlines[i].text.length;
    const inlineEnd = pos + inlineLen;

    if (offset >= inlineEnd) {
      pos = inlineEnd;
      continue;
    }

    const charFrom = Math.max(0, offset - pos);
    const available = inlineLen - charFrom;
    const charTo = charFrom + Math.min(remaining, available);

    segments.push({ inlineIndex: i, charFrom, charTo });
    remaining -= charTo - charFrom;
    pos = inlineEnd;
  }

  return segments;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/store/block-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/store/block-helpers.ts packages/docs/test/store/block-helpers.test.ts
git commit -m "Add block-helpers with resolveOffset and resolveDeleteRange"
```

---

### Task 2: Add applyInsertText and applyDeleteText helpers

**Files:**
- Modify: `packages/docs/src/store/block-helpers.ts`
- Modify: `packages/docs/test/store/block-helpers.test.ts`

- [ ] **Step 1: Write failing tests for applyInsertText and applyDeleteText**

```typescript
// Append to packages/docs/test/store/block-helpers.test.ts
import { applyInsertText, applyDeleteText } from '../../src/store/block-helpers.js';

describe('applyInsertText', () => {
  it('inserts text in single inline', () => {
    const block = makeBlock({ text: 'Helo' });
    const result = applyInsertText(block, 3, 'l');
    expect(result.inlines[0].text).toBe('Hello');
  });

  it('inserts text at inline boundary', () => {
    const block = makeBlock({ text: 'AB' }, { text: 'CD' });
    const result = applyInsertText(block, 2, 'X');
    // offset 2 resolves to inline[0] charOffset 2 (end of inline[0])
    expect(result.inlines[0].text).toBe('ABX');
    expect(result.inlines[1].text).toBe('CD');
  });

  it('inserts text at offset 0', () => {
    const block = makeBlock({ text: 'Hello' });
    const result = applyInsertText(block, 0, 'X');
    expect(result.inlines[0].text).toBe('XHello');
  });

  it('preserves inline styles', () => {
    const block = makeBlock({ text: 'AB', style: { bold: true } });
    const result = applyInsertText(block, 1, 'X');
    expect(result.inlines[0].text).toBe('AXB');
    expect(result.inlines[0].style).toEqual({ bold: true });
  });
});

describe('applyDeleteText', () => {
  it('deletes within single inline', () => {
    const block = makeBlock({ text: 'Hello' });
    const result = applyDeleteText(block, 1, 3);
    expect(result.inlines[0].text).toBe('Ho');
  });

  it('deletes across inline boundary', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World' });
    const result = applyDeleteText(block, 3, 4);
    // Deletes "lo" + "Wo"
    expect(result.inlines[0].text).toBe('Hel');
    expect(result.inlines[1].text).toBe('rld');
  });

  it('removes empty inlines after deletion (keeps at least one)', () => {
    const block = makeBlock({ text: 'AB' }, { text: 'CD' });
    const result = applyDeleteText(block, 0, 2);
    // inline[0] becomes empty and is removed
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('CD');
  });

  it('keeps one empty inline when all text is deleted', () => {
    const block = makeBlock({ text: 'AB' });
    const result = applyDeleteText(block, 0, 2);
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('');
  });

  it('normalizes adjacent same-style inlines after deletion', () => {
    const block = makeBlock(
      { text: 'AA', style: { bold: true } },
      { text: 'XX' },
      { text: 'BB', style: { bold: true } },
    );
    // Delete the middle non-bold part → bold "AA" + bold "BB" should merge
    const result = applyDeleteText(block, 2, 2);
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('AABB');
    expect(result.inlines[0].style).toEqual({ bold: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/store/block-helpers.test.ts`
Expected: FAIL — applyInsertText/applyDeleteText not exported

- [ ] **Step 3: Implement applyInsertText, applyDeleteText, and normalizeInlines**

```typescript
// Append to packages/docs/src/store/block-helpers.ts
import type { Inline } from '../model/types.js';
import { inlineStylesEqual } from '../model/types.js';

/**
 * Merge adjacent inlines with identical styles.
 * Always returns at least one inline.
 */
export function normalizeInlines(inlines: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const inline of inlines) {
    if (inline.text.length === 0) continue;
    const last = merged[merged.length - 1];
    if (last && inlineStylesEqual(last.style, inline.style)) {
      last.text += inline.text;
    } else {
      merged.push({ text: inline.text, style: { ...inline.style } });
    }
  }
  return merged.length > 0
    ? merged
    : [{ text: '', style: inlines[0]?.style ?? {} }];
}

/**
 * Insert text at block-level offset. Returns a new Block (pure function).
 */
export function applyInsertText(block: Block, offset: number, text: string): Block {
  const newBlock = cloneBlock(block);
  const { inlineIndex, charOffset } = resolveOffset(newBlock, offset);
  const inline = newBlock.inlines[inlineIndex];
  inline.text =
    inline.text.slice(0, charOffset) + text + inline.text.slice(charOffset);
  return newBlock;
}

/**
 * Delete `length` characters starting at block-level offset. Returns new Block.
 */
export function applyDeleteText(block: Block, offset: number, length: number): Block {
  const newBlock = cloneBlock(block);
  const segments = resolveDeleteRange(newBlock, offset, length);

  // Delete in reverse order to preserve earlier indices
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const inline = newBlock.inlines[seg.inlineIndex];
    inline.text =
      inline.text.slice(0, seg.charFrom) + inline.text.slice(seg.charTo);
  }

  // Remove empty inlines then normalize
  newBlock.inlines = normalizeInlines(newBlock.inlines);
  return newBlock;
}

function cloneBlock(block: Block): Block {
  return JSON.parse(JSON.stringify(block));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/store/block-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/store/block-helpers.ts packages/docs/test/store/block-helpers.test.ts
git commit -m "Add applyInsertText and applyDeleteText helpers"
```

---

### Task 3: Add insertText and deleteText to DocStore interface and MemDocStore

**Files:**
- Modify: `packages/docs/src/store/store.ts`
- Modify: `packages/docs/src/store/memory.ts`
- Modify: `packages/docs/test/store/memory.test.ts`

- [ ] **Step 1: Write failing tests for MemDocStore.insertText and deleteText**

```typescript
// Append to packages/docs/test/store/memory.test.ts
describe('fine-grained text editing', () => {
  it('insertText inserts at offset within block', () => {
    const block = makeBlock('Hello');
    const store = new MemDocStore({ blocks: [block] });
    store.insertText(block.id, 5, ' World');
    expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello World');
  });

  it('insertText at offset 0', () => {
    const block = makeBlock('World');
    const store = new MemDocStore({ blocks: [block] });
    store.insertText(block.id, 0, 'Hello ');
    expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello World');
  });

  it('deleteText removes characters at offset', () => {
    const block = makeBlock('Hello World');
    const store = new MemDocStore({ blocks: [block] });
    store.deleteText(block.id, 5, 6);
    expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello');
  });

  it('deleteText across inline boundaries', () => {
    const block = {
      id: 'b1',
      type: 'paragraph' as const,
      inlines: [
        { text: 'Hello', style: {} },
        { text: 'World', style: { bold: true } },
      ],
      style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
    };
    const store = new MemDocStore({ blocks: [block] });
    store.deleteText('b1', 3, 4);
    const updated = store.getBlock('b1')!;
    // "Hel" + "rld"(bold)
    expect(updated.inlines[0].text).toBe('Hel');
    expect(updated.inlines[1].text).toBe('rld');
  });

  it('insertText throws for non-existent block', () => {
    const store = new MemDocStore();
    expect(() => store.insertText('no-such', 0, 'X')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/store/memory.test.ts`
Expected: FAIL — insertText/deleteText not defined

- [ ] **Step 3: Add insertText and deleteText to DocStore interface**

```typescript
// Add to packages/docs/src/store/store.ts, after deleteBlockByIndex
/** Insert text at the given block-level character offset. */
insertText(blockId: string, offset: number, text: string): void;
/** Delete `length` characters starting at the given block-level offset. */
deleteText(blockId: string, offset: number, length: number): void;
```

- [ ] **Step 4: Implement in MemDocStore**

```typescript
// Add to packages/docs/src/store/memory.ts
import { applyInsertText, applyDeleteText } from './block-helpers.js';

// Add methods to MemDocStore class:
insertText(blockId: string, offset: number, text: string): void {
  const index = this.doc.blocks.findIndex((b) => b.id === blockId);
  if (index === -1) throw new Error(`Block not found: ${blockId}`);
  this.doc.blocks[index] = applyInsertText(this.doc.blocks[index], offset, text);
}

deleteText(blockId: string, offset: number, length: number): void {
  const index = this.doc.blocks.findIndex((b) => b.id === blockId);
  if (index === -1) throw new Error(`Block not found: ${blockId}`);
  this.doc.blocks[index] = applyDeleteText(this.doc.blocks[index], offset, length);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/store/memory.test.ts`
Expected: PASS

- [ ] **Step 6: Run full verify**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/docs/src/store/store.ts packages/docs/src/store/memory.ts packages/docs/test/store/memory.test.ts
git commit -m "Add insertText and deleteText to DocStore and MemDocStore"
```

---

### Task 4: Implement insertText and deleteText in YorkieDocStore

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [ ] **Step 1: Add import and implement insertText**

```typescript
// Add import at top of yorkie-doc-store.ts
import { resolveOffset, resolveDeleteRange, applyInsertText, applyDeleteText } from '@wafflebase/docs/store/block-helpers';

// Add method to YorkieDocStore class
insertText(blockId: string, offset: number, text: string): void {
  const block = this.getBlock(blockId);
  if (!block) throw new Error(`Block not found: ${blockId}`);

  const { inlineIndex, charOffset } = resolveOffset(block, offset);
  const blockIdx = this.findBlockIndex(blockId);

  this.doc.update((root) => {
    root.content.editByPath(
      [blockIdx, inlineIndex, 0, charOffset],
      [blockIdx, inlineIndex, 0, charOffset],
      { type: 'text', value: text },
    );
  });

  this.dirty = false;
  this.cachedDoc = null;
}
```

- [ ] **Step 2: Implement deleteText**

```typescript
// Add method to YorkieDocStore class
deleteText(blockId: string, offset: number, length: number): void {
  const block = this.getBlock(blockId);
  if (!block) throw new Error(`Block not found: ${blockId}`);

  const segments = resolveDeleteRange(block, offset, length);
  const blockIdx = this.findBlockIndex(blockId);

  this.doc.update((root) => {
    const tree = root.content;
    // Reverse order: later segments first to preserve earlier indices
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      tree.editByPath(
        [blockIdx, seg.inlineIndex, 0, seg.charFrom],
        [blockIdx, seg.inlineIndex, 0, seg.charTo],
      );
    }
  });

  this.dirty = false;
  this.cachedDoc = null;
}
```

- [ ] **Step 3: Add findBlockIndex helper if not already present**

Check if `findBlockIndex(blockId)` exists. If not, add:

```typescript
private findBlockIndex(blockId: string): number {
  const doc = this.getDocument();
  return doc.blocks.findIndex((b) => b.id === blockId);
}
```

- [ ] **Step 4: Run verify**

Run: `pnpm verify:fast`
Expected: PASS (compile + existing tests)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Implement insertText and deleteText in YorkieDocStore"
```

---

### Task 5: Wire Doc.insertText and Doc.deleteText to store methods

**Files:**
- Modify: `packages/docs/src/model/document.ts`
- Modify: `packages/docs/test/model/document.test.ts`

- [ ] **Step 1: Write tests verifying Doc.insertText uses store.insertText**

Add a test that creates a Doc with a MemDocStore, calls `doc.insertText()`, and verifies the store's block is updated character-level (not full replacement).

```typescript
// In packages/docs/test/model/document.test.ts — add or extend
it('insertText delegates to store.insertText', () => {
  const block = createBlock('Hello');
  const store = new MemDocStore({ blocks: [block] });
  const doc = new Doc(store);

  doc.insertText({ blockId: block.id, offset: 5 }, ' World');
  expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello World');
});

it('deleteText delegates to store.deleteText', () => {
  const block = createBlock('Hello World');
  const store = new MemDocStore({ blocks: [block] });
  const doc = new Doc(store);

  doc.deleteText({ blockId: block.id, offset: 5 }, 6);
  expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello');
});
```

- [ ] **Step 2: Modify Doc.insertText to call store.insertText**

```typescript
// packages/docs/src/model/document.ts — replace insertText method (~line 115)
insertText(pos: DocPosition, text: string): void {
  const cellInfo = this._blockParentMap.get(pos.blockId);
  if (cellInfo) {
    // Table cell path — will be migrated in Phase 4
    const block = this.getBlock(pos.blockId);
    const { inlineIndex, charOffset } = resolveOffset(block, pos.offset);
    const inline = block.inlines[inlineIndex];
    inline.text =
      inline.text.slice(0, charOffset) + text + inline.text.slice(charOffset);
    this.updateBlockInStore(pos.blockId, block);
  } else {
    this.store.insertText(pos.blockId, pos.offset, text);
  }
  this.refresh();
}
```

Note: Import `resolveOffset` from `../store/block-helpers.js` and remove the private `resolveOffset` method if it's now redundant, or keep it for other callers during migration.

- [ ] **Step 3: Modify Doc.deleteText to call store.deleteText**

```typescript
// packages/docs/src/model/document.ts — replace deleteText method (~line 128)
deleteText(pos: DocPosition, length: number): void {
  const cellInfo = this._blockParentMap.get(pos.blockId);
  if (cellInfo) {
    // Table cell path — will be migrated in Phase 4
    const block = this.getBlock(pos.blockId);
    const blockLen = getBlockTextLength(block);
    let remaining = Math.min(length, blockLen - pos.offset);
    if (remaining <= 0) return;
    let offset = pos.offset;
    while (remaining > 0) {
      const { inlineIndex, charOffset } = resolveOffset(block, offset);
      const inline = block.inlines[inlineIndex];
      const available = inline.text.length - charOffset;
      if (available <= 0) break;
      const toDelete = Math.min(remaining, available);
      inline.text =
        inline.text.slice(0, charOffset) + inline.text.slice(charOffset + toDelete);
      remaining -= toDelete;
      if (inline.text.length === 0 && block.inlines.length > 1) {
        block.inlines.splice(inlineIndex, 1);
      }
    }
    this.normalizeInlines(block);
    this.updateBlockInStore(pos.blockId, block);
  } else {
    this.store.deleteText(pos.blockId, pos.offset, length);
  }
  this.refresh();
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/docs && npx vitest run`
Expected: PASS

- [ ] **Step 5: Run full verify**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/test/model/document.test.ts
git commit -m "Wire Doc.insertText and deleteText to store methods for top-level blocks"
```

---

## Phase 2: Inline Styling

### Task 6: Add resolveStyleRange helper and applyInlineStyle helper

**Files:**
- Modify: `packages/docs/src/store/block-helpers.ts`
- Modify: `packages/docs/test/store/block-helpers.test.ts`

- [ ] **Step 1: Write failing tests for resolveStyleRange**

```typescript
// Append to packages/docs/test/store/block-helpers.test.ts
import { resolveStyleRange, applyInlineStyle } from '../../src/store/block-helpers.js';

describe('resolveStyleRange', () => {
  it('resolves within single inline', () => {
    const block = makeBlock({ text: 'Hello World' });
    expect(resolveStyleRange(block, 6, 11)).toEqual([
      { inlineIndex: 0, charFrom: 6, charTo: 11 },
    ]);
  });

  it('resolves across two inlines', () => {
    const block = makeBlock({ text: 'Hello' }, { text: 'World' });
    expect(resolveStyleRange(block, 3, 8)).toEqual([
      { inlineIndex: 0, charFrom: 3, charTo: 5 },
      { inlineIndex: 1, charFrom: 0, charTo: 3 },
    ]);
  });
});

describe('applyInlineStyle', () => {
  it('applies style within single inline — splits into 3', () => {
    const block = makeBlock({ text: 'Hello World' });
    const result = applyInlineStyle(block, 6, 11, { bold: true });
    expect(result.inlines).toHaveLength(2);
    expect(result.inlines[0]).toEqual({ text: 'Hello ', style: {} });
    expect(result.inlines[1]).toEqual({ text: 'World', style: { bold: true } });
  });

  it('applies style to entire inline — no split needed', () => {
    const block = makeBlock({ text: 'Hello' });
    const result = applyInlineStyle(block, 0, 5, { italic: true });
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0]).toEqual({ text: 'Hello', style: { italic: true } });
  });

  it('applies style across inline boundary', () => {
    const block = makeBlock({ text: 'AB' }, { text: 'CD' });
    const result = applyInlineStyle(block, 1, 3, { bold: true });
    // "A" + "B"(bold) + "C"(bold) + "D"
    // After normalize: "A" + "BC"(bold) + "D"
    expect(result.inlines).toHaveLength(3);
    expect(result.inlines[0]).toEqual({ text: 'A', style: {} });
    expect(result.inlines[1]).toEqual({ text: 'BC', style: { bold: true } });
    expect(result.inlines[2]).toEqual({ text: 'D', style: {} });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/store/block-helpers.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement resolveStyleRange and applyInlineStyle**

```typescript
// Append to packages/docs/src/store/block-helpers.ts

/**
 * Resolve a style range into per-inline segments.
 * Same algorithm as resolveDeleteRange but for a [from, to) range.
 */
export function resolveStyleRange(
  block: Block,
  from: number,
  to: number,
): InlineSegment[] {
  return resolveDeleteRange(block, from, to - from);
}

/**
 * Apply inline style to a range within a block. Returns new Block.
 * Splits inlines as needed and normalizes the result.
 */
export function applyInlineStyle(
  block: Block,
  from: number,
  to: number,
  style: Partial<InlineStyle>,
): Block {
  const newBlock = cloneBlock(block);
  const newInlines: Inline[] = [];
  let pos = 0;

  for (const inline of newBlock.inlines) {
    const inlineEnd = pos + inline.text.length;

    if (inlineEnd <= from || pos >= to) {
      newInlines.push({ text: inline.text, style: { ...inline.style } });
    } else {
      const overlapStart = Math.max(0, from - pos);
      const overlapEnd = Math.min(inline.text.length, to - pos);

      if (overlapStart > 0) {
        newInlines.push({
          text: inline.text.slice(0, overlapStart),
          style: { ...inline.style },
        });
      }

      newInlines.push({
        text: inline.text.slice(overlapStart, overlapEnd),
        style: { ...inline.style, ...style },
      });

      if (overlapEnd < inline.text.length) {
        newInlines.push({
          text: inline.text.slice(overlapEnd),
          style: { ...inline.style },
        });
      }
    }
    pos = inlineEnd;
  }

  newBlock.inlines = normalizeInlines(newInlines);
  return newBlock;
}
```

Note: Add `InlineStyle` to the import from `../model/types.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/store/block-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/store/block-helpers.ts packages/docs/test/store/block-helpers.test.ts
git commit -m "Add resolveStyleRange and applyInlineStyle helpers"
```

---

### Task 7: Add applyStyle to DocStore interface and MemDocStore

**Files:**
- Modify: `packages/docs/src/store/store.ts`
- Modify: `packages/docs/src/store/memory.ts`
- Modify: `packages/docs/test/store/memory.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// Append to packages/docs/test/store/memory.test.ts
describe('fine-grained styling', () => {
  it('applyStyle applies bold to range', () => {
    const block = makeBlock('Hello World');
    const store = new MemDocStore({ blocks: [block] });
    store.applyStyle(block.id, 6, 11, { bold: true });
    const updated = store.getBlock(block.id)!;
    expect(updated.inlines).toHaveLength(2);
    expect(updated.inlines[0].text).toBe('Hello ');
    expect(updated.inlines[1].text).toBe('World');
    expect(updated.inlines[1].style).toEqual({ bold: true });
  });
});
```

- [ ] **Step 2: Add applyStyle to DocStore interface**

```typescript
// Add to packages/docs/src/store/store.ts
/** Apply inline style to a character range within a block. */
applyStyle(
  blockId: string,
  fromOffset: number,
  toOffset: number,
  style: Partial<InlineStyle>,
): void;
```

Note: Add `InlineStyle` to the import from `../model/types.js`.

- [ ] **Step 3: Implement in MemDocStore**

```typescript
// Add to packages/docs/src/store/memory.ts
import { applyInsertText, applyDeleteText, applyInlineStyle as applyInlineStyleHelper } from './block-helpers.js';

applyStyle(blockId: string, fromOffset: number, toOffset: number, style: Partial<InlineStyle>): void {
  const index = this.doc.blocks.findIndex((b) => b.id === blockId);
  if (index === -1) throw new Error(`Block not found: ${blockId}`);
  this.doc.blocks[index] = applyInlineStyleHelper(this.doc.blocks[index], fromOffset, toOffset, style);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/store/memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/store/store.ts packages/docs/src/store/memory.ts packages/docs/test/store/memory.test.ts
git commit -m "Add applyStyle to DocStore and MemDocStore"
```

---

### Task 8: Implement applyStyle in YorkieDocStore

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [ ] **Step 1: Implement applyStyle using styleByPath per segment**

```typescript
// Add to YorkieDocStore class
applyStyle(
  blockId: string,
  fromOffset: number,
  toOffset: number,
  style: Partial<InlineStyle>,
): void {
  const block = this.getBlock(blockId);
  if (!block) throw new Error(`Block not found: ${blockId}`);

  const segments = resolveStyleRange(block, fromOffset, toOffset);
  const blockIdx = this.findBlockIndex(blockId);
  const serialized = serializeInlineStyle(style);

  this.doc.update((root) => {
    const tree = root.content;
    for (const seg of segments) {
      tree.styleByPath(
        [blockIdx, seg.inlineIndex, 0, seg.charFrom],
        [blockIdx, seg.inlineIndex, 0, seg.charTo],
        serialized,
      );
    }
  });

  this.dirty = false;
  this.cachedDoc = null;
}
```

Note: Import `resolveStyleRange` from block-helpers. `serializeInlineStyle` already exists in this file.

- [ ] **Step 2: Run verify**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Implement applyStyle in YorkieDocStore using styleByPath"
```

---

### Task 9: Wire Doc.applyInlineStyle to store.applyStyle for single-block case

**Files:**
- Modify: `packages/docs/src/model/document.ts`

- [ ] **Step 1: Modify Doc.applyInlineStyle single-block path**

In `applyInlineStyle` (~line 302), for the same-block case where both anchor
and focus are in a top-level block (not table cell), replace:

```typescript
this.applyStyleToBlock(block, start, end, style);
this.updateBlockInStore(block.id, block);
```

with:

```typescript
this.store.applyStyle(block.id, start, end, style);
```

Keep the table cell path and cross-block path unchanged for now.

- [ ] **Step 2: Run tests**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/model/document.ts
git commit -m "Wire Doc.applyInlineStyle to store.applyStyle for single-block case"
```

---

## Phase 3: Structural Editing

### Task 10: Add splitBlock and mergeBlock to DocStore and MemDocStore

**Files:**
- Modify: `packages/docs/src/store/store.ts`
- Modify: `packages/docs/src/store/block-helpers.ts`
- Modify: `packages/docs/test/store/block-helpers.test.ts`
- Modify: `packages/docs/src/store/memory.ts`
- Modify: `packages/docs/test/store/memory.test.ts`

- [ ] **Step 1: Write failing tests for applySplitBlock and applyMergeBlocks helpers**

```typescript
// Append to packages/docs/test/store/block-helpers.test.ts
import { applySplitBlock, applyMergeBlocks } from '../../src/store/block-helpers.js';

describe('applySplitBlock', () => {
  it('splits block at offset', () => {
    const block = makeBlock({ text: 'Hello World' });
    const [before, after] = applySplitBlock(block, 5, 'b2', 'paragraph');
    expect(before.inlines[0].text).toBe('Hello');
    expect(after.id).toBe('b2');
    expect(after.inlines[0].text).toBe(' World');
  });

  it('splits at start — first block empty', () => {
    const block = makeBlock({ text: 'Hello' });
    const [before, after] = applySplitBlock(block, 0, 'b2', 'paragraph');
    expect(before.inlines[0].text).toBe('');
    expect(after.inlines[0].text).toBe('Hello');
  });

  it('splits at end — second block empty', () => {
    const block = makeBlock({ text: 'Hello' });
    const [before, after] = applySplitBlock(block, 5, 'b2', 'paragraph');
    expect(before.inlines[0].text).toBe('Hello');
    expect(after.inlines[0].text).toBe('');
  });

  it('preserves inline styles across split', () => {
    const block = makeBlock(
      { text: 'AB', style: { bold: true } },
      { text: 'CD', style: { italic: true } },
    );
    const [before, after] = applySplitBlock(block, 3, 'b2', 'paragraph');
    // "AB" + "C" → before has bold "AB" + italic "C"
    // Wait — offset 3 is at inline[1] charOffset 1
    // before = bold "AB" + italic "C"
    // after = italic "D"
    expect(before.inlines).toHaveLength(2);
    expect(before.inlines[0]).toEqual({ text: 'AB', style: { bold: true } });
    expect(before.inlines[1]).toEqual({ text: 'C', style: { italic: true } });
    expect(after.inlines).toHaveLength(1);
    expect(after.inlines[0]).toEqual({ text: 'D', style: { italic: true } });
  });
});

describe('applyMergeBlocks', () => {
  it('merges two blocks into one', () => {
    const a = makeBlock({ text: 'Hello' });
    const b = makeBlock({ text: ' World' });
    const result = applyMergeBlocks(a, b);
    expect(result.inlines[0].text).toBe('Hello World');
  });

  it('merges and normalizes same-style inlines', () => {
    const a = makeBlock({ text: 'AB', style: { bold: true } });
    const b = makeBlock({ text: 'CD', style: { bold: true } });
    const result = applyMergeBlocks(a, b);
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('ABCD');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/store/block-helpers.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement applySplitBlock and applyMergeBlocks**

```typescript
// Append to packages/docs/src/store/block-helpers.ts
import type { BlockType } from '../model/types.js';

/**
 * Split a block at offset. Returns [beforeBlock, afterBlock].
 * The afterBlock gets the new id and type.
 */
export function applySplitBlock(
  block: Block,
  offset: number,
  newBlockId: string,
  newBlockType: BlockType,
): [Block, Block] {
  const before = cloneBlock(block);
  const after = cloneBlock(block);
  after.id = newBlockId;
  after.type = newBlockType;

  const beforeInlines: Inline[] = [];
  const afterInlines: Inline[] = [];
  let pos = 0;

  for (const inline of block.inlines) {
    const inlineEnd = pos + inline.text.length;

    if (inlineEnd <= offset) {
      beforeInlines.push({ text: inline.text, style: { ...inline.style } });
    } else if (pos >= offset) {
      afterInlines.push({ text: inline.text, style: { ...inline.style } });
    } else {
      // Split point is inside this inline
      const splitAt = offset - pos;
      beforeInlines.push({
        text: inline.text.slice(0, splitAt),
        style: { ...inline.style },
      });
      afterInlines.push({
        text: inline.text.slice(splitAt),
        style: { ...inline.style },
      });
    }

    pos = inlineEnd;
  }

  before.inlines = normalizeInlines(beforeInlines);
  after.inlines = normalizeInlines(afterInlines);

  // Remove table data and block-specific attrs from after block
  delete after.tableData;
  delete after.headingLevel;
  delete after.listKind;
  delete after.listLevel;

  return [before, after];
}

/**
 * Merge nextBlock into block. Returns the merged block.
 */
export function applyMergeBlocks(block: Block, nextBlock: Block): Block {
  const merged = cloneBlock(block);
  const nextClone = cloneBlock(nextBlock);
  merged.inlines = normalizeInlines([...merged.inlines, ...nextClone.inlines]);
  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/store/block-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Add splitBlock and mergeBlock to DocStore interface**

```typescript
// Add to packages/docs/src/store/store.ts
/** Split a block at offset, creating a new block after it. */
splitBlock(
  blockId: string,
  offset: number,
  newBlockId: string,
  newBlockType: BlockType,
): void;
/** Merge nextBlock into blockId, removing nextBlock. */
mergeBlock(blockId: string, nextBlockId: string): void;
```

Note: Add `BlockType` to the import.

- [ ] **Step 6: Implement in MemDocStore**

```typescript
// Add to MemDocStore class
import { applySplitBlock, applyMergeBlocks } from './block-helpers.js';

splitBlock(blockId: string, offset: number, newBlockId: string, newBlockType: BlockType): void {
  const index = this.doc.blocks.findIndex((b) => b.id === blockId);
  if (index === -1) throw new Error(`Block not found: ${blockId}`);
  const [before, after] = applySplitBlock(this.doc.blocks[index], offset, newBlockId, newBlockType);
  this.doc.blocks[index] = before;
  this.doc.blocks.splice(index + 1, 0, after);
}

mergeBlock(blockId: string, nextBlockId: string): void {
  const index = this.doc.blocks.findIndex((b) => b.id === blockId);
  const nextIndex = this.doc.blocks.findIndex((b) => b.id === nextBlockId);
  if (index === -1 || nextIndex === -1) throw new Error('Block not found');
  this.doc.blocks[index] = applyMergeBlocks(this.doc.blocks[index], this.doc.blocks[nextIndex]);
  this.doc.blocks.splice(nextIndex, 1);
}
```

- [ ] **Step 7: Write and run MemDocStore tests**

```typescript
// Append to packages/docs/test/store/memory.test.ts
describe('structural editing', () => {
  it('splitBlock splits at offset', () => {
    const block = makeBlock('Hello World');
    const store = new MemDocStore({ blocks: [block] });
    store.splitBlock(block.id, 5, 'b2', 'paragraph');
    const doc = store.getDocument();
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0].inlines[0].text).toBe('Hello');
    expect(doc.blocks[1].id).toBe('b2');
    expect(doc.blocks[1].inlines[0].text).toBe(' World');
  });

  it('mergeBlock merges and removes next', () => {
    const b1 = makeBlock('Hello');
    const b2 = makeBlock(' World');
    const store = new MemDocStore({ blocks: [b1, b2] });
    store.mergeBlock(b1.id, b2.id);
    const doc = store.getDocument();
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].inlines[0].text).toBe('Hello World');
  });
});
```

Run: `cd packages/docs && npx vitest run test/store/memory.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/docs/src/store/store.ts packages/docs/src/store/block-helpers.ts packages/docs/test/store/block-helpers.test.ts packages/docs/src/store/memory.ts packages/docs/test/store/memory.test.ts
git commit -m "Add splitBlock and mergeBlock to DocStore, helpers, and MemDocStore"
```

---

### Task 11: Implement splitBlock and mergeBlock in YorkieDocStore

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [ ] **Step 1: Implement splitBlock using single-level splitByPath calls**

```typescript
// Add to YorkieDocStore class
splitBlock(
  blockId: string,
  offset: number,
  newBlockId: string,
  newBlockType: BlockType,
): void {
  const block = this.getBlock(blockId);
  if (!block) throw new Error(`Block not found: ${blockId}`);

  const { inlineIndex, charOffset } = resolveOffset(block, offset);
  const blockIdx = this.findBlockIndex(blockId);

  this.doc.update((root) => {
    const tree = root.content;

    // 1. Split text node at character offset
    if (charOffset > 0 && charOffset < block.inlines[inlineIndex].text.length) {
      tree.splitByPath([blockIdx, inlineIndex, 0, charOffset], 1);
    }

    // 2. Split inline level (to create a new inline boundary)
    const splitInlineIdx = charOffset === 0 ? inlineIndex : inlineIndex + 1;
    if (splitInlineIdx > 0 && splitInlineIdx < block.inlines.length + 1) {
      tree.splitByPath([blockIdx, splitInlineIdx], 1);
    }

    // 3. Split block level
    tree.splitByPath([blockIdx + 1], 1);

    // 4. Set new block attributes
    // TODO: Set id, type attributes on the new block node
  });

  this.dirty = false;
  this.cachedDoc = null;
}
```

Note: The exact split path indices and attribute setting depend on how Yorkie's
`splitByPath` modifies the tree structure. This will need adjustment during
implementation based on Yorkie's actual behavior. Write integration tests to
verify the resulting tree structure.

- [ ] **Step 2: Implement mergeBlock using single-level mergeByPath calls**

```typescript
// Add to YorkieDocStore class
mergeBlock(blockId: string, nextBlockId: string): void {
  const block = this.getBlock(blockId);
  const nextBlock = this.getBlock(nextBlockId);
  if (!block || !nextBlock) throw new Error('Block not found');

  const blockIdx = this.findBlockIndex(blockId);

  this.doc.update((root) => {
    const tree = root.content;

    // 1. Merge block level (nextBlock into block)
    tree.mergeByPath([blockIdx + 1]);

    // 2. Merge adjacent inlines with same style at the join point
    const joinInlineIdx = block.inlines.length;
    if (joinInlineIdx > 0 && joinInlineIdx < block.inlines.length + nextBlock.inlines.length) {
      // Check if styles match before merging
      const lastStyle = block.inlines[block.inlines.length - 1].style;
      const firstNextStyle = nextBlock.inlines[0].style;
      if (inlineStylesEqual(lastStyle, firstNextStyle)) {
        tree.mergeByPath([blockIdx, joinInlineIdx]);
      }
    }
  });

  this.dirty = false;
  this.cachedDoc = null;
}
```

- [ ] **Step 3: Run verify**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Implement splitBlock and mergeBlock in YorkieDocStore"
```

---

### Task 12: Wire Doc.splitBlock and Doc.mergeBlocks to store methods

**Files:**
- Modify: `packages/docs/src/model/document.ts`

- [ ] **Step 1: Modify Doc.splitBlock for top-level blocks**

In `splitBlock()` (~line 196), for the top-level (non-cell) path, replace the
manual inline splitting + `store.updateBlock()` + `store.insertBlock()` with a
single `store.splitBlock()` call. Keep business logic (empty list item
conversion, HR handling) in Doc.

```typescript
// The method should become roughly:
splitBlock(blockId: string, offset: number): string {
  const cellInfo = this._blockParentMap.get(blockId);
  if (cellInfo) {
    return this.splitBlockInCellInternal(cellInfo, blockId, offset);
  }

  const block = this.getBlock(blockId);
  const blockText = getBlockText(block);

  // Business logic stays in Doc
  if (block.type === 'list-item' && blockText.length === 0) {
    this.setBlockType(blockId, 'paragraph');
    return blockId;
  }
  if (block.type === 'horizontal-rule') {
    const newBlock = { id: generateBlockId(), type: 'paragraph' as const, ... };
    this.store.insertBlock(this.getBlockIndex(blockId) + 1, newBlock);
    this.refresh();
    return newBlock.id;
  }

  // Determine new block type
  let newType: BlockType = 'paragraph';
  if (block.type === 'list-item') newType = 'list-item';

  const newBlockId = generateBlockId();
  this.store.splitBlock(blockId, offset, newBlockId, newType);
  this.refresh();
  return newBlockId;
}
```

- [ ] **Step 2: Modify Doc.mergeBlocks for top-level blocks**

```typescript
mergeBlocks(blockId: string, nextBlockId: string): void {
  const cellInfo = this._blockParentMap.get(blockId);
  if (cellInfo) {
    // Keep existing cell merge logic for now (Phase 4)
    ...
    return;
  }

  this.store.mergeBlock(blockId, nextBlockId);
  this.refresh();
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/model/document.ts
git commit -m "Wire Doc.splitBlock and mergeBlocks to store methods for top-level blocks"
```

---

## Phase 4: Table Cell Internal Edits

### Task 13: Add table cell variants to DocStore and MemDocStore

**Files:**
- Modify: `packages/docs/src/store/store.ts`
- Modify: `packages/docs/src/store/memory.ts`
- Modify: `packages/docs/test/store/memory.test.ts`

- [ ] **Step 1: Add insertTextInCell, deleteTextInCell, applyStyleInCell to DocStore interface**

```typescript
// Add to packages/docs/src/store/store.ts

/** Insert text in a cell's block at offset. */
insertTextInCell(
  tableBlockId: string, rowIndex: number, colIndex: number,
  cellBlockIndex: number, offset: number, text: string,
): void;
/** Delete text in a cell's block. */
deleteTextInCell(
  tableBlockId: string, rowIndex: number, colIndex: number,
  cellBlockIndex: number, offset: number, length: number,
): void;
/** Apply style in a cell's block. */
applyStyleInCell(
  tableBlockId: string, rowIndex: number, colIndex: number,
  cellBlockIndex: number, fromOffset: number, toOffset: number,
  style: Partial<InlineStyle>,
): void;
```

- [ ] **Step 2: Implement in MemDocStore**

```typescript
// Add to MemDocStore class
insertTextInCell(
  tableBlockId: string, rowIndex: number, colIndex: number,
  cellBlockIndex: number, offset: number, text: string,
): void {
  const block = this.findBlock(tableBlockId);
  const cell = block.tableData!.rows[rowIndex].cells[colIndex];
  cell.blocks[cellBlockIndex] = applyInsertText(cell.blocks[cellBlockIndex], offset, text);
}

deleteTextInCell(
  tableBlockId: string, rowIndex: number, colIndex: number,
  cellBlockIndex: number, offset: number, length: number,
): void {
  const block = this.findBlock(tableBlockId);
  const cell = block.tableData!.rows[rowIndex].cells[colIndex];
  cell.blocks[cellBlockIndex] = applyDeleteText(cell.blocks[cellBlockIndex], offset, length);
}

applyStyleInCell(
  tableBlockId: string, rowIndex: number, colIndex: number,
  cellBlockIndex: number, fromOffset: number, toOffset: number,
  style: Partial<InlineStyle>,
): void {
  const block = this.findBlock(tableBlockId);
  const cell = block.tableData!.rows[rowIndex].cells[colIndex];
  cell.blocks[cellBlockIndex] = applyInlineStyleHelper(cell.blocks[cellBlockIndex], fromOffset, toOffset, style);
}
```

- [ ] **Step 3: Write and run tests**

```typescript
// Append to packages/docs/test/store/memory.test.ts
describe('table cell text editing', () => {
  function makeTableBlock() {
    return {
      id: 'table1',
      type: 'table' as const,
      inlines: [{ text: '', style: {} }],
      style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
      tableData: {
        columnWidths: [0.5, 0.5],
        rows: [{
          cells: [
            { blocks: [{ id: 'cb1', type: 'paragraph' as const, inlines: [{ text: 'Hello', style: {} }], style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 } }], style: {} },
            { blocks: [{ id: 'cb2', type: 'paragraph' as const, inlines: [{ text: 'World', style: {} }], style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 } }], style: {} },
          ],
        }],
      },
    };
  }

  it('insertTextInCell inserts text in cell block', () => {
    const store = new MemDocStore({ blocks: [makeTableBlock()] });
    store.insertTextInCell('table1', 0, 0, 0, 5, '!');
    const block = store.getBlock('table1')!;
    expect(block.tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('Hello!');
  });

  it('deleteTextInCell deletes text in cell block', () => {
    const store = new MemDocStore({ blocks: [makeTableBlock()] });
    store.deleteTextInCell('table1', 0, 1, 0, 0, 3);
    const block = store.getBlock('table1')!;
    expect(block.tableData!.rows[0].cells[1].blocks[0].inlines[0].text).toBe('ld');
  });
});
```

Run: `cd packages/docs && npx vitest run test/store/memory.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/store/store.ts packages/docs/src/store/memory.ts packages/docs/test/store/memory.test.ts
git commit -m "Add table cell text editing methods to DocStore and MemDocStore"
```

---

### Task 14: Implement table cell variants in YorkieDocStore

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [ ] **Step 1: Implement insertTextInCell**

```typescript
insertTextInCell(
  tableBlockId: string, rowIndex: number, colIndex: number,
  cellBlockIndex: number, offset: number, text: string,
): void {
  const block = this.getBlock(tableBlockId);
  if (!block?.tableData) throw new Error('Table block not found');
  const cellBlock = block.tableData.rows[rowIndex].cells[colIndex].blocks[cellBlockIndex];
  const { inlineIndex, charOffset } = resolveOffset(cellBlock, offset);
  const tIdx = this.findBlockIndex(tableBlockId);

  this.doc.update((root) => {
    root.content.editByPath(
      [tIdx, rowIndex, colIndex, cellBlockIndex, inlineIndex, 0, charOffset],
      [tIdx, rowIndex, colIndex, cellBlockIndex, inlineIndex, 0, charOffset],
      { type: 'text', value: text },
    );
  });

  this.dirty = false;
  this.cachedDoc = null;
}
```

- [ ] **Step 2: Implement deleteTextInCell and applyStyleInCell**

Follow the same pattern as top-level versions but with the extended path
`[tIdx, rowIndex, colIndex, cellBlockIndex, ...]`.

- [ ] **Step 3: Run verify**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Implement table cell text editing in YorkieDocStore"
```

---

### Task 15: Wire Doc methods to use cell variants via blockParentMap

**Files:**
- Modify: `packages/docs/src/model/document.ts`

- [ ] **Step 1: Update Doc.insertText cell path**

Replace the table cell branch in `Doc.insertText()` (from Task 5) to use
`store.insertTextInCell()`:

```typescript
insertText(pos: DocPosition, text: string): void {
  const cellInfo = this._blockParentMap.get(pos.blockId);
  if (cellInfo) {
    const cellBlockIdx = this.getCellBlockIndex(cellInfo, pos.blockId);
    this.store.insertTextInCell(
      cellInfo.tableBlockId, cellInfo.rowIndex, cellInfo.colIndex,
      cellBlockIdx, pos.offset, text,
    );
  } else {
    this.store.insertText(pos.blockId, pos.offset, text);
  }
  this.refresh();
}
```

Add a private helper to find the block index within a cell:

```typescript
private getCellBlockIndex(cellInfo: BlockCellInfo, blockId: string): number {
  const tableBlock = this.getBlock(cellInfo.tableBlockId);
  const cell = tableBlock.tableData!.rows[cellInfo.rowIndex].cells[cellInfo.colIndex];
  return cell.blocks.findIndex((b) => b.id === blockId);
}
```

- [ ] **Step 2: Update Doc.deleteText and Doc.applyInlineStyle cell paths similarly**

- [ ] **Step 3: Run tests**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/model/document.ts
git commit -m "Route Doc text/style methods through cell variants via blockParentMap"
```

---

## Phase 5: Undo/Redo

### Task 16: Add Yorkie undo/redo with feature flag

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [ ] **Step 1: Add feature flag and Yorkie undo path**

```typescript
// Add to YorkieDocStore class
private useYorkieUndo = false;  // Feature flag

snapshot(): void {
  if (this.useYorkieUndo) {
    // Yorkie tracks undo units via doc.update() boundaries — no-op
    return;
  }
  // Existing snapshot-based path
  this.undoStack.push(cloneDocument(this.getDocument()));
  this.redoStack = [];
}

undo(): void {
  if (this.useYorkieUndo) {
    try {
      this.doc.history.undo();
      this.dirty = true;
      return;
    } catch {
      // Fallback if Yorkie undo fails
    }
  }
  // Existing snapshot-based path
  if (!this.canUndo()) return;
  this.redoStack.push(cloneDocument(this.getDocument()));
  const prev = this.undoStack.pop()!;
  this.writeFullDocument(prev);
}

redo(): void {
  if (this.useYorkieUndo) {
    try {
      this.doc.history.redo();
      this.dirty = true;
      return;
    } catch {
      // Fallback
    }
  }
  // Existing snapshot-based path
  if (!this.canRedo()) return;
  this.undoStack.push(cloneDocument(this.getDocument()));
  const next = this.redoStack.pop()!;
  this.writeFullDocument(next);
}
```

Note: The exact Yorkie history API (`doc.history.undo()`) may differ — verify
against the Yorkie SDK docs. This is intentionally behind a feature flag.

- [ ] **Step 2: Write a manual test plan**

Since Yorkie undo is unstable, create a manual test checklist:
1. Type text → undo → text disappears
2. Type → bold → undo → bold removed → undo → text removed
3. Enter (split) → undo → blocks merged back
4. Concurrent edit by peer → undo only affects local changes
5. Redo after undo restores the change

- [ ] **Step 3: Run verify**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Add feature-flagged Yorkie undo/redo with snapshot fallback"
```

---

### Task 17: Final cleanup — deprecate updateBlock usage in Doc

**Files:**
- Modify: `packages/docs/src/model/document.ts`
- Modify: `packages/docs/src/store/store.ts`

- [ ] **Step 1: Audit remaining updateBlock calls in Doc**

Search for all calls to `this.store.updateBlock()` and
`this.updateBlockInStore()` in `document.ts`. Each should be replaced with the
appropriate fine-grained method or documented as intentionally kept (for
block-level attribute changes like type, alignment).

- [ ] **Step 2: Add deprecation comment to DocStore.updateBlock**

```typescript
// In store.ts
/**
 * @deprecated Use insertText/deleteText/applyStyle/splitBlock/mergeBlock
 * for text mutations. Only use for block-level attribute changes
 * (type, alignment, list properties).
 */
updateBlock(id: string, block: Block): void;
```

- [ ] **Step 3: Run full verify**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/src/store/store.ts
git commit -m "Deprecate updateBlock for text mutations, document remaining uses"
```
