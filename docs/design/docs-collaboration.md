---
title: docs-collaboration
target-version: 0.2.0
---

# Docs Collaboration

## Summary

Add real-time collaborative editing to the docs (document editor) package using
Yorkie's `Tree` CRDT. The docs editor currently uses an in-memory store
(`MemDocStore`); this design introduces a `YorkieDocStore` that uses
`yorkie.Tree` as the single source of truth and exposes it through the existing
`DocStore` interface.

## Goals / Non-Goals

### Goals

- Real-time collaborative text editing (insert, delete, split/merge blocks)
- Collaborative inline styling (bold, italic, underline, fontSize, etc.)
- Collaborative block styling (alignment, lineHeight, margins)
- Extensible tree structure for future block types (tables, lists, images)
- Local snapshot-based undo/redo as a first step

### Non-Goals

- Presence / remote cursor display (follow-up work)
- Yorkie-based undo/redo (future migration from local snapshots)
- Offline editing with sync (out of scope)
- Conflict resolution UI (Yorkie CRDT handles conflicts automatically)

## Proposal Details

### Approach: Tree as Single Source of Truth

`yorkie.Tree` is the only authoritative data store when `YorkieDocStore` is
active. The `Doc` class delegates all mutations through `DocStore` methods,
which translate to `yorkie.Tree` operations. Reading is done by traversing the
tree and building `Document` objects on demand.

This avoids dual-state synchronization (Document copy + Tree) and eliminates
the need for diffing or operation translation between two representations.

### yorkie.Tree Node Structure

The current `Document → Block → Inline` hierarchy maps directly to tree
element and text nodes:

```xml
<doc>
  <block id="abc123" type="paragraph" alignment="left" lineHeight="1.5">
    <inline bold="true" fontSize="14">Hello </inline>
    <inline italic="true">world</inline>
  </block>
  <block id="def456" type="paragraph">
    <inline>Second paragraph</inline>
  </block>
</doc>
```

- **`<doc>`** — Root element node.
- **`<block>`** — Paragraph element. Attributes carry `id`, `type`, and
  block-level style properties (`alignment`, `lineHeight`, `marginTop`,
  `marginBottom`, `textIndent`, `marginLeft`).
- **`<inline>`** — Styled text run element. Attributes carry inline style
  properties (`bold`, `italic`, `underline`, `strikethrough`, `fontSize`,
  `fontFamily`, `color`).
- **Text nodes** — Leaf nodes inside `<inline>` elements containing the actual
  character data.

Future block types (`<table>`, `<list-item>`, `<image>`) are added as new
element types alongside `<block>`.

### Doc Class Refactoring

The `Doc` class currently takes a `Document` object and mutates it directly.
It is refactored to take a `DocStore` and delegate all mutations through store
methods. `Doc` maintains a cached `Document` reference from `store.getDocument()`
for reads (e.g., `TextEditor` accessing `doc.document.blocks` for cursor
movement, word boundary detection). The cache is refreshed after mutations
and on remote changes.

**Before:**

```typescript
class Doc {
  constructor(public document: Document) {}

  insertText(pos, text) {
    const block = this.document.blocks.find(...);
    inline.text = inline.text.slice(0, offset) + text + ...;
  }
}
```

**After:**

```typescript
class Doc {
  private _document: Document;

  constructor(private store: DocStore) {
    this._document = store.getDocument();
  }

  /** Cached document for reads. Refreshed after mutations. */
  get document(): Document {
    return this._document;
  }

  /** Refresh cached document from store (called after mutations and remote changes). */
  refresh(): void {
    this._document = this.store.getDocument();
  }

  insertText(pos, text) {
    const block = this.store.getBlock(pos.blockId);
    // ... compute updated block (same logic)
    this.store.updateBlock(pos.blockId, updatedBlock);
    this.refresh();
  }

  splitBlock(blockId, offset) {
    const block = this.store.getBlock(blockId);
    // ... compute before/after inlines
    this.store.updateBlock(blockId, beforeBlock);
    this.store.insertBlock(blockIndex + 1, afterBlock);
    this.refresh();
  }

  mergeBlocks(blockId, nextBlockId) {
    const block = this.store.getBlock(blockId);
    const nextBlock = this.store.getBlock(nextBlockId);
    // ... merge inlines
    this.store.updateBlock(blockId, mergedBlock);
    this.store.deleteBlock(nextBlockId);
    this.refresh();
  }
}
```

This preserves the existing read pattern (`doc.document.blocks[i]`) used
throughout `TextEditor` while routing all writes through `DocStore`.

Affected mutation methods:
- `insertText()`, `deleteText()`, `deleteBackward()`
- `splitBlock()`, `mergeBlocks()`
- `applyInlineStyle()`, `applyBlockStyle()`
- `deleteRange()` (multi-block selection deletion)

### YorkieDocStore Implementation

Implements `DocStore` with `yorkie.Tree` as the backing store.

The Yorkie document root has a mixed schema:

```typescript
type YorkieDocsDocument = {
  content: yorkie.Tree;    // Document content (blocks/inlines/text)
  pageSetup?: PageSetup;   // Document-level metadata (JSON field)
};
```

#### Reading

- **`getDocument()`** — Traverses the tree root, converting element/text nodes
  to `Block[]` and constructing a `Document`. Results are cached with a dirty
  flag; unchanged trees return the cached copy. Both local and remote changes
  set `dirty = true` to invalidate the cache.
