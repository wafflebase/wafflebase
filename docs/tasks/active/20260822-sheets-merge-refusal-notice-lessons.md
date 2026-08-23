# Lessons — sheets merge refusal notice (#935)

- **A refusal is a feature, not an absence.** #927 made `moveRangeTo` reject
  merge-corrupting drops, which was correct — but a model that returns early
  without telling anyone reads to the user as a broken gesture. When a
  pre-flight check is added to a mutation, the reason it fired needs a way out
  of the model in the same change, or the fix trades corruption for confusion.

- **One reason code, three call sites.** The three refusals (`moveRangeTo`'s
  source-split and dest-partial, `autofill`'s merge block) share a single
  `RangeOpRefusal` union and one `setOnRefusal` hook rather than three return
  types. That kept `autofill`'s `Promise<boolean>` contract (and its twelve
  existing call sites in tests) untouched, and put the user-facing copy in the
  view where the other message copy already lives.

- **`consumeSpillBlocker()` is a contract, not a detail.** `setData` and
  `removeData` both call it when they clear a cell; `moveRangeTo` did not, and
  the divergence was invisible until someone traced a `#REF!` that refused to
  recover. Worth grepping every clearing path when a model-wide contract like
  this is introduced — review found the same omission in cut-`paste`,
  `mergeSelection`, and `autofill`, i.e. every sibling gesture that erases a
  cell. Fixing one call site of a contract and not the rest just relocates the
  bug; the durable answer was one `recalculateWithUnblocked` helper the five
  paths share, so the next clearing path has something to call.

- **Re-queuing the anchor is not enough — its readers matter too.** The first
  cut added the unblocked anchor to the dependants map *after*
  `buildDependantsMap` had run, with an empty dependants set, so the anchor
  re-evaluated but the formulas reading it kept the stale `#REF!`. The anchor
  has to join the changed set before the map is built.

- **Spill ghosts are derived, so they must not travel.** `moveRangeTo` copied
  whatever `fetchGrid` returned, ghosts included, which planted cells naming an
  anchor sref that no longer spilled there and left the originals behind at the
  source (the clear loop skips anything with a `spillAnchor`). Derived cells
  belong to their anchor's lifecycle: drop them and let the anchor re-create
  them where it lands.

- **"Never travel" has a destination half.** Skipping ghosts in the moved grid
  fixed the phantom copies, but `setGrid` only writes the keys it is given —
  so the destination offsets those ghosts used to overwrite silently kept
  whatever sat there, inside the rectangle the user just "moved". Removing a
  write is also removing a clear; the same held for cut-`paste`, which the
  first pass fixed only for `moveRangeTo`.

- **Unblocking a spill into a merge is worse than leaving it blocked.**
  `mergeSelection` erasing a blocker looked like every other clearing path,
  but `setCell` resolves a covered ref onto the merge anchor, so the freed
  anchor's ghosts would have overwritten the merge anchor one after another —
  and its own cleanup, reading through the same resolution, could never undo
  it. The fix belongs in the blocking rule (`findSpillBlocker` treats a merged
  block as a blocker), not in the gesture: then merging *re-blocks* in the
  erased data's place and `unmergeSelection` releases it.

- **A map that is a side effect of calculation needs a derivation.**
  `spillBlockers` only ever existed because the calculator wrote it, so
  `undo`/`redo` — which replace cell data and recalculate nothing — and simply
  opening a document both started with it empty while `spillBlocked` anchors
  sat in the store. `loadSpillBlockers` re-derives it from those anchors, which
  is only possible because the footprint (`spillRows`/`spillCols`) is
  persisted. Any in-memory index that no load path rebuilds is a latent bug.

- **The pre-commit hook runs the whole `verify:fast` lane.** In a fresh
  checkout without built workspace dependencies, packages like
  `@wafflebase/slides` fail `typecheck` on missing `@wafflebase/docs` types,
  which blocks the commit for reasons unrelated to the diff. Building the deps
  first (`pnpm core build`, etc.) or letting CI be the gate are the options;
  either way the failure is not necessarily yours.
