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

## A depth is the wrong handle on a stack that drops from the bottom

`undoFloor` was a length. `pushUndo` `shift()`s the oldest entry once the
stack hits 50, so a length compared against a length recorded earlier stops
describing the same boundary. Holding the floor entry's *identity* and asking
where it is now (or whether it is gone) survives the drop; a number cannot.
