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
