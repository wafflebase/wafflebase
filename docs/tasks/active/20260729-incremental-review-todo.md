# Incremental review: the decision logic (scripts only, inert)

Land the pure logic for reviewing only the *delta* since a lens's last verdict,
plus the module that replaces the inline prior-findings script. **Nothing changes
behaviour yet** — every default preserves today's full-diff review.

## Scope of THIS PR, and what is deliberately not in it

This is the **script half**. Workflow wiring is a follow-up.

That split is not just size management. The script half is fully verifiable
locally — `resolveReviewMode` is pure, so its whole decision table is a unit test.
The wiring half is **not** locally verifiable: it depends on `external_id` round-
tripping through the GitHub checks API, on `git merge-base --is-ancestor` against
real branch history, and on a `workflow_run` context no local run reproduces.
Landing the logic first, tested, makes the risky half small and reviewable in
isolation instead of buried in a 1000-line diff.

**In this PR:**

- [x] `scripts/agent/review-state.mjs` — `serializeReviewState`,
      `parseReviewState`, `latestLensRuns`, `resolveReviewMode`,
      `renderScopeNote`.
- [x] `scripts/agent/prior-findings.mjs` — `tagPriorFindings`, `lensCheckNames`,
      plus a `gh`-CLI entry point, replacing ~40 lines of inline
      `github-script` (and the second copy #558 would have needed).
- [x] `review-panel.mjs` — `--review-mode` / `--since-sha` / `--base-sha`, all
      defaulting to today's behaviour; scope note threaded into the lens prompt.
- [x] Tests (`review-state.test.mjs`, 17 cases) + the inertness guard.

**Follow-up (wiring):** stamp `external_id` on each check run, compute the git
facts, `git diff --no-color -U15 <since> <head>` on narrowed rounds, replace the
inline prior-findings step, and add `checks: read` to the on-demand `review` job.

## Where the state lives, and why not `output.text`

Every candidate sits behind the same `checks:write` trust boundary — the author
agent lacks it, so it cannot forge any of them. The choice is therefore purely
about **failure modes**, and `output.text` loses:
`agent-review-panel.yml` trims it to fit a 60k limit **by dropping findings**. It
is *designed* to lose data. A control field that decides whether code gets
reviewed must not live in a lossy channel.

`external_id` is a fixed 255-char slot the panel writes and nothing else touches.
The widest shape here is ~170 chars, and `serializeReviewState` throws rather than
emit something over the cap.

## The one rule

**Every path fails to `full`.** Reviewing code twice costs tokens; reviewing it
zero times ships a bug. There is no symmetry, so there is no case where "probably
fine" resolves to `incremental`.

Ten distinct `full` reasons, correctness hazards checked before policy caps so the
reported reason names a real problem when one exists (a force-pushed branch must
report `force-push-or-rewrite`, not the `delta-too-large` that also happened to
fire). Three reasons are additions to the plan's list, because a fused reason is a
worse diagnostic:

| reason | why it forces full |
|---|---|
| `lens-state-divergence` | lenses disagree on what they last reviewed — one missed a round, so the newest pointer would skip commits the laggard never saw |
| `no-new-commits` | re-run on an already-reviewed SHA; the delta is empty and `review-panel.mjs` fails closed on an empty diff, so narrowing turns a harmless re-run into an outage |
| `invalid-input` | a caller passing junk gets `full`, never a throw |

## The recall regression is real and is mitigated, not hidden

Carry-forward re-checks findings already **raised**. It cannot surface a defect
whose root cause is round-1 code that only became *reachable* through round-3
code. Narrowing the diff makes that defect invisible.

Three mitigations, all mandatory:

1. **`renderScopeNote`** — and three of its clauses are load-bearing. It says
   earlier commits were reviewed already (the saving), **but the lens still owns
   defects this delta newly exposes in them**, that the *complete* working tree is
   its cwd, and that the changed-file list is *cumulative*. Clause 1 alone reads
   as "old code is someone else's problem", which is exactly the regression.
2. **Forced full round** every 3 rounds, plus on every hazard above.
3. **Wider diff context** on narrowed rounds (wiring PR) — a one-line change in an
   unseen function is unreviewable at `-U3`.

**Honest accounting: ~2x saving, not ~8x.** A third of rounds stay full by design,
and any rebase or merge resets to full.

## Two fail-opens deliberately not created

- **`--changed-files` stays cumulative.** Fed the delta, `lensApplies` could mark
  a narrow-glob lens inapplicable in round N; the workflow drops inapplicable
  lenses from `required_checks`; and a lens that **failed in round 2** would
  silently stop being required in round 3 — promoting with an unresolved blocker.
  Unreachable today. The comment and the constraint exist so it stays that way.
- **Incremental without a scope note is refused.** A caller passing
  `--review-mode incremental` with no usable `--since-sha` would otherwise get a
  partial diff with no note — a lens reviewing a fragment while believing it is
  the whole PR. `review-panel.mjs` throws instead.

## Deviation from the plan: no `countCompletedRounds`

The plan listed it on this module. `rounds.mjs` already has
`groupReviewRounds(commits, lensCheckNames)`, so `roundIndex` is
`groupReviewRounds(...).length` at the wiring layer and is injected into
`resolveReviewMode` as a plain number. A second round-counter is precisely the
kind of hand-maintained duplicate this series keeps having to fix (see
`DEFAULT_REVIEW_CHECKS` in the previous PR).

## Verification

- `agent:tests`: **131 tests** green (was 117); 17 new in `review-state.test.mjs`.
- `pnpm verify:self` green.
- **Inertness proven by execution, not by inspection.** `runLens` was extracted
  from both `origin/main` and this branch and rendered against the same inputs
  with no flags: the prompts are **byte-identical**. With a scope note they differ,
  and the note lands *before* the diff.
- That property is now a **test**, and it is mutation-tested against both
  fail-open directions: making the scope-note push unconditional (which would add
  a blank line to every prompt on every PR) and defaulting the mode to
  incremental.
- `resolveReviewMode`'s own test caught a real bug during development: a `= {}`
  parameter default only fires for `undefined`, so `resolveReviewMode(null)` threw
  — contradicting its no-throw contract. `renderScopeNote` had the identical bug
  and its test stayed green because it only passed `undefined`. Both fixed; both
  tests now sweep the whole junk class.

What none of this covers: **the wiring**. No local test exercises `external_id`
round-tripping, `git merge-base --is-ancestor`, or the real round counter. Until
the follow-up lands, this code is dead weight that changes nothing — which is the
intended state for a merge of this one.
