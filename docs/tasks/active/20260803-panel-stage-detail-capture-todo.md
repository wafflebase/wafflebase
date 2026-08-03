# Panel stage detail: record what the panel actually did

Producer only. One JSON file per lens per round, uploaded as an artifact, read by
nothing yet.

## The problem

#608 opened the feedback corpus on the grounds that **"nothing records outcomes, so
every tuning decision was argued from intuition"**. That is still true one stage
earlier, and worse: the panel's own decisions are not merely unscored, they are
**unrecoverable**. By the time a round ends, the only surviving evidence of what six
lenses detected and how the verifier ruled has been squeezed through two channels
that were built for other jobs.

`output.text` on each `agent-review-<lens>` check run is one of them, and it is
disqualified by construction:

- It keeps `critical`/`major` only, and drops `lane === 'backlog'` — so every minor
  finding, every nit, and the entire demoted lane the novelty gate (#583) exists to
  produce are absent.
- It drops **trailing findings** until the array fits 60k.
- `review-state.mjs` already refuses to trust it for the same reason, in as many
  words: *"the panel workflow trims it to fit a 60k limit by dropping findings, i.e.
  it is DESIGNED to lose data."*

`output.summary` is the other, and it is prose whose shape has drifted with
#573–#610 — a renderer, not a record.

Neither has ever carried the two things a scoring pass most needs, at any severity:
**which sample raised what** (`unionSamples` collapses the samples; `lensStats`
keeps `agreement` as a score, not the findings it scored) and **how the verifier
ruled on each finding** (`lensStats.verifier` keeps tallies; every verdict, ground
and citation is discarded).

So `misses.jsonl` can record that the panel was wrong about a PR, but nothing can
say *which stage* was wrong, or on which sample, or on what ground. This records
that, at zero model cost and with no new permissions.

## The change

- [x] `stageDetailCaptureEnabled(env)` in `review-panel.mjs` — the gate, and the
      only reason this needs tests at all (see *Fail directions*). **Default ON.**
- [x] `buildStageDetail({ lensDiff, scopeNote, samples, fresh, freshVerdicts,
      prior, priorVerdicts })` — pure, so "capture changes no verdict" is a property
      a test can assert rather than a claim a reader has to take on trust.
- [x] `writeStageDetail(lensOut, detail, env)` — dependency-free `writeFileSync`
      into the lens out dir the lens already owns, beside `verdict.json`. Returns
      whether it landed; swallows everything.
- [x] Called once per lens, after `gatingFindings(merged)` and before
      `writeVerdict` — verification is complete, so every verdict exists, and
      nothing has been written yet, so it reads exactly the values the check run is
      built from.
- [x] `samples` records the raw per-sample findings **before** `unionSamples` and
      before `clusterFindings`. That is the per-sample detection signal, and it is
      the one thing no other channel can be back-filled to produce.
- [x] `verifications` records every finding that reached the verifier, tagged
      `population: "fresh" | "prior-round"`, with its verdict and whether it
      dropped. `dropped` is recomputed through the real `isDroppingVerdict` rather
      than restated, so the capture cannot drift from the gate. `verdict: null`
      means the verifier errored and the finding was kept.
- [x] `lensDiff` is the **routed** slice (#582), not the PR diff — what makes a
      capture replayable, and 76–97% of the file's bytes.
- [x] `AGENT_STAGE_DETAIL_CAPTURE` repo variable → `STAGE_DETAIL_CAPTURE` in the
      "Run review panel" step's `env:`. Passed **raw**, with no YAML-side default.
- [x] A second `upload-artifact` step, `review-panel-stage-detail`,
      `.agent-review/*/stage-detail.json`, `if-no-files-found: ignore`,
      `retention-days: 30`, mirroring the existing step's
      `always() && steps.pr.outputs.number != ''` and `continue-on-error: true`.
- [x] 9 new tests. 501 agent tests, 500 pass / 0 fail / 1 pre-existing skip.

No new job permissions, and none wanted — see *Explicit non-goal*.

## Corrected from the plan

The writer was to be ported from the eval-harness branch, where it has run since
July. **Three of its four lines would now be wrong**, because #591/#601 moved
restatement clustering to *before* verification after that code was written.

- **`verdicts` is index-aligned to `detected`, not to `findings`.** The original
  mapped the fresh population over `findings` — the post-union, pre-cluster set —
  which was correct when the verifier ran on it. It no longer does: `clusterFindings`
  runs first and `verdicts` is built over its output. Copying the line forward would
  have paired findings with **other findings' verdicts** whenever a round clustered
  anything, and the pairing is the entire content of the file. This is the failure
  that would not have shown up in a test, only in a corpus that quietly disagreed
  with reality.
- **`isDroppingVerdict` takes `{ claimType }` now, not `verifyOpts`.** That
  parameter no longer exists; `verifyOpts` is gone from this scope entirely. Passing
  a stale options bag would have scored absence claims against presence grounds —
  silently, since the function's contract is to KEEP on anything it does not
  recognize.
- **`VERIFIER_MAX_TURNS` needed no export.** The original commit exported it for the
  harness. Upstream exports it already, and it is now `{ presence, absence }` rather
  than a scalar. Nothing to do, which is worth saying: the port's diff is smaller
  than the branch it came from, not larger.

The original also wrote inline in `main()` and had **no gate at all**. Splitting it
into a pure builder and a swallowing writer is what makes both properties below
testable.

## Fail directions, opposite on purpose

| path | on doubt | why |
|---|---|---|
| `writeStageDetail` (the write) | **no capture**, logged, returns `false` | it runs inside `Promise.all(allLenses.map(...))`, where a throw aborts every other lens. Losing one round's diagnostic costs a row in a dataset; failing the round blocks a PR on an instrumentation bug. There is no symmetry, so there is no case where a write error propagates |
| `stageDetailCaptureEnabled` (the gate) | **ON** | a repo variable that was never set arrives as the empty string, so the ordinary `if (env.X)` flag shape resolves "nobody configured it" to OFF. A diagnostic that is quietly absent is worse than one that is loudly broken: the corpus would look thin rather than unwired, and nothing would page |
| an unrecognized gate value (`"banana"`) | **ON** | same direction. Only `0`/`false`/`off` are off-words; anything else keeps the default |
| `buildStageDetail` (the payload) | a stable shape, never a throw | `lensDiff`/`scopeNote` degrade to `""` and a sample with no `findings` array to `[]`, so a consumer reading `detail.lensDiff.length` never has to guard the field's absence. A `null` row would have to be special-cased by every reader, forever |
| the upload step | `continue-on-error`, `if-no-files-found: ignore` | absent files are the *normal* case when capture is off or every lens skipped. Warning on that would train the pipeline's watchers to ignore a real warning |

The gate is the inverse of `AGENT_PIPELINE_ENABLED`'s `== 'true'` opt-in, and it is
resolved **in the script**, not in a YAML expression. A `&& 'x' || 'y'` default in
the workflow would put the inverted logic in the one place no test can reach it.

## Explicit non-goal

**This must not change a single verdict.** It is instrumentation placed inside the
decision path, which is the one thing that can go wrong here that would matter, so
the design is arranged to make it checkable rather than argued: `buildStageDetail`
is pure and asserted not to mutate its inputs, `writeStageDetail` touches only the
filesystem, and the call site consumes `lensDiff`, `ok`, `detected`, `verdicts`,
`priorForLens` and `priorVerdicts` without writing to any of them. Capture ON and
capture OFF differ by one file on disk.

**No consumer, and no collector job.** Nothing reads `stage-detail.json`. Moving
these artifacts into a store is a separate PR, and it is separate for a permissions
reason, not a tidiness one: this job's SDK working directory is the untrusted branch
checkout, so it is not granted the write scopes that would let it push data
anywhere. An artifact is the hand-off precisely because of that boundary, exactly as
it already is for `review-panel-execution`. **Nothing in this PR adds a permission**,
and a later collector must be its own job rather than a scope widened here.

**`stage-detail.json` must never enter a lens or verifier prompt** — the same
prohibition `misses.jsonl` carries, and for a stronger reason: `lensDiff` is a
verbatim copy of contributor-authored diff text. If it ever reaches a model it goes
in fenced as DATA, like the diff it contains.

## Verification

- [x] `node --test "scripts/agent/*.test.mjs"` — 501 tests, 500 pass, 0 fail, 1
      skipped (pre-existing). No `node_modules` needed for this lane.
- [x] The gate, in both directions: absent / `""` / `"   "` / `undefined` / `"1"` /
      `"true"` / `"on"` / `"yes"` / `"banana"` → **ON**; `"0"` / `"false"` / `"off"`
      / `"FALSE"` / `"Off"` / `" false "` → **OFF**. The empty-string case is the
      one that would silently unwire this and it is asserted with a message.
- [x] A failed write returns `false` and does not throw, on two real failure shapes
      and no mocks: a `lensOut` nested under a regular file (ENOTDIR from
      `mkdirSync`), and payloads `JSON.stringify` refuses (a circular reference, a
      `BigInt`).
- [x] OFF writes **nothing** — the lens out dir is not even created, so an opted-out
      run is byte-identical to today.
- [x] `buildStageDetail` does not mutate: findings and verdicts are
      `JSON.stringify`-compared before and after.
- [x] Non-blocking findings are excluded from `verifications`; a blocking finding
      with a missing verdict is recorded as `verdict: null, dropped: false`.

### Size, measured

Built with the real `lensReviewPlan`/`sliceDiffByFile` routing over four actual
upstream commits, with two findings per sample and three verifier verdicts per lens:

| PR diff | lenses applicable | per run, raw | largest lens |
|---|---|---|---|
| 9.6 KB (#638) | 2 | 25 KB | 12.7 KB |
| 17.4 KB (#636) | 5 | 105 KB | 21.0 KB |
| 204.6 KB | 6 | 1.0 MB | 214.7 KB |
| 470.7 KB | 6 | 2.0 MB | 486.4 KB |

`lensDiff` is 76–97% of every file, so this tracks diff size and nothing else.
**The planned "30–80 KB per lens" holds only for small PRs** — a 470 KB diff costs
~2 MB per run, 25× the planned ceiling. It is still not a problem:
`upload-artifact@v4` deflates, and these diffs compress 3.1–3.6×, so the worst
case above stores as ~0.6 MB and a typical round as under 10 KB. At a few PRs a day
and 30-day retention that is single-digit MB standing.

Routing narrows less than its name suggests on this repository — most lenses read
source files, so `lensDiff` came out within 0–30% of the full diff on all four
samples. Worth knowing before anyone counts on #582 for size rather than for focus.

## Not built

- **A collector.** Downloading these into a store, keyed by run and commit, is the
  next PR. It needs write scopes this job must not have.
- **Anything that reads the file.** No schema module, no validator, no projection.
  The producer is deliberately shaped as JSON with a stable field set so that a
  consumer can be written against it later without a migration; that is the whole
  extent of the forward commitment.
- **`agent-review-on-demand.yml`.** It runs the same panel, so capture is ON there
  and the files are written — but it uploads no artifact (it does not upload the
  execution log either) and its rounds record no check runs and drive no
  promote/fix loop. Advisory `@claude review` invocations are not the population a
  tuning corpus should be scored on. Wiring it up is a one-step addition if that
  changes.
- **A real end-to-end panel run.** The sizes above are computed from real diffs
  through the real routing code, not read off a completed workflow. The first
  managed PR after this merges will produce the artifact; the number to check
  against the table is the largest per-lens file.
