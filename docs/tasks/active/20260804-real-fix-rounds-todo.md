# Count fix attempts, and let a maintainer hand a PR back

Follow-up to the #648 post-mortem (#649 fixed the concurrency race; this fixes the
round budget, which was an independent defect).

## The problem

`MAX_REVIEW_ROUNDS` is documented as *"Failed **fix** rounds before
review-round-guard.mjs pages a human."* What it counted was:

> commits that are single-parent **and** carry a failing lens verdict

The predicate was named `isFixerCommit`, which is what made the miscount look
correct. It is literally `parents.length === 1` — "not a merge commit" — and its
own docstring says it is *"deliberately identity-independent"*. It cannot tell who
pushed a commit.

**The implement workflow pushes twice**: its work, then a self-review fix. On #648
the agent said so at 09:47 — *"Two blocking findings, both fixed in `1d9e19d`."*
Each commit drew its own panel round, and both counted as failed fix rounds before
the fix loop had run once.

Measured on both PRs whose data still exists:

| PR | counted as rounds | real fix attempts | pre-consumed |
|---|---|---|---|
| #648 | 3 | **1** | 2 |
| #605 | 5 | 3 | 2 |

So when #615 lowered the cap 5 → 3 — sound reasoning *for panel rounds* — the real
effect was to cut the fix loop from three attempts to **one**. #648 then paged with
"requested changes 3 times without converging" after a single attempt, and the one
attempt it did get had fixed the original nine findings and introduced four new
ones in the guard it added. An ordinary second round. There wasn't one.

## The change

- [x] **Count only commits committed after the first panel verdict on the PR.** A
      commit that predates every verdict cannot be a response to one. Needs no
      identity, and the data already carries it.
- [x] **`isFixerCommit` → `isSingleParentCommit`**, because that is all it tested.
- [x] **`@claude rerun` restores the budget.** #650 shipped the command while this
      was in progress — it clears the latch and re-runs CI, but its own summary said
      the PR was "still bounded by the pipeline's round/attempt caps". It now writes
      a hidden `RERUN_MARKER` and the guard counts attempts only from the newest one.
      I dropped the `@claude retry` command I had built: a second verb for the same
      job would have been worse than the gap.
- [x] `MAX_REVIEW_ROUNDS` stays 3 — but now means three *actual* fix attempts.

## Fail directions

**The count fails toward counting.** It feeds a cap: over-counting pages a round
early, which `@claude rerun` undoes; under-counting means the cap never trips and
the loop is unbounded, recoverable only if someone notices. So a commit whose
position cannot be established counts, and with no verdict timestamps anywhere the
floor is abandoned and every failing commit counts — exactly the old behaviour.
That is also why the PR #521 fixture still returns 3 unchanged.

**The rerun marker is author-checked**, and for a sharper reason than the paged
latch: the latch only ever stops work, while this GRANTS budget. On a public repo a
body test alone would let any account hand the fixer unlimited attempts. Only the
workflow's own bot, or a human with write access, may move the floor.

## Verification

- [x] `pnpm verify:self` green (11/11).
- [x] The counter tested against **#648's real shape** — three commits, real
      timestamps — returning 1 where the old code returned 3.
- [x] The marker is a contract between a workflow and a module that cannot import
      it, so a test asserts `agent-rerun.yml` emits `RERUN_MARKER`. A drifted copy
      does not error — the budget silently never resets, and the PR re-pages after
      one round exactly as before.
- [x] A latent crash fixed on the way — `(commits ?? []).filter` threw on a
      non-array; a thrown guard is a dead fix job, not a conservative one.

## Reworked mid-flight

I had built a separate `@claude retry` command before #650 landed `@claude rerun`
for the same job. Shipping both would have left two verbs for un-sticking a PR and
two latch-clearing mechanisms. Dropped mine, including its inline gate copy and the
cross-implementation drift test that copy needed — `@claude rerun` deletes the paged
comments outright, so there is no latch left to out-date and no duplication to pin.

## Not in this PR

Whether `MAX_REVIEW_ROUNDS = 3` is still the right number now that it means three
real attempts. It was chosen when it meant one.
