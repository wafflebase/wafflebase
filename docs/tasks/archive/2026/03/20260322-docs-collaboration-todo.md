# Docs Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time collaborative editing to the docs package using Yorkie's Tree CRDT as the single source of truth behind the DocStore interface.

**Architecture:** `yorkie.Tree` is the single source of truth when `YorkieDocStore` is active. `Doc` class delegates all mutations through `DocStore` methods. `MemDocStore` is fixed to use snapshot-only undo. `TextEditor` reads from a cached `Document` on `Doc`, refreshed after mutations.

**Tech Stack:** TypeScript, Yorkie SDK (`yorkie.Tree`), Vitest

**Spec:** `docs/design/docs-collaboration.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/docs/src/store/store.ts` | Modify | Add `deleteBlockByIndex()` to DocStore interface |
| `packages/docs/src/store/memory.ts` | Modify | Fix undo to snapshot-only; add `deleteBlockByIndex()`; remove per-mutation `pushUndo()` |
| `packages/docs/src/model/document.ts` | Modify | Refactor `Doc` to take `DocStore`, delegate mutations, maintain cached document |
| `packages/docs/src/view/text-editor.ts` | Modify | Replace direct `doc.document.blocks.splice()` with `doc.deleteBlock()` |
| `packages/docs/src/view/editor.ts` | Modify | Remove `syncToStore()`, pass store to `Doc`, add remote change wiring |
| `packages/docs/test/model/document.test.ts` | Modify | Update `Doc` tests to use `MemDocStore` |
| `packages/docs/test/store/memory.test.ts` | Modify | Update undo tests for snapshot-only contract |

---

### Task 1: Fix MemDocStore to snapshot-only undo

The current `MemDocStore` pushes undo on every `updateBlock()`, `insertBlock()`, `deleteBlock()`, `setDocument()`, `setPageSetup()`. Per the design, only explicit `snapshot()` calls should create undo entries.

**Files:**
- Modify: `packages/docs/src/store/memory.ts`
- Modify: `packages/docs/test/store/memory.test.ts`

- [x] **Step 1: Update MemDocStore — remove pushUndo from mutation methods**

In `packages/docs/src/store/memory.ts`, remove `this.pushUndo()` calls from `updateBlock()`, `insertBlock()`, `deleteBlock()`, `setPageSetup()`. Keep `pushUndo()` only in `snapshot()` and `setDocument()` (which is a full replacement and should preserve undo).

Actually, `setDocument()` should also use explicit `snapshot()` — remove `pushUndo()` from it too. The caller is responsible for calling `snapshot()` before `setDocument()`.

```typescript
setDocument(doc: Document): void {
  this.doc = cloneDocument(doc);
  this.redoStack = [];
}

updateBlock(id: string, block: Block): void {
  const index = this.doc.blocks.findIndex((b) => b.id === id);
  if (index === -1) throw new Error(`Block not found: ${id}`);
  this.doc.blocks[index] = JSON.parse(JSON.stringify(block));
}

insertBlock(index: number, block: Block): void {
  this.doc.blocks.splice(index, 0, JSON.parse(JSON.stringify(block)));
}

deleteBlock(id: string): void {
  const index = this.doc.blocks.findIndex((b) => b.id === id);
  if (index === -1) throw new Error(`Block not found: ${id}`);
  this.doc.blocks.splice(index, 1);
}

setPageSetup(setup: PageSetup): void {
  this.doc.pageSetup = JSON.parse(JSON.stringify(setup));
}
```

Note: `redoStack = []` clearing is kept in `snapshot()` (line 101) which is the
only place redo state should be invalidated. Individual mutations do not clear
redo — the caller decides when to snapshot.

- [x] **Step 2: Update MemDocStore tests for snapshot-only undo**

7 of 8 existing undo/redo tests rely on per-mutation undo and will break:
- "should undo a setDocument"
- "should redo after undo"
- "should clear redo stack on new mutation"
- "should report canUndo/canRedo correctly"
- "should undo insertBlock"
- "should undo deleteBlock"
- "should undo updateBlock"

Rewrite all to use `snapshot()` before mutations. Add a test verifying mutations
without snapshot are NOT undoable.

```typescript
it('should undo updateBlock when preceded by snapshot', () => {
  const block = makeBlock('Hello');
  const store = new MemDocStore({ blocks: [block] });
  store.snapshot();
  store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
  expect(store.getBlock(block.id)?.inlines[0].text).toBe('World');
  store.undo();
  expect(store.getBlock(block.id)?.inlines[0].text).toBe('Hello');
});

it('mutation without snapshot is not undoable', () => {
  const block = makeBlock('Hello');
  const store = new MemDocStore({ blocks: [block] });
  store.updateBlock(block.id, { ...block, inlines: [{ text: 'World', style: {} }] });
  expect(store.canUndo()).toBe(false);
});
```

