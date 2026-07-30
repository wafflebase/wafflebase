# Lessons — Detect stalled review rounds

## The obvious signal was the wrong signal

The intuitive design is "page when consecutive rounds raise the same findings."
That fires on healthy PRs, because `review-panel.mjs` **deliberately** re-merges
every unresolved prior finding into the current round — the cross-round re-check
that exists to stop a real bug vanishing when a later pass misses it. High
overlap is therefore the designed steady state, not an anomaly.

The discriminating signal is overlap **plus a blocking count that did not fall**.
Worth noting because the same trap will recur: any future metric over rounds has
to account for carry-forward inflating round-to-round similarity by
construction.

## Two thresholds I guessed wrong, caught by measuring

Both defaults in the plan were invented, and both were wrong. Writing tests
against *real* data rather than synthetic fixtures is what exposed them.

**Jaccard at 0.6.** PR #564's design-fit lens emitted four verbatim rephrasings
of one defect. They score 0.19–0.52 pairwise under Jaccard — so the shipped
threshold would have matched **none of them**, and the feature would have been
dead code that always reported "progressing." Measuring three metrics against
those four real strings plus four real unrelated findings gave:

| metric | same defect | different defect |
|---|---|---|
| jaccard | 0.19 – 0.52 | 0.00 – 0.04 |
| dice | 0.32 – 0.68 | 0.00 – 0.09 |
| overlap | 0.39 – 0.71 | 0.00 – 0.08 |

Overlap (containment) both separates widest and is semantically right: the panel
restates one defect at different levels of detail, and Jaccard punishes the
longer wording for carrying more specifics. Threshold 0.3.

**Greedy one-to-one matching.** Intended to stop two identical findings both
claiming one prior and inflating the ratio. But #564's real shape was *2 priors
becoming 4 rephrasings*, which one-to-one scores 0.5 — under-reporting exactly
when the loop is most visibly stuck. Many-to-one is the honest answer to "how
much of this round is recycled", and the count test already covers the inflation
risk.

Generalisable: when a heuristic has a tunable constant, calibrate it against
production artifacts before shipping. Both errors were invisible to code review
and obvious after one measurement.

## Absent is not empty

`groupReviewRounds` treats a lens whose check run has **no** `output.text` as
`partial`, not as "found nothing". A clean lens legitimately persists `"[]"`, so
conflating absent with empty would let an unreadable round look like a clean one
— and a clean round breaks a stall run, which is a fail-*open* toward burning
more rounds. The same distinction bit the panel before, in the 60k trim loop
that must never slice serialized JSON.

## Verify a CLI by running it, not by reading it

`review-round-guard.mjs` shells out to `gh`, so it has no unit tests and the
pure helpers cannot cover the wiring. A ~20-line `gh` stub on `PATH` plus
`STUB_DATA`/`GITHUB_OUTPUT` env made the whole script exercisable end-to-end,
and caught things inspection would not have: that the back-fill actually fires,
and — more importantly — that when the back-fill *fails* the rounds degrade to
partial and the guard correctly does **not** page.

Cheap enough that the same stub pattern is worth reusing for `mark-ready.mjs`
and `metrics.mjs`, which are equally untested at the CLI layer.

## Check what merged before starting

Main moved twice more while the plan sat (PR #566, PR #568). #568 added
`detectFlips`, close enough in name to be worth checking for duplication —
it reads severity *counts* from the ledger to spot blocking → clean, whereas
this reads finding *text* from check runs to spot non-convergence. Complementary,
no overlap. But the check took a minute and the earlier #565 collision cost half
a PR's work, so it stays a standing step.
