# Self-review loop — lessons

## Check the gate before claiming a loop covers a branch

I asserted that the cloud review→fix loop already ran, so a local 3-round loop
would duplicate it. It does not. `agent-review-panel.yml:192-199` admits a PR
only when the branch starts with `agent/` **or** the PR carries
`agent:managed`; every other PR gets CI and nothing else. `gh pr checks` on
three merged human PRs (#1071, #1063, #1057) shows zero `agent-review-*` checks,
and #1061 — a human branch *with* the label — shows all seven.

**Rule:** before saying an automated stage covers some work, read the workflow's
`if:` / gate job and confirm against a real run. A workflow existing in the repo
says nothing about which PRs it admits.

## "Prior findings" and "rebuttals" solve opposite failures

Also mis-stated: I said carrying prior findings forward stops a later round from
re-raising what round 1 already flagged. It does the reverse — it carries
**unfixed** findings forward so a round that happens to miss one cannot clear it.
The re-raise of a finding you deliberately *declined* is what `--rebuttals`
addresses, via an adjudicator subagent.

**Rule:** name the failure mode a flag prevents before recommending it. Two
round-threading inputs that sound similar had opposite fail directions here.

## A workflow step that names a tool the actor cannot run is not a workflow step

The first draft of both the command and `CLAUDE.md` put `/code-review` and
`/simplify` in the round rotation. Neither can be invoked by an agent — they are
user-invoked and billed — so an agent following the loop would have reached round
2, found the door locked, and either skipped the round silently or substituted
its own read of its own diff and called that a review.

**Rule:** when writing a process doc, check who the actor is and whether that
actor can actually perform each step. Name the invocable tool for the agent path
and mark the rest as "ask the human", rather than listing them as
interchangeable.

## Self-review in the same context is the weakest round available

This branch's round 1 ran without `CLAUDE_CODE_OAUTH_TOKEN`, so the six-lens
panel skipped and the review was my own read of my own diff — the exact failure
mode the panel's verifier exists to avoid (a reviewer that shares the author's
context inherits the author's misreadings). It still found three real defects,
which says something about the first draft, not about the method.

**Rule:** say which reviewer actually ran. "Reviewed" without naming the reviewer
lets a skipped panel and a real one read identically in a task file.