- [x] **Step 3: Run tests**

Run: `pnpm --filter @wafflebase/docs test`
Expected: All tests pass.

- [x] **Step 4: Commit**

```bash
git add packages/docs/src/store/memory.ts packages/docs/test/store/memory.test.ts
git commit -m "Fix MemDocStore to snapshot-only undo contract

Per docs-collaboration design, only explicit snapshot() calls create
undo entries. Mutation methods no longer auto-push to undo stack."
```

---

### Task 2: Add deleteBlockByIndex to DocStore interface

`TextEditor.deleteSelection()` currently uses `doc.document.blocks.splice(i, 1)` to remove middle blocks by index. After refactoring, `Doc` needs a way to delete blocks by index (not just by ID). Add this to the interface.

**Files:**
- Modify: `packages/docs/src/store/store.ts`
- Modify: `packages/docs/src/store/memory.ts`

- [x] **Step 1: Add deleteBlockByIndex to DocStore interface**

```typescript
// In store.ts, add to DocStore interface:
deleteBlockByIndex(index: number): void;
```

- [x] **Step 2: Implement in MemDocStore**

```typescript
deleteBlockByIndex(index: number): void {
  if (index < 0 || index >= this.doc.blocks.length) {
    throw new Error(`Block index out of bounds: ${index}`);
  }
  this.doc.blocks.splice(index, 1);
}
```

- [x] **Step 3: Add tests for deleteBlockByIndex**

In `packages/docs/test/store/memory.test.ts`:

```typescript
it('should delete a block by index', () => {
  const block1 = makeBlock('First');
  const block2 = makeBlock('Second');
  const store = new MemDocStore({ blocks: [block1, block2] });
  store.deleteBlockByIndex(0);
  expect(store.getDocument().blocks).toHaveLength(1);
  expect(store.getDocument().blocks[0].id).toBe(block2.id);
});

it('should throw for out-of-bounds index', () => {
  const store = new MemDocStore({ blocks: [makeBlock('Only')] });
  expect(() => store.deleteBlockByIndex(1)).toThrow('out of bounds');
  expect(() => store.deleteBlockByIndex(-1)).toThrow('out of bounds');
});
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @wafflebase/docs test`
Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/store/store.ts packages/docs/src/store/memory.ts
git commit -m "Add deleteBlockByIndex to DocStore interface

Needed by Doc.deleteSelection() which removes middle blocks by
index during multi-block selection deletion."
```

---

### Task 3: Refactor Doc class to use DocStore

The core refactoring: `Doc` takes a `DocStore` instead of a `Document`, delegates all mutations through the store, and maintains a cached `Document` for reads.

**Files:**
- Modify: `packages/docs/src/model/document.ts`
- Modify: `packages/docs/test/model/document.test.ts`

- [x] **Step 1: Update Doc constructor and add cached document pattern**

```typescript
export class Doc {
  private _document: Document;

  constructor(private store: DocStore) {
    this._document = store.getDocument();
  }

  /** Cached document for reads. Refreshed after mutations. */
  get document(): Document {
    return this._document;
  }

  /** Needed for editor.ts to assign on undo/redo (doc.document = store.getDocument()) */
  set document(doc: Document) {
    this._document = doc;
  }

  /** Refresh cached document from store. */
  refresh(): void {
    this._document = this.store.getDocument();
  }

