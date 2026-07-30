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

## A one-off proof is not a test, and a regex over source is not a proof

The claim was "with no flags, every lens prompt is byte-identical." I proved it
properly — extracted `runLens` from `origin/main` and from the branch, rendered
both, diffed the strings — and then shipped, as the *test*, a `readFileSync` plus
two regexes over `review-panel.mjs`. The review panel caught exactly that: the
proof ran once and evaporated, and what remained could not observe the property.
Any other edit to the prompt assembly changes the rendered string while both
regexes still match.

The fix was to export the assembly (`buildLensPrompt`) so the test renders it, and
to pin the exact expected string. That also closed three other findings for free —
"nothing asserts the scope note reaches the prompt", "nothing asserts it lands
before the diff", and the untested fail-closed throw — because all three became
executable at the same moment.

**If a property is about a value, the test has to produce the value.** When that
means exporting something whose only caller is internal, export it and say in the
docblock that testability is the reason. A source-text assertion is a last resort
for plumbing that genuinely cannot be executed, and it should be narrowed to the
plumbing.

## When you replace code, the defensive details ARE the payload

`prior-findings.mjs` reimplemented ~40 lines of inline `github-script` and dropped
two precautions the original had:

- the `commits/{sha}/check-runs` **list response omits or truncates
  `output.text`**, so the original re-fetched each run by id;
- that endpoint is object-wrapped, so `--paginate` without `--slurp` yields
  invalid JSON.

Both were *already documented in this repository*, in `review-round-guard.mjs`,
which had hit each one and left a comment saying so. I read the inline code for
what it computed and treated the extra call and the odd flag as incidental. Each
omission silently reduces carry-forward to zero findings — indistinguishable from a
clean round, and it disables the cross-round re-check that exists to stop an
unfixed blocker vanishing from the gate (#521).

**Reading a rewrite target for its output is not enough — read it for why each
call is shaped the way it is.** An API call with an unexplained extra step is the
most likely thing in the file to be load-bearing, because nobody writes those for
fun. When the answer isn't in the code, `git log -S` on the odd flag usually has
it.

## Verify claims about the code you are replacing, not just your own

I wrote — in a docstring, the commit message, and the PR body — that the inline
version "wrapped the whole loop in one `try`, so one lens's malformed JSON zeroed
the other four." It does not. It has a `try` per lens, inside the loop. I had
invented a defect to justify an extraction that was already justified on other
grounds (testable, un-duplicated, lintable).

A false claim about the prior art is worse than no claim: it is the sentence a
future reader trusts when deciding whether the old approach can be returned to.
**Quote the code you are characterising, or don't characterise it.**

## The same bug twice in one series, in a new function

`.filter((l) => l !== "")` deleted every deliberate blank line from
`renderScopeNote` — the identical mistake that collapsed the verifier prompt
earlier in this series, and the fix is the same `null` sentinel. It survived
because every assertion on the note was a substring match, and substrings cannot
see layout: the heading ran into the paragraph and the closing line became a lazy
continuation of the last bullet, with all assertions green.

Two takeaways. A model-facing string is a rendered artifact, so **assert its
rendered shape** (first line, blank lines, last line), not just that the words
appear. And a bug already fixed once in a series is a *pattern to grep for*, not a
closed ticket — `.filter((l) => l !== "")` across the directory would have found
this before the reviewer did.

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
