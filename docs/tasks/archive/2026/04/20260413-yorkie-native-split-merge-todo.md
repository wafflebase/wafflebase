# Yorkie v0.7.4 Native Split/Merge Investigation

- **Status**: done
- **Date**: 2026-04-13

## Background

Yorkie v0.7.4 (released 2026-04-11) ships major convergence fixes for
concurrent Tree.Edit split/merge operations. The ProseMirror binding was
also migrated to native split/merge (PR #1207).

Waffledocs currently uses `@yorkie-js/sdk@0.7.3` and handles split/merge
via **block replacement** — two `editByPath` calls that replace or insert
entire block nodes. This is LWW and loses one side on concurrent edits.

## v0.7.4 API Summary

### Split

```typescript
// Empty range + splitLevel splits the node hierarchy
tree.editByPath(splitPath, splitPath, undefined, splitLevel);
tree.edit(splitIdx, splitIdx, undefined, splitLevel);
```

- `splitLevel=1`: splits at the block level (safe, well-tested)
- `splitLevel=0`: default, no split (normal insert/delete)
- `splitLevel>1`: unstable — 3 integration tests still skipped in v0.7.4

### Merge

```typescript
// Deleting the boundary between two blocks triggers an automatic merge
tree.editByPath(blockEndPath, nextBlockStartPath);
tree.edit(bFrom, bTo);
```

- Deletes from the first block's close tag through the next block's open tag
- For multiple merges, apply right-to-left to avoid index shifts

## Current Implementation (Block Replacement)

### splitBlock (yorkie-doc-store.ts:770-807)

```typescript
const [before, after] = applySplitBlock(block, offset, newBlockId, newBlockType);
// Two independent editByPath calls — LWW on concurrent edits
tree.editByPath([blockIdx + off], [blockIdx + off + 1], buildBlockNode(before));
tree.editByPath([blockIdx + off + 1], [blockIdx + off + 1], buildBlockNode(after));
```

### mergeBlock (yorkie-doc-store.ts:809-847)

```typescript
const merged = applyMergeBlocks(block, nextBlock);
// Two independent editByPath calls — LWW on concurrent edits
tree.editByPath([blockIdx + off], [blockIdx + off + 1], buildBlockNode(merged));
tree.editByPath([deleteIdx + off], [deleteIdx + off + 1]);
```

## What Native Split/Merge Improves

### 1. Split (Enter key) — Concurrent Safety

| Scenario | Current (block replacement) | Native split |
|----------|----------------------------|--------------|
| Two users press Enter in the same paragraph | One split lost (LWW) | Both splits preserved |
| One user splits + another types text | Typed text may be lost | Text preserved (CRDT) |

**Target implementation:**
```typescript
// Before: 2x block replacement
tree.editByPath([blockIdx + off], [blockIdx + off + 1], buildBlockNode(before));
tree.editByPath([blockIdx + off + 1], [blockIdx + off + 1], buildBlockNode(after));

// After: single atomic CRDT operation
const splitPath = [blockIdx + off, inlineIndex, charOffset];
tree.editByPath(splitPath, splitPath, undefined, /* splitLevel= */ 1);
```

### 2. Merge (Backspace at paragraph start) — Text Preservation

| Scenario | Current (block replacement) | Native merge |
|----------|----------------------------|--------------|
| One user merges + another types text | Typed text may be lost | Text preserved |
| Two users merge at the same boundary | Unpredictable | Convergence guaranteed |

**Target implementation:**
```typescript
// Before: block replacement + deletion
tree.editByPath([blockIdx + off], [blockIdx + off + 1], buildBlockNode(merged));
tree.editByPath([deleteIdx + off], [deleteIdx + off + 1]);

// After: boundary deletion triggers automatic merge
// (exact path computation needed — see ProseMirror's computeMergeBoundary)
```

### 3. Phase 5 Undo/Redo Stability

- Native split/merge = single CRDT operation = single undo unit
- Block replacement (2 calls) can leave intermediate state on undo

## Risks and Constraints

### Safe (splitLevel=1)
- Body block split on Enter — block-level split, well-tested
- Body block merge on Backspace — boundary deletion
- v0.7.4 fixes 8 of 11 concurrent convergence test cases

### Needs Care
- **Block attributes after split**: native split copies the original block's
  attributes. The "after" block needs its id, type, headingLevel, listKind,
  listLevel adjusted via `styleByPath` post-split
- **SDK upgrade 0.7.3 → 0.7.4**: verify no breaking changes
- **Header/Footer**: keep current `writeFullDocument()` approach (different tree region)

### Avoid
- **splitLevel > 1**: 3 tests still skipped:
  - `contained-split-and-split-at-different-levels`
  - `side-by-side-split-and-insert`
  - `side-by-side-split-and-delete`
- **Table cell internal split/merge**: deeper tree paths, defer to Phase 4

## Implementation Complexity

### Straightforward
- SDK version upgrade (0.7.3 → 0.7.4)
- Split: change to `editByPath(path, path, undefined, 1)`

### Requires Design
- **Post-split attribute adjustment**: native split copies attributes, so the
  after block's id/type must be set via `styleByPath`
- **Merge boundary calculation**: need to compute the exact path/index for the
  boundary between two blocks (refer to ProseMirror binding's `computeMergeBoundary`)
- **Cache synchronization**: in-memory cache update logic must change since we
  no longer build the result nodes ourselves

## Recommended Execution Order

1. Upgrade SDK (0.7.3 → 0.7.4) and confirm existing tests pass
2. Implement native split for body blocks (splitLevel=1)
3. Implement native merge for body blocks (boundary deletion)
4. Test concurrent editing (two clients, simultaneous split/merge)
5. Validate integration with Phase 5 undo/redo

## References

- [Yorkie JS SDK v0.7.4 release](https://github.com/yorkie-team/yorkie-js-sdk/releases)
- [PR #1207: Native split/merge in ProseMirror](https://github.com/yorkie-team/yorkie-js-sdk/pull/1207)
- [PR #1202: Convergence bug fixes](https://github.com/yorkie-team/yorkie-js-sdk/pull/1202)
- Current impl: `packages/frontend/src/app/docs/yorkie-doc-store.ts:770-847`
- Design doc: `docs/design/docs/docs-intent-preserving-edits.md`
