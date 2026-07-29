# Lessons: incremental review (wiring)

## A guard that watches syntax is not a guard

The write rule — only a lens that produced a verdict may stamp a last-reviewed
pointer — started as a convention across three `panel.push` sites, with the pointer
spread into one of them and a test that scanned `review-panel.mjs` for which push
carried the field.

I mutation-tested it. Removing the pointer failed the test, so it looked real. Then
I tried the mutation in the *dangerous* direction — attaching the pointer to the
fail-closed entry as well — and **the test passed**, because the mutation used
`entry.reviewState = ...` instead of a property inside the object literal the regex
matched. The guard was watching the syntax I happened to write.

The fix was not a better regex. It was `panelEntry`, a function that decides, so
every call site can pass `reviewState` unconditionally and the rule still holds.
Now the rule is executable: the test feeds it a crashed lens and asserts no pointer
comes back, and both remaining mutations (dropping the `valid` check, bypassing the
function) fail.

**Mutation-test in the direction of the failure you fear, not the direction that is
easy to write.** Deleting a guard is the easy mutation and it proves almost
nothing; the mutation worth running is the one an author would plausibly make while
adding a feature. And when a rule is enforced by convention at N call sites, the
answer is usually one function, not N assertions.

## When inputs are circular, make the two phases explicit

`resolveReviewMode` takes git facts as arguments — that purity is what makes its
decision table testable. But the facts have to describe `since..head`, and `since`
comes out of the pointers, so a caller cannot gather its inputs in one pass. My
first version of the caller would have had to re-derive the agreed sha itself,
duplicating logic the pure module already had.

Exporting `agreedReviewedSha` and having `resolveReviewMode` call it internally
fixed both halves: the caller learns the range from the same code that will later
decide on it, so the two cannot disagree.

**A documented caller contract that the caller cannot mechanically satisfy is a
latent bug.** If the contract says "measure X over range R", export whatever
computes R. And the test for it should capture what the dependency actually
received — here, the git argv — because the pure function is *handed* the facts and
by construction cannot notice they describe the wrong range.

## Put the flag and the artifact in the same step

The narrowed diff and the `--review-mode` flag that tells the lens it is narrowed
are written by one workflow step. That is not tidiness. `review-panel.mjs` receives
a *file*: it cannot tell a narrowed diff from a full one, so nothing downstream can
catch a disagreement between them. The only defence is to make disagreement
structurally impossible, and two values from one step is how.

The corollary is a fail-direction split I got wrong first time. I put
`continue-on-error: true` on both the scope step and the narrowing step, reasoning
"a cost optimiser must never block a PR." True for the step that only *computes* —
but the narrowing step *mutates* the reviewed artifact, and tolerating a failure
between `mv` and the output write would ship exactly the fragment-reviewed-as-whole
outcome the design exists to prevent.

**Ask what a step leaves behind when it dies half-done.** A step that computes can
fail soft; a step that mutates the thing a gate reads cannot.

## `continue-on-error` is not the same as "the script handles its own errors"

I wrote a comment arguing the scope step needed no `continue-on-error` because the
script resolves every failure to `full` internally. That was wrong in a way worth
remembering: `main().catch(...)` cannot catch an **import-time** failure. A bad
module path or a missing node crashes before any of that logic runs.

So the reasoning has to be about the *step*, not the script: what does the runner do
if this process exits non-zero for a reason the process never saw? Here that meant
`continue-on-error: true` after all, on the step whose failure is affordable.

## Test the shell-out against the real thing at least once

`gitFacts` is fully covered by a stubbed runner, and every branch passes. That
proves the *logic*, and nothing about the *argv*. A misspelled flag or a wrong range
syntax makes every fact `null`, which resolves to `full` — a silent, permanent
no-op that looks exactly like a feature working conservatively.

Running it against real history took one command and confirmed all four shapes
(`--is-ancestor` both ways, a nonexistent sha, `--numstat` summing). Same for
`review-scope.mjs` end-to-end against the real API: it proved the `--slurp`
pagination parses, which is the contract this series has now broken twice.

**For anything that shells out or calls an API, stubs test the branches and one real
run tests the call.** Both, not either.
