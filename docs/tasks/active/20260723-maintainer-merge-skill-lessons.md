# Maintainer Merge skill — lessons

## The commit-msg hook can silently swallow a merge

`git merge origin/main` with no `-m` generates a ~71-char subject
("Merge remote-tracking branch 'origin/main' into <branch>"). The repo's
commit-msg hook enforces `subject ≤ 70`, so the commit is **rejected** — but the
merge stays half-applied: `.git/MERGE_HEAD` present, the resolution only
*staged*, HEAD unchanged. A follow-up `git push HEAD:branch` then pushes the old
head (a no-op), and the PR stays `CONFLICTING` while everything *looks* done.

**Rule:** always merge with an explicit ≤70-char subject
(`git merge origin/main -m "Merge main into <branch> (resolve conflict)"`), and
after pushing, `git ls-remote` to confirm the remote advanced to the *new merge
commit*, not the old head.

## Effort/cost lives in PR comments, not commits

The agent pipeline's effort summary is aggregated from hidden per-session
`<!-- agent-metric -->` ledger comments into one `<!-- agent-metrics-summary -->`
comment. Squash merge concatenates *commit messages* and dedupes
`Co-Authored-By` — it never pulls comment data. To carry combined effort into
the squash message you copy the summary comment. When the PR has none (the
feature wasn't live), omit it — do not invent numbers.

## "CI green" ≠ mergeable

Branch protection required `verify-self/browser/integration (22.x)`, distinct
from the "CI" workflow run. `mergeable=MERGEABLE state=BLOCKED` was the required
*review*, not a check. Read `branches/<base>/protection` to know the real gate.

## Recover from a concurrent session; don't redo

A parallel session had already resolved + pushed the correct merge commit
(`c7b1c8725`, a proper ≤70-char merge). The local session's rejected merge
looked like lost work. Ground truth came from `refs/pull/<N>/head` + raw git
(bypassing the RTK output proxy, which reformats `git status`/`ls`). The remote
was correct; re-pushing would have been wasted effort.

## Skill placement

Kept the skill out of the repo autonomous-pipeline path by scoping its
description to "a maintainer needs to squash-merge"; lives at
`.claude/skills/maintainer-merge/` so both maintainers share it, versioned with
the code that it references (`scripts/agent/metrics.mjs`).
