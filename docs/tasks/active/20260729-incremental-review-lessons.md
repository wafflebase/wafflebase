# Lessons: incremental review (script half)

## `= {}` is not a null guard, and a test that only passes `undefined` won't tell you

`resolveReviewMode({...} = {})` threw on `resolveReviewMode(null)`, directly
contradicting the contract written three lines above it — *"a caller passing junk
gets `full`, never a throw"*. A parameter default fires only for `undefined`.

The instructive part is the second half. `renderScopeNote` had the **identical**
bug, and its test was green, because the test passed `undefined` and stopped
there. One bug was caught and one was hidden by the same blind spot in the same
file.

Two habits fall out of this:

- For any function whose contract is "never throws on bad input", sweep the whole
  junk class — `[undefined, null, 0, "", "x", [], true, {}]` — not one
  representative. It is one line and it found the second bug immediately.
- When a test catches a defect, check the sibling functions for it before moving
  on. The fix is cheap; the search is the expensive part, and you have already
  paid for it.

## Prove inertness by executing, not by reading the diff

The central claim of this PR is "with no flags, nothing changes." That is easy to
believe from the diff — the scope note is conditional, the mode defaults to
`full` — and easy to get subtly wrong, because a single unconditional
`parts.push("", scopeNote)` would insert a blank line into every lens prompt on
every PR and quietly invalidate every before/after measurement in the series.

So I extracted `runLens` from `origin/main` *and* from the branch, rendered both
against identical inputs, and diffed the strings. Byte-identical. That took a few
minutes and is the only form of evidence that actually addresses the claim.

Then I made it a test, and mutation-tested it in both fail-open directions —
unconditional push, and defaulting the mode to `incremental`. A one-off script
proves it today; the test keeps it true.

## Allow-list the dangerous value, don't deny-list the safe one

`args["review-mode"] === "incremental" ? "incremental" : "full"` and
`args["review-mode"] === "full" ? "full" : "incremental"` look interchangeable.
They are opposites under failure: a typo, an empty string, or an unset variable
sends the first to `full` and the second to `incremental`.

The rule generalises to every flag that widens risk: **test for the risky value,
default everything else to safe.** The guard now asserts that exact expression,
so the inverted form fails a test rather than shipping.

## Ten reasons beat one boolean

`resolveReviewMode` could have returned `{ mode }`. It returns
`{ mode, sinceSha, reason }` with ten distinct `full` reasons, and the reasons are
checked **correctness-first** so a force-pushed branch reports
`force-push-or-rewrite` rather than the `delta-too-large` that also happened to
fire.

This costs nothing and buys the ability to answer, months later, *why did we
never actually narrow anything?* — a question a boolean cannot answer at all.
Three of the reasons are additions to what the plan sketched, added because
folding `lens-state-divergence` into `lens-state-gap` would have hidden a
genuinely different failure (a lens that missed a round) inside a generic one.

## Say which half is unverifiable, and split there

This PR stops at the script boundary, and the reason is not size. The logic half
is pure, so its entire decision table is a unit test. The wiring half depends on
`external_id` surviving a round trip through the checks API, on
`git merge-base --is-ancestor` against real history, and on a `workflow_run`
context nothing local reproduces — **none of which a local test can touch.**

Splitting at the verifiability boundary means the part that cannot be tested
arrives as a small reviewable diff instead of being buried in a large one. Worth
looking for that seam deliberately on any change that spans pure logic and
infrastructure.
