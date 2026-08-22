# Prepare CI for GitHub's merge queue, and propose enabling it on main

**Split ownership:** the CI-side change lands in this repo (this task). Turning
the queue on is a repository-admin setting on `wafflebase/wafflebase` and needs a
maintainer — this task carries the proposal, not the flip.

## Problem

`main` requires three checks: `verify-self (22.x)`, `verify-browser (22.x)`,
`verify-integration (22.x)`. All three prove a PR is green **against its own
branch**. None prove it is green against the `main` it will actually land on.

That gap is a rebase loop. Measured on the last eight CI runs, a full cycle is
~15–18 minutes wall clock. So on a day with several merges: rebase onto `main`,
wait ~18 min, find `main` moved again, rebase again. The change was never wrong;
the queue behind it moved. Semantic conflicts (two PRs that each pass alone and
break together) are not caught at all until they are already on `main`.

Batching PRs by hand — rebase several onto one branch, run CI once — saves runner
minutes but not the loop, and it does not survive contact with a repo where
contributors land work independently. Note that the merge queue is **not** an
automated version of that batching: it does not combine builds (see the cost
note below). It removes the human from the loop; it does not spend less CI.

## Goal

Make the required checks run against the post-merge tree, and stop paying a
manual rebase per PR, without inventing any of the machinery: GitHub's merge
queue already does exactly this.

Contributor-visible change: click **Merge when ready** instead of rebasing.

## What this PR does (CI side, inert until enabled)

- [x] `ci.yml`: add `merge_group: types: [checks_requested]`. Without it a
      queued PR waits on required contexts that never start and is dequeued when
      the status-check timeout expires — so the trigger has to be merged
      *before* the setting is switched on. It is inert until then: no queue, no
      `merge_group` event, no extra runs.
- [x] `ci.yml`: skip the Codecov upload on `merge_group`. The queue SHA need not
      ever reach `main` (a failing entry is dequeued; a group is rebuilt without
      the offender), so coverage filed against it is unreachable from any
      branch — and the `push` run on `main` already reports the merged tree.
      Also keeps `CODECOV_TOKEN` out of runs whose tree holds unmerged fork code.
- [x] `docs/design/harness-engineering.md`: `### Merge queue` under CI Contract —
      rationale, CI-side contract, residual risk.
- [x] `MAINTAINING.md`: `### Merge queue` — enable/verify/rollback runbook with
      recommended parameters.
- [x] `CONTRIBUTING.md`: note at the end of the PR workflow, explicitly marked
      not-enabled-yet, so it flips to unconditional in one edit.

**Verified as needing no change:**

- Required check names are matrix job names and do not vary by event, so the
  required-check list stays as-is.
- The two PR-comment steps already guard on
  `github.event_name == 'pull_request'`; a merge-group run has no
  `context.issue.number`, so they skip instead of failing.
- `agent-review-panel` / `agent-iterate-ci` consume `workflow_run` from CI and
  would otherwise fire on every queue run. Both gate on
  `head_branch.startsWith('agent/')` plus a `pulls.list` lookup by head branch;
  `gh-readonly-queue/main/pr-<n>-<sha>` matches neither, so `managed` resolves
  `false` and only the cheap gate job runs. Review and the auto-fix loop belong
  to the PR, not to the speculative merge.
- `docker-publish` / `publish-ghpage` trigger on `push` to `main`, which the
  queue still produces.

## Maintainer decision needed

- [x] Enable **Require merge queue** for `main` (Settings → Branches → rule for
      `main`; the repo uses classic branch protection, not a ruleset).
      Recommended parameters and the verify/rollback steps are in
      [MAINTAINING.md](../../../MAINTAINING.md#merge-queue).
- [x] **Accept that this costs CI time rather than saving it.** Roughly one extra
      run per queued PR, on top of what its own pushes trigger, at ~18 min each.
      There is no grouping discount: per GitHub's docs, "Merge limits do not
      combine `merge_group` builds", and Build concurrency only throttles how many
      speculative builds run at once. What is bought is human time (nobody sits in
      the rebase loop) and correctness (semantic conflicts caught pre-merge). If
      runner minutes are the binding constraint, this is the wrong trade and the
      proposal should be declined.
- [x] Accept the residual risk: a `merge_group` run executes PR code in this
      repository rather than a fork's sandbox, so it runs alongside a
      `GITHUB_TOKEN` carrying `ci.yml`'s workflow-level `pull-requests: write` /
      `issues: write`, and alongside any secret the workflow references — here
      only `CODECOV_TOKEN`, whose step is skipped in queue context. Not every
      repository secret. Queueing requires write access, so this is the trust
      boundary that already governs merging, but code execution moves one step
      earlier, to queueing rather than merge. Review before queueing, exactly as
      before merging.

## Deferred

- A `concurrency` group on `ci.yml` to cancel superseded PR runs. Real savings,
  independent of the queue, and easy to get wrong here — cancelling a
  `merge_group` run would dequeue a PR. Separate change, separate reasoning.
  Worth more now than it looked: since the queue adds runs rather than batching
  them, this is the change that actually pays for it.
- Per-job least-privilege `permissions` in `ci.yml`. The workflow-level
  `pull-requests: write` / `issues: write` exist for the PR-comment steps in
  `verify-self` and `verify-integration`; `verify-browser` needs neither, and
  `permissions` cannot be made conditional on the event. Narrowing this shrinks
  the `GITHUB_TOKEN` half of the merge-queue residual risk — but it also changes
  the `pull_request` path, where a mistake silently breaks the summary comment,
  so it should not ride along with a trigger addition. Raised by CodeRabbit on
  PR #755.

## Test plan

The queue cannot be exercised until a maintainer enables it, so verification
splits:

- Now: `ci.yml` parses and the `pull_request` path is unchanged — this PR's own
  CI run is the evidence (`merge_group` contributes no run while the queue is
  off, which is the claim).
- At enable time: the first-queued-PR check in
  [MAINTAINING.md](../../../MAINTAINING.md#merge-queue) — confirm the three
  required contexts appear on the `gh-readonly-queue/main/...` ref and the PR
  merges with no manual rebase.
