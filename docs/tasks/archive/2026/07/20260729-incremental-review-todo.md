# Incremental review: the decision logic (scripts only, inert)

Land the pure logic for reviewing only the *delta* since a lens's last verdict,
plus the module that replaces the inline prior-findings script. **Nothing changes
behaviour yet** — every default preserves today's full-diff review.

## Scope of THIS PR, and what is deliberately not in it

This is the **script half**. Workflow wiring is a follow-up.

Two reasons, and the second one is not a choice:

1. **Verifiability.** The script half is fully verifiable locally —
   `resolveReviewMode` is pure, so its whole decision table is a unit test. The
   wiring half is **not**: it depends on `external_id` round-tripping through the
   GitHub checks API, on `git merge-base --is-ancestor` against real branch
   history, and on a `workflow_run` context no local run reproduces. Landing the
   logic first, tested, makes the risky half small and reviewable in isolation
   instead of buried in a 1000-line diff.
2. **A capability boundary.** The wiring edits `.github/workflows/**`, which the
   agent App cannot push (no `workflows` scope — this is what blocked #564, and it
   is deliberate: `ci.yml` runs on `pull_request`, so a branch that could rewrite
   workflows could make CI pass on its own PR and defeat `mark-ready.mjs` gate 1).
   So the wiring needs a human push regardless of how it is packaged, and the
   scripts are the part that can travel the normal path.

**In this PR:**

- [x] `scripts/agent/review-state.mjs` — `serializeReviewState`,
      `parseReviewState`, `latestLensRuns`, `resolveReviewMode`,
      `renderScopeNote`.
- [x] `scripts/agent/prior-findings.mjs` — `tagPriorFindings`, `lensCheckNames`,
      `collectPrior` (API access injected so its failure paths are testable),
      plus a `gh`-CLI entry point, replacing ~40 lines of inline
      `github-script` (and the second copy #558 would have needed).
- [x] `review-panel.mjs` — `--review-mode` / `--since-sha` / `--base-sha`, all
      defaulting to today's behaviour; `resolveReviewScope` and
      `buildLensPrompt` exported so the scope decision and the rendered prompt
      are both testable.
- [x] Tests: `review-state.test.mjs`, `prior-findings.test.mjs`, and the
      inertness guard in `review-panel.test.mjs`.

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
The widest shape here is 183 chars, and `serializeReviewState` throws rather than
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
- **Incremental without a scope note is refused, and so is the reverse.** A caller
  passing `--review-mode incremental` with no usable `--since-sha` would otherwise
  get a partial diff with no note — a lens reviewing a fragment while believing it
  is the whole PR. `resolveReviewScope` throws instead. It also throws on
  `--since-sha` *without* the mode flag: this script cannot tell a narrowed diff
  from a full one by looking at it, so the flag pair is the only signal there is,
  and a lost or mistyped `--review-mode` is exactly how that pair comes apart.

## Deviation from the plan: no `countCompletedRounds`

The plan listed it on this module. `rounds.mjs` already has
`groupReviewRounds(commits, lensCheckNames)`, so `roundIndex` is
`groupReviewRounds(...).length` at the wiring layer and is injected into
`resolveReviewMode` as a plain number. A second round-counter is precisely the
kind of hand-maintained duplicate this series keeps having to fix (see
`DEFAULT_REVIEW_CHECKS` in the previous PR).

## Verification

- `agent:tests`: **161 tests** green (was 148 on `main` after #578).
- `pnpm verify:self` green.
- **Inertness proven by execution, not by inspection.** `runLens`'s prompt
  assembly was extracted from `origin/main` and rendered beside this branch's
  `buildLensPrompt` on identical inputs: **byte-identical**, 1012 bytes each. With
  a scope note they differ, and the note lands *before* the diff.
- That property is now a **test that renders the prompt** — the first version
  grepped `review-panel.mjs` for two literal expressions, which cannot observe the
  property it claimed, since any other edit to the assembly changes the prompt
  while the regexes still match. `buildLensPrompt` and `resolveReviewScope` were
  exported for that reason and no other.
- `collectPrior` takes its API function as an argument, so all four of
  `prior-findings.mjs`'s failure paths are covered, and each new guard is
  mutation-tested: dropping the `checks.get` back-fill, dropping `--slurp`, and
  collapsing the per-commit `catch` into one outer `try` each fail a test.
- `resolveReviewMode`'s own test caught a real bug during development: a `= {}`
  parameter default only fires for `undefined`, so `resolveReviewMode(null)` threw
  — contradicting its no-throw contract. `renderScopeNote` had the identical bug
  and its test stayed green because it only passed `undefined`. Both fixed; both
  tests now sweep the whole junk class.

What none of this covers: **the wiring**. No local test exercises `external_id`
round-tripping, `git merge-base --is-ancestor`, or the real round counter. Until
the follow-up lands, this code is dead weight that changes nothing — which is the
intended state for a merge of this one.
