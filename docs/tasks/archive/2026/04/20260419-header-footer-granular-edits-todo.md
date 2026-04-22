# Header/Footer Granular Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Created**: 2026-04-19

**Goal:** Replace full-document rewrite (`writeFullDocument`) with character-level Tree edits for header/footer blocks, eliminating CRDT tombstone explosion.

**Architecture:** Add a `resolveBlockTreePath(blockId)` helper that returns the full Yorkie Tree path for any block — whether it's in header (`[0, blockIdx, ...]`), footer (`[footerTreeIdx, blockIdx, ...]`), or body (`[blockIdx + bodyOffset, ...]`). Each mutation method (`insertText`, `deleteText`, `applyStyle`, `updateBlock`, `deleteBlock`, `splitBlock`, `mergeBlock`) uses this path instead of branching to `commitHeaderFooterChange`.

**Tech Stack:** TypeScript, Yorkie JS SDK Tree API (`editByPath`, `editBulkByPath`, `styleByPath`)

---

## Context

### Problem
Header/footer edits call `commitHeaderFooterChange()` → `writeFullDocument()`, which deletes ALL tree children and re-inserts them. In CRDT, deletes create tombstones. A single character edit in the header generates ~8,000 tombstone nodes. After ~100 such edits, the document grows to 120MB (2.2GB in memory), crashing the server.

### Current Tree Structure
```
doc (root)
├── header [0]                    ← type="header" wrapper
│   ├── block [0, 0]             ← type="block" with id/type attrs
│   │   ├── inline [0, 0, 0]
│   │   │   └── text
│   │   └── inline [0, 0, 1]
│   └── block [0, 1]
├── block [1]                     ← body block (bodyTreeOffset = 1)
├── block [2]
└── footer [3]                    ← type="footer" wrapper (last child)
    └── block [3, 0]
```

### Key Insight
Body blocks already use character-level `editByPath` with paths like `[blockIdx + off, inlineIdx, charOffset]`. Header/footer blocks just need paths like `[headerTreeIdx, blockIdxInHeader, inlineIdx, charOffset]` — one extra level of nesting.

### File
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

---

### Task 1: Add `resolveBlockTreePath` helper

Replace `findHeaderFooterBlock` + `bodyTreeOffset` with a unified path resolver.

- [ ] **Step 1: Add the helper method to YorkieDocStore**

Add after the existing `bodyTreeOffset` method (~line 525):

