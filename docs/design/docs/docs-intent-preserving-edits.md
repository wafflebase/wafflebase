---
title: docs-intent-preserving-edits
target-version: 0.4.0
---

# Intent-Preserving Yorkie Edits for Docs Editor

## Summary

Migrate the Docs editor from full block replacement to character-level Yorkie
Tree editing. This eliminates last-writer-wins conflicts when multiple users
edit the same paragraph concurrently.

## Goals

- Character-level text merge for concurrent same-paragraph edits
- Preserve editing intent in Yorkie operations instead of replacing entire blocks
- Maintain `DocStore` abstraction for both `MemDocStore` and `YorkieDocStore`
- Incremental migration — each phase is independently shippable

## Non-Goals

- Changing the Yorkie Tree node hierarchy (block → inline → text stays the same)
- Rich content beyond text (images, embeds)
- Operational transformation — Yorkie CRDT handles conflict resolution

## Architecture

### DocStore API

The `DocStore` interface expresses edits as `(blockId, offset, ...)`. The Store
resolves block-level offsets to inline/character positions internally.

```
TextEditor → Doc (orchestrator) → DocStore (persistence)
                                    ├── MemDocStore (helpers only)
                                    └── YorkieDocStore (helpers + Yorkie Tree API)
```

- **Doc** — editing entry point, business logic (list conversion, markdown), routes
  to store via `blockParentMap` (top-level vs table cell)
- **block-helpers.ts** — pure functions shared by both stores: offset resolution,
  text mutation, inline styling, block split/merge, normalization

### DocStore Methods

```typescript
// Phase 1: Text editing
insertText(blockId, offset, text): void;
deleteText(blockId, offset, length): void;

// Phase 2: Inline styling
applyStyle(blockId, fromOffset, toOffset, style): void;

// Phase 3: Structural editing
splitBlock(blockId, offset, newBlockId, newBlockType): void;
mergeBlock(blockId, nextBlockId): void;

// Phase 4: Table cell edits reuse the Phase 1–3 methods above — no
// dedicated *InCell variants exist. resolveBlockTreePath() DFS resolves
// cell-internal blockIds transparently (see Phase 4 below).
```

### Yorkie Tree Strategy

| Operation | Yorkie API | Granularity | Concurrent behavior |
|-----------|-----------|-------------|---------------------|
| Text insert | `editByPath` | Character-level `[blockIdx, inlineIdx, charOffset]` | CRDT merge |
| Text delete | `editByPath` | Character-level + empty inline cleanup | CRDT merge |
| Style | `editByPath` (`splitLevel=1`) + `styleByPath` | Inline-level split + element style | CRDT merge |
| Split | `editByPath` + `styleByPath` | Manual two-step: delete "after" content + insert new block | CRDT merge |
| Merge | `editByPath` + `editBulkByPath` | Two-step: delete next block + re-insert its inlines | CRDT merge |
| Full doc write | `editBulkByPath` | Undo/redo fallback | — |

**Path format:** 3 levels `[blockIdx, inlineIdx, charOffset]`. The inline
node's `hasTextChild()` interprets the last element as a character offset.

#### Native Inline Styling

Style operations use `editByPath` with `splitLevel=1` to split inline nodes
at style boundaries, then `styleByPath` to apply attributes to the resulting
inlines. This eliminates LWW conflicts — concurrent text edits in the same
block are preserved during styling operations. The split is performed at
`toOffset` first, then `fromOffset`, so that earlier path indices remain valid.

#### Split/Merge (manual two-step)

Split and merge deliberately avoid the native single-call `editByPath`
splitLevel path — it breaks undo/redo and hits a yorkie-js-sdk range-narrowing
bug on split-created blocks. Instead both operations decompose into
same-parent edits, which still preserve editing intent (no whole-block
replacement) while keeping undo/redo stable.

