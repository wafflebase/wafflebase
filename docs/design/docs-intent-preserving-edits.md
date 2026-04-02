---
title: docs-intent-preserving-edits
target-version: 0.4.0
---

# Intent-Preserving Yorkie Edits for Docs Editor

## Summary

Migrate the Docs editor from full block replacement (`editByPath([idx],
[idx+1], blockNode)`) to character-level Yorkie Tree editing. This eliminates
last-writer-wins conflicts when multiple users edit the same paragraph or table
cell concurrently.

## Goals

- Character-level text merge for concurrent same-paragraph edits
- Preserve editing intent (insert, delete, style, split, merge) in Yorkie
  operations instead of replacing entire blocks
- Maintain `DocStore` abstraction — both `MemDocStore` and `YorkieDocStore`
  implement the same interface
- Incremental migration — each phase is independently shippable

## Non-Goals

- Changing the Yorkie Tree node hierarchy (block → inline → text structure
  stays the same)
- Rich content beyond text (images, embeds) — separate project
- Operational transformation — Yorkie CRDT handles conflict resolution

## Current Problem

### Full Block Replacement

Every text edit — even a single character — replaces the entire block node in
the Yorkie Tree:

```typescript
// Current: typing "X" replaces the whole block
updateBlock(id: string, block: Block): void {
  this.doc.update((root) => {
    root.content.editByPath([blockIdx], [blockIdx + 1], buildBlockNode(block));
  });
}
```

This means concurrent edits to the same block are last-writer-wins. User A
types "hello" and User B types "world" in the same paragraph — one edit is
lost.

### Impact

| Scenario | Current behavior |
|----------|-----------------|
| Same paragraph, concurrent typing | Last-writer-wins — one user's text lost |
| Same table cell, concurrent typing | Last-writer-wins — one user's text lost |
| Different paragraphs | Both preserved (independent tree nodes) |
| Different table cells | Both preserved (independent tree nodes) |

## Architecture Decisions

### 1. Block-offset Store API

The `DocStore` interface expresses edits as `(blockId, offset, ...)` — the
Store internally resolves block-level offsets to inline/character positions in
the Yorkie Tree.

**Why:** The Store always computes positions against the latest Yorkie Tree
state, eliminating stale-cache synchronization issues. The Doc layer doesn't
need to know about inline node structure for persistence.

### 2. Doc as Orchestrator

The `Doc` class remains the editing entry point. `TextEditor` calls
`doc.insertText()`, which routes to the appropriate Store method based on
`blockParentMap` (top-level block vs table cell block).

**Why:** Minimal change to the existing TextEditor → Doc → Store flow. Doc
handles business logic (empty list item → paragraph conversion, markdown
auto-convert); Store handles persistence.

### 3. Common Helpers

Document model manipulation logic is extracted into pure helper functions in
`packages/docs/src/store/block-helpers.ts`. Both `MemDocStore` and `YorkieDocStore` reuse them.

**Why:** Avoids duplicating offset resolution, inline normalization, and
split/merge logic across two Store implementations.

### 4. Single-Level Yorkie API Calls

Yorkie Tree APIs (`editByPath`, `styleByPath`, `splitByPath`, `mergeByPath`)
are called one level at a time, composed within a single `doc.update()` block.
Deep multi-level calls are avoided for stability.

**Why:** Yorkie Tree APIs may not reliably handle deep multi-level operations.
Single-level calls composed in one `doc.update()` are predictable and form a
single undo unit.

## Yorkie Tree API Usage

| API | Purpose | Constraint |
|-----|---------|------------|
| `editByPath(from, to, node?)` | Text insert/delete | Same level only; no cross-inline ranges |
| `styleByPath(from, to, attrs)` | Apply inline style | Per-inline segment; Yorkie handles node split |
| `splitByPath(path, depth=1)` | Split node at path | One level at a time |
| `mergeByPath(path)` | Merge with previous sibling | One level at a time |
| `editBulkByPath(from, to, nodes[])` | Bulk insert | Full document write (undo fallback) |

**Composition pattern:** Multiple single-level calls within one `doc.update()`
to form complex operations:

```typescript
doc.update((root) => {
  const tree = root.content;
  // All calls here form a single undo unit
  tree.editByPath(...);
  tree.splitByPath(..., 1);
  tree.editByPath(...);
});
```

## DocStore Interface Changes

New fine-grained methods added alongside existing ones. Existing methods are
retained during migration and deprecated once all call sites are converted.

