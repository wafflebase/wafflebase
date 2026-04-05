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
| Style | `editByPath` | Block replacement `[blockIdx]` | LWW |
| Split/Merge | `editByPath` | Block replacement | LWW |
| Full doc write | `editBulkByPath` | Undo/redo fallback | — |

**Path format:** 3 levels `[blockIdx, inlineIdx, charOffset]`. The inline
node's `hasTextChild()` interprets the last element as a character offset.

**Why not `styleByPath`?** It sets attributes on a single element, not a text
range. Cannot split inlines for partial styling.
([yorkie-js-sdk#1197](https://github.com/yorkie-team/yorkie-js-sdk/issues/1197))

**Why not `splitByPath`/`mergeByPath`?** Deep-path behavior unverified.
Block replacement via `editByPath` achieves the same result safely.

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Text insert/delete (character-level) | ✅ Shipped |
| 2 | Inline styling (block replacement) | ✅ Shipped |
| 3 | Structural editing — split/merge (block replacement) | ✅ Shipped |
| 4 | Table cell internal edits (extend Phase 1–3) | Planned |
| 5 | Yorkie-native undo/redo (feature-flagged) | Planned |

## Known Issues

1. **Remote cursor offset not transformed** — when a remote user inserts text
   before the local cursor, the position is not adjusted. Needs cursor
   transformation based on remote edit positions.

2. **Style/structure operations are LWW** — concurrent style or split/merge on
   the same block loses one side. Blocked by Yorkie's `styleByPath` limitation.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Yorkie `editByPath` at text level has bugs | Extensive testing; started with simplest case |
| Model cache diverges from Yorkie Tree | In-place cache update after each mutation |
| Yorkie Tree undo unstable for mixed ops | Feature-flagged; SDK 0.7.3 includes fix for mixed char+block undo |
| Performance regression | Benchmark per-character ops vs block replacement |
