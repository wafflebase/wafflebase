# Lessons — docs link text follow + partial-link snap (#1038)

## Ordering the two parts is load-bearing

Part B expands a selection at store time. If it expanded a *collapsed*
caret it would make `selection.hasSelection()` true, and `insertLink`
gates its edit-in-place branch on exactly that — so Part B would have
silently disabled Part A's fix (and newly enabled "Add comment" where it
is currently refused, and flipped ⌘B's decision rule from caret style to
range style). One `anchor === focus` check removes all three, which is
why it has its own test rather than being an implementation detail.

## `findLinkRunAt` is edge-inclusive on purpose, and that is the wrong
## test for a selection endpoint

An offset exactly at `run.end` counts as "inside" the run — right for a
caret (the popover must open when you click just past the link), wrong for
a selection endpoint, where it would swallow a link the selection merely
abuts with zero of its characters selected. Part B therefore adds a
strictly-interior test on top of `findLinkRunAt` rather than reusing it.

## The raw mousedown anchor has to survive the snap

`updateDragSelection` re-reads the *stored* anchor every mousemove. Writing
the snapped anchor back makes the snap a one-way ratchet: dragging back out
of the link cannot un-snap, and the anchor's correct snap direction (toward
`run.start` when the focus is to its right, `run.end` when to its left)
depends on where the focus is *now*, so it cannot be recomputed from an
already-snapped value. `Selection.rawAnchor` keeps the original.

## Ordering endpoints without layout

`expandRangeForLinks` needs to know which endpoint is the start, because
the start grows left and the end grows right. `normalizeRange` answers that
but needs a `DocumentLayout`, which would make the helper untestable as a
pure function and drag a large module into a small one. `doc.getBlockIndex`
covers the same-context multi-block case; an endpoint pair it cannot order
(header/footer, or cell blocks across two blocks) returns the range
unchanged. Declining to snap is the safe failure — a wrong-direction
expansion would *shrink* the selection, dropping selected characters.

## Inserting the replacement text at the trailing edge, not the leading one

`resolveOffset` resolves `link.end` into the link's own last inline
(`remaining <= len`), so text inserted there inherits the run's style —
including the href written a moment earlier. Inserting at `link.start`
would instead inherit whatever precedes the link. Insert first, delete
the old extent second, and the offsets stay simple arithmetic.
