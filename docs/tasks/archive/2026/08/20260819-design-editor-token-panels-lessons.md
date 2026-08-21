# Lessons — token panels (PR 12a)

## A gate change that is never committed is not a gate change

`verify:frame` gained five staging checks, ran 34/34, and was revert-proved — then the
commit that followed staged only `docs/` and `packages/design-sandbox`. The checks existed
in the working tree for about an hour and were gone. The count dropping from 34 to 29 on the
next run is the only reason it was noticed. `git add -A <path>` with a narrow path is the
hazard; the check is to read `git show --stat` against what the work actually touched.

## The type was the bug, twice

Two of the three defects here were places where a type DESCRIBED the wire wrongly and
therefore hid fields the server was already sending (`located`/`reason`/`label`/`file`) or
made two different failures identical (`status`). Neither was a logic error, and neither
would have been found by reading the code that produced them — only by writing a caller that
needed the missing information.

## Two guards, and say which one the test proves

The render loop is stopped by a memo AND an equality check, either of which suffices. The
regression test therefore only fails when both are removed. That is defence in depth on a
failure whose symptom is a dead tab, and the test says so — claiming the test proves each
guard would have been false.

## Dropping a feature means handling what depended on it

`PreviewPane` going away left two live call sites: `ComponentList`'s "has a live preview"
icon and the review modal's before/after cells. Left alone they would have become a marker
for a capability nothing has, and two empty boxes. Both needed a decision of their own — one
icon, and the class strings — which is the part of a "just drop it" that is not free.

## `echo "tsc ok"` after a pipe reports nothing

Three times now a verification step read

    pnpm exec tsc --noEmit 2>&1 | grep -v WARN | head -3; echo "tsc ok"

which prints "tsc ok" whatever happened. It hid a real `design-sandbox` typecheck failure
introduced in 11c for two PRs, and I asserted the branch was clean while it was not. The
form that actually reports is

    pnpm exec tsc --noEmit >/dev/null 2>&1 && echo ✅ || echo ❌

Same class as the gate change that was never committed: the check that would have caught it
is cheap, and the failure mode is a confident false statement rather than a visible error.

## A narrow `git add` path has now dropped three things

`git add -A packages/...` left behind, in order: five `verify:frame` staging checks, the
`pnpm-lock.yaml` entries `design-sandbox` needs to install at all, and a typecheck fix that
belonged in the PR whose test it fixed. Each was invisible until something downstream
disagreed — a check count, a fresh install, a per-branch typecheck.

The rule this earns: after committing, verify each branch in the stack **independently** —
`tsc` and tests per branch, not once at the tip. A stack where only the tip is green is a
stack of PRs that fail CI one at a time.
