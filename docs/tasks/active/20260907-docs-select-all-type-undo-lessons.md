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

## Making a fact live invalidates every reader that captured it

Re-resolving the share link on an interval turned `role` from a load-time
fact into a live one. `docs-view` was updated with it, but `readOnly` is read
at mount by five editors, and two of them — `slides-view` and `notes-view` —
still captured it once. `slides-view` even carried a comment asserting the
very assumption the change removed ("fixed for the lifetime of the route"),
so the next reader would have been told the opposite of the truth. Round 9's
Correctness and Design-fit lenses both landed on it; both were CONFIRMED and
both are one fix: list `readOnlyMount` / `readOnly` in the mount-effect deps
(the pattern `docs-view`, `board-view` and `sheet-view` already use) and
rewrite the stale comment. Covered by
`src/app/slides/slides-view-readonly.test.tsx` and
`src/app/notes/notes-view-readonly.test.tsx`, which mount each view over a
local Yorkie document with the engine's `initialize` spied on, and assert
both directions: a `false → true` flip rebuilds, an unrelated prop change
does not.

Widening a value's lifetime is not a local edit. The audit is "who reads
this, and when do they read it" — one grep per consumer, not one per caller
of the thing that changed.

Deliberately left undone, and why: mobile slides already reacts (it takes
`mode`, listed in its own deps), and the owning routes never pass `readOnly`
at all, so only the `/shared/:token` mounts change behavior. `YorkieNoteStore`
has no `dispose()`, so a notes rebuild leaves the constructor's `doc.subscribe`
attached — unlike the docs store's, that handler only snapshots a selection
onto the discarded store and drives no editor, so it is inert rather than
harmful. Adding a store API plus its tests for a bounded, once-per-downgrade
leak belongs to its own change, not to this one. The round's other two
blocking entries were `[POOL_EXHAUSTED]` infrastructure failures, not
findings; the non-blocking suggestions (sharing.md revalidation contract, the
undisposed store in the import path, polling after the error page, tests for
the revalidation query) were left alone to stop this PR growing further.