  static create(): Doc {
    const store = new MemDocStore();
    store.setDocument({ blocks: [createEmptyBlock()] });
    return new Doc(store);
  }
```

- [x] **Step 2: Refactor getBlock and getBlockIndex to use cached document**

These read methods use the cached `_document` — no store call needed:

```typescript
getBlock(blockId: string): Block {
  const block = this._document.blocks.find((b) => b.id === blockId);
  if (!block) throw new Error(`Block not found: ${blockId}`);
  return block;
}

getBlockIndex(blockId: string): number {
  return this._document.blocks.findIndex((b) => b.id === blockId);
}
```

- [x] **Step 3: Refactor mutation methods to delegate through store**

Each mutation method: compute the result, call store methods, then refresh cache.

`insertText`:
```typescript
insertText(pos: DocPosition, text: string): void {
  const block = this.getBlock(pos.blockId);
  const { inlineIndex, charOffset } = this.resolveOffset(block, pos.offset);
  const inline = block.inlines[inlineIndex];
  inline.text = inline.text.slice(0, charOffset) + text + inline.text.slice(charOffset);
  this.store.updateBlock(pos.blockId, block);
  this.refresh();
}
```

`deleteText`:
```typescript
deleteText(pos: DocPosition, length: number): void {
  const block = this.getBlock(pos.blockId);
  // ... existing deletion logic (same as current) ...
  this.store.updateBlock(pos.blockId, block);
  this.refresh();
}
```

`splitBlock`:
```typescript
splitBlock(blockId: string, offset: number): string {
  const blockIndex = this.getBlockIndex(blockId);
  const block = this.getBlock(blockId);
  // ... compute beforeInlines and afterInlines (same logic) ...

  // Update current block
  block.inlines = beforeInlines.length > 0
    ? beforeInlines
    : [{ text: '', style: this.getStyleAtOffset(block, offset) }];
  this.store.updateBlock(blockId, block);

  // Create and insert new block
  const newBlock: Block = { ... };
  this.store.insertBlock(blockIndex + 1, newBlock);
  this.refresh();
  return newBlock.id;
}
```

`mergeBlocks`:
```typescript
mergeBlocks(blockId: string, nextBlockId: string): void {
  const block = this.getBlock(blockId);
  const nextBlock = this.getBlock(nextBlockId);
  block.inlines = [...block.inlines, ...nextBlock.inlines];
  this.normalizeInlines(block);
  this.store.updateBlock(blockId, block);
  this.store.deleteBlock(nextBlockId);
  this.refresh();
}
```

`deleteBackward`:
```typescript
deleteBackward(pos: DocPosition): DocPosition {
  if (pos.offset > 0) {
    const newPos = { blockId: pos.blockId, offset: pos.offset - 1 };
    this.deleteText(newPos, 1);  // already calls refresh
    return newPos;
  }
  const blockIndex = this.getBlockIndex(pos.blockId);
  if (blockIndex <= 0) return pos;
  const prevBlock = this._document.blocks[blockIndex - 1];
  const prevLength = getBlockTextLength(prevBlock);
  const currentBlock = this._document.blocks[blockIndex];
  this.mergeBlocks(prevBlock.id, currentBlock.id);  // already calls refresh
  return { blockId: prevBlock.id, offset: prevLength };
}
```

`applyInlineStyle` and `applyBlockStyle`:
```typescript
applyInlineStyle(range: DocRange, style: Partial<InlineStyle>): void {
  // ... existing logic that modifies blocks in place ...
  // After modifying each block, update the store:
  for (let i = fromBlockIdx; i <= toBlockIdx; i++) {
    const block = this._document.blocks[i];
    // ... apply style to block ...
    this.store.updateBlock(block.id, block);
  }
  this.refresh();
}

applyBlockStyle(blockId: string, style: Partial<BlockStyle>): void {
  const block = this.getBlock(blockId);
  block.style = { ...block.style, ...style };
  this.store.updateBlock(blockId, block);
  this.refresh();
}
```

Add a `deleteBlock` method for TextEditor's deleteSelection:
```typescript
deleteBlock(blockId: string): void {
  this.store.deleteBlock(blockId);
  this.refresh();
}

deleteBlockByIndex(index: number): void {
  this.store.deleteBlockByIndex(index);
  this.refresh();
}
```

- [x] **Step 4: Update tests to create Doc with MemDocStore**

```typescript
// Before:
const doc = Doc.create();

// After (Doc.create() already returns a Doc with MemDocStore, so no change needed)

// For tests that construct Doc directly:
// Before:
const doc = new Doc({ blocks: [createEmptyBlock()] });

// After:
const store = new MemDocStore({ blocks: [createEmptyBlock()] });
const doc = new Doc(store);
```

Update all tests in `packages/docs/test/model/document.test.ts` to use the new constructor pattern.

- [x] **Step 5: Run tests**

Run: `pnpm --filter @wafflebase/docs test`
Expected: All tests pass.

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/test/model/document.test.ts
git commit -m "Refactor Doc class to delegate mutations through DocStore

Doc now takes a DocStore in its constructor and delegates all
mutations (insert, delete, split, merge, style) through store
methods. Maintains a cached Document for reads, refreshed after
each mutation."
```

---

### Task 4: Fix TextEditor.deleteSelection to use Doc methods

The `deleteSelection()` method in `TextEditor` directly splices `doc.document.blocks`. This must go through `Doc` methods.

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

- [x] **Step 1: Replace direct splice with doc.deleteBlockByIndex()**

In `deleteSelection()` at line ~891, replace:
```typescript
// Before:
this.doc.document.blocks.splice(i, 1);
```
with:
```typescript
// After:
this.doc.deleteBlockByIndex(i);
```

And at line ~895, replace:
```typescript
// Before:
const lastBlockId = this.doc.document.blocks[startBlockIdx + 1]?.id;
```
with the same pattern but read from `doc.document` (which is now the cached version, refreshed by `deleteBlockByIndex`).

- [x] **Step 2: Run tests**

Run: `pnpm --filter @wafflebase/docs test`
Expected: All tests pass.

- [x] **Step 3: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "Replace direct block splice in deleteSelection with Doc method

TextEditor now uses doc.deleteBlockByIndex() instead of directly
splicing doc.document.blocks, ensuring mutations go through DocStore."
```

---

### Task 5: Remove syncToStore from editor.ts

The `syncToStore()` pattern (`docStore.replaceDocument(doc.document)`) is no longer needed since `Doc` writes through the store directly.

**Files:**
- Modify: `packages/docs/src/view/editor.ts`

- [x] **Step 1: Update Doc creation and remove syncToStore**

```typescript
// Change Doc creation (line ~58):
// Before:
const doc = new Doc(storeDoc);

// After:
const doc = new Doc(docStore);
```

Remove the `syncToStore` function entirely (lines ~119-121).

Remove `syncToStore()` call from `render()` (line ~216).

- [x] **Step 2: Update undo/redo to use doc.refresh()**

In `undoFn` and `redoFn`, replace `doc.document = docStore.getDocument()` with `doc.refresh()`:

```typescript
const undoFn = () => {
  if (docStore.canUndo()) {
    docStore.undo();
    doc.refresh();
    layoutCache = undefined;
    if (doc.document.blocks.length > 0) {
      cursor.moveTo({ blockId: doc.document.blocks[0].id, offset: 0 });
    }
    needsScrollIntoView = true;
    render();
  }
};
```

- [x] **Step 3: Update initial document setup**

The initialization that ensures at least one block:

```typescript
// Before:
let storeDoc = docStore.getDocument();
if (storeDoc.blocks.length === 0) {
  const doc = Doc.create();
  docStore.setDocument(doc.document);
  storeDoc = docStore.getDocument();
}
const doc = new Doc(storeDoc);

// After:
const initDoc = docStore.getDocument();
if (initDoc.blocks.length === 0) {
  const emptyDoc = Doc.create();
  docStore.setDocument(emptyDoc.document);
}
const doc = new Doc(docStore);
```

- [x] **Step 4: Update ruler onMarginChange handler**

Remove direct `doc.document.pageSetup = setup` since the store is now the source of truth:

```typescript
ruler.onMarginChange((margins) => {
  docStore.snapshot();
  const setup = resolvePageSetup(doc.document.pageSetup);
  setup.margins = { ...margins };
  docStore.setPageSetup(setup);
  doc.refresh();  // pick up the pageSetup change
  layoutCache = undefined;
  render();
});
```

- [x] **Step 5: Run tests**

Run: `pnpm verify:fast`
Expected: All tests pass.

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/view/editor.ts
git commit -m "Remove syncToStore pattern from editor

Doc now writes through DocStore directly, so replaceDocument()
sync is no longer needed. Undo/redo uses doc.refresh() instead
of direct document assignment."
```

---

### Task 6: Verify full integration

- [x] **Step 1: Run full verification**

Run: `pnpm verify:fast`
Expected: All tests pass, no lint errors.

- [x] **Step 2: Manual smoke test (optional)** (skipped — verify:fast passed)

If dev environment is running (`pnpm dev`), open the docs editor and verify:
- Text input works
- Enter (split block) and Backspace (merge block) work
- Bold/italic styling works
- Undo/redo works
- Multi-block selection delete works

- [x] **Step 3: Commit any remaining fixes**

If any fixes are needed, commit them.

---

## Design Notes

- **replaceDocument()**: After removing `syncToStore()`, `replaceDocument()` has
  no callers. It is kept on the DocStore interface for now (undo/redo restore
  still uses it internally in MemDocStore). On `YorkieDocStore` it will be a no-op.
- **Doc reads from cached `_document`**: `Doc.getBlock()` reads from the cached
  `_document` (not `store.getBlock()`). This is safe because `MemDocStore.getDocument()`
  returns a deep clone, and `refresh()` replaces the entire cache after mutations.
  Future store implementations must maintain this clone-on-read contract.
- **Repeated refresh() in compound ops**: Methods like `deleteBackward()` may
  call `deleteText()` then `mergeBlocks()`, each of which calls `refresh()`.
  The extra clone is harmless for correctness; optimization can come later if profiling
  shows it matters.

## Future Tasks (Not in this plan)

These are deferred to follow-up work:

1. **YorkieDocStore implementation** — Create `YorkieDocStore` in `packages/frontend` that implements `DocStore` using `yorkie.Tree` as the backing store
2. **Frontend integration** — Wire `YorkieDocStore` into the docs page component
3. **Remote change handling** — Subscribe to Yorkie remote changes, call `doc.refresh()` and re-render
4. **Presence** — Show other users' cursors and selections
5. **Yorkie-based undo/redo** — Migrate from local snapshots to `doc.history`
6. **Doc.deleteRange()** — Extract multi-block deletion logic from `TextEditor.deleteSelection()` into a proper `Doc.deleteRange()` method for better testability