```typescript
interface DocStore {
  // ── Existing (retained during migration) ──────────────────
  getDocument(): Document;
  getBlock(id: string): Block | undefined;
  setDocument(doc: Document): void;
  replaceDocument(doc: Document): void;
  updateBlock(id: string, block: Block): void;         // deprecated after Phase 3
  insertBlock(index: number, block: Block): void;
  deleteBlock(id: string): void;
  deleteBlockByIndex(index: number): void;
  getPageSetup(): PageSetup;
  setPageSetup(setup: PageSetup): void;

  // ── Phase 1: Character-level text editing ─────────────────
  insertText(blockId: string, offset: number, text: string): void;
  deleteText(blockId: string, offset: number, length: number): void;

  // ── Phase 2: Inline styling ───────────────────────────────
  applyStyle(
    blockId: string,
    fromOffset: number,
    toOffset: number,
    style: Partial<InlineStyle>,
  ): void;

  // ── Phase 3: Structural editing ───────────────────────────
  splitBlock(
    blockId: string,
    offset: number,
    newBlockId: string,
    newBlockType: BlockType,
  ): void;
  mergeBlock(blockId: string, nextBlockId: string): void;

  // ── Phase 4: Table cell variants ──────────────────────────
  insertTextInCell(
    tableBlockId: string,
    rowIndex: number,
    colIndex: number,
    cellBlockIndex: number,
    offset: number,
    text: string,
  ): void;
  deleteTextInCell(
    tableBlockId: string,
    rowIndex: number,
    colIndex: number,
    cellBlockIndex: number,
    offset: number,
    length: number,
  ): void;
  applyStyleInCell(
    tableBlockId: string,
    rowIndex: number,
    colIndex: number,
    cellBlockIndex: number,
    fromOffset: number,
    toOffset: number,
    style: Partial<InlineStyle>,
  ): void;

  // ── Existing table structural ops (unchanged) ─────────────
  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void;
  deleteTableRow(tableBlockId: string, rowIndex: number): void;
  insertTableColumn(
    tableBlockId: string, atIndex: number, cells: TableCell[],
  ): void;
  deleteTableColumn(tableBlockId: string, colIndex: number): void;
  updateTableCell(
    tableBlockId: string,
    rowIndex: number,
    colIndex: number,
    cell: TableCell,
  ): void;
  updateTableAttrs(
    tableBlockId: string,
    attrs: { cols: number[]; rowHeights?: (number | undefined)[] },
  ): void;

  // ── Undo/Redo (Phase 5 changes implementation) ───────────
  snapshot(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
```

## Common Helpers Module

```
packages/docs/src/store/
  ├── store.ts              # DocStore interface
  ├── memory.ts             # MemDocStore
  ├── block-helpers.ts      # New: pure helper functions
```

### Helper Functions

```typescript
// Resolve block-level character offset → inline position
function resolveOffset(
  block: Block, offset: number,
): { inlineIndex: number; charOffset: number };

// Resolve a delete range across multiple inlines
function resolveDeleteRange(
  block: Block, offset: number, length: number,
): Array<{ inlineIndex: number; charFrom: number; charTo: number }>;

// Resolve a style range across multiple inlines
function resolveStyleRange(
  block: Block, from: number, to: number,
): Array<{ inlineIndex: number; charFrom: number; charTo: number }>;

// Model mutations (pure functions: Block in → Block out)
function applyInsertText(block: Block, offset: number, text: string): Block;
function applyDeleteText(block: Block, offset: number, length: number): Block;
function applyInlineStyle(
  block: Block, from: number, to: number, style: Partial<InlineStyle>,
): Block;
function applySplitBlock(
  block: Block, offset: number, newBlockId: string, newBlockType: BlockType,
): [Block, Block];
function applyMergeBlocks(block: Block, nextBlock: Block): Block;

// Merge adjacent inlines with identical styles
function normalizeInlines(block: Block): Block;
```

### Usage Pattern

```typescript
// MemDocStore — helpers only
insertText(blockId: string, offset: number, text: string): void {
  const block = this.getBlock(blockId);
  const updated = applyInsertText(block, offset, text);
  this.setBlock(blockId, updated);
}

// YorkieDocStore — helpers + Yorkie Tree API
insertText(blockId: string, offset: number, text: string): void {
  const block = this.getBlock(blockId);

  // 1. Yorkie Tree edit
  const { inlineIndex, charOffset } = resolveOffset(block, offset);
  const blockIdx = this.findBlockIndex(blockId);
  this.doc.update((root) => {
    root.content.editByPath(
      [blockIdx, inlineIndex, 0, charOffset],
      [blockIdx, inlineIndex, 0, charOffset],
      { type: 'text', value: text },
    );
  });

  // 2. Model cache update (same helper)
  const updated = applyInsertText(block, offset, text);
  this.updateCache(blockId, updated);
}
```

## Phase Overview

### Phase 1: Character-Level Text Editing

Migrate `Doc.insertText()` and `Doc.deleteText()` to use `store.insertText()`
and `store.deleteText()` instead of `store.updateBlock()`.

Key implementation details:

