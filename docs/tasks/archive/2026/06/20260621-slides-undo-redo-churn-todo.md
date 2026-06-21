# Slides undo/redo document churn — diff-based replaceRoot

**Created**: 2026-06-21

Design: `docs/design/slides/slides-collaboration.md` (reconcile note added)

## Problem

`YorkieSlidesStore.replaceRoot()` (the undo/redo restore path) rewrites
the Yorkie root by splicing the *entire* `r.slides` and `r.layouts`
arrays:

```ts
r.slides.splice(0, r.slides.length, ...(nextSlides as never[]));
r.layouts.splice(0, r.layouts.length, ...(nextLayouts as never[]));
```

Each rebuilt slide is a fresh object holding freshly `clone()`d
elements, so every undo/redo — even one reverting a single-element move
— removes every slide (with all nested elements) and re-adds clones.
The op churn is proportional to the whole document, not to what changed.

Repeated undo/redo accumulated CRDT tombstones until one slides
document reached 118MB. Server housekeeping (snapshot/compaction) loads
the whole document into memory; with no pod memory limit it exhausted
the 8GB EKS node and cascaded node OOMs.

See incident: second-brain
`00_log/incidents/2026/2026-06-20-yorkie-document-oom-node-cascade.md`.

## Decisions (confirmed)

- Fix at the source: make `replaceRoot()` reconcile by `id` so it only
  touches elements/slides/layouts that actually changed.
- Reproduce first: a black-box churn test using `doc.getGarbageLen()`
  must go Red on current `main` before the fix, Green after.
- Preserve CRDT identity for matched nodes (field-level in-place update,
  Yorkie move primitives for reorder) instead of remove + re-add.
- `meta` / `themes` / `masters` / `guides`: keep whole-value assignment
  (no deep id-reconcile) but **only write when changed** (JSON compare
  against the current root). A theme/master is a deep nested object;
  reassigning it unconditionally would tombstone tens of nodes on every
  undo, even an undo that never touched the theme. Guarding the write
  makes a single-element-move undo near-zero churn.

## Plan

- [x] Red: add `yorkie-slides-undo-churn.test.ts`
  - [x] Seed a doc (3 slides × 20 elements) via `ensureSlidesRoot` + update
  - [x] Change one element frame in a batch, `undo()`, assert
        `getGarbageLen()` delta is small (< 30) — failed on current code
        (undo churned 1336 nodes, redo 1456)
  - [x] Correctness: undo/redo restores `read()` exactly for
        single-field change, reorder, add cases
  - [x] Correctness: nested group child change recurses correctly
  - [x] Mixed-content churn (text + group present) stays < 30
- [x] Implement diff-based `replaceRoot()`
  - [x] `reconcileArrayById(arr, desired, updateItem)` helper:
        remove by id, append by id, reorder via move primitives, recurse
  - [x] Slide reconcile: elements (recursive), background, notes, layoutId
  - [x] Element reconcile: skip if deep-equal; else update changed
        fields in place; remove stale fields (e.g. `placeholderRef`);
        recurse group `data.children`
  - [x] Layout reconcile by id
  - [x] meta/themes/masters/guides: whole-value assignment guarded by a
        structural compare (no write when unchanged)
- [x] Green: churn test passes; all correctness assertions pass
- [x] `pnpm verify:fast` green
- [x] Self-review the branch diff
- [x] Open PR (English); capture lessons; archive task docs (PR #388 merged)

## Verification

- Churn test Red on current code (undo 1336 / redo 1456 garbage nodes),
  Green after fix (< 30 for undo / redo / mixed-content)
- Correctness tests pass (move / reorder / add / group recursion)
- `pnpm verify:fast` green (after `@wafflebase/docs build` to refresh the
  stale dist from the `main` pull — unrelated to this change)

## Results

- Root cause: `replaceRoot` spliced the whole `slides` / `layouts`
  arrays, so every undo/redo tombstoned the entire document. One element
  moved + undone churned 1336 CRDT nodes on a 3×20 deck.
- Fix: `replaceRoot` now builds the desired tree from the snapshot (same
  mapping) and reconciles the live root by id — remove/append/reorder
  (move primitives) + recurse, skipping deep-equal subtrees. The same
  single-element undo now churns a handful of nodes.
- Discovery: a bare `'#abc'` string fill is wrapped to a `ThemeColor` by
  `migrateDocument` on read, so the first undo migrates every element — a
  one-time cost, not steady-state churn. The editor stores canonical
  `ThemeColor` fills, so real decks don't hit it; the test seeds the
  canonical shape to measure steady state.
