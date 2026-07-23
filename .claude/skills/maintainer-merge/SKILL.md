---
name: maintainer-merge
description: Use when a maintainer needs to squash-merge a wafflebase PR (often a fork / agent-pipeline PR) that has merge conflicts, requires folding the pipeline's combined effort/cost into the squash commit message, is BLOCKED by branch protection, or fails to merge with "refusing to allow an OAuth App to create or update workflow ... without workflow scope".
---

# Maintainer Merge

## Overview

Squash-merge a PR the way a wafflebase maintainer does: resolve conflicts on
the (possibly fork) branch, wait for the *real* required checks, fold every
commit into one honest squash message — with the pipeline's **combined
effort/cost** appended when the PR carries it — and merge, bypassing branch
protection only as the repo owner.

**Core principle: never fabricate. Effort/cost is aggregated data that already
exists in the PR's comments — you copy it, you don't invent it. If it isn't
there, omit it.**

## When to Use

- Merging an agent-pipeline PR (`agent/*` branch), especially from a **fork**.
- PR is `CONFLICTING` / `DIRTY` and needs conflict resolution before merge.
- You want the squash commit to carry the **combined effort/cost** of all the
  agent sessions (turns / tokens / time), not just the diff.
- Merge is `BLOCKED` (branch protection) or fails with the `workflow` scope error.

Not for: your own working-branch review (`/code-review`), or trivial no-conflict
PRs you can merge from the GitHub UI.

## Prerequisite: the `workflow` scope pitfall

If the PR touches `.github/workflows/*`, `gh pr merge` fails with:

```
refusing to allow an OAuth App to create or update workflow `.github/workflows/...`
without `workflow` scope
```

`gh`'s default token lacks it. Check and fix **before** you start:

```bash
gh auth status | grep -i scopes           # want: ... 'workflow' ...
gh auth refresh -h github.com -s workflow  # interactive; run in a real terminal
```

The refresh is interactive (browser/device code) — it cannot run inside a
non-interactive tool call. Have the human run it, then continue.

## Procedure

1. **Inspect.** Capture the facts that decide the path:
   ```bash
   gh pr view <N> --json mergeable,mergeStateStatus,isCrossRepository,files,\
   headRefName,headRepositoryOwner,baseRefName
   gh api repos/{owner}/{repo}/pulls/<N> -q '.maintainer_can_modify, .head.repo.full_name, .head.ref'
   ```
   Fork PR? You can push to its branch only if `maintainer_can_modify == true`.

2. **Resolve conflicts** on the PR branch. `gh pr checkout <N>`, then merge with
   an **explicit short subject** — the auto-generated merge subject is ~71 chars
   and the repo's commit-msg hook rejects >70, silently leaving the merge
   *uncommitted* (see pitfalls):
   ```bash
   git merge origin/main -m "Merge main into <branch> (resolve conflict)"
   ```
   A merge commit is fine — squash flattens it, and it preserves the
   contributor's original commits (unlike a rebase force-push). Then **verify
   the resolution** — don't just delete markers:
   - `grep -rnE '^(<<<<<<<|=======|>>>>>>>)'` returns nothing.
   - Union-merge when both sides added complementary things (keep both).
   - Run the affected tests + validate YAML for workflow files
     (`ruby -ryaml -e "YAML.load_file('f.yml')"`).
   - Sanity-check that step IDs / `outputs` referenced downstream still line up.

3. **Push the resolution to the PR branch, then CONFIRM it advanced.** For a
   fork, push by URL (there is no configured remote):
   ```bash
   git push git@github.com:<forkOwner>/<repo>.git HEAD:<head.ref>
   git ls-remote git@github.com:<forkOwner>/<repo>.git refs/heads/<head.ref>
   ```
   The remote SHA must equal your **new merge commit**. If it equals the old
   head, your merge never committed (hook rejected it) and you pushed a no-op —
   fix step 2 and repush. SSH can also hang open after a successful push and
   time the command out, so always confirm with `ls-remote`.

4. **Wait for the REAL required checks — not "CI".** GitHub reruns CI on an
   ephemeral merge-test SHA (`refs/pull/N/merge`), so the run's head SHA won't
   match your branch tip — that's expected. Read branch protection to learn what
   is actually required, then confirm those exact contexts are green:
   ```bash
   gh api repos/{owner}/{repo}/branches/<base>/protection \
     -q '.required_status_checks.contexts, .required_pull_request_reviews, .enforce_admins.enabled'
   gh pr view <N> --json statusCheckRollup \
     -q '.statusCheckRollup[] | "\((.name//.context))\t\(.conclusion//.state)"'
   ```
   For wafflebase `main` the required contexts are `verify-self (22.x)`,
   `verify-browser (22.x)`, `verify-integration (22.x)` — a green "CI" run alone
   is **not** sufficient. `mergeable=MERGEABLE state=BLOCKED` almost always means
   the required *review* is missing, not a check.

