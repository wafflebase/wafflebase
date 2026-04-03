# Intent-Preserving Yorkie Edits — Lessons Learned

## Phase 1–3 Implementation (2026-04-02)

### Yorkie Tree path format

Text-level paths use 3 levels `[blockIdx, inlineIdx, charOffset]`, not 4.
The inline node's `hasTextChild()` flag causes the last path element to be
interpreted as a character offset automatically. Initial implementation used
4-level paths which caused "unacceptable path" errors at runtime.

### styleByPath is element-level only

`styleByPath(path, attrs)` takes a single path and sets attributes on the
element at that path. It does NOT take a from/to range and cannot split
inline nodes for partial text styling. Bold/italic applied via `styleByPath`
silently failed — text appeared styled locally (cached model) but was not
persisted to Yorkie. Fixed by using block-level `editByPath` replacement.

### Character-level delete leaves empty inlines — solved

When `editByPath` deletes all text from an inline node, the empty inline
element remains in the Yorkie tree. But `applyDeleteText` (the model helper)
runs `normalizeInlines` which removes empty inlines. Initially fixed by
falling back to block-level replacement, but later improved: empty inline
nodes are now removed via `editByPath([blockIdx, idx], [blockIdx, idx+1])`
within the same `doc.update()`, preserving character-level CRDT semantics
for concurrent deletions.

### Cache invalidation vs in-place update

Initial implementation used cache invalidation (`dirty = true, cachedDoc =
null`) after mutations. This caused the remote peer's toolbar to throw
"Block not found" errors because intermediate states were visible between
multiple `doc.update()` calls. Fixed by switching to in-place cache update
(`cachedDoc = currentDoc, dirty = false`) matching the existing `updateBlock`
pattern.

### Where character-level CRDT merge actually helps

**Text insertion and deletion** both use character-level Yorkie Tree editing
— two users editing the same paragraph get both edits merged via CRDT.
Style, split, and merge use block-level replacement (LWW) because Yorkie's
APIs for those operations either don't exist for text ranges or have
unverified behavior at deep paths.

### Takeaway: verify Yorkie API behavior empirically

Don't assume Yorkie Tree APIs work the way their names suggest. Always test
with the actual SDK version. The API surface documentation is sparse — read
the SDK source (`pathToTreePos`, `findTextPos`, `pathToPosRange`) to
understand actual behavior.
