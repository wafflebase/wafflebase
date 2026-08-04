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

## Review response (panel, #657)

Six fixed, three skipped. The panel was right about the one that mattered.

- [x] **CRITICAL — `retryAt` was undeclared** at the round-cap page, so the guard
      threw a `ReferenceError` exactly when it should latch the PR. Residue of the
      dropped `@claude retry` scope: my rename used `str.replace` **without
      asserting the match**, the pattern didn't match, and the no-op was silent.
      Every other edit in this series asserts; this one didn't. CI was green because
      nothing exercises that path.
- [x] **Only the round cap honoured the rerun floor.** The stall and
      rebuttal-standstill pages run *before* it and read pre-rerun history, so a
      rerun on an already-stalled PR re-paged on the first post-rerun round — the
      same failure this PR exists to end, through a different door. Both now hold
      for one post-rerun attempt: it delays them by exactly one round, never
      disables them.
- [x] **`RERUN_MARKER` matched by substring** — so quoting it re-granted the budget.
      Now it must be the comment's first line. This is the second time the substring
      shape has bitten: clearing #648 by hand re-armed the paged latch with the
      sentence explaining its removal.
- [x] **The marker was trusted from any `author_association`**, a weaker credential
      than `@claude rerun` itself enforces (`getCollaboratorPermissionLevel`).
      Bot-only now. Combined with first-line anchoring this also closes the
      smuggling channel the security lens found: the allow-listed bots publish LLM
      output verbatim, so a substring test made "a model emitted the marker" enough.
- [x] `firstVerdictAt` lacked the `app.slug` guard every other lens-run consumer
      applies — a foreign app's same-named check could lower the floor and inflate
      the count.
- [x] Timestamps compared numerically rather than lexicographically; the string
      compare was a latent dependency on GitHub emitting Z-normalised,
      equal-precision ISO.
- [x] **The marker contract test was vacuous** — satisfied by the explanatory `//`
      comment in `agent-rerun.yml`, so deleting the emit left it green. Now excludes
      prose lines and asserts exactly one emitting line.
- [x] `rounds.mjs`'s header still described the old contract; `gh-checks.mjs` claimed
      its shape could be "passed straight through" for a round count, but it drops
      `parents` and `commit.committer.date` — no live bug (the guard fetches commits
      itself) but the doc invited one.

**Skipped: the first-verdict discriminator is race-dependent.** True and inherent —
if a verdict lands before the implementer's self-review push, that push counts. It is
already stated in the PR body and now in the module header. The direction is
conservative (over-count → page early → undone by a rerun), and nothing in the data
distinguishes the two.

**Skipped: `rounds.mjs` is drifting into a marker grab-bag.** Fair, but the
paged-latch precedent is already in this file, and a module holding one marker plus
one predicate would split the trust list across two places — worse for the property
that actually matters.

**Skipped: the "relocated code" security finding**, which the panel itself marked as
pre-existing and not gating.

## The finding behind the finding

`scripts/agent/**` has **no linting at all** — `verify:fast` lints only
`packages/frontend`. That is why an undefined identifier reached CI green.

Verified rather than assumed: `no-undef` over `scripts/agent/*.mjs` reports the
`retryAt` bug precisely, and reports **nothing else** across the directory. So the
class is closable for the price of one config file. Not done here — it is a
build-config change with its own blast radius, and this PR is about round counting.
