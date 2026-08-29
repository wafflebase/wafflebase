---
title: docs-collaboration
target-version: 0.2.0
---

# Docs Collaboration

> **Status (2026-05):** This document captures the original v0.2.0
> Yorkie integration — `YorkieDocStore` over `yorkie.Tree`, block-level
> `updateBlock` writes that replace whole blocks per edit. That model
> shipped and is still in the store interface, but the **editor no
> longer uses it for text edits**. Concurrent same-paragraph edits go
> through the character-level intent-preserving path described in
> [`docs-intent-preserving-edits.md`](docs-intent-preserving-edits.md)
> (Phases 1–8 shipped in v0.4.x). Read this doc for the tree node
> structure, snapshot/restore, and undo strategy; read intent-preserving
> for what actually happens on every keystroke today.

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

### Non-Goals (as originally scoped)

- ~~Presence / remote cursor display~~ — **since shipped**: peer carets and
  name labels via `packages/docs/src/view/peer-cursor.ts`, with live presence
  wiring in `packages/frontend/src/app/docs/docs-detail.tsx`.
- ~~Yorkie-based undo/redo~~ — **since shipped**: `YorkieDocStore` delegates
  undo/redo to Yorkie `doc.history` (see the Undo/Redo section below).
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

#### Attribute encoding contract (block style)

Block-style attributes are **optional on the wire**. `BlockStyle` is a full
shape in the model, but the persisted attribute set is a partial: the v1
content `PUT` API accepts `style: {}`, and documents written before a field
existed simply lack it. So the writer emits an attribute only when it carries a
value the reader can invert — an alignment in
`{left, center, right, justify}`, and a *finite* number for each of
`lineHeight` / `marginTop` / `marginBottom` / `textIndent` / `marginLeft`. An
absent attribute means "unspecified" and reads back as `DEFAULT_BLOCK_STYLE`;
`header`/`footer` `marginFromEdge` follows the same rule with
`DEFAULT_HEADER_MARGIN_FROM_EDGE`. Symmetrically, the reader drops any
attribute the writer would not have emitted (`Number("undefined") → NaN`, an
unknown alignment) rather than passing it to `normalizeBlockStyle`, which is a
bare spread and would carry `NaN` straight into the layout engine.

Two writers encode this tree — the editor's `YorkieDocStore`
(`packages/frontend/src/app/docs/yorkie-doc-store.ts`) and the backend's
`docs-tree.ts` behind the v1 content REST endpoint — so the codec is a single
shared module, `@wafflebase/docs` `model/crdt-attrs.ts`
(`serializeBlockStyleAttrs` / `parseBlockStyleAttrs` /
`serializeMarginFromEdgeAttrs` / `parseMarginFromEdgeAttr`). Both sides import
it; neither keeps a copy, because a divergence would make one writer's output
unreadable by the other's reader.

Tables have since shipped as `type: 'table'` element nodes (including nested
tables) — see `packages/docs/src/model/document.ts` (`insertTable`,
`insertTableInCell`, `createTableBlock`) and [`docs-tables.md`](docs-tables.md).
Other future block types (`<list-item>`, `<image>`) follow the same pattern of
adding new element types alongside `<block>`.

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

#### Undo/Redo

The production `YorkieDocStore` drives undo/redo through **Yorkie
`doc.history`** — `undo()`/`redo()`/`canUndo()`/`canRedo()` delegate to
`this.doc.history.undo()/redo()/canUndo()/canRedo()`
(`packages/frontend/src/app/docs/yorkie-doc-store.ts`). This gives
operation-level undo that respects concurrent edits, rather than restoring a
whole-document snapshot. (Shipped in PR #162, replacing the earlier
snapshot-based scheme.)

The in-package dev store `MemDocStore` still keeps a local snapshot undo
stack — fine for single-user local development, but the collaborative path is
the `doc.history` one described above. `DocStore.snapshot()` is therefore a
no-op on `YorkieDocStore`: it exists for `MemDocStore`, and every call site
that needs a checkpoint on both stores must keep calling it.

Because Yorkie takes one undo unit per `doc.update()`, an action needing two
store writes costs two Cmd+Z. `DocStore.batch(fn)` is the seam that folds
them: one top-level batch opens exactly one `doc.update` (an ambient root
parked in `activeRoot`, with every write routed through `withUpdate`), so N
writes commit as one Yorkie change and one `doc.history` entry. Nested
`batch()` calls short-circuit rather than opening a second update, which
Yorkie does not support — keyed on **`activeRoot`**, the same sentinel
`withUpdate` reads, and deliberately not on a depth counter. A counter would
still read "in a batch" during the SDK's post-updater work (the change push
and the synchronous `local-change` publish), which runs after the ambient
root is already gone; a subscriber re-entering `batch()` there would take the
fast path with no root and get one undo unit per write. `MemDocStore`, whose
undo unit is anchored to `snapshot()` rather than to an update, satisfies the
same contract with a depth counter plus a checkpoint taken up front. The
architecture is `YorkieSlidesStore`'s — see
[slides-native-undo.md](../slides/slides-native-undo.md), whose sketch uses
the counter for both stores.

The contract both implementations enforce:

- One top-level `batch(fn)` = at most one undo unit; a batch that writes
  nothing pushes nothing and leaves redo history alone.
- Nested `batch()` calls do not nest undo units.
- `undo()` / `redo()` must not be called inside a batch.
- `setDocument()` must not be called inside a batch — **both** stores throw.
  It re-arms the undo floor, and `YorkieDocStore` can only read that floor
  once the batch's single `doc.update` has closed, so inside a batch the
  floor would land one unit low and the freshly loaded document itself would
  become undoable. `MemDocStore` throws for parity, so code written against
  the in-package store cannot pass there and fail under this one.
- Whether a partially applied batch is rolled back is store-specific:
  `YorkieDocStore` discards the whole update, `MemDocStore` does not.
  `Doc.batch()` therefore re-reads the store when the body throws, so the
  docs model never outlives writes the CRDT rejected.

Today only the named-style redefinition entry points use it
(`setDocStyles` / `updateStyleToMatch` / `resetNamedStyle` /
`resetAllNamedStyles`, whose registry write triggers a second
`dropStaleStyleOffAll` sweep). Every other editing path keeps the undo
granularity it had, though all of them now route their writes through
`withUpdate` instead of calling `doc.update` directly — a nested update
inside an open batch would split its undo unit.

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

- **`initialize(container, store?, theme?, readOnly?)`** — `store` is optional
  and defaults to a new `MemDocStore()`; the collaborative caller passes a
  `YorkieDocStore`.
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
| Local snapshot undo overwrites concurrent users' changes | **Resolved.** `YorkieDocStore` delegates undo/redo to Yorkie `doc.history` unconditionally (`snapshot()` is a no-op there), so undo applies the reverse ops of the local client's last change and leaves a peer's concurrent edit intact. Snapshot undo survives only in `MemDocStore`, which is single-client by construction. See the Undo/Redo section above. |
| `yorkie.Tree` API constraints (edit by path vs index) | Prototype key operations early to validate API fit. |
| Doc refactoring breaks existing tests | MemDocStore preserves identical behavior; tests update constructor only. |
