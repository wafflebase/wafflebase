# Incremental review: the wiring (turn it on)

#581 landed the decision logic inert. This connects it: the panel now stamps what
each lens reviewed, resolves the next round's scope from those pointers, and
reviews only the delta when every condition holds.

## What this PR does

- [x] `scripts/agent/review-scope.mjs` — the caller `review-state.mjs` was written
      for. Reads each lens's pointer (checks API), measures the range (git), calls
      `resolveReviewMode`, emits `mode` / `since` / `reason` / `rounds` as step
      outputs. `decideScope` and `gitFacts` take their API and git runners as
      arguments, so the composition is tested rather than only its parts.
- [x] `scripts/agent/gh-checks.mjs` — the two check-run API contracts, stated once
      and shared by `review-scope.mjs` and `prior-findings.mjs` (see below).
- [x] `review-state.mjs` — `agreedReviewedSha` exported so the two-phase caller
      contract is usable, not just documented. `resolveReviewMode` uses it
      internally, so the two cannot disagree about which pointer is in play.
- [x] `review-panel.mjs` — `--head-sha`; `panelEntry` owns the write rule.
- [x] `agent-review-panel.yml` — scope step, narrowing step, the new flags, and
      `external_id` on each check run.
- [x] Both workflows — the inline prior-findings `github-script` replaced by
      `prior-findings.mjs`. On-demand already had `checks: read` (from #558).

## The two-phase contract, and why it exists

The inputs are circular: `resolveReviewMode` needs git facts about `since..head`,
and `since` is only knowable after reading the pointers. So `decideScope` asks
`agreedReviewedSha` first and measures git **only over the range it is about to
narrow to**.

This is the hazard `resolveReviewMode` cannot detect — it is *handed* the facts, so
facts measured over a different range would validate one range and narrow another.
The test asserts it by capturing the argv git receives, not by trusting the shape.

## Where the fail directions differ, on purpose

| step | on failure | why |
|---|---|---|
| `Resolve review scope` | tolerated → full review | It only computes. Every internal failure already resolves to `full`; `continue-on-error` covers the class the script cannot catch (module resolution, missing node). A bug in a cost optimiser must not block a PR. |
| `Narrow the reviewed diff` | **fails the job** | It MUTATES the reviewed artifact. Tolerating a failure between replacing `/tmp/pr.diff` and writing `mode` would hand the panel a narrowed diff with no flag — a lens reviewing a fragment while believing it is the whole PR. `review-panel.mjs` cannot detect that: it receives a file, not a range. |
| `Read prior findings` | tolerated → carry none | Prior findings can only re-raise a blocker, never clear one. |

The flag and the diff come from the **same step**, which is what makes them
inseparable. When narrowing does not happen its outputs are empty, the panel gets
no flag, and the full diff written earlier stands — so the existing diff step is
left byte-identical to the on-demand workflow's copy of it.

## The write rule is a function

`panelEntry` attaches the pointer only when `valid === true` and the conclusion is
not `skipped`. Every call site passes `reviewState` unconditionally and the rule
still holds.

It became a function because the first version was a rule the three `panel.push`
sites were trusted to follow, guarded by a test that scanned the source for which
one carried the field. **That test passed** when the pointer was also attached to
the fail-closed entry by a separate `entry.reviewState = ...` — see the lessons
file.

## Deduplication, not a third copy

`prior-findings.mjs` and `review-scope.mjs` both need "every check run on this PR's
commits". That logic carries two contracts this repo has now got wrong twice: the
list response omits `output.text`, and the object-wrapped check-runs endpoint needs
`--slurp`. Each failure is silent and reads as "carried 0 findings". They live in
`gh-checks.mjs` once. `parseArgs` moved there too rather than becoming a fifth copy.

`review-round-guard.mjs` is deliberately **not** refactored onto it: it feeds the
paging path, and pulling a gate file into this change trades a real risk for a
cosmetic one.

## Verification

- `agent:tests`: **225 tests** green (was 224 on `main`); `review-scope.test.mjs`
  is new, `prior-findings.test.mjs` re-pointed at the shared `parseArgs`.
- `pnpm verify:self` green. Both workflows parse.
- **`gitFacts` verified against real git**, not only stubs — a wrong flag would
  yield `null`, resolve to `full`, and be a silent permanent no-op that stubs
  cannot catch. On `origin/main~4..origin/main`: `isAncestor: true`,
  `hasMergeInRange: false`, `deltaLines: 4521`; reversed → `isAncestor: false`;
  a nonexistent sha → all `null`; same sha → `0`.
- **`review-scope.mjs` run end-to-end against the real API** (PR #581): enumerated
  its commits, fetched check runs with `--slurp` without a parse error, found no
  pointers, emitted `mode=full reason=no-prior-state`.
- **The narrowing path proven with real git** and a stubbed API (we cannot write
  `external_id` without `checks:write`): default cap → `delta-too-large` on a real
  1670-line range, raised cap → `incremental` with the correct `since`,
  `fullEvery: 1` → `periodic-rebaseline`.

What none of this covers: `external_id` actually round-tripping through the checks
API. Nothing local can write one. **Round 1 after merge will still be `full`
(`no-prior-state`); round 2 is the first that can narrow** — that is the signal to
watch, along with the `Review scope:` line in the run summary.

## Follow-ups, deliberately not here

- `fullEvery = 3` and `maxDeltaLines = 400` still have no data behind them. They
  are parameters; tune once there are real round counts.
- The `scopeDigest` interaction with `feat/file-class-routing` — noted in the
  design doc, needed only if that PR lands.
- Surfacing `reason` in the metrics comment as well as the step summary.
