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

## Step 1: `insertText` / `deleteText` in cells

- [ ] Extend `resolveBlockTreePath()` to DFS into table/row/cell/block nodes
- [ ] Add `region` support for cell blocks (returns parent table's region)
- [ ] Add `getBlockByRegion()` support for cell block lookup
- [ ] Verify `insertText` works for cell-internal blocks
- [ ] Verify `deleteText` works for cell-internal blocks
- [ ] Remove Doc `updateBlockInStore()` cell LWW branch for text edits
- [ ] Unit tests: cell text insert/delete via YorkieDocStore
- [ ] Concurrent test: two users editing same cell, character-level merge

## Step 2: `applyStyle` in cells

- [ ] Verify `applyStyle` works for cell-internal blocks (reuses Step 1 path)
- [ ] Remove Doc cell routing for style operations
- [ ] Unit tests: cell inline styling via YorkieDocStore
- [ ] Concurrent test: text edit + style in same cell

## Step 3: `splitBlock` / `mergeBlock` in cells

- [ ] Verify `splitBlock` works for cell-internal blocks
- [ ] Verify `mergeBlock` works for cell-internal blocks
- [ ] Remove `splitBlockInCellInternal()` from Doc
- [ ] Remove cell branch in `Doc.mergeBlocks()`
- [ ] Unit tests: cell split/merge via YorkieDocStore
- [ ] Concurrent test: split + text edit in same cell
