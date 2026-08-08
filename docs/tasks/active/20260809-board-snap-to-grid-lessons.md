# Board snap to grid — lessons

## A snap that quantizes is not a snap that thresholds

Every snap already in the editor — slide centre, guides, element edges,
equal-size — returns **zero** correction when the pointer has not moved.
That property is load-bearing far from the snap code: `startDrag`'s
`if (liveDx === 0 && liveDy === 0)` guard is the only thing keeping a
select-click out of the undo history, and it works because a zero raw
delta stays zero all the way through the pipeline.

Grid snapping breaks that invariant by design. It rounds, so it returns a
non-zero correction for a zero-length delta — and the guard, written
years earlier against a different assumption, silently stopped holding.
A stray `pointermove` inside a click became a committed move.

**Rule:** when adding a new stage to an existing pipeline, don't only ask
"is my stage correct?" Ask which *properties* of the existing stages the
downstream code depends on, and whether the new stage still has them.
Here the property was "identity on zero input", and it was never written
down anywhere — it lived in a guard three hundred lines away.

The fix reused `SLOW_DOUBLE_CLICK_MAX_DISTANCE_PX`, the threshold the
editor already uses to classify click-vs-drag, rather than introducing a
second one. Two thresholds answering the same question is a bug waiting
for the day they disagree.

## Per-axis discipline has to be carried through, not assumed

`snapDelta` evaluates X and Y independently, and so does `matchSize` —
it emits a separate guide per axis. The first cut of `gridSizedFrame`
collapsed that into one boolean (`guides.length > 0`), so a width that
happened to match a peer's width also disabled grid snapping on the
height.

It typechecked, it passed every test, and it read fine. The tell was
purely structural: a per-axis pipeline had grown a stage that took a
scalar. **When surrounding code is per-axis (or per-field, per-item),
a boolean parameter is a smell even when it produces plausible output.**

## Write the review's blind spot into the plan, not just the code

The plan for this task was good — the decisions table pre-answered most
review questions. Its one gap: it reasoned carefully about what
*snapping* means (which is a semantic question) and never asked which
*gestures* should count as a drag (which is an interaction question).
Both findings the review raised came out of that gap.

**Rule:** for anything that changes what a pointer gesture does, the plan
needs a line about gesture classification — what counts as a click, what
counts as a drag, and what happens at the boundary — even when the
feature seems to be about geometry.

## Docs claims age the moment the code moves

Three doc corrections came out of review, all of the same kind: the text
described the design as intended rather than as built. Smart guides run
*after* `snapDelta` and can pull an axis back off the lattice — the doc
listed only three winners. Alt is sampled per pointer frame, not per
gesture — the doc said "for one gesture" while the JSDoc twelve lines
away said "this gesture frame". Neither is wrong by much, and both would
have misled the next person.

Related: [[board-grid-lessons]] recorded the same shape of finding (an
overstated "no per-frame cost" claim, corrected rather than defended).
