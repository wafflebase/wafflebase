# Lessons — docs list level carries the subtree (#1050)

## What the flat model forces

`listLevel` is a plain integer on the block, so there is no parent pointer to
follow and no way to move "a subtree" as an object. Every writer has to
re-derive the subtree from adjacency at the moment of the gesture. That is why
the fix is a *planning* step rather than a new model field: compute the whole
`block → new level` map from the pre-edit array first, then write. Reading
levels back while writing them would make the second item of a subtree see the
first item's new level and mis-detect its own parent.

## Boundaries have to fail as a unit

The two clamps (`0` and `MAX_LIST_LEVEL`) were per-block before, which is
correct for a flat operation and wrong for a subtree one: clamping one member
of a subtree collapses the depth gap and reproduces exactly the bug being
fixed. Refusing the whole subtree keeps a single invariant ("relative depth is
preserved, or nothing moves") instead of two competing ones.

The pre-existing "Tab clamps at 8" test still passes unchanged, because a run
of *equal*-level items are siblings, not children — so per-item clamping and
per-subtree refusal agree whenever no nesting exists.

## Four call sites, one rule

The same six handlers duplicate this logic across `text-editor.ts`,
`editor.ts` and `text-box-editor.ts` (the last is what Slides and Board mount).
Threading `siblings` through each `forEachBlockInSelection` was the cheap part;
the value is that the rule itself now lives in one pure function with tests,
so the next list gesture added to any of the three editors inherits it.

## Not verified

The issue asked for the behavior to be confirmed by hand against Word and
Google Docs. This run is headless with no access to either, so the rule above
is a recorded decision derived from the model's constraints, not a measurement.
