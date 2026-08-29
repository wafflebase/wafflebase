# Docs `DocStore.batch()` seam

Add the `batch()` seam the docs store is missing, and use it to close the
named-style double-undo.

## Problem

`YorkieDocStore.snapshot()` is a no-op — Yorkie takes its undo units from
`doc.update()`, one per call. So any editor action that has to make **two**
store writes costs **two** Cmd+Z, the first of which looks like it did
nothing.

The named-style redefinition path is exactly that shape
(`packages/docs/src/view/editor.ts`):

```ts
updateStyleToMatch(styleId) {
  docStore.snapshot();
  docStore.updateStyleDefinition(styleId, def);   // write 1 → undo unit 1
  afterNamedStyleChange();                        // → doc.dropStaleStyleOffAll()
}                                                 //   → store.applyStyles()
                                                  //   → write 2 → undo unit 2
```

Both writes are individually batched (`writeStylesAndRematerialize` is one
`doc.update`, `applyStyles` is one `doc.update`), but nothing can fold the
two into each other. `docs-font-controls.md` names the missing piece:

> Folding them needs a `DocStore.batch()` seam that does not exist yet —
> the slides store has one.

The same missing seam is why `Doc.mergeBlocks` and the block-split path
knowingly skip the stale-flag sweep.

## Precedent

`docs/design/slides/slides-native-undo.md`. `YorkieSlidesStore.batch()`
opens **one** `doc.update` and parks the live root in `activeRoot`; every
mutator goes through `withUpdate`, which reuses the ambient root instead of
opening its own update. One batch = one Yorkie change = one `doc.history`
entry. Nested `batch()` calls short-circuit on a depth counter so they never
open a second update.

Copy that architecture. Do not invent a second one.

## Plan

- [x] Read `slides-native-undo.md`, `docs-font-controls.md`,
      `docs-collaboration.md`, `docs-intent-preserving-edits.md`.
- [x] Confirm the Yorkie SDK semantics the seam depends on (0.7.17):
      - `Document.update()` sets `isUpdating` and builds its change from a
        single `ChangeContext` — a nested `update()` would push a second
        change while the outer one is still open, splitting the undo unit
        and clearing `isUpdating` early. So **every** mutator must route
        through `withUpdate`.
      - `Document.getRoot()` calls `ensureClone()` and builds a fresh
        context over the *same* `clone.root` the open update is mutating,
        so reads inside a batch observe in-progress writes. Writes through
        it would be dropped — the store only reads there.
      - `doc.history.canUndo()` is false while `isUpdating`, so
        `undo()`/`redo()` called inside a batch are already safe no-ops.
- [x] Write the failing tests first.
- [x] `DocStore.batch(fn)` on the interface.
- [x] `MemDocStore.batch()` — collapse the `snapshot()` calls inside a batch
      into one undo checkpoint (Mem's undo unit is the snapshot, not the
      write).
- [x] `YorkieDocStore.batch()` — ambient root + `withUpdate`, every
      `this.doc.update(` call site routed through it.
- [x] Wrap the four named-style entry points in `editor.ts` in `batch()`.
- [x] Update `docs-font-controls.md`, `docs-collaboration.md`,
      `docs-intent-preserving-edits.md`.
- [x] `pnpm verify:fast` green.

## Tests

| Test | File |
| --- | --- |
| `updateStyleToMatch` that strands a style-off flag is **one** undo unit | `packages/frontend/tests/app/docs/editor-undo-selection.test.ts` |
| one `editor.undo()` restores both the registry and the flag | same |
| two separate named-style actions stay two undo units | same |
| one batch = one undo unit however many store writes | `packages/frontend/tests/app/docs/yorkie-doc-store.test.ts` |
| a nested batch does not open a second undo unit | same |
| one undo reverts every write in the batch | same |
| **boundary**: unbatched consecutive writes stay separate undo units | same |
| **boundary**: two typing bursts in two batches stay two undo units | same |
| presence written inside a batch adds no extra undo unit | same |
| an empty batch pushes no undo unit | same |
| Mem: a batch collapses its snapshots into one undo unit | `packages/docs/test/store/memory.test.ts` |
| Mem: nested batch adds no second unit; unbatched stays separate | same |

The first one is the acceptance criterion: it fails on `main`
(`docStore.batch is not a function`) and passes on this branch.

## Non-goals

Deliberately **not** in this change — each is its own task, now unblocked:

- The stale-flag sweep on block merge (`Doc.mergeBlocks`).
- The stale-flag sweep on block split.
- The five `{ skip: KNOWN_BUG }` CRDT convergence tests in
  `yorkie-doc-store-concurrent.integration.ts`.
- A churn regression guard of the kind slides has
  (`yorkie-slides-undo-churn.test.ts`). Docs has none, and adding the
  measurement harness is out of scope; the two boundary tests above pin the
  one risk this change introduces (over-collapsing separate user actions).

## Review

Shipped as designed. Notes:

- The Yorkie refactor touched **30** `this.doc.update(` call sites. All of
  them now go through `withUpdate`, including the two presence-only writes
  (`publishResolvedLocalCursor`, `updateCursorPos`) — a presence write that
  fired synchronously inside an open batch would otherwise nest an update.
  Presence `set` is not part of the document change, so folding it in does
  not pollute the batch's undo unit.
- `batch()` is **additive**: nothing outside the four named-style entry
  points calls it, so every other editing path keeps exactly the undo
  granularity it had. That is what makes the churn risk small enough to pin
  with two boundary tests instead of a measurement harness.
- `MemDocStore` and `YorkieDocStore` reach "one batch = one undo unit" by
  different mechanisms (suppressing repeat `snapshot()` calls vs. a single
  `doc.update`), because their undo units are anchored to different things.
  The interface documents the contract, not the mechanism.
