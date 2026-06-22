---
title: slides-native-undo
target-version: 0.4.7
---

# Slides Native Undo/Redo

## Summary

`YorkieSlidesStore` is the only document store that rolls its own
snapshot-based undo/redo. `batch()` pushes a full `SlidesDocument`
snapshot onto an `undoStack`, and `undo()` restores it by reconciling
the live Yorkie root against the snapshot. Sheets
(`spreadsheet/yorkie-store.ts`) and Docs (`docs/yorkie-doc-store.ts`)
both use Yorkie-native `doc.history.undo()/redo()`, which apply the
*reverse operations* of the last change and touch only what changed.

This document specifies migrating Slides to `doc.history`, matching
Docs/Sheets, and removing the snapshot machinery (`undoStack`,
`redoStack`, `replaceRoot`, and the `reconcile*` helpers) once parity
is proven.

The snapshot approach caused the 2026-06-20 node-OOM incident:
`replaceRoot` originally rewrote the whole root, tombstoning the entire
document on every undo/redo. PR #388 contained the blast radius by
reconciling by id, but kept the snapshot architecture and its costs: a
full-document `read()` (JSON clone) on every batch, unbounded snapshot
stacks, and last-write-wins collaborative semantics (an undo overwrites
a peer's change that landed between `batch()` and `undo()`). Native
undo removes this whole problem class by construction.

## Goals / Non-Goals

- **Goal**: Replace snapshot undo/redo in `YorkieSlidesStore` with
  `doc.history`. Remove `undoStack` / `redoStack` / `replaceRoot` and
  the reconcile helpers once native parity is green.
- **Goal**: Preserve the public `SlidesStore` contract — `batch(fn)`,
  `undo()`, `redo()`, `canUndo()`, `canRedo()` — unchanged for callers.
  In particular **one `batch()` call = one undo unit** must hold (the
  existing `yorkie-slides-store.test.ts` "one batch = one undo entry"
  test is the acceptance criterion).
- **Goal**: Keep the churn regression guard green — native undo of a
  single-element edit must touch ~one element, not the whole deck.
- **Non-Goal**: Change `MemSlidesStore` (the non-Yorkie fallback). It
  keeps its own snapshot undo; it is single-client and never hit the
  OOM path. The `SlidesStore` interface is unchanged, so both
  implementations satisfy it.
- **Non-Goal**: Redesign the editor's batch/selection model beyond what
  the undo-unit grouping refactor requires.

## Background: how Yorkie native undo works

Confirmed against `@yorkie-js/sdk` 0.7.8 and the Docs/Sheets stores:

- **`doc.history` API**: `canUndo()`, `canRedo()`, `undo()`, `redo()`,
  plus test-only `doc.getUndoStackForTest()` / `getRedoStackForTest()`
  (arrays of reverse-op batches). There is **no** stack-depth config.
- **One `doc.update()` = one undo unit.** Internally, `doc.update()`
  collects the reverse ops produced by its callback and, if non-empty,
  calls `pushUndo(reverseOps)` exactly once. Two separate
  `doc.update()` calls are always two undo units. **There is no
  cross-update grouping API** (no `message`/`groupId` parameter, no
  public `pushUndo`). The only way to group N mutations into one undo
  unit is to run them inside a single `doc.update()` callback.
- **Reversibility**: object `set` / key `delete`, array `push` /
  `splice` insert+remove, and the array move primitives
  (`moveFront` / `moveAfter` / `moveAfterByIndex`) all produce reverse
  ops. Yorkie `Tree` `editByPath` *merge* is the one known
  non-reversible op — **but Slides does not use `Tree` for text**
  (text bodies and slide notes are plain `Block[]` JSON; see the
  `ensureSlidesRoot` note about the reverted Phase 5a Tree migration).
  Every Slides mutation is therefore a plain object/array op that
  Yorkie can reverse.
- **Collaborative semantics**: undo reverts only the *local client's*
  ops from the last unit, not absolute state. A peer's concurrent edit
  that landed in between is preserved. This is a net improvement over
  the snapshot path's LWW absolute-restore.

## Proposal Details

### The central refactor: one `batch()` = one `doc.update()`

Today every mutator independently calls `this.doc.update(...)`, and
`batch()` only manages a depth counter + snapshot. So a batch of N
mutators (e.g. dragging 3 selected elements, or `addSlide` + N
`addElement` during seeding) becomes N native undo units. To make one
batch one undo unit, the whole batch must run inside a single
`doc.update()`.

We introduce an **ambient root** held for the duration of a top-level
batch, and route every mutator through a `withUpdate` helper instead of
calling `this.doc.update` directly:

```ts
private activeRoot: YorkieSlidesRoot | null = null;
private activePresence: Presence<SlidesPresence> | null = null;

/** Run `fn` against the batch's ambient root if one is open, else open
 *  a standalone doc.update. Every mutator uses this, never doc.update. */
private withUpdate(
  fn: (r: YorkieSlidesRoot, p: Presence<SlidesPresence>) => void,
): void {
  if (this.activeRoot) {
    fn(this.activeRoot, this.activePresence!);
  } else {
    this.doc.update((r, p) => fn(r, p));
  }
}

batch(fn: () => void): void {
  if (this.batchDepth > 0) {
    // Nested batch — already inside the ambient doc.update; just run.
    this.batchDepth++;
    try { fn(); } finally { this.batchDepth--; }
    return;
  }
  this.batchDepth++;
  try {
    // ONE doc.update for the whole batch → ONE native undo unit.
    this.doc.update((r, p) => {
      this.activeRoot = r;
      this.activePresence = p;
      try { fn(); } finally {
        this.activeRoot = null;
        this.activePresence = null;
      }
    });
  } finally {
    this.batchDepth--;
    this.notifyChange();
  }
}
```

Each mutator changes from:

```ts
addSlide(...) {
  this.requireBatch();
  /* pre-compute: getLayout, generateId, resolveMasterAndTheme */
  this.doc.update((r) => { /* mutate r */ });
}
```

to:

```ts
addSlide(...) {
  this.requireBatch();
  /* pre-compute */
  this.withUpdate((r) => { /* mutate r */ });
}
```

Because `requireBatch()` already throws when called outside a batch,
every mutator runs with `activeRoot` set, so `withUpdate` always reuses
the ambient root in practice. The standalone-`doc.update` fallback in
`withUpdate` exists only for defensiveness and for `updatePresence`,
which is intentionally **not** batch-scoped (see below).

#### Reads inside the ambient update

A few mutators compute from the root *before* mutating
(`resolveMasterAndTheme()` calls `this.doc.getRoot()`;
`slideElementsLookup()` reads `s.elements`). After this refactor these
run inside the open ambient `doc.update`. Reading the live root while an
update is open returns the in-progress state, which is what we want.
`resolveMasterAndTheme()` is refactored to read from `activeRoot` when
present (falling back to `this.doc.getRoot()`) so it observes edits made
earlier in the same batch and never crosses a transaction boundary.

**Verification point**: confirm `this.doc.getRoot()` reads issued inside
an open `doc.update` reflect in-progress mutations (covered by the
multi-op batch tests — e.g. `addSlide` then `applyLayout` in one batch).

### Undo / redo / canUndo / canRedo

Mirror Docs (`yorkie-doc-store.ts`), including the **undo floor**:

```ts
private undoFloor = 0;

constructor(doc) {
  this.doc = doc;
  // Everything already in the doc at construction (the ensureSlidesRoot
  // seed + the "new deck opens with one slide" seed) is the initial
  // state. Users must not undo past it.
  this.undoFloor = this.doc.getUndoStackForTest().length;
  /* ...subscribe... */
}

undo(): void {
  if (!this.canUndo()) return;
  this.doc.history.undo();
  this.notifyChange();
}

redo(): void {
  if (!this.canRedo()) return;
  this.doc.history.redo();
  this.notifyChange();
}

canUndo(): boolean {
  return (
    this.doc.history.canUndo() &&
    this.doc.getUndoStackForTest().length > this.undoFloor
  );
}

canRedo(): boolean {
  return this.doc.history.canRedo();
}
```

Unlike Docs (which is cache-backed and only flips a `dirty` flag),
Slides has no read cache; `read()` always walks the live root. So
`undo()`/`redo()` call `notifyChange()` to refresh subscribed views
(thumbnail panel, overlay) after the reverse ops apply, matching what
the snapshot path did.

The undo floor must be captured **after** the deck-seed step. The seed
that opens a new deck with one slide runs through `batch()` (one undo
unit) after construction; whoever owns that seed (the SlidesDetail
wrapper) is responsible for the floor being correct. Today the store is
constructed against an already-seeded doc in tests via
`ensureSlidesRoot`, so capturing the floor in the constructor matches
the Docs store. **Verification point**: a fresh deck cannot be undone
back to zero slides (port a floor test from the Docs suite).

### Presence and selection

- `updatePresence()` stays a standalone `doc.update((_, p) => p.set(...))`
  outside `batch()`; presence is not part of document history. It must
  **not** route through the ambient root (it has no batch), so it keeps
  calling `this.doc.update` directly.
- After undo/redo, the editor's local selection may reference an element
  id that the reverse op removed (undo of `addElement`) or re-created
  (redo). This is identical to the snapshot path and is handled by the
  view layer reconciling selection against `read()` on the
  `notifyChange` tick. No store change required; called out as a smoke-
  test item (undo a delete → selection clears; redo → element returns).

### Removals

Once native parity is green, delete:

- `undoStack`, `redoStack` fields and all reads/writes.
- `replaceRoot()`.
- The reconcile helpers that existed **only** to serve `replaceRoot`:
  `reconcileArrayById`, `reconcileObjectFields`, `updateGroupData`,
  `updateElement`, `updateSlide`, `updateLayout`, and `deepEqual` /
  `clone`-for-snapshot usages that become unreferenced. (`clone`,
  `yorkieToPlain`, `unwrapElement` stay — they serve `read()` and the
  mutators.)
- The per-batch `this.read()` snapshot call in `batch()`.

### MemSlidesStore

Unchanged. It keeps snapshot undo. Both stores satisfy the same
`SlidesStore` interface. The cross-store equivalence test
(`yorkie-slides-equivalence.test.ts` "batch / undo / redo round-trip")
must still pass: for single-client local scenarios, native undo and
snapshot undo produce the same observable `read()`.

## Test Strategy

- **Keep** `yorkie-slides-undo-churn.test.ts` as the regression guard.
  Native undo should also be ~zero churn (reverse ops touch only the
  changed nodes). Re-baseline the asserted `getGarbageLen` deltas if the
  native numbers differ from the reconcile numbers.
- **Keep** `yorkie-slides-store.test.ts` "one batch = one undo entry" —
  this is the headline acceptance test for the grouping refactor.
- **Add** a multi-element-drag grouping test: one batch with N
  `updateElementFrame` calls → exactly one undo reverts all N.
- **Add** an undo-floor test ported from the Docs suite: repeated undo
  cannot drop below the seeded deck.
- **Keep** the theme test "addTheme + applyTheme are batched into one
  undo entry" and the autofit "survives undo/redo" equivalence test.
- `pnpm verify:fast`; manual smoke: multi-element drag undo, undo across
  a concurrent peer edit (two-client), undo/redo of add/remove element
  with selection.

## Risks and Mitigation

- **Reads inside an open `doc.update`** (root reads in
  `resolveMasterAndTheme`, lookups) — mitigated by routing root reads
  through `activeRoot` and covered by multi-op batch tests. If Yorkie
  ever disallows `getRoot()` mid-update, the fallback is to pass the
  ambient root explicitly to those helpers (already the plan for
  `resolveMasterAndTheme`).
- **Churn re-baseline** — native reverse-op deltas may differ from the
  reconcile deltas; update the test thresholds with measured values, not
  guesses, and keep them tight enough to still catch a whole-document
  churn regression.
- **Collaborative semantics change** — undo now reverts only local ops.
  Any test/UX that assumed absolute restore must be re-validated. This
  is the intended improvement, but it is a behavior change.
- **Atomic batch rollback** — one `doc.update` per batch means a throw
  mid-batch now rolls back the *whole* batch, where the old per-mutator
  updates committed mutators 1..k−1 before the throw. This is strictly
  more correct (a half-applied batch was always a latent bug, and the
  old snapshot undo would revert the whole batch anyway), and audited
  batch callers don't depend on partial commits — but it is a behavior
  change worth noting.
- **Nested batches** — a mutator that itself calls `batch()` (or a
  caller nesting batches) must not open a second `doc.update`; the
  `batchDepth > 0` short-circuit handles this. Audit that no mutator
  calls `this.doc.update` directly after the refactor (grep gate).

## References

- PR #388 — interim reconcile fix (kept the snapshot architecture).
- Incident: `second-brain`
  `00_log/incidents/2026/2026-06-20-yorkie-document-oom-node-cascade.md`.
- Reference impls: `docs/yorkie-doc-store.ts` (Docs, with `undoFloor`),
  `spreadsheet/yorkie-store.ts` (Sheets, with `beginBatch`/`endBatch`).
- Yorkie undo mechanism: `docs/design/docs/docs-intent-preserving-edits.md`
  (IME Composition and Undo Granularity).
</content>
</invoke>
