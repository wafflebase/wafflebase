# A timed-out fix round latches the PR on `agent:fixing` forever

## Problem

Three agent PRs opened on 2026-09-08 — #1047, #1052, #1053 — stopped in the
`agent:fixing` intermediate state instead of converging on `agent:ready` or
`agent:blocked`. #1046, opened alongside them, converged normally.

All three died at the same place: the `fix` job of `agent-review-panel.yml` hit
its `timeout-minutes: 45` wall while the fixer agent was still working.

| PR | last dispatch | `fix` job | span | result |
| --- | --- | --- | --- | --- |
| #1047 | round 2 · 14:34:58 | `34236446882` | 14:33:34→15:18:57 | `cancelled` |
| #1052 | round 3 · 15:07:21 | `34239953179` | 15:06:05→15:51:33 | `cancelled` |
| #1053 | round 3 · 16:00:21 | `34245675810` | 15:59:08→16:44:36 | `cancelled` |

A job killed by `timeout-minutes` reports **`cancelled`**, not `failure`. Every
detector that would have converged the state reads `failure`:

1. `Page if the fix produced no commit` carried only
   `if: steps.guard.outputs.proceed == 'true'`, so it kept GitHub's implicit
   `success()`. The step before it was cancelled, so it was skipped. Its own
   comment states the assumption that makes this a bug: *"if the fixer
   hard-errored, the job fails and the stalled net pages instead"* — a timeout
   does not fail the job.
2. The `stalled` net is `if: !cancelled() && (… needs.fix.result == 'failure')`,
   which excludes a cancellation twice over. The `!cancelled()` is deliberate
   (it stops a concurrency-superseded run from paging and latching
   `agent:blocked` over a fresher round) and must not simply be removed.

`Set state → fixing`, fourteen steps earlier, had already written the label. It
is the latch the rest of the pipeline reads as "a round is in flight", so
nothing re-triggers. The PR stops for good, with no comment saying so — while
`Update loop status (fix outcome)` (which *is* `always()`) writes "a page
comment follows" onto the sticky loop-status comment. The page never comes.

Seen before on #1042 (2026-09-07). This is the pipeline's one silent dead-end.

## Design

Fix it **inside the `fix` job**, not in the `stalled` net. Two reasons:

- The evidence says post-cancel steps work. In `34245675810` the `always()`
  steps ran in the runner's cancellation grace window, and
  `Update loop status (fix outcome)` spent five seconds doing `git ls-remote`
  plus a PR-comment API call, successfully, *after* the kill.
- The job already holds what the decision needs — `steps.before-fix.outputs.sha`
  and a checkout with a remote — and `stalled` would have to re-derive it. More
  importantly, adding `'cancelled'` to `stalled` would double-page every
  timeout, and would page spuriously on a supersede.

Replace the implicit `success()` on the no-commit page with `always()` plus an
explicit outcome set, so exactly one new case is admitted:

```yaml
if: >-
  always() && steps.guard.outputs.proceed == 'true' &&
  (steps.fixer.outcome == 'success' ||
   steps.fixer.outcome == 'cancelled' ||
   steps.cred.outputs.available == 'false')
```

| fixer outcome | before | after |
| --- | --- | --- |
| `success` | runs | runs |
| skipped, no live credential | runs | runs |
| `cancelled` (45-min wall) | **skipped — the bug** | **runs → page + `agent:blocked`** |
| `failure` | skipped; `stalled` pages | skipped; `stalled` pages |
| an earlier setup step failed | skipped; `stalled` pages | skipped; `stalled` pages |

The last two rows are why the condition names `steps.cred.outputs.available`
instead of accepting `steps.fixer.outcome == 'skipped'`: a step never reached
because setup failed also reports `skipped`, and admitting it would double-page
against the `stalled` net.

**A push-supersede does not page** without needing any new machinery: the
`active` concurrency group is claimed by a `ci.yml` `workflow_run`, and the
`requested` arm of that requires a push — so such a round has always advanced
the head and the step's existing `BEFORE != AFTER` check stays quiet. That is
the property `!cancelled()` protects in `stalled`, enforced here by data rather
than by job status.

**A CI re-run is the one supersede that leaves the head unchanged**, and it is
the case that makes this fix dangerous rather than merely incomplete. The page
body carries `<!-- agent-review-paged -->`, which the `gate` job treats as "a
human owns this" and refuses every later panel run on (`rounds.mjs::PAGED_LATCH`,
`guard-verdict.mjs:73`) — and `agent-rerun.yml` *deletes* that latch **before**
it re-runs CI. So a page written from the cancellation grace window would land
just after the operator's cleanup and freeze the very round they started,
consuming their rerun. That is #648's spurious latch, restored by a fix aimed at
the opposite failure.

So the `cancelled` arm first compares the CI run's **current** `run_attempt`
against the one this panel was triggered with, and stays silent when they
differ. The ordering is sound: a re-run bumps the attempt when it starts, which
is before CI completes, which is before the panel run that cancels us is
created. It needs `actions: read` on the `fix` job and `secrets.GITHUB_TOKEN`
for the read, because the App token minted for the comment is scoped to
contents/pull-requests/issues. It fails **open** — an unread attempt number is
not evidence of a re-run, and a stray page a human can clear beats the silent
dead-end.

Not in scope: raising the 45-minute wall. The wall is a budget; a wall that is
hit silently is the defect.

## Adjacent defect found, deliberately not fixed here

The no-live-credential path double-pages, and has since before this change.
`Page — no live credential for the fixer` says *"the fix agent was **not
dispatched** … **No fix round was consumed**"* and advises `@claude rerun` once
usage windows reset — its comment asserts that "skipping the steps below leaves
the `fix` job GREEN", i.e. that the no-commit page will not run. It does run:
nothing failed, so the implicit `success()` holds. So the PR also gets the
generic *"did not converge within its turn budget"* page and `agent:blocked`,
contradicting the first comment in both cause and remedy.

Left alone on purpose — fixing it means deciding whether that path should latch
`blocked` at all, which is a contract question and not this bug. Filed here so
it is not lost.

## Tasks

- [x] Reproduce from the run record — confirm the timeout, the skipped page, and
      the skipped `stalled` net on all three PRs
- [x] Confirm the cancellation grace window admits network work (step 25's five
      seconds of `ls-remote` + API call)
- [x] Failing test in `scripts/agent/checks.test.mjs`: extract the step's `if:`
      and evaluate it over every fixer outcome
- [x] Add `id: fixer` to `Address panel findings`
- [x] Rewrite the no-commit page's `if:` and explain the outcome set
- [x] Name the wall in the page body when the outcome is `cancelled`, since the
      recovery is specific
- [x] Comment `stalled` to say why `'cancelled'` is deliberately absent
- [x] Self review: caught that the new page would freeze a `@claude rerun`, and
      added the CI-attempt suppression + `actions: read` for it
- [x] Exercise the step's shell directly over all arms (pushed / unchanged /
      cancelled / re-run / read-failed) with stubbed `gh` and `git`
- [x] Mutation-check both new assertions — drop the `cancelled` disjunct or the
      re-run `exit 0` and the test fails
- [x] `pnpm verify:fast`
- [ ] Re-trigger #1047 / #1052 / #1053 by hand (`@claude fix`) — the fix cannot
      rescue a round that already died

## Review

(filled in at merge)
