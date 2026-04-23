# Phase 8: Cell Structural Edits — Lessons

## Cache index vs tree path offset

When updating the cached `doc.blocks` array after a Yorkie tree mutation,
`resolveBlockTreePath()` returns a tree-level path that includes `bodyTreeOffset`
(e.g., `[bodyIdx + 1]` when a header exists). The cache array `doc.blocks` is
zero-indexed, so using the raw tree path index causes an off-by-one splice.

**Fix:** Use `getRegionBlocks().topIndex` for top-level blocks (it subtracts the
offset), and `siblingPath[last]` only for cell-internal blocks (where the last
element is already a local block index within `cell.blocks`).

This same bug pattern exists in the pre-existing `deleteBlock` and `splitBlock`
cache updates but is latent because no tests exercise those methods with a
header-containing document. Filed as a known issue for follow-up.
