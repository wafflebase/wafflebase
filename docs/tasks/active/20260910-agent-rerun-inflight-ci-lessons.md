# Lessons — `@claude rerun` is a no-op while CI is in flight

## A correct selection inside a step that stops when it is empty

`ciRunToRerun` was right, unit-tested, and pinned against two inline copies. The
bug was one level up: the step called it, got `null`, wrote `reran = false`, and
said something reassuring. Every test in the repo agreed the *rule* was correct,
and no test asked what the step did when the rule selected nothing.

The general shape: **a pure function's tests do not cover its caller's empty
branch.** When a selection can legitimately return nothing, the "nothing" arm is
a behaviour with its own consequences, and it needs its own scenario — here,
extracting the whole step from the YAML and driving it against stubs
(`scripts/agent/rerun-arms.test.mjs`).

## Three correct mechanisms can compose into a dead zone

Nothing here was individually wrong:

- refusing a `completed` event on attempt 1 keeps one panel per CI run,
- refusing a panel round on a paged PR stops ~$12 of unread review,
- refusing to `reRunWorkflow` an in-flight run avoids a guaranteed 422.

The dead zone is the intersection, and no single file contains it. Reviewing any
one of the three in isolation would approve it. When a pipeline stalls, the
question worth asking first is not "which component is wrong" but "which two
correct refusals meet here".

## Diagnose the verb by what it *reported*, not by what it is for

The comment said "Rerun engaged" and dropped the label successfully, so the verb
read as working. The single load-bearing clause was the one nobody parses:
*"No CI run to re-run — the panel will engage on the next CI run."* That sentence
is false whenever CI for the head has already been created, which is the common
case, and it was the whole diagnosis.

Repo-specific corollary already learned twice (#632, #648, and again here): **a
summary must report what happened, not what was attempted.** The loop-status note
in the same workflow still said "CI re-running" unconditionally; it now reads
`reran`.

## Where the evidence lives

`gh api repos/{o}/{r}/issues/{n}/timeline` interleaved with
`gh api "…/actions/runs?head_sha=…"` reconstructs a stalled pipeline minute by
minute, and the two together are what showed the CI run *existed* but was four
minutes young when the verb ran. Neither alone would have.

One dead end for anyone reaching for it later: a `workflow_run`-triggered run
carries **no** reference to the run that triggered it. Its `head_sha` and
`head_branch` are the default branch's, and the payload is not exposed on the
listing — so you cannot ask "which panel run belongs to this CI run" through the
API at all.
