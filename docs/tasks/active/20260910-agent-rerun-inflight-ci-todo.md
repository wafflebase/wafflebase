# `@claude rerun` is a no-op while CI is in flight

## Problem

On 2026-09-09 both #1047 and #1052 were rebased onto `main`, then handed
`@claude rerun`, and neither loop resumed. The verb reported success:

> 🔁 Rerun engaged — cleared 1 paged marker(s). Dropped `agent:blocked`.
> **No CI run to re-run — the panel will engage on the next CI run.**

There was no next CI run. Both PRs sat unreviewed until a human re-ran CI by
hand.

| time (2026-09-09) | #1047 | #1052 |
| --- | --- | --- |
| rebase pushed → CI created (attempt 1) | 11:52:16 | 11:53:55 |
| panel `requested` → `gate` refuses (paged latch still on) | 11:52:21 | 11:53:57 |
| `@claude rerun` → latch deleted, **no run re-run** | 11:56:13 | 11:56:16 |
| CI concludes `success`, attempt **1** | 12:16:14 | 12:18:27 |
| panel `completed` → every job `skipped` | 12:16:16 | 12:18:29 |

Three mechanisms compose into a dead zone, each correct on its own:

1. **The re-run target must be `completed`.** `ciRunToRerun`
   (`scripts/agent/checks.mjs`) picks the newest `status === 'completed'` run,
   because `reRunWorkflow` answers 422 for a run still in flight. A run created
   four minutes ago is not completed, so the selection is empty and the step
   sets `reran = false`.
2. **The panel admits a `completed` event only on `run_attempt > 1`**
   (`agent-review-panel.yml`, `gate`). A fresh run's completion is refused
   because its `requested` event already started that round.
3. **That `requested` round was refused by the paged latch**, which the rerun
   had not yet deleted — it fires ~5 seconds after CI is created, and the
   operator types the comment minutes later.

So the round's one `requested` event is spent under the latch, its `completed`
event is refused for being attempt 1, and the verb whose whole purpose is to
produce an attempt 2 declines to. Nothing re-triggers.

The same three-way composition breaks `@claude loop` on a human PR whose CI is
in flight: the `requested` panel is refused for being unmanaged, the label
lands too late to matter, and `agent-loop.yml` carries a literal copy of the
same selection.

`reran = false` is not a rare edge. It is what happens whenever the operator
pushes and then reaches for the verb, which is the ordinary sequence.

## Why the message is worse than the bug

"the panel will engage on the next CI run" is true only if a next CI run
exists. After a rerun on a head whose CI has already been created, there is
none — the operator has to push an empty commit or re-run CI by hand, and the
comment tells them neither. Both PRs were read as "resuming" for five hours.

## Approach

Teach the two re-run steps the in-flight case: **wait for the run, then re-run
it**, instead of reporting that there is nothing to do.

- `completed` run exists → unchanged. Re-run it (this is already the design;
  `@claude rerun` has always cost a full CI run).
- otherwise a run is in flight → poll until it concludes (bounded, 30 min),
  then re-run it, subject to two guards below.
- nothing at all for this head → unchanged message.

Two guards, because a lot can happen in thirteen minutes:

- **The head moved.** If a commit landed while we waited (the CI-fix arm
  converging, or a human pushing), re-running the old run would run CI against
  a stale sha. Skip, and say so — the push already engaged the loop.
- **The awaited run concluded `failure`.** `agent-iterate-ci.yml` has no
  attempt gate, so it fired on that very completion and its fixer may be
  pushing right now. Its concurrency group is `cancel-in-progress: true` keyed
  on the branch, so a second `completed/failure` event from our re-run would
  **cancel the fixer mid-push** — #648's failure mode, reintroduced by the fix
  for a different one. Skip, and say the CI-fix arm has it.

Rejected alternatives:

- **Cancel the in-flight run and re-run it** — reaches attempt 2 sooner and
  wastes fewer CI minutes, but it destroys a run the operator is watching, and
  it makes a live panel's `ci` job read `cancelled` and discard a ~$12 round
  that was about to promote or fix. A recovery verb should not be destructive.
- **Re-run the refused *panel* run instead of CI** — the elegant one: it costs
  no CI and puts the panel back in parallel with CI, where the design wants it.
  Unreachable through the API. A `workflow_run`-triggered run reports the
  default branch as its head (`head_sha` = `main`'s), carries no reference to
  the run that triggered it, and the payload is not exposed on the listing —
  so the only way to pick the right panel run is a time window, which would
  re-review whichever PR's CI happened to start nearby.
- **Admit `completed` on attempt 1 when no panel reviewed this head** — the
  panel outlasts CI by ~4 minutes on the median, so at CI completion the live
  panel has not written its check runs yet and the rule would double-fire every
  ordinary round.

## Tasks

- [x] `ciRunToAwait()` in `scripts/agent/checks.mjs` — newest not-completed run
- [x] `agent-rerun.yml`: wait → head-moved guard → failure guard → re-run
- [x] `agent-loop.yml`: same, kept literally in sync
- [x] Honest outcome text for each arm (waited / timed out / head moved / red)
- [x] Raise both job walls above the wait bound
- [x] Unit tests for `ciRunToAwait`, extraction test extended to the new copies
- [x] `pnpm verify:fast`

## Review

Landed as PR #1056.

`ciRunToAwait` is deliberately "newest run that is not `completed`" rather than
an allow-list of `queued`/`in_progress`: GitHub has added run statuses before
(`waiting`, `pending`, `requested`), and a status this pipeline has never heard
of must read as "still going" — the direction where the verb waits and then
re-runs — not as "nothing here", which is the bug being fixed.

The mirror-extraction test in `checks.test.mjs` now pulls **both** selections
out of each workflow and runs them against the same fixtures as the exported
functions. That test is the only thing keeping three copies of a rule one rule;
it was extended rather than duplicated so a future edit cannot satisfy it by
updating one file.

Not covered end-to-end: the wait path can only be observed on a real
`@claude rerun` issued against an in-flight CI run. The unit tests pin the
selection and the guards' conditions; the polling loop itself is exercised only
by its own fixtures.
