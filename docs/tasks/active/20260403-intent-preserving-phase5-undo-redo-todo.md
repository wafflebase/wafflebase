# Intent-Preserving Edits — Phase 5: Yorkie-Native Undo/Redo

**Goal:** Migrate from snapshot-based undo/redo to Yorkie Tree history, where
each `doc.update()` is an undo unit.

**Design doc:** `docs/design/docs-intent-preserving-edits.md`

**Depends on:** Phase 1-3 (completed), Phase 4 (recommended), SDK 0.7.3 (completed)

---

## Overview

Current undo/redo deep-clones the entire document on each snapshot, then
rewrites the full Yorkie Tree on undo. This is expensive and doesn't compose
with remote changes. Yorkie Tree undo/redo operates on individual operations,
giving correct concurrent undo behavior.

**SDK prerequisite:** `@yorkie-js/sdk` 0.7.3 includes the fix for mixed
character-level and block-level undo/redo (yorkie-team/yorkie-js-sdk#1196).

**Stability note:** Yorkie Tree undo/redo is not yet fully stable. This phase
must be feature-flagged with snapshot-based fallback retained.

## Tasks

### Task 1: Add feature flag for Yorkie undo

- [ ] Add `useYorkieUndo` flag to YorkieDocStore
- [ ] When enabled, `snapshot()` becomes no-op (Yorkie tracks via `doc.update()`)
- [ ] When disabled, existing snapshot-based behavior unchanged

### Task 2: Implement Yorkie undo/redo

- [ ] Implement `undo()` using Yorkie history API (`doc.history.undo()`)
- [ ] Implement `redo()` using Yorkie history API (`doc.history.redo()`)
- [ ] Add try/catch with fallback to snapshot-based on failure
- [ ] Update `canUndo()`/`canRedo()` to query Yorkie history when flag enabled

### Task 3: Test each operation type for undo correctness

- [ ] Type text → undo → text disappears
- [ ] Type → bold → undo → bold removed → undo → text removed
- [ ] Enter (split) → undo → blocks merged back
- [ ] Backspace merge → undo → blocks restored
- [ ] Multiple undos → redo all → original state restored
- [ ] Concurrent edit by peer → undo only affects local changes

### Task 4: Deprecate updateBlock for text mutations

- [ ] Audit remaining `updateBlock()` calls in Doc
- [ ] Replace any text/style/structure calls with fine-grained methods
- [ ] Add deprecation comment — keep only for block-level attribute changes
- [ ] MemDocStore undo/redo stays snapshot-based (no Yorkie dependency)