**Split** is a two-step edit in `splitBlock`
(`packages/frontend/src/app/docs/yorkie-doc-store.ts`): (1) delete the "after"
content (from the split point to the end of the block) from the original
block, then (2) insert a new block carrying that content via `editByPath` +
`buildBlockNode`, followed by `styleByPath` to set the new block's attributes
(id, type, list/heading properties). A native `splitLevel=2` call is
explicitly *not* used — the only mentions of `splitLevel` in the store are
comments explaining why it is avoided.

**Merge** in `mergeBlock` also decomposes into two same-parent operations,
working around the yorkie-js-sdk "Phase 3 Range Narrowing" bug where a single
cross-boundary `editByPath` fails on split-created blocks: (1) delete the next
block element, then (2) re-insert its inline children at the end of the first
block via `editBulkByPath` (deep-cloned so Yorkie mints fresh CRDT nodes).

### IME Composition and Undo Granularity

Undo in the Docs editor *is* Yorkie's `doc.history` — the store keeps no own
stack and `snapshot()` is a no-op. Yorkie pushes exactly one undo unit per
`doc.update()` that produces reverse ops, with no way to exclude or group Tree
edits across updates. The only lever is to avoid interim `doc.update()`s.

So one IME-composed character (e.g. one Hangul syllable) is one undo unit: a
single Undo removes it cleanly, matching English typing and Google Docs/Notion.

- **While a composition is active**, no Tree edit / `doc.update()` is performed
  for interim composing text. The committed text is written exactly once on
  `compositionend` (single `doc.update()` → one undo unit). In-progress
  composing text is view-local.
- **The composing string is rendered via view-local layout injection** — a
  synthetic `MeasuredSegment` spliced into `layoutBlock()` at the composing
  offset, so it reflows/wraps correctly and the caret resolves normally. It is
  never written to `doc.document.blocks` and is cleared on composition end/abort.
  Body, header, footer, and table cells all share `root.content` and funnel
  through the same `layoutBlock()`. The software Hangul assembler (`hangul.ts`)
  routes its `composing` vs `commit` split through the same transient-render /
  single-insert paths.

### Caret Restoration on Undo Races Against the Live-Cursor Publisher

Undo restores the caret from Yorkie presence, not from the Tree edit itself:
`saveSnapshot()` → `YorkieDocStore.setCursorForHistory()` stages the pre-edit
caret into `pendingCursorPos` immediately before an edit; the edit's own
`doc.update()` then writes that staged position into presence
(`activeCursorPos`) with `addToHistory: true`. Yorkie's undo restores whatever
was live in presence at the moment that `doc.update()` began — so the value
staged by `setCursorForHistory()` is exactly what a later Undo needs to land
on.

This assumes nothing else writes `activeCursorPos` in the gap between
`setCursorForHistory()` staging it and the edit's own write. That assumption
breaks under IME composition: `docs-view.tsx`'s `onCursorMove` listener
may publish a trailing live-cursor update to presence during interim
composition (`YorkieDocStore.updateCursorPos()`, no `addToHistory`) — i.e.
while the composing text is still view-local (see above), before the
syllable's single commit `doc.update()` runs. If that throttled write lands
in the gap, it overwrites the correctly-staged pre-edit position with the
in-progress (uncommitted) composing position, and undo restores the wrong
caret.

`updateCursorPos` clamps to the block's current text length
(`clampPosToModel`), which incidentally masks this for composing at the end
of a block — the interim offset is always past the not-yet-updated block
length, so it clamps back to the correct pre-edit position. It does **not**
mask it when there is content after the caret (e.g. composing between two
existing characters): the block is long enough that the interim offset isn't
clamped, so the corrupted value survives. See issue #609.

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Text insert/delete (character-level) | ✅ Shipped |
| 2 | Inline styling (native CRDT `editByPath`/`styleByPath`) | ✅ Shipped |
| 3 | Structural editing — split/merge (manual two-step) | ✅ Shipped |
| 4 | Table cell internal edits (extend Phase 1–3) | ✅ Shipped |
| 5 | Block/cell attribute edits (styleByPath) | ✅ Shipped |
| 6 | Cell span attributes (styleByPath) | ✅ Shipped |
| 7 | Table-level attributes (styleByPath on block) | ✅ Shipped |
| 8 | Cell structural edits (editByPath) | ✅ Shipped |
| 9 | Yorkie-native undo/redo (feature-flagged) | Planned |