5. **Assemble the squash message.** Subject ≤70 chars, ends with `(#N)`; body
   explains WHY, folding all commits into one coherent narrative (see the repo's
   commit-message rules in `CLAUDE.md`). Append the effort/cost block — below.

6. **Merge.** Owner bypass is only allowed when `enforce_admins == false`:
   ```bash
   gh pr merge <N> --squash --admin \
     --subject "<subject> (#N)" --body-file <path>
   ```
   `--admin` skips the required review; drop it and `gh pr review --approve`
   instead if you'd rather record an approval. Squash auto-dedupes
   `Co-Authored-By` trailers, so keep them in the body. The local merge commit
   from step 2 disappears — squash collapses the branch-vs-main diff into one.

## Combining effort/cost into the squash message

The per-session effort is **not** in the git commits. Each agent session
(`implement` / `ci-fix` / `review-fix`) posts a hidden append-only ledger
comment `<!-- agent-metric {json} -->`, and the pipeline renders one aggregated
summary comment marked `<!-- agent-metrics-summary -->` (heading `## 🤖 Agent
effort`) via `scripts/agent/metrics.mjs summarize`. **That summary already IS
the combined effort of every commit** (turns/tokens/time summed, sessions
counted). To fold it into the squash body, copy it — don't recompute:

```bash
# Pull the rendered summary (aggregate of all sessions) and strip the marker.
gh api --paginate repos/{owner}/{repo}/issues/<N>/comments \
  -q '.[] | select(.body | contains("<!-- agent-metrics-summary -->")) | .body' \
  | sed '/agent-metrics-summary/d'
```

Paste that bullet block near the end of the squash body (above the
`Co-Authored-By` trailers). If **no** summary comment exists — e.g. the PR
predates the metrics feature, or the pipeline never promoted it — **omit the
block entirely. Never write plausible-looking numbers.** If you want the raw
ledger instead of the rendered summary, aggregate the `<!-- agent-metric -->`
records the same way `aggregate()` in `scripts/agent/metrics.mjs` does (sum
turns/tokens/durationMs; sessions = count; attempt = review-fix rounds + 1).

## Pitfalls

| Symptom | Cause / Fix |
|---|---|
| `refusing to allow an OAuth App ... without workflow scope` | `gh` token lacks `workflow`. `gh auth refresh -h github.com -s workflow` (interactive — have the human run it). |
| Conflict "resolved" but PR still `CONFLICTING`; `.git/MERGE_HEAD` present, resolution only *staged* | The commit-msg hook rejected the >70-char auto-merge subject, so the merge never committed. Re-run the merge with `-m "Merge main into <branch> (resolve conflict)"` (≤70 chars). |
| `mergeable=MERGEABLE` but `state=BLOCKED` | Branch protection: usually a required **review** (`REVIEW_REQUIRED`), sometimes a pending required check. Approve, wait, or `--admin` (only if `enforce_admins=false`). |
| Green "CI" but still can't merge | "CI" ≠ the required contexts. Verify `verify-self/browser/integration` specifically. |
| Can't push to a fork PR branch | Needs `maintainer_can_modify == true`; push by fork URL, not `origin`. |
| `git push` times out but the ref updated | SSH lingers after a successful push; confirm with `git ls-remote`. Don't re-push. |
| Remote head == old head after your "push" | Your merge never committed (see the hook row); you pushed a no-op. Fix and repush. |
| Local branch looks stalled / diverged from the PR head | A concurrent session may have already resolved + pushed. Fetch `refs/pull/<N>/head`, verify it has the resolution, and recover — don't redo. |
| Effort numbers look made up | You invented them. Only ever copy the `agent-metrics-summary` comment; omit if absent. |

## Quick Reference

```bash
gh pr view <N> --json mergeable,mergeStateStatus,isCrossRepository,files
gh pr checkout <N>
git merge origin/main -m "Merge main into <branch> (resolve conflict)"  # ≤70 chars
git push git@github.com:<fork>/<repo>.git HEAD:<ref> && git ls-remote <fork-url> refs/heads/<ref>
gh api .../branches/<base>/protection -q .required_status_checks.contexts
gh pr merge <N> --squash --admin --subject "... (#N)" --body-file msg.txt
```
