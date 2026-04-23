# Intent-Preserving Edits — Phase 4: Table Cell Internal Edits

**Goal:** Extend Phase 1-3's character-level editing to table cell blocks by
unifying path resolution — no new `*InCell` methods, existing methods handle
cells transparently.

**Design doc:** `docs/design/docs/docs-intent-preserving-edits.md`

**Depends on:** Phase 1-3 (completed)

**Approach:** B-2 — `resolveBlockTreePath()` DFS traverses the Yorkie Tree to
find cell-internal blocks by `id` attribute. All existing `insertText`,
`deleteText`, `applyStyle`, `splitBlock`, `mergeBlock` work unchanged for
cell blocks via the longer path prefix.

---

## Step 1: `insertText` / `deleteText` in cells — ✅ Done

- [x] Extend `resolveBlockTreePath()` to DFS into table/row/cell/block nodes
- [x] Add `region` support for cell blocks (returns parent table's region)
- [x] Add `getBlockByRegion()` / `setBlockByRegion()` support for cell block lookup
- [x] Extend `getBlock()` with `findBlockRecursive()` for cell search
- [x] Verify `insertText` works for cell-internal blocks
- [x] Verify `deleteText` works for cell-internal blocks
- [x] Unit tests: 5 cases (insert, delete, mid-insert, preceded block, different cells)
- [x] Concurrent test: two users inserting in same cell, character-level merge

## Step 2: `applyStyle` in cells — ✅ Done

- [x] Verify `applyStyle` works for cell-internal blocks (reuses Step 1 path)
- [x] Unit tests: cell bold, cell style after insert
- [x] Concurrent test: text insert + bold in same cell

## Step 3: `splitBlock` / `mergeBlock` in cells — ✅ Done

- [x] Add `getBlocksArrayForPath()` for cell-internal split/merge cache updates
- [x] Verify `splitBlock` works for cell-internal blocks
- [x] Verify `mergeBlock` works for cell-internal blocks
- [x] Unit tests: cell split, cell merge, split without affecting other cells
- [x] Concurrent test: split + text insert in same cell

## Doc class LWW routing cleanup — ✅ Done

- [x] Route `Doc.insertText` through `store.insertText` (not `updateBlockInStore`)
- [x] Route `Doc.deleteText` through `store.deleteText`
- [x] Route `Doc.applyInlineStyle` same-block through `store.applyStyle`
- [x] Route `Doc.applyInlineStyle` cross-block same-cell through `store.applyStyle` per block
- [x] Route `Doc.applyInlineStyle` cross-block table-in-range through `store.applyStyle` per cell block
- [x] Route `Doc.mergeBlocks` through `store.mergeBlock` (remove cell branch)
- [x] Remove `splitBlockInCellInternal()` and exclusive helpers
- [x] Remove `applyStyleToBlock()` (no longer used)
- [x] Fix nested-table test to sync store after direct mutation

## Key finding

`Doc.insertText`/`deleteText` were using `store.updateBlock` (full block
replacement) even for top-level blocks. Phase 1-3's character-level
`store.insertText`/`deleteText` were only reachable from tests, not the UI.
The Doc cleanup commit fixes this — all text/style operations now route
through fine-grained store methods for both top-level and cell blocks.