### Phase 4: Table Cell Internal Edits

Extend Phase 1–3 character-level CRDT editing into table cells. Instead of
adding `*InCell` methods to DocStore, the existing `insertText`, `deleteText`,
`applyStyle`, `splitBlock`, `mergeBlock` are extended to handle cell-internal
blocks transparently.

**Strategy: Unified blockId resolution (approach B-2)**

`resolveBlockTreePath(blockId)` is extended to DFS the Yorkie Tree, finding
blocks inside table cells and nested tables. The returned path includes the
full chain: `[...tablePath, rowIdx, cellIdx, blockIdx]`. All existing methods
then operate on cell-internal blocks identically to top-level blocks — the
only difference is the longer path prefix.

This eliminates the current LWW pattern where `Doc.updateBlockInStore()`
replaces the entire root table via `store.updateBlock(rootTableId)` for
cell-internal edits.

**Path format:**
```
Top-level block:    [bodyOffset + blockIdx]
Cell block:         [bodyOffset + tableIdx, rowIdx, cellIdx, blockIdx]
Nested cell block:  [...outerPath, rowIdx, cellIdx, tableIdx, rowIdx, cellIdx, blockIdx]
```

**Implementation steps:**

| Step | Scope | Description |
|------|-------|-------------|
| 1 | `insertText` / `deleteText` | Extend `resolveBlockTreePath()` with DFS, remove Doc LWW routing |
| 2 | `applyStyle` | Reuse Step 1 path resolution for native CRDT cell styling |
| 3 | `splitBlock` / `mergeBlock` | Remove `splitBlockInCellInternal()`, unify cell split/merge |

**Doc class cleanup (per step):**
- Step 1: Remove cell branch in `updateBlockInStore()` for text edits
- Step 2: Remove cell branch in `applyInlineStyle()` routing
- Step 3: Remove `splitBlockInCellInternal()` and cell branch in `mergeBlocks()`

### Phase 5: Block/Cell Attribute Edits

Migrate remaining LWW operations to intent-preserving `styleByPath`/`editByPath`:

| Operation | Before | After |
|-----------|--------|-------|
| `setBlockType` | `updateBlockInStore` (full block replace) | `styleByPath` on block node |
| `applyBlockStyle` | `updateBlockInStore` (full block replace) | `styleByPath` on block node |
| `applyCellStyle` | `updateTableCell` (full cell replace) | `styleByPath` on cell node |
| `insertImageInline` | `updateBlockInStore` (full block replace) | `editByPath` at inline level |

This eliminates `updateBlockInStore` and `findRootTableId` from the Doc class.
All editing operations now route through intent-preserving store methods.

### Phase 6: Cell Span Attributes

Change `colSpan`/`rowSpan` attributes on cell nodes via `styleByPath`. Same
pattern as Phase 5's `applyCellStyle`.

| Operation | Before | After |
|-----------|--------|-------|
| `deleteRow()` rowSpan adjust | `store.updateTableCell` (full cell replace) | `store.applyCellSpan` (styleByPath) |
| `deleteColumn()` colSpan adjust | `store.updateTableCell` (full cell replace) | `store.applyCellSpan` (styleByPath) |
| `splitCell()` top-left span clear | `store.updateTableCell` (full cell replace) | `store.applyCellSpan` (styleByPath) |

`applyCellSpan` uses `styleByPath` to set span values and `removeStyleByPath`
to clear them (value 1 = default = remove from tree). Covered cell block reset
in `splitCell` still uses `updateTableCell` (Phase 8).

### Phase 7: Table-Level Attributes ✅

Column widths and row heights are block-level attributes on the table node.
Migrated `updateTableAttrs` from `editByPath` (full block replacement) to
`styleByPath` on the block node.

| Before | After |
|--------|-------|
| `editByPath(tablePath, endPath, buildBlockNode(block))` | `styleByPath(tablePath, { cols, rowHeights })` |

