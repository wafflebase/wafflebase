# Lessons — Tighten fixer + implement prompts (#563 D2/D3)

## The push rejection is the security boundary, not an inconvenience

The obvious reaction to "the agent can't push workflow files" is to grant the
App `workflows` write. Don't.

`ci.yml` triggers on `pull_request`, which means **a PR branch supplies its own
CI definition**. An agent that could edit workflows could rewrite `ci.yml` on its
own branch and make CI pass trivially, defeating `mark-ready.mjs` gate 1 on that
very PR. The review panel survives that — it runs on `workflow_run`, so it
executes from the default branch — but only until the PR merges, after which the
modified panel, lenses, and severity rule govern every subsequent PR.

A human merge gate makes that survivable, because a person is standing at step
two. It stops being survivable the moment merges are automated. The missing scope
is currently the only thing enforcing that boundary, and it should stay missing.

## Splitting at the capability boundary belongs at issue-filing time

Issue #563 asked for three deliverables: one the agent could do, two it
structurally could not. Every component of the pipeline then behaved correctly on an
impossible task and the PR still failed — design-fit reported the truth, the
fixer tried and was rejected, and the no-commit detector paged.

Nothing in the loop can fix a task that is impossible for the loop. The check
belongs earlier: when filing an agent issue, ask whether satisfying the
acceptance criteria requires a file the agent cannot push, and split if so.
Cheaper to decline a run in five seconds than to spend $9.36 discovering it.

## A prompt change has no unit test — say so out loud

D1 shipped with a real regression test. D2/D3 cannot: the deliverable *is* the
prompt, and its effect is a distribution over agent behavior. The only honest
verification is rounds-to-converge and per-session tokens across the next several
autonomous PRs, compared against a recorded baseline (PR #547 at 4 review
rounds, PR #548 at 8).

Worth stating in the PR rather than letting green CI imply the change was
validated. Green CI here only means the YAML parses.

## The instruction that now guarantees a recurring finding

The fix prompt says: *"If you believe a finding is wrong, do NOT change code for
it; reply in the PR thread with your reasoning."* That is the right instruction —
editing code to appease a wrong finding is worse than leaving it.

But **nothing reads that reply.** The panel receives the diff, the changed files,
the issue spec, and prior *findings*; there is no channel for "answered." So a
finding the fixer correctly disputes will be raised again next round, and the
round after, until the cap. #564 is the worked example.

Today that resolves itself because a human eventually steps in. It does not
resolve itself under auto-merge, where the same situation is a permanent
deadlock — or, worse, an incentive to build a channel where the agent can talk
its way past a gate. Whatever fixes this needs an independent adjudicator and a
bias toward upholding the finding, not a free-text back-channel.