```typescript
/**
 * Resolve a block ID to its Yorkie tree path prefix.
 * - Header block: [0, blockIdx]
 * - Body block:   [blockIdx + bodyOffset]
 * - Footer block: [footerTreeIdx, blockIdx]
 *
 * Returns { path, region } where path is the tree path to the block node,
 * and region indicates where the block lives.
 */
private resolveBlockTreePath(
  blockId: string,
  doc: Document,
): { path: number[]; region: 'header' | 'body' | 'footer' } {
  // Check header
  if (doc.header) {
    const idx = doc.header.blocks.findIndex((b) => b.id === blockId);
    if (idx !== -1) return { path: [0, idx], region: 'header' };
  }

  // Check body
  const bodyIdx = doc.blocks.findIndex((b) => b.id === blockId);
  if (bodyIdx !== -1) {
    return { path: [bodyIdx + this.bodyTreeOffset(doc)], region: 'body' };
  }

  // Check footer
  if (doc.footer) {
    const idx = doc.footer.blocks.findIndex((b) => b.id === blockId);
    if (idx !== -1) {
      // Footer is the last child of the tree root.
      // Its index = bodyOffset + body block count
      const footerTreeIdx = this.bodyTreeOffset(doc) + doc.blocks.length;
      return { path: [footerTreeIdx, idx], region: 'footer' };
    }
  }

  throw new Error(`Block not found: ${blockId}`);
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/frontend && pnpm tsc --noEmit 2>&1 | tail -5`
Expected: no errors from yorkie-doc-store.ts

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Add resolveBlockTreePath helper for header/footer tree paths"
```

---

### Task 2: Convert `insertText` to use granular header/footer edits

- [ ] **Step 1: Replace the header/footer branch in insertText**

Replace the current header/footer early return (lines ~611-616):

```typescript
// BEFORE:
const hf = this.findHeaderFooterBlock(blockId, currentDoc);
if (hf) {
  hf.blocks[hf.index] = applyInsertText(hf.blocks[hf.index], offset, text);
  this.commitHeaderFooterChange(currentDoc);
  return;
}
```

With unified path resolution. The full `insertText` method becomes:

```typescript
insertText(blockId: string, offset: number, text: string): void {
  const currentDoc = this.getDocument();
  const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);

  // Find the block object regardless of region
  const block =
    region === 'header' ? currentDoc.header!.blocks[blockPath[blockPath.length - 1]] :
    region === 'footer' ? currentDoc.footer!.blocks[blockPath[blockPath.length - 1]] :
    currentDoc.blocks[blockPath[0] - this.bodyTreeOffset(currentDoc)];

  const cacheResolved = resolveOffset(block, offset);
  const targetInline = block.inlines[cacheResolved.inlineIndex];

  this.doc.update((root) => {
    const tree = root.content;
    if (!tree || typeof tree.getRootTreeNode !== 'function') return;

    const treeRoot = tree.getRootTreeNode();
    // resolveTreeOffset needs the absolute tree index of the block node.
    // For body blocks, blockPath is [treeIdx]. For header/footer, it's [wrapperIdx, blockIdx].
    // We need to find the block node in the tree to resolve inline offsets.
    const blockNode = this.getTreeBlockNode(treeRoot, blockPath);
    const inlineChildren = ((blockNode as ElementNode).children ?? []).filter(
      (c): c is ElementNode => c.type === 'inline',
    );
    let remaining = offset;
    let inlineIndex = 0;
    let charOffset = 0;
    for (let i = 0; i < inlineChildren.length; i++) {
      const textLen = (inlineChildren[i].children ?? [])
        .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
        .reduce((sum, t) => sum + t.value.length, 0);
      if (remaining <= textLen) {
        inlineIndex = i;
        charOffset = remaining;
        break;
      }
      remaining -= textLen;
      if (i === inlineChildren.length - 1) {
        inlineIndex = i;
        charOffset = textLen;
      }
    }

    if (targetInline.style.image) {
      const { image: _, ...plainStyle } = targetInline.style;
      void _;
      const newNode = buildInlineNode({ text, style: plainStyle });
      if (charOffset === 0) {
        tree.editByPath(
          [...blockPath, inlineIndex],
          [...blockPath, inlineIndex],
          newNode,
        );
      } else {
        tree.editByPath(
          [...blockPath, inlineIndex + 1],
          [...blockPath, inlineIndex + 1],
          newNode,
        );
      }
    } else {
      tree.editByPath(
        [...blockPath, inlineIndex, charOffset],
        [...blockPath, inlineIndex, charOffset],
        { type: 'text', value: text },
      );
    }
  });

  // Update cache in-place
  const updatedBlock = applyInsertText(block, offset, text);
  if (region === 'header') {
    currentDoc.header!.blocks[blockPath[blockPath.length - 1]] = updatedBlock;
  } else if (region === 'footer') {
    currentDoc.footer!.blocks[blockPath[blockPath.length - 1]] = updatedBlock;
  } else {
    currentDoc.blocks[blockPath[0] - this.bodyTreeOffset(currentDoc)] = updatedBlock;
  }
  this.cachedDoc = currentDoc;
  this.dirty = false;
}
```

- [ ] **Step 2: Add the `getTreeBlockNode` helper**

Add near `resolveTreeOffset`:

```typescript
/**
 * Navigate the tree to find the block node at the given path.
 */
