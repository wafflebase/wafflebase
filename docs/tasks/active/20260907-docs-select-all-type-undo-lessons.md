# Lessons — docs select-all-then-type undo (#1045)

## A store seam only helps the paths that call it

`DocStore.batch()` was designed for exactly this failure and shipped months
earlier, but only the named-style and link-run paths adopted it. The editing
paths that write *per block* — the ones that can actually exhaust a 50-entry
undo stack — never did. Adding a seam is half the work; auditing the call
sites that need it is the other half.

## Wrapping the primitive beats wrapping every caller

`deleteSelection()` has ~19 call sites. Batching inside the primitive makes
all of them at most one unit for free; only the handful that write *more*
after the delete (typing, paste, Enter, page break) then need an outer unit,
and nested batches short-circuit. Wrapping 19 call sites by hand would have
been a much larger diff with more places to get the boundary wrong.

## `saveSnapshot()` must stay outside the batch

It looks like part of the edit, and on `MemDocStore` it is. On
`YorkieDocStore` it also flushes the *pre-edit* caret and selection into
presence, which is what Yorkie captures as the reverse of the change's
`addToHistory` set. Inside an open batch `skipNonHistoryPresence()` drops that
write — so batching it would have silently made undo restore the post-edit
caret. The batch must open at `deleteSelection()`, never before it.

The review panel then found the other half of that rule: the ordering is free
on `YorkieDocStore` (its `snapshot()` is a no-op) but not on `MemDocStore`,
where `batch()` took its own checkpoint up front and every batched edit would
have cost a dead Cmd+Z in a slides text box or the demo app. Fixed in the
store rather than in the caller — `MemDocStore.batch()` adopts a checkpoint
holding exactly the current state instead of pushing an identical second one
— because the two stores have to keep one contract, and only the store knows
what its own checkpoints mean.

## Holding a render holds the layout with it

The paint can wait for the batch to commit; `getLayout()` cannot. `render()`
is `recomputeLayout(); paint();`, so swallowing an interior `requestRender()`
also swallows the re-measure, and the rest of the unit keeps reading a
`blockParentMap` from before the delete — which the paste path branches on
(`isInCell` / `getCellInfo`). The fix was to split the seam: a held render
still calls the host's new `requestLayoutRefresh()`. "Keep rendering out of
the batch" is really two rules wearing one name.

## A depth is the wrong handle on a stack that drops from the bottom

`undoFloor` was a length. `pushUndo` `shift()`s the oldest entry once the
stack hits 50, so a length compared against a length recorded earlier stops
describing the same boundary. Holding the floor entry's *identity* and asking
where it is now (or whether it is gone) survives the drop; a number cannot.
