# Lessons — table drag selection across a colspan merge (#1049)

## Reproduce before believing a root cause

The issue offered two candidates. Both were wrong for the reported table:
driving the four gestures through real `mousedown`/`mousemove`/`mouseup`
events against a top-level table produced the correct highlight every time.
The cheapest way to establish that was a jsdom harness modelled on
`link-snap-pointer.test.ts` — a canvas spy that records every `fillRect`
together with the `fillStyle` at call time, so the assertion is literally
"which pixels were painted in the selection colour", not "what does the
selection object contain".

## A sweep is cheaper than another theory

The second pass started by re-arguing the two candidates from the issue on
paper. That produced nothing; what settled it was making the fixture's merge
position an environment variable and running the same eight gestures over
four merge shapes in about a minute. A harness that is already driving real
events is worth parameterizing before it is worth reasoning about — the
sweep either finds the shape that breaks, or it converts "it does not
reproduce" from one sample into a statement about the whole family.

## Two lookups for one table

`normalizeRange()` found its table with `layout.blocks.find(...)`, while
`buildCellRangeRects()` — the very next function — used
`resolveNestedTableLayout()`. A nested table only exists in
`blockParentMap`, so the first lookup missed it and the read-time merge
expansion became a no-op there. When two neighbours resolve the same thing
two ways, the weaker one is a latent bug; unify on the one that already
handles the general case.

## A cap is a property of the write site, not of the writer

The first nesting cap gave `buildBlockNode` a `depth = 0` default, which read
as "callers who do not care start at the top". Every incremental writer in the
store — `updateBlock`, `insertBlockAfter`, the paste batch, the row/cell
writers — *is* such a caller, and each of them edits at a tree path that may
sit inside thirty tables. The default silently reset the counter at exactly
the sites where it mattered, leaving the cap binding whole-document writes
alone. Making `depth` required, and deriving it from the path each writer
already holds, is what turned it into an invariant. The signature change also
surfaced three call sites that had never been updated — invisible because the
frontend runs no `tsc` in CI.

## A budget on a shared helper inherits the wrong failure mode

`expandCellRangeForMerges` was bounded so a hostile presence rectangle could
not hang the paint loop. But the same function decides the rectangle
`mergeCells` writes, and there a partially-expanded rectangle is not a short
paint — it merges through the middle of an existing merge and replicates that.
The budget belonged to the *call*, not the function: exact by default, bounded
only by the one caller that paints.

## Test the write, not the round-trip

Three of the new store tests passed against a deliberately broken writer,
because both ways of reading back — the writing store's cache and a fresh
store's reader — hide the defect. The cache holds the model that was handed
in; the fresh read applies the *read* cap, which truncates a too-deep table
however it was written. Only the raw Yorkie tree distinguishes "written with
no rows" from "written with rows and hidden on the way back". When a fix is
about what reaches the CRDT, assert against the CRDT.
