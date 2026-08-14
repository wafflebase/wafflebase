# One panel per branch, and a fixer with room to finish

Two failures found while investigating why **#648** came out `agent:blocked`.

## What happened on #648

The label and the page both said the fixer couldn't satisfy the panel. Neither was
what happened.

`agent-review-panel.yml` had **no `concurrency` guard**, so two CI completions
close together started two full pipelines against `agent/586-cli-system-exit-code`:

| run | panel | fix | turns | outcome |
|---|---|---|---|---|
| A `30803409664` | 09:55→10:05 | 10:05→**10:35:52** | **81** | ❌ `Reached maximum number of turns (80)` |
| B `30803718950` | 10:00→10:11 | 10:11→10:32:48 | 76 | ✅ pushed `102e0fa73` |

**21 overlapping minutes, two fixer agents, the same nine findings.** B converged
and pushed; A crossed its ceiling and its job failed. Run A's `stalled` job then
paged with *"the fixer agent failed, so the requested changes were not applied"* —
**false**: `102e0fa73` was on the branch and CI-green three minutes earlier.

The paged latch (correctly) froze the PR, so the commit that *did* land was never
reviewed. `$22.30` spent, roughly a third of it on a duplicate that could only
lose.

The same absent guard had already produced a different symptom on **#605**: two
panels completing in the *same second* with identical `external_id` and
contradictory verdicts — correctness 1 major vs 2 major, docs success vs failure.

## The change

- [x] `concurrency: agent-review-panel-<head_repo>-<head_branch>` with
      `cancel-in-progress`.
      Cancel rather than queue: a superseded panel is reviewing a sha that is no
      longer the head, so its verdict is stale before it is written.
- [x] Fixer `--max-turns` **80 → 200**, above `agent-implement`'s 150. The fixer
      reads code it did not write at locations the panel chose, then fixes every
      finding in one pass. The ceiling is a runaway backstop, not a budget —
      `MAX_REVIEW_ROUNDS` and the 45-minute job timeout bind first.
- [x] The `stalled` page now distinguishes **three** states on a fixer failure:
      the head moved (an unreviewed commit landed — without claiming who pushed it),
      it did not move (nothing pushed), or it could not be read (say so).
- [x] `stalled` moved from `always()` to `!cancelled()` — see below, plus a new
      cancellation-safe `close-stuck-checks` job so that move does not strand
      lens checks.
- [x] Corrected a now-stale line in `harness-engineering.md` claiming a paged PR
      still re-reviews on every CI-green push; the gate's paged latch ended that.

## The trap my own change introduced

`stalled` ran under `always()`. With `cancel-in-progress` now cancelling
superseded runs, a panel cancelled **before it started** reports `skipped` — which
is one of `stalled`'s trigger conditions. It would have paged and latched the PR to
`agent:blocked` at the exact moment a fresher round was starting, and the latch
would then have stopped that round from running.

A spurious page is this job's worst failure mode, because the page is *sticky* —
every other part of the pipeline treats it as "a human owns this now".
`!cancelled()` still fires on every genuine failure; a failed dependency is not a
cancellation.

The stuck-check cleanup that rode on the same `always()` had to move with it —
see the review response below. The remaining `always()` uses in this workflow are
step-level, and the one that writes state (`Post per-lens check runs`) is
self-healing: a superseded run's lens checks are overwritten by the newer run, since
check runs resolve latest-per-name.

## Verification

- [x] `pnpm verify:self` green (11/11); workflow parses.
- [x] **The three-state reason logic extracted from the YAML and executed** — inline
      `github-script` JS can hold neither a test nor a linter, so it was run against
      #648's real shape, a genuine no-push, and an unreadable head — asserting the
      output carries no unproven attribution.
- [x] Group key contains no `run_id` — that is the mistake that makes a concurrency
      group match only itself and guard nothing.

## Deliberately NOT in this PR

The third finding from the investigation: **don't latch on a page whose premise the
branch contradicts.** If the head advanced and CI is green after a page, that is
worth one more panel round. It needs a decision about who may clear a latch, which
is a trust question rather than a bug fix.

#648 itself still needs unblocking by hand so one round can review `102e0fa73`.
Nothing here does that.

## Review response (CodeRabbit, #649)

Three fixed, one skipped.

- [x] **Fork branch-name collision could cancel a legitimate panel.** `concurrency`
      is evaluated at the workflow level, *before* `gate` applies its
      `head_repository.full_name == github.repository` fork check. Keyed on the
      branch alone, anyone could fork this **public** repo, open a PR from a branch
      named to match an in-flight agent branch, and have their CI completion cancel
      the real panel — denial of review from an unprivileged position, with the
      cancelling run then skipped by the gate so nothing records the review that
      should have happened. The group now includes the head repository.
- [x] **`!cancelled()` stranded the stuck-check cleanup.** That cleanup exists for
      the "panel KILLED mid-run (timeout/**cancel**)" case and rode on `stalled`'s
      `always()`. Moving `stalled` off `always()` removed it at exactly the moment
      the concurrency guard made cancellation the *common* outcome — every
      superseded round would have left six `agent-review-*` checks spinning forever.
      Split into a `close-stuck-checks` job that runs on cancellation, never pages,
      never labels, and holds `checks: write` alone. The two genuinely need opposite
      cancellation behaviour, which is why bundling them created the regression.
- [x] **My own fix still attributed the push.** "the branch DID advance … changes
      were applied" claims the *fixer* pushed the *requested fix*, and this run can
      observe neither. A human push and a concurrent run's fixer look identical from
      here. It now states both shas and says a commit landed unreviewed, without
      saying who or what — otherwise it is the same unproven claim as the sentence it
      replaced, pointing the other way.

**Skipped: wrapping the `pulls.list` lookup in try/catch and reusing `gate`'s PR
number.** The `advanced` computation cannot throw (`typeof pr.head?.sha === 'string'`),
so the new code path is already covered. A `pulls.list` throw failing the whole step
is pre-existing behaviour with pre-existing consequences, and `gate` emits only the PR
number — not the head sha this needs — so reusing it would still cost a second call.

**Skipped: `#648` at line start rendering as a heading.** CommonMark requires
whitespace after the `#` run, so `#648` is not an ATX heading; GitHub follows
CommonMark and auto-links it as an issue reference, which is the intent.
