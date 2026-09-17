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
