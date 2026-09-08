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

## Two lookups for one table

`normalizeRange()` found its table with `layout.blocks.find(...)`, while
`buildCellRangeRects()` — the very next function — used
`resolveNestedTableLayout()`. A nested table only exists in
`blockParentMap`, so the first lookup missed it and the read-time merge
expansion became a no-op there. When two neighbours resolve the same thing
two ways, the weaker one is a latent bug; unify on the one that already
handles the general case.