private getTreeBlockNode(treeRoot: TreeNode, blockPath: number[]): TreeNode {
  let node = treeRoot;
  for (const idx of blockPath) {
    node = ((node as ElementNode).children ?? [])[idx];
  }
  return node;
}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/frontend && pnpm tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Convert insertText to granular edits for header/footer blocks"
```

---

### Task 3: Convert `deleteText` to use granular header/footer edits

- [ ] **Step 1: Replace the header/footer branch in deleteText**

Replace the header/footer early return (lines ~669-674) with unified logic:

```typescript
deleteText(blockId: string, offset: number, length: number): void {
  const currentDoc = this.getDocument();
  const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);

  const block =
    region === 'header' ? currentDoc.header!.blocks[blockPath[blockPath.length - 1]] :
    region === 'footer' ? currentDoc.footer!.blocks[blockPath[blockPath.length - 1]] :
    currentDoc.blocks[blockPath[0] - this.bodyTreeOffset(currentDoc)];

  this.doc.update((root) => {
    const tree = root.content;
    if (!tree || typeof tree.getRootTreeNode !== 'function') return;

    const treeRoot = tree.getRootTreeNode();
    const blockNode = this.getTreeBlockNode(treeRoot, blockPath);
    const inlineChildren = ((blockNode as ElementNode).children ?? []).filter(
      (c): c is ElementNode => c.type === 'inline',
    );

    // Resolve start and end positions from the tree structure
    const resolvePos = (pos: number) => {
      let rem = pos;
      for (let i = 0; i < inlineChildren.length; i++) {
        const textLen = (inlineChildren[i].children ?? [])
          .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
          .reduce((sum, t) => sum + t.value.length, 0);
        if (rem <= textLen) return { inlineIndex: i, charOffset: rem };
        rem -= textLen;
      }
      const lastIdx = Math.max(0, inlineChildren.length - 1);
      const lastLen = (inlineChildren[lastIdx]?.children ?? [])
        .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
        .reduce((sum, t) => sum + t.value.length, 0);
      return { inlineIndex: lastIdx, charOffset: lastLen };
    };

    const treeStart = resolvePos(offset);
    const treeEnd = resolvePos(offset + length);

    tree.editByPath(
      [...blockPath, treeStart.inlineIndex, treeStart.charOffset],
      [...blockPath, treeEnd.inlineIndex, treeEnd.charOffset],
    );

    // Remove empty inlines after deletion
    const updatedBlockNode = this.getTreeBlockNode(tree.getRootTreeNode(), blockPath);
    const updatedInlines = ((updatedBlockNode as ElementNode).children ?? []).filter(
      (c) => c.type === 'inline',
    ) as ElementNode[];
    for (let i = updatedInlines.length - 1; i >= 0; i--) {
      if (updatedInlines.length <= 1) break;
      const textLen = (updatedInlines[i].children ?? [])
        .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
        .reduce((sum, t) => sum + t.value.length, 0);
      if (textLen === 0) {
        tree.editByPath([...blockPath, i], [...blockPath, i + 1]);
      }
    }
  });

  // Update cache in-place
  const updatedBlock = applyDeleteText(block, offset, length);
  if (region === 'header') {
    currentDoc.header!.blocks[blockPath[blockPath.length - 1]] = updatedBlock;
  } else if (region === 'footer') {
    currentDoc.footer!.blocks[blockPath[blockPath.length - 1]] = updatedBlock;
  } else {
    currentDoc.blocks[blockPath[0] - this.bodyTreeOffset(currentDoc)] = updatedBlock;
  }
  this.cachedDoc = currentDoc;
  this.dirty = false;
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/frontend && pnpm tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Convert deleteText to granular edits for header/footer blocks"
```

---

### Task 4: Convert `updateBlock` and `applyStyle`

These two methods use the same pattern: replace a whole block node via `editByPath([idx], [idx+1], newNode)`.

- [ ] **Step 1: Update `updateBlock`**

Replace the header/footer early return:

```typescript
updateBlock(id: string, block: Block): void {
  const currentDoc = this.getDocument();
  const { path: blockPath, region } = this.resolveBlockTreePath(id, currentDoc);

  this.doc.update((root) => {
    const tree = root.content;
    if (!tree || typeof tree.getRootTreeNode !== 'function') return;
    const endPath = [...blockPath];
    endPath[endPath.length - 1] += 1;
    tree.editByPath(blockPath, endPath, buildBlockNode(block));
  });

  // Update cache in-place
  if (region === 'header') {
    currentDoc.header!.blocks[blockPath[blockPath.length - 1]] = block;
  } else if (region === 'footer') {
    currentDoc.footer!.blocks[blockPath[blockPath.length - 1]] = block;
  } else {
    currentDoc.blocks[blockPath[0] - this.bodyTreeOffset(currentDoc)] = block;
  }
  this.cachedDoc = currentDoc;
  this.dirty = false;
}
```

- [ ] **Step 2: Update `applyStyle`**

Same pattern — replace the header/footer early return:

```typescript
applyStyle(
  blockId: string,
  fromOffset: number,
  toOffset: number,
  style: Partial<InlineStyle>,
): void {
  const currentDoc = this.getDocument();
  const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);

  const block =
    region === 'header' ? currentDoc.header!.blocks[blockPath[blockPath.length - 1]] :
    region === 'footer' ? currentDoc.footer!.blocks[blockPath[blockPath.length - 1]] :
    currentDoc.blocks[blockPath[0] - this.bodyTreeOffset(currentDoc)];

  const updated = applyInlineStyleHelper(block, fromOffset, toOffset, style);

  this.doc.update((root) => {
    const tree = root.content;
    if (!tree || typeof tree.getRootTreeNode !== 'function') return;
    const endPath = [...blockPath];
    endPath[endPath.length - 1] += 1;
    tree.editByPath(blockPath, endPath, buildBlockNode(updated));
  });

  if (region === 'header') {
    currentDoc.header!.blocks[blockPath[blockPath.length - 1]] = updated;
  } else if (region === 'footer') {
    currentDoc.footer!.blocks[blockPath[blockPath.length - 1]] = updated;
  } else {
    currentDoc.blocks[blockPath[0] - this.bodyTreeOffset(currentDoc)] = updated;
  }
  this.cachedDoc = currentDoc;
  this.dirty = false;
}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/frontend && pnpm tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Convert updateBlock and applyStyle to granular header/footer edits"
```

---

### Task 5: Convert `deleteBlock`, `splitBlock`, `mergeBlock`

- [ ] **Step 1: Update `deleteBlock`**

```typescript
deleteBlock(id: string): void {
  const currentDoc = this.getDocument();
  const { path: blockPath, region } = this.resolveBlockTreePath(id, currentDoc);

  this.doc.update((root) => {
    const tree = root.content;
    if (!tree || typeof tree.getRootTreeNode !== 'function') return;
    const endPath = [...blockPath];
    endPath[endPath.length - 1] += 1;
    tree.editByPath(blockPath, endPath);
  });

  if (region === 'header') {
    const idx = blockPath[blockPath.length - 1];
    currentDoc.header!.blocks.splice(idx, 1);
  } else if (region === 'footer') {
    const idx = blockPath[blockPath.length - 1];
    currentDoc.footer!.blocks.splice(idx, 1);
  } else {
    const bodyIdx = blockPath[0] - this.bodyTreeOffset(currentDoc);
    currentDoc.blocks.splice(bodyIdx, 1);
  }
  this.cachedDoc = currentDoc;
  this.dirty = false;
}
```

- [ ] **Step 2: Update `splitBlock`**

```typescript
splitBlock(
  blockId: string,
  offset: number,
  newBlockId: string,
  newBlockType: BlockType,
): void {
  const currentDoc = this.getDocument();
  const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);

  const block =
    region === 'header' ? currentDoc.header!.blocks[blockPath[blockPath.length - 1]] :
    region === 'footer' ? currentDoc.footer!.blocks[blockPath[blockPath.length - 1]] :
    currentDoc.blocks[blockPath[0] - this.bodyTreeOffset(currentDoc)];

  if (block.type === 'table' || block.type === 'horizontal-rule' || block.type === 'page-break') {
    throw new Error(`splitBlock does not support ${block.type} blocks`);
  }

  this.doc.update((root) => {
    const tree = root.content;
    if (!tree || typeof tree.getRootTreeNode !== 'function') return;

    const treeRoot = tree.getRootTreeNode();
    const blockNode = this.getTreeBlockNode(treeRoot, blockPath);
    const inlineChildren = ((blockNode as ElementNode).children ?? []).filter(
      (c): c is ElementNode => c.type === 'inline',
    );
    let remaining = offset;
    let inlineIndex = 0;
    let charOffset = 0;
    for (let i = 0; i < inlineChildren.length; i++) {
      const textLen = (inlineChildren[i].children ?? [])
        .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
        .reduce((sum, t) => sum + t.value.length, 0);
      if (remaining <= textLen) {
        inlineIndex = i;
        charOffset = remaining;
        break;
      }
      remaining -= textLen;
      if (i === inlineChildren.length - 1) {
        inlineIndex = i;
        charOffset = textLen;
      }
    }

    // Native CRDT split at splitLevel=2
    tree.editByPath(
      [...blockPath, inlineIndex, charOffset],
      [...blockPath, inlineIndex, charOffset],
      undefined,
      2,
    );

    // Update the "after" block's attributes
    const afterPath = [...blockPath];
    afterPath[afterPath.length - 1] += 1;
    const afterAttrs: Record<string, string> = {
      id: newBlockId,
      type: newBlockType,
      ...serializeBlockStyle(block.style),
    };
    if (newBlockType === 'list-item' && block.listKind !== undefined) {
      afterAttrs.listKind = block.listKind;
      if (block.listLevel !== undefined) {
        afterAttrs.listLevel = String(block.listLevel);
      }
    }
    if (newBlockType === 'heading' && block.headingLevel !== undefined) {
      afterAttrs.headingLevel = String(block.headingLevel);
    }
    tree.styleByPath(afterPath, afterAttrs);
  });

  // Update cache in-place
  const [before, after] = applySplitBlock(block, offset, newBlockId, newBlockType);
  const blockIdx = blockPath[blockPath.length - 1];
  if (region === 'header') {
    currentDoc.header!.blocks[blockIdx] = before;
    currentDoc.header!.blocks.splice(blockIdx + 1, 0, after);
  } else if (region === 'footer') {
    currentDoc.footer!.blocks[blockIdx] = before;
    currentDoc.footer!.blocks.splice(blockIdx + 1, 0, after);
  } else {
    const bodyIdx = blockPath[0] - this.bodyTreeOffset(currentDoc);
    currentDoc.blocks[bodyIdx] = before;
    currentDoc.blocks.splice(bodyIdx + 1, 0, after);
  }
  this.cachedDoc = currentDoc;
  this.dirty = false;
}
```

- [ ] **Step 3: Update `mergeBlock`**

```typescript
mergeBlock(blockId: string, nextBlockId: string): void {
  if (blockId === nextBlockId) throw new Error('Cannot merge a block with itself');
  const currentDoc = this.getDocument();
  const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);
  const { path: nextPath, region: nextRegion } = this.resolveBlockTreePath(nextBlockId, currentDoc);

  if (region !== nextRegion) {
    throw new Error('Cannot merge blocks across header/body/footer boundaries');
  }

  const block =
    region === 'header' ? currentDoc.header!.blocks[blockPath[blockPath.length - 1]] :
    region === 'footer' ? currentDoc.footer!.blocks[blockPath[blockPath.length - 1]] :
    currentDoc.blocks[blockPath[0] - this.bodyTreeOffset(currentDoc)];

  const firstBlockInlineCount = block.inlines.length;

  this.doc.update((root) => {
    const tree = root.content;
    if (!tree || typeof tree.getRootTreeNode !== 'function') return;
    tree.editByPath([...blockPath, firstBlockInlineCount], [...nextPath, 0]);
  });

  const nextBlock =
    nextRegion === 'header' ? currentDoc.header!.blocks[nextPath[nextPath.length - 1]] :
    nextRegion === 'footer' ? currentDoc.footer!.blocks[nextPath[nextPath.length - 1]] :
    currentDoc.blocks[nextPath[0] - this.bodyTreeOffset(currentDoc)];

  const merged = applyMergeBlocks(block, nextBlock);

  const blockIdx = blockPath[blockPath.length - 1];
  const nextIdx = nextPath[nextPath.length - 1];
  if (region === 'header') {
    currentDoc.header!.blocks[blockIdx] = merged;
    currentDoc.header!.blocks.splice(nextIdx, 1);
  } else if (region === 'footer') {
    currentDoc.footer!.blocks[blockIdx] = merged;
    currentDoc.footer!.blocks.splice(nextIdx, 1);
  } else {
    const bodyIdx = blockPath[0] - this.bodyTreeOffset(currentDoc);
    const nextBodyIdx = nextPath[0] - this.bodyTreeOffset(currentDoc);
    currentDoc.blocks[bodyIdx] = merged;
    currentDoc.blocks.splice(nextBodyIdx, 1);
  }
  this.cachedDoc = currentDoc;
  this.dirty = false;
}
```

- [ ] **Step 4: Verify build**

Run: `cd packages/frontend && pnpm tsc --noEmit 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Convert deleteBlock, splitBlock, mergeBlock to granular header/footer edits"
```

---

### Task 6: Remove dead code and keep setHeader/setFooter using writeFullDocument

`setHeader` and `setFooter` toggle the existence of the header/footer container node itself — this legitimately needs `writeFullDocument` since it changes the tree structure (adding/removing wrapper nodes). Keep them as-is.

- [ ] **Step 1: Remove `commitHeaderFooterChange` method**

Delete the `commitHeaderFooterChange` method (~lines 577-581) since nothing calls it anymore.

- [ ] **Step 2: Remove `findHeaderFooterBlock` method if no longer used**

Check: `findHeaderFooterBlock` is only called from the header/footer branches we removed. Delete it (~lines 562-572).

- [ ] **Step 3: Clean up old `resolveTreeOffset` method**

The old `resolveTreeOffset` method (lines ~533-557) is replaced by inline resolution using `getTreeBlockNode`. If no remaining callers exist, remove it.

- [ ] **Step 4: Verify build and run verify:fast**

Run: `pnpm verify:fast 2>&1 | tail -20`
Expected: lint + tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Remove dead commitHeaderFooterChange and findHeaderFooterBlock"
```

---

### Task 7: Manual verification

- [ ] **Step 1: Run dev server and test header editing**

```bash
pnpm dev
```

1. Open a document with a header enabled
2. Type text in the header — should work normally
3. Delete text in the header — should work normally
4. Split a line (Enter) in the header — should create a new block
5. Merge lines (Backspace at start) — should merge blocks
6. Apply bold/italic in the header — should work
7. Verify body editing still works normally

- [ ] **Step 2: Verify no full-document rewrites during header editing**

Add a temporary `console.log('writeFullDocument called')` at the top of `writeFullDocument`. Edit the header and verify it does NOT appear (except for undo/redo and setHeader/setFooter toggle).

- [ ] **Step 3: Remove the temporary console.log**

- [ ] **Step 4: Final commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Verify header/footer granular edits work correctly"
```
