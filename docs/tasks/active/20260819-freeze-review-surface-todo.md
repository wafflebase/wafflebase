# Freeze the review surface so the fix loop can converge

## The problem, measured

Ten open draft agent PRs, none merged, ~$1,104 of agent spend. None converges.
Measured across the 8 PRs with readable round data (88 scored rounds):

- **79% of every round's findings are newly discovered**, not re-raised
  (373 new vs 97 carried, matched with the panel's own `findingSimilarity`).
  The fixer is not failing — it clears most of what it is handed.
- **The reviewed diff never shrinks.** #786 went 15 files/+218 lines at round 1
  to 47 files/+5,595 at round 16 (26x). #810: 8 files/+251 -> 61 files/+5,059
  (20x). #863: 9/+272 -> 31/+1,807 (6x). Growth is +228..+358 lines per round.
- **Finding count stays flat at ~6/round while the diff grows 20x.** That is
  roughly one blocking finding per 50 new lines. The fixer writes ~300 lines to
  clear ~6 findings, and those 300 lines mint ~6 more. **The loop's fixed point
  is ~6 findings, not 0.**
- `detectStalledRounds` cannot see this. It needs `repeatRatio >= 0.30` AND a
  non-falling count, twice consecutively; new findings mean a low repeat ratio,
  so it reports `progressing`. Replayed fresh at every round on all 8 PRs it
  fires on exactly one (#786, at round 16 — the last one). Seven of eight run to
  the round cap, get paged, and `@claude rerun` grants a fresh budget without
  changing the dynamic.
- The lenses that drive it are the additive ones: `security` 133 findings
  (failed 70 of 88 rounds), `design-fit` 109 (68), `correctness` 105 (64),
  `blast-radius` 83 (56), `test-adequacy` 72 (54). `docs` 5 (7) is the only one
  that reliably passes. Every remedy in the top five is *more code*.

The root cause is scope, not review quality: the findings are mostly legitimate.
These PRs began at a reasonable 218-272 lines and are now 1,800-5,600 lines
across 31-61 files. Nothing in the loop has a concept of "this PR is done
growing", so every line the fixer writes to satisfy a finding becomes new
reviewable surface that mints the next finding.

## The fix

**Freeze the review surface at the point the fixer was first dispatched.** A
blocking finding whose cited line was *put there by a fix round* stops gating the
merge — it is still reported, it just stops failing the lens check and stops
reaching the fixer. Findings on the original implement diff gate exactly as they
do today.

This is deliberately modelled on the existing novelty gate (`novelty.mjs`),
which already answers a sibling question with git ("did this change put this line
here, carrying code that already existed?") and already has the lane, the
demotion path and the reporting section for the answer. The new gate asks: **did
a FIX ROUND put this line here?**

### The anchor: `frozenSha`

The first `<!-- agent-fix-dispatch -->` record's `from` field — the head SHA at
the moment the fixer was first dispatched, i.e. the PR exactly as the implement
job left it. This is the right anchor and not merely a convenient one:

- It is already **unforgeable** — `parseFixDispatchComment` author-gates to
  `github-actions[bot]` and refuses everything else.
- It is **stable** across reruns. `@claude rerun` resets the round floor but does
  not delete dispatch records, so the surface stays frozen where it was rather
  than re-freezing around whatever the fixer has since written. Re-freezing would
  reintroduce the treadmill one rerun at a time.
- It **degrades to today's behaviour**: no dispatch records (round 1, or a PR
  from before the ledger landed) means no frozen surface, so nothing is demoted.

### The rule

`surfaceOf()` returns `in-scope | out-of-scope | unknown`. A line is
`out-of-scope` iff **both** blames affirmatively place it after `frozenSha`:

    plain  git blame            -> which commit put this line at this offset
    moved  git blame -w -C -C -C -> which commit originally WROTE that content

Both are required, and for the same reason `novelty.mjs` needs both: if a fix
round *relocated* original implement-diff code into a new file, plain blame
attributes it to the fix commit, but the content predates the freeze — that is
original code and must keep gating. Requiring the content blame to also postdate
the freeze routes only genuinely fixer-authored lines off the gate.

**FAIL DIRECTION: every uncertain path returns `unknown`, and `unknown` keeps the
finding blocking.** No frozen SHA, no parseable citation, an unresolvable SHA, a
failed or timed-out blame, a shallow clone, a non-ancestor freeze point: all
resolve to in-scope. Demotion requires git to have affirmatively answered twice.
Nothing here can lose a finding the current gate would have kept.

### Deliberate carve-out: `critical` never demotes

Out-of-scope **major** findings demote. Out-of-scope **critical** findings keep
gating regardless of provenance. A critical defect anywhere in the PR should stop
it, and the cost of that carve-out is bounded — critical is rare in the corpus.

## Tasks

- [x] `scripts/agent/review-surface.mjs` — `surfaceOf`, `frozenShaFrom`,
      `DEMOTING_SCOPES`, `SCOPES`, `--dry-run`. Mirrors `novelty.mjs`'s structure,
      its `git()` status/ok split, and its `GIT_TIMEOUT_MS` ceiling.
- [x] `scripts/agent/review-surface.test.mjs` — real git fixtures via
      `fixtureGitEnv`. Every fail-direction path asserted to return `unknown`.
- [x] `review-panel.mjs::routeFinding` — accept `surface`; demote
      `out-of-scope` majors to `backlog` after the verifier and novelty clauses.
- [x] `review-panel.mjs::annotateFindings` + `main()` — a `surfacesFor` pass
      alongside `noveltiesFor`, sharing one cache; `--frozen-sha` flag; log
      whether the gate is on, mirroring the novelty gate's OFF/on lines.
- [x] `severity.mjs` — a `### Out of scope — added by a later fix round` section
      with the blame proof line, mirroring the relocated section.
- [x] `.github/workflows/agent-review-panel.yml` — resolve `frozen-sha` next to
      the rebuttal/fix-report readers; pass `--frozen-sha`; `continue-on-error`
      so an unresolvable freeze point degrades to "gate off".
- [x] Mutation-test every guard: remove it, watch the test fail.
- [x] `docs/design/harness-engineering.md` — the gate, the anchor, the carve-out.

## Deliberately out of scope

- **Auto-filing follow-up issues** for demoted findings. They are reported in the
  check body and the round comment, which is where `relocated` demotions already
  live, so nothing is lost. Filing issues from the panel job is a larger blast
  radius (an unlabelled-issue discipline the loop does not currently have, and
  `agent:candidate` is a live trigger) and belongs in its own PR.
- Changing `detectStalledRounds`, `MAX_REVIEW_ROUNDS`, or the rerun budget.
- Changing any lens rubric or the fixer prompt.

## Result

All lanes green, all guards mutation-verified.

- `agent:tests` (as CI runs it — recursive, `node_modules` pruned, `eval/run` isolated):
  **2170 pass, 0 fail, 6 skipped**; `eval/run.test.mjs` 56 pass; `scripts:tests` 203 pass.
- 26 new tests in `scripts/agent/review-surface.test.mjs`, 7 in
  `scripts/agent/review-panel.test.mjs`, 5 in `scripts/agent/severity.test.mjs`.
- **12/12 module mutations caught, 16/16 including the workflow wiring.**

Two real bugs were found by the tests rather than by review, both worth recording:

1. `scopeFrom(null)` threw, violating the module's own never-throws contract — the
   identical bug `resolveReviewMode` documents having had, from the identical cause
   (a `= {}` parameter default fires only for `undefined`). Fixed with the coerced-object
   destructure that function already uses.
2. **The isolation test was passing for the wrong reason.** Both git fixtures had
   byte-identical trees and the fixture pins `user.name`/`user.email`, so two repos
   built inside the same one-second tick produced *identical commit shas* — and the
   test compared a sha read from the decoy against the same sha from the real repo.
   It caught the `GIT_DIR`-escape mutation when run alone and missed it in the full
   file, purely on timing. `makeRepo({ tag })` now varies the first commit's content
   so the two histories can never be compared by accident.

Both were only visible because the mutation pass was run over the *whole file*
rather than the single test, and because a surviving mutation was investigated
instead of re-run. A mutation that survives intermittently is a flaky test, not a
flaky mutation.

## Validated against the live PRs

The gate was run for real — actual `surfaceOf` calls, against the actual branch
checkouts, over the actual blocking findings persisted on each PR's latest round.
All nine open draft PRs already carry a dispatch ledger (5–13 records each), so
the gate is live for every one of them the moment this merges, with no migration.

On #863 and #786's latest rounds, `freezeResolves` returned true for both and the
gate routed as designed:

| | count |
|---|---|
| located blocking findings | 5 |
| **would demote** (out-of-scope major) | **3** |
| kept, in-scope | 2 |
| kept, unknown (fail-safe) | 0 |
| kept, critical carve-out | 0 |

It is not demoting indiscriminately — 2 of 5 were correctly kept as in-scope,
including one in the same file as a demoted finding (`login.ts:66` in-scope,
`login.ts:373` demoted), which is exactly the line-provenance-not-file-identity
behaviour the module argues for.

**The honest limitation: 8 of the 13 blocking findings carried no usable line**,
so the gate could not place them and they stay blocking. This is inherited from
`novelty.mjs::findingLocation`, which takes only the FIRST citation in `evidence`
and drops it when it names a different file than the finding's own `file` — e.g. a
`correctness` finding on `auth.controller.ts` whose evidence opens with
`cli-auth.store.ts:39`. The novelty gate has the identical blind spot. So this
change reduces the treadmill rather than eliminating it, and the highest-value
follow-up is widening `findingLocation` to take the first citation that MATCHES
the finding's file (which the design doc already describes it as doing — the code
does not). That is a change to a shared gate input and belongs in its own PR.