All 7 call sites (`insertRow`, `deleteRow`, `insertColumn`, `deleteColumn`,
`setColumnWidth`, `resizeColumn`, `setRowHeight`) are routed through the
same `updateTableAttrs` store method — no Doc-level changes needed.

Attributes are serialized as comma-separated strings on the block node
(`cols: "0.5,0.5"`, `rowHeights: "40,"`), matching the existing
`buildBlockNode` format.

### Phase 8: Cell Structural Edits

Migrate cell-internal block insert/delete from `updateTableCell` (full cell
replacement) to `editByPath` (block-level CRDT operations). Operations where
full replacement IS the intent (`mergeCells` covered cell reset,
`updateBlockDirect` paste) remain unchanged.

**Strategy: Unified blockId resolution (approach B)**

Reuse the Phase 4 `resolveBlockTreePath(blockId)` DFS to resolve cell-internal
blocks transparently. One new store method `insertBlockAfter(siblingBlockId,
block)` handles all insertion cases. Existing `deleteBlock(id)` is extended
to handle cell-internal blocks.

**New store method:**

```typescript
insertBlockAfter(siblingBlockId: string, block: Block): void;
```

- `resolveBlockTreePath(siblingBlockId)` resolves the sibling path
- YorkieDocStore: `editByPath([...path+1], [...path+1], buildBlockNode(block))`
- MemDocStore: `findBlockInAnyArray(siblingBlockId)` → `splice(index+1, 0, block)`

**Migrated call sites:**

| Call site | Before | After |
|-----------|--------|-------|
| `splitBlock()` HR/page-break in cell | `store.updateTableCell` (whole cell) | `store.insertBlockAfter(blockId, newBlock)` |
| `insertTableInCell()` | `store.updateTableCell` (whole cell) | `store.insertBlockAfter(blockId, newTable)` |
| `deleteTableInCell()` | `store.updateTableCell` (whole cell) | `store.deleteBlock(tableBlockId)` |

**Retained LWW call sites (full replacement is the intent):**

| Call site | Reason |
|-----------|--------|
| `mergeCells()` covered cell reset | Deliberately clearing cell content |
| `splitCell()` covered cell reset | Deliberately resetting to empty |
| `updateBlockDirect()` paste | Replacing entire block content |

**deleteTableInCell empty-cell guard:** After deleting the last block in a
cell, the cell must retain at least one block. When the deleted block is the
only block, replace it with an empty paragraph via `updateBlock` instead of
deleting.

## Known Issues

1. **Remote cursor offset not transformed** — when a remote user inserts text
   before the local cursor, the position is not adjusted. Needs cursor
   transformation based on remote edit positions.

2. **Concurrent split+edit edge cases** — split/merge use the manual
   two-step decomposition above (native `splitLevel=2` is avoided because it
   breaks undo/redo and trips a yorkie-js-sdk range-narrowing bug). Our
   concurrent integration tests converge correctly, but rare split+edit edge
   cases cannot be fully ruled out.

3. **Caret restoration races the live-cursor publisher during IME composition**
   — see "Caret Restoration on Undo Races Against the Live-Cursor Publisher"
   above and issue #609. Reproduces when composing Hangul with content after
   the caret; masked (accidentally) when composing at end-of-block.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Yorkie `editByPath` at text level has bugs | Extensive testing; started with simplest case |
| Model cache diverges from Yorkie Tree | In-place cache update after each mutation |
| Yorkie Tree undo unstable for mixed ops | Split/merge use the manual two-step decomposition (native `splitLevel=2` avoided) to keep undo/redo stable |
| Performance regression | Benchmark per-character ops vs block replacement |
| Split divergence on concurrent split+edit | Manual two-step split/merge (native splitLevel avoided); concurrent integration tests added |
| DFS tree traversal cost for cell block lookup | Tables are small; optimize with index cache if profiling shows regression |
| Doc routing cleanup breaks existing cell editing | Each step is independently testable; unit + concurrent tests per step |
