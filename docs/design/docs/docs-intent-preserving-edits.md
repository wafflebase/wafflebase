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

// Phase 4: Table cell variants
insertTextInCell(tableBlockId, rowIndex, colIndex, cellBlockIndex, offset, text): void;
deleteTextInCell(...): void;
applyStyleInCell(...): void;
```

### Yorkie Tree Strategy

| Operation | Yorkie API | Granularity | Concurrent behavior |
|-----------|-----------|-------------|---------------------|
| Text insert | `editByPath` | Character-level `[blockIdx, inlineIdx, charOffset]` | CRDT merge |
| Text delete | `editByPath` | Character-level + empty inline cleanup | CRDT merge |
| Style | `editByPath` (`splitLevel=1`) + `styleByPath` | Inline-level split + element style | CRDT merge |
| Split | `editByPath` + `styleByPath` | Native CRDT split (`splitLevel=2`) | CRDT merge |
| Merge | `editByPath` | Native boundary deletion | CRDT merge |
| Full doc write | `editBulkByPath` | Undo/redo fallback | — |

**Path format:** 3 levels `[blockIdx, inlineIdx, charOffset]`. The inline
node's `hasTextChild()` interprets the last element as a character offset.

#### Native Inline Styling (SDK 0.7.6)

Style operations use `editByPath` with `splitLevel=1` to split inline nodes
at style boundaries, then `styleByPath` to apply attributes to the resulting
inlines. This eliminates LWW conflicts — concurrent text edits in the same
block are preserved during styling operations. The split is performed at
`toOffset` first, then `fromOffset`, so that earlier path indices remain valid.

#### Native Split/Merge (SDK 0.7.4)

As of SDK 0.7.4, split and merge use native Yorkie Tree CRDT operations
instead of block replacement. This eliminates LWW conflicts for concurrent
structural edits.

**Split** uses `editByPath(path, path, undefined, splitLevel)` where
`splitLevel=2`. The path points to text level `[blockIdx, inlineIdx,
charOffset]`, and `splitLevel` counts only element ancestors (text nodes
excluded). Two element levels are split: inline → block. After the split,
`styleByPath` updates the new "after" block's attributes (id, type, list
properties).

**Merge** uses boundary deletion: `editByPath([blockIdx, inlineCount],
[nextBlockIdx, 0])`. This deletes the range from the first block's close
boundary to the next block's open boundary, triggering an automatic CRDT
merge.

**splitLevel note:** Yorkie's `splitLevel` counts from the immediate parent
element of the text position upward. In our tree `doc → block → inline →
text`, the parent chain from text is: inline (level 1) → block (level 2).
So `splitLevel=2` achieves a block-level split.

**Known concurrent edge cases (SDK 0.7.4):** Two integration tests remain
skipped in the Yorkie SDK — `concurrently-split-split-test` and
`concurrently-split-edit-test`. Both involve mixed `splitLevel` values
(1 and 2) on deeply nested trees. Our use case (uniform `splitLevel=2` on
a flat block list) is a narrower pattern, but concurrent split+edit
divergence cannot be fully ruled out until these are resolved upstream.

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Text insert/delete (character-level) | ✅ Shipped |
| 2 | Inline styling (native CRDT, SDK 0.7.6) | ✅ Shipped |
| 3 | Structural editing — split/merge (native CRDT, SDK 0.7.4) | ✅ Shipped |
| 4 | Table cell internal edits (extend Phase 1–3) | Planned |
| 5 | Yorkie-native undo/redo (feature-flagged) | Planned |

## Known Issues

1. **Remote cursor offset not transformed** — when a remote user inserts text
   before the local cursor, the position is not adjusted. Needs cursor
   transformation based on remote edit positions.

2. **Concurrent split+edit edge cases** — Yorkie SDK 0.7.4 has two skipped
   concurrent tests involving mixed splitLevel values. Our concurrent
   integration tests (inline `splitLevel=1` + block `splitLevel=2`) converge
   correctly in SDK 0.7.6, but edge cases cannot be fully ruled out until
   resolved upstream.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Yorkie `editByPath` at text level has bugs | Extensive testing; started with simplest case |
| Model cache diverges from Yorkie Tree | In-place cache update after each mutation |
| Yorkie Tree undo unstable for mixed ops | Feature-flagged; SDK 0.7.3 includes fix for mixed char+block undo |
| Performance regression | Benchmark per-character ops vs block replacement |
| Native split divergence on concurrent split+edit | Uniform splitLevel=2 on flat block list; concurrent integration tests added |