- **`getBlock(id)`** — Uses a `Map<string, TreeNode>` index of block IDs to
  tree nodes for O(1) lookup. The index is rebuilt when the cache is dirty.
  Converts the found tree node to a `Block`.

#### Writing

All write methods execute inside `doc.update((root) => { ... })` and set
`dirty = true` after mutation:

- **`updateBlock(id, block)`** — Finds the `<block>` element by `id`,
  replaces its children (inline nodes) and updates attributes.
- **`insertBlock(index, block)`** — Inserts a new `<block>` element with
  inline children at the given index position in the tree.
- **`deleteBlock(id)`** — Removes the `<block>` element from the tree.
- **`setDocument(doc)`** — Replaces the entire tree content. Used for
  initial document setup.
- **`replaceDocument(doc)`** — No-op on `YorkieDocStore`. The current
  `packages/docs/src/view/editor.ts` pattern of calling `replaceDocument()` after `Doc` mutations
  (via `syncToStore()`) is unnecessary when `Doc` already writes through
  the store. The `syncToStore()` call is removed from the editor.

#### Remote Change Detection

```typescript
doc.subscribe((event) => {
  if (event.type === 'remote-change') {
    this.dirty = true;
    this.onRemoteChange?.();
  }
});
```

The `onRemoteChange` callback triggers editor re-render. Since
`getDocument()` is dirty, the tree is re-traversed to produce an updated
`Document` for layout and painting.

#### PageSetup

Stored as a JSON field (`pageSetup`) on the Yorkie document root, separate
from the `content` tree. See the root schema above.

#### Undo/Redo (Phase 1 — Local Snapshots)

The undo contract: **only explicit `snapshot()` calls create undo entries.**
Individual `updateBlock()`/`insertBlock()`/`deleteBlock()` do NOT push to the
undo stack. This applies to both `MemDocStore` and `YorkieDocStore`.

Note: The current `MemDocStore` pushes undo on every mutation method. This
will be fixed to match the `snapshot()`-only contract so that both stores
behave identically.

- **`snapshot()`** — Calls `getDocument()` to deep-clone the current state
  and pushes it onto a local undo stack.
- **`undo()`** — Pops from the undo stack, pushes current state to redo
  stack, and replaces the entire tree content with the snapshot.
- **`redo()`** — Reverse of undo.

**Limitation**: In Phase 1, undo restores a full document snapshot. During
concurrent editing, this can overwrite other users' changes. This is
acceptable as a known limitation; undo is scoped to single-user scenarios
until Phase 2 migrates to `doc.history.undo()/redo()` for operation-level
undo that respects concurrent edits.

### Data Flow

#### Local Edit

```
User types
  → TextEditor.handleInput()
  → store.snapshot()
  → Doc.insertText(pos, text)
    → store.updateBlock(id, updatedBlock)
      → YorkieDocStore: doc.update() → tree.edit()
  → editor.render()
    → store.getDocument()  // tree traversal → Document (cached)
    → computeLayout() → paint()
```

#### Remote Change

```
Other client edits
  → Yorkie server propagates ops
  → yorkie.Tree auto-updated
  → doc.subscribe() → dirty = true → onRemoteChange()
  → editor.render()
    → store.getDocument()  // dirty → re-traverse tree
    → computeLayout() → paint()
```

### Editor Integration

- **`initialize(container, store)`** — `store` parameter becomes required;
  caller provides either `MemDocStore` or `YorkieDocStore`.
- **`Doc`** — Created with the store: `new Doc(store)`.
- **`syncToStore()` removed** — No longer needed since `Doc` writes through
  the store directly. `replaceDocument()` calls are removed from the editor.
- **Remote change handler** — On `onRemoteChange`, call `doc.refresh()` to
  update the cached document, then re-render.
- **Unchanged**: `TextEditor`, `Layout`, `Pagination`, `DocCanvas`, `Cursor`,
  `Selection` — the rendering and input pipeline is unaffected.

Impact is confined to three areas: `Doc`, `DocStore`/`YorkieDocStore`, and
editor initialization.

### MemDocStore Compatibility

`MemDocStore` continues to work unchanged for tests and offline use:
- It maintains its own `Document` in memory.
- `getBlock()`, `updateBlock()`, `insertBlock()`, `deleteBlock()` operate on
  the internal `Document.blocks` array.
- Snapshot-based undo/redo remains as-is.

The `Doc` class works identically with either store implementation since it
only calls `DocStore` interface methods.

### Concurrent Block Operations

Block IDs must be globally unique (nanoid with sufficient entropy). When two
users simultaneously split the same block or one splits while another deletes,
Yorkie's Tree CRDT resolves conflicts automatically. The resulting block order
is determined by Yorkie's merge semantics.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| `getDocument()` tree traversal cost on large docs | Dirty-flag cache; only re-traverse on actual changes. Incremental layout (dirty block tracking) already minimizes downstream cost. |
| `getBlock(id)` O(n) scan per call on hot path | `Map<string, TreeNode>` index rebuilt on dirty; O(1) lookup. |
| Local snapshot undo overwrites concurrent users' changes | Known Phase 1 limitation; undo restricted to single-user until Phase 2 migrates to Yorkie operation-level history. |
| `yorkie.Tree` API constraints (edit by path vs index) | Prototype key operations early to validate API fit. |
| Doc refactoring breaks existing tests | MemDocStore preserves identical behavior; tests update constructor only. |
