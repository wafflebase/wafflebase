# Lessons: blast-radius lens

## Redundancy across samples is not redundancy across evidence

The panel had two false-negative defences and both were the same defence.
Sampling runs a lens twice on one diff; cross-round re-check re-verifies findings
already raised. Run either a hundred times and a defect outside the diff stays
invisible, because neither changes *what is being read*.

This is the same lesson the independent verifier taught one PR earlier — a second
reader of the same evidence inherits the first reader's blind spot. Worth
applying as a general check on any "we review it twice" claim: **twice with what
input?** If the answer is "the same one", the second pass buys stability, not
coverage.

## Specify a lens by procedure when the scope is the whole repository

"Consider wider impact" is unfalsifiable advice — a reviewer can satisfy it by
thinking hard and reporting nothing, which is precisely the failure the
coverage-first rubrics were written to fix.

So `blast-radius.md` leads with steps: find what the interface change looks like
to a caller, `Grep` for every other reference, judge each, cite by `file:line`.
And it states the completion condition bluntly — *"If you finish without running
`Grep`, you have not done this review."* A procedure can be observed to have not
happened; an attitude cannot.

The mirror of that is bounding the lane just as hard. A lens whose scope is "the
whole repo" will drift into re-reviewing the diff unless told not to, and then it
is a fifth general reviewer doubling cost and noise for nothing. The rubric
carries an explicit test for the boundary: *a finding you can state without
leaving the diff belongs to another lens.*

## Adding one row to a manifest is how you find out what the manifest doesn't drive

Every consumer of the lens list derived it from `lenses.json` — except one. The
ready gate's `DEFAULT_REVIEW_CHECKS` was five hardcoded strings in
`mark-ready.mjs`, and it could not be tested there, because that file is a CLI
with a top-level `process.exit` and cannot be imported at all.

Untestable and hand-maintained is the combination that rots. Moving it to
`checks.mjs` — a module that already existed for "pure check-run gate logic,
shared by mark-ready.mjs and its tests" — cost five lines and converted a silent
drift into a red test. The existing module was the tell: someone had already
solved this shape once and the constant just hadn't followed.

General pattern: when adding an item to a data-driven set, grep for the set's
members as literals. Whatever comes back is the part that isn't data-driven.

## A guard from last week caught this week's change

`review-panel.test.mjs`'s rubric guard asserts the rubric set equals the
manifest's lens ids. Adding the lens to `lenses.json` turned the suite red
immediately, before any new test existed — with a message naming exactly the
missing rubric.

That assertion was written speculatively one PR ago ("so a fifth lens cannot ship
with a clamp unnoticed") and paid off on the very next PR. It also enforced
something stronger than intended: the new rubric could not be merged until it was
*coverage-first*, so the fifth lens inherited PR 5's discipline mechanically
rather than by my remembering to apply it.

Cheap invariants asserted against real artifacts keep paying. Note the shape that
made it work — it did not check "the four rubrics we know about", it checked "the
rubrics equal the manifest", which is the version that has something to say about
inputs nobody anticipated.

## Stale comments are findings this lens would report

Two comments were made wrong by this change: `agent-review-panel.yml`'s "re-read
by 4 lenses", and `mark-ready.mjs`'s claim that an empty required-check set was
unreachable "because every lens is `**`-scoped" — already false since #564 added
path globs, and now doubly so.

Both are exactly what `blast-radius` is meant to flag: a consumer of a changed
contract left describing the old one. Writing the lens and then finding two
instances of its own bug class in the same commit is a good sign about the lane —
and the fix for the second one was to name the invariant that actually holds
(correctness and security are still blocking at `**`, asserted in a test) rather
than to restate a count that will rot again.
