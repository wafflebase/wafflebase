# Intent-Preserving Edits — Phase 9: Yorkie-Native Undo/Redo

**Goal:** Migrate from snapshot-based undo/redo to Yorkie Tree history, where
each `doc.update()` is an undo unit.

**Design doc:** `docs/design/docs/docs-intent-preserving-edits.md`

**Depends on:** Phase 1-5 (completed), Phase 6-8 (recommended), SDK 0.7.7 (completed)

---

## Overview

Current undo/redo deep-clones the entire document on each snapshot, then
rewrites the full Yorkie Tree on undo. This is expensive and doesn't compose
with remote changes. Yorkie Tree undo/redo operates on individual operations,
giving correct concurrent undo behavior.

**SDK prerequisite:** `@yorkie-js/sdk` 0.7.7 includes splitLevel>=2 undo/redo
support. Upgraded from 0.7.6 → 0.7.7 on 2026-04-26.

**Stability note:** splitLevel>=2 undo/redo is now shipped in SDK. This phase
should still be feature-flagged with snapshot-based fallback until validated.

## Tasks

### Task 1: Add feature flag for Yorkie undo

- [x] Add `useYorkieUndo` flag to YorkieDocStore
- [x] When enabled, `snapshot()` becomes no-op (Yorkie tracks via `doc.update()`)
- [x] When disabled, existing snapshot-based behavior unchanged

### Task 2: Implement Yorkie undo/redo

- [x] Implement `undo()` using Yorkie history API (`doc.history.undo()`)
- [x] Implement `redo()` using Yorkie history API (`doc.history.redo()`)
- [x] Add try/catch with fallback to snapshot-based on failure
- [x] Update `canUndo()`/`canRedo()` to query Yorkie history when flag enabled

### Task 3: Test each operation type for undo correctness

- [x] Type text → undo → text disappears
- [x] Type → bold → undo → bold removed → undo → text removed
- [x] Enter (split) → undo → blocks merged back
- [ ] Backspace merge → undo → blocks restored (SKIP: Yorkie Tree editByPath merge undo not yet supported)
- [x] Multiple undos → redo all → original state restored
- [ ] Concurrent edit by peer → undo only affects local changes (requires two-user Yorkie test harness)

### Task 4: Deprecate updateBlock for text mutations

- [x] Audit remaining `updateBlock()` calls in Doc — done in Phase 5
- [x] Replace text/style/structure/attribute calls with fine-grained methods — done in Phase 4-5
- [x] Audit remaining `updateBlock()` / `updateTableCell` calls (Phase 6-8 scope)
  - `text-editor.ts`: 5 `updateBlockDirect` calls (paste, image delete, etc.)
  - `document.ts:576`: `updateBlock` for cell-internal last block replace
  - `document.ts:764,793`: `updateTableCell` in mergeCells/splitCell
  - These need fine-grained migration in Phase 6-8 for full Yorkie undo compat
- [x] MemDocStore undo/redo stays snapshot-based (no Yorkie dependency)
