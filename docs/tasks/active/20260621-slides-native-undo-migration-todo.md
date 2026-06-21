# Slides undo/redo — migrate to Yorkie-native `doc.history`

**Created**: 2026-06-21

Follow-up to PR #388 (Reconcile slides undo/redo by id to stop document
churn). Design doc to be written first:
`docs/design/slides/slides-native-undo.md`.

## Problem

`YorkieSlidesStore` is the only document store that rolls its own
snapshot-based undo/redo: `batch()` pushes a full `SlidesDocument`
snapshot onto `undoStack`, and `undo()` restores it via `replaceRoot`.
Sheets (`yorkie-store.ts`) and Docs (`yorkie-doc-store.ts`) both use
Yorkie-native `doc.history.undo()/redo()`.

The snapshot approach caused the 2026-06-20 node-OOM incident: restoring
a snapshot rewrote the whole Yorkie root, tombstoning the entire document
on every undo/redo. PR #388 fixed that by reconciling the live root
against the snapshot by id — a targeted fix that keeps the snapshot
architecture.

Yorkie-native undo would remove the whole problem class by construction:
`doc.history.undo()` applies the *reverse operations* of the last change,
touching only what changed. It also:

- needs no snapshot stacks (drops the per-batch full-document `read()`);
- has better collaborative semantics — it reverts only the local client's
  operations, instead of overwriting a peer's change that landed between
  `batch()` and `undo()` (a gap the store's own comments flag as
  "deliberately ignored in Phase 4a").

## Goal / Non-Goals

- Goal: replace the snapshot undo/redo in `YorkieSlidesStore` with
  `doc.history`, matching Docs/Sheets. Remove `undoStack` / `redoStack` /
  `replaceRoot` and the snapshot machinery once parity is proven.
- Non-Goal: changing `MemSlidesStore` (the non-Yorkie fallback) unless
  required for shared behavior — decide during design.
- Non-Goal: redesigning the editor's batch/selection model beyond what the
  undo-unit grouping requires.

## Key challenges (verification points)

1. **One batch = one undo unit.** This is the central refactor. Slides
   `batch()` does NOT wrap its work in a single `doc.update`; each of the
   ~46 mutators calls `this.doc.update()` independently, so a batch of N
   edits (e.g. dragging 3 selected elements) becomes N native undo units.
   Sheets/Docs avoid this by doing one `doc.update` per public action.
   Options: (a) make `batch()` open a single `doc.update` and have
   mutators operate on an ambient root passed down, or (b) Yorkie undo-unit
   grouping if available. Validate undo grouping with a multi-element drag.

2. **Op reversibility.** Confirm every slides mutation produces a
   Yorkie-reversible change: set/add/remove/move/style/tree, the array
   move primitives (`moveFront`/`moveAfter`), group/ungroup, table ops,
   connector endpoint edits, guides. Anything Yorkie can't reverse breaks
   native undo.

3. **Collaborative semantics change.** Native undo reverts only local
   ops, not absolute state. Re-validate any test/UX that assumed snapshot
   absolute-restore. (Net improvement, but a behavior change.)

4. **Undo floor.** Mirror Docs' `undoFloor`
   (`getUndoStackForTest().length > undoFloor`) so a user can't undo past
   the initially seeded deck (the "new deck opens with one slide" seed).

5. **Presence / selection.** Ensure undo/redo plays correctly with the
   selection overlay and presence after reverse ops (selection may point
   at re-created/removed element ids).

6. **MemSlidesStore parity.** The fallback store uses snapshot undo.
   Decide whether to keep its snapshot path or unify the interface.

## Plan

- [ ] Write `docs/design/slides/slides-native-undo.md` (this plan + the
      batch→undo-unit design, op-reversibility audit, semantics)
- [ ] Refactor `batch()` so one batch maps to one Yorkie undo unit
      (single `doc.update` / ambient root)
- [ ] Swap `undo()` / `redo()` / `canUndo()` / `canRedo()` to
      `doc.history`, add an undo floor
- [ ] Port undo/redo tests; keep the `getGarbageLen` churn test as a
      regression guard (native undo should also be ~zero churn)
- [ ] Remove `undoStack` / `redoStack` / `replaceRoot` and the reconcile
      helpers once native parity is green
- [ ] `pnpm verify:fast`; manual smoke (multi-element drag undo, undo
      across a concurrent peer edit)

## References

- PR #388 — interim reconcile fix (keeps snapshot architecture)
- Incident: `second-brain`
  `00_log/incidents/2026/2026-06-20-yorkie-document-oom-node-cascade.md`
- Reference impls: `yorkie-doc-store.ts` (Docs), `yorkie-store.ts` (Sheets)