- **Single-inline insert:** `editByPath([blockIdx, inlineIdx, 0, charOffset],
  [blockIdx, inlineIdx, 0, charOffset], textNode)`
- **Cross-inline delete:** Multiple `editByPath` calls in reverse order within
  one `doc.update()` to preserve indices
- **IME composition:** `handleCompositionEnd` uses `deleteText` + `insertText`
  within one `doc.update()`

### Phase 2: Inline Styling

Migrate `Doc.applyInlineStyle()` to use `store.applyStyle()`.

- `styleByPath` per inline segment within one `doc.update()`
- Yorkie handles inline node splitting internally
- Remove manual 3-way inline split logic from Doc

### Phase 3: Structural Editing

Migrate `Doc.splitBlock()` and `Doc.mergeBlocks()` to use `store.splitBlock()`
and `store.mergeBlock()`.

- `splitByPath` called one level at a time: text → inline → block
- `mergeByPath` called one level at a time: block → inline (cleanup)
- Business logic (list item conversion, markdown auto-convert) stays in Doc

### Phase 4: Table Cell Internal Edits

Extend Phase 1–3 to table cell blocks with deeper Yorkie Tree paths.

- Path extends to `[tIdx, rowIdx, colIdx, cellBlockIdx, inlineIdx, 0, charOffset]`
- Doc routes via `blockParentMap` to `*InCell` store methods
- Existing table structural ops (row/column insert/delete) unchanged

### Phase 5: Undo/Redo

Migrate from snapshot-based to Yorkie Tree history.

- Each `doc.update()` from Phase 1–4 is already a single undo unit
- Feature-flagged: snapshot-based fallback retained until Yorkie undo is stable
- Test each Phase's operations for correct undo/redo behavior individually
- MemDocStore continues using snapshot-based undo

## Migration Strategy

Each Phase migrates specific code paths from `updateBlock()` to fine-grained
methods. The old path remains functional until all callers are converted.

```
Phase 1: Doc.insertText(), Doc.deleteText()
         → store.insertText(), store.deleteText()
         (handleInput, deleteBackward, handlePaste)

Phase 2: Doc.applyInlineStyle()
         → store.applyStyle()
         (toggleStyle, toolbar actions)

Phase 3: Doc.splitBlock(), Doc.mergeBlocks()
         → store.splitBlock(), store.mergeBlock()
         (handleEnter, deleteBackward at block start)

Phase 4: Same as Phase 1–3 routed through *InCell variants
         (blockParentMap routing in Doc)

Phase 5: Undo/redo implementation swap
         (feature flag gated)
```

### Deprecation of updateBlock()

After Phase 4, `updateBlock()` should only be used for block-level attribute
changes (type, alignment, list properties). Full removal is possible once all
mutation paths use fine-grained methods.

## File Changes Summary

| File | Change |
|------|--------|
| `packages/docs/src/store/store.ts` | Add new methods to DocStore interface |
| `packages/docs/src/store/block-helpers.ts` | New file: pure helper functions |
| `packages/docs/src/store/memory.ts` | Implement new methods using helpers |
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | Implement new methods with Yorkie Tree API |
| `packages/docs/src/model/document.ts` | Simplify to call store methods instead of manual manipulation |
| `packages/docs/src/view/text-editor.ts` | No change (calls Doc methods as before) |

## Known Issues

### Remote cursor offset not transformed after character-level edits

With full block replacement, remote changes replaced the entire block, so
cursor positions were implicitly reset. With character-level edits, the remote
peer's cursor offset is not adjusted when text is inserted or deleted before
it. For example, if Client2's cursor is at offset 4 and Client1 inserts a
character at offset 0, Client2's cursor should shift to offset 5 but stays
at 4 — appearing to move backward.

**Fix:** Implement cursor offset transformation based on remote edit positions.
When a remote `insertText(blockId, offset, text)` is received, all local
cursors in the same block with offset > remoteOffset should be incremented by
`text.length`. Similarly for `deleteText`. This requires subscribing to
granular Yorkie Tree change events rather than the current coarse
`remote-change` event.

**Priority:** Should be resolved before Phase 2 ships to users.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Yorkie `editByPath` at text-node level has undiscovered bugs | Phase 1 starts with simplest case (single inline insert); extensive testing before proceeding |
| `styleByPath` inline splitting doesn't match expected model | Verify by comparing deserialized tree with helper-computed model after each operation |
| `splitByPath`/`mergeByPath` single-level composition produces unexpected tree structure | Build comprehensive test suite comparing split/merge results against known-good snapshots |
| Yorkie Tree undo is unstable | Feature-flagged; snapshot-based fallback retained until verified |
| Model cache diverges from Yorkie Tree state | Each mutation updates both; add debug assertion comparing cache vs tree in dev mode |
| Performance regression from per-character Yorkie operations | Benchmark against current full-block replacement; batch rapid keystrokes if needed |
