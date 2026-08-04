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

---

# Follow-up: tier the diff out of the capture

Producer only, still read by nothing upstream. `lensDiff`'s **content** becomes
opt-in; the default path keeps a hash, a byte count and the routed file list.

## The problem

The table above answered "how big is this?" and moved on. It should not have. Two
of its own numbers are the problem: `lensDiff` is **76–97% of every file**, and a
470 KB diff costs ~2 MB per run — 25× the ceiling this was planned against.

Size is only half of it. Every other field in `stage-detail.json` is data this
pipeline generated about itself — findings it raised, verdicts it reached, a scope
note it rendered. `lensDiff` alone is a **verbatim copy of contributor-authored
text from a possibly-forked branch**. The section above already flags that
(*"if it ever reaches a model it goes in fenced as DATA"*) and then carries it on
every round anyway, for the benefit of a consumer that does not exist yet.

And it is carried for one job only: **replay** — feeding a lens exactly the bytes
it saw, which is what detection-stage reliability, per-lens detection validity and
fixed-corpus panel comparison all need. The ordinary consumer of this data, a pass
that scores findings, never opens it. So the bulky, third-party, attacker-shaped
field rides along by default while earning its place only on demand — exactly
backwards.

**Why not drop it and re-derive the slice from the SHAs later?** One reason that is
decisive on its own, and one that is real but weaker than it first looks:

1. **The slice is not a function of the diff alone.** It is the output of the
   file-class router (#582) applied to the diff, and that router has already
   changed once and can change again. Re-deriving with a newer router yields
   different bytes than production used, *silently* — which defeats the single
   property the field exists to provide. Perfect retention of every commit does
   not fix this, which is why it, and not reachability, carries the case. In
   incremental mode it is worse still: the slice is a function of two SHAs *plus*
   the router.
2. **Recovering the input depends on things this repository does not control.**
   `refs/pull/N/head` does survive a squash merge and a deleted branch, so a
   merged PR's tree is normally still fetchable — see *Corrected from the plan*,
   because the original justification here was wrong. What remains is thinner but
   real: recovery relies on GitHub's PR-ref retention, and it requires knowing
   *which* SHA each round actually reviewed. The fix loop appends commits, so a
   PR's head has usually moved on by the time anyone looks.

Hence the shape below: keep a **hash**, so drift stays detectable whether or not
the input can be recovered, and keep the **content** only when replay is intended.

## The change

- [x] `stageDetailDiffContentEnabled(env)` — `STAGE_DETAIL_DIFF_CONTENT`.
      **Default OFF**, the deliberate inverse of `stageDetailCaptureEnabled`'s
      default ON. See *Fail directions*; the asymmetry is stated in the code
      comment, the workflow comment and here, because a flag that looks
      inconsistent is exactly what a later reader "fixes".
- [x] `lensDiffSha256` — SHA-256 of the **raw** router output, emitted in **both**
      modes so the drift guard reads one field regardless of configuration.
- [x] `lensDiffBytes` — UTF-8 byte length. Makes corpus sizing and empty-slice
      detection possible with no body present.
- [x] `lensFiles` — the paths in the routed slice, via the same `sliceDiffByFile`
      the router used, so it cannot drift from what the lens saw. This is the
      field that keeps the scope-discipline metric computable once the body is
      gone, and it is **not** recoverable later: `pulls/{n}/files` returns the PR's
      *current* diff, not the slice reviewed at this round.
- [x] `lensDiff` is **omitted**, not emptied, when content is off — see *Corrected
      from the plan*.
- [x] `lensDiffMetadata` derives all three; only the `createHash` call is guarded,
      because `Buffer.byteLength` and `sliceDiffByFile` are total over a string
      and the router already runs the latter over the whole diff every round.
- [x] `AGENT_STAGE_DETAIL_DIFF_CONTENT` repo variable → `STAGE_DETAIL_DIFF_CONTENT`
      in the "Run review panel" step's `env:`. Passed **raw**, no YAML-side
      default, for the same empty-string reason as the capture flag.
- [x] 8 new tests. 512 agent tests, 511 pass / 0 fail / 1 pre-existing skip.

## Corrected from the plan

- **The "commits become unreachable" premise did not survive checking, and the
  case is better without it.** The plan justified the hash partly on 13 of 15
  surveyed PRs having lost their `agent-review-*` check runs, attributed to the
  fixer force-pushing. **This pipeline does not force-push, and is explicitly told
  not to** — `agent-review-panel.yml` instructs the fixer in as many words:
  *"Append a follow-up commit (do NOT force-push)"*. Nothing contradicts it: there
  is no `--force`, `--force-with-lease`, `push -f` or `commit --amend` anywhere in
  `.github/workflows/` or `scripts/agent/`; `agent-iterate-ci.yml` pushes with
  `git push --no-verify` and `agent-implement.yml` with `git push -u origin`, both
  appending. Nor does squash-merging orphan a branch's commits:
  `refs/pull/N/head` survives the merge *and* the branch deletion, which is the
  ordinary way a squashed PR's tree is recovered. Missing check runs on a PR's
  **current head** are what appending commits produces — the runs sit on an
  earlier SHA — and that is a different fact from anything being unreachable. The
  router argument was always the stronger one and now stands alone, which costs
  the design nothing: it is the reason retention cannot rescue a re-derived slice
  in the first place.
- **Omitting the field beats emptying it, and the consumer is why.** The plan said
  "content behind a flag" without saying what the off path emits. The merged
  builder degrades a missing `lensDiff` to `""`, so the obvious implementation
  leaves `lensDiff: ""` in place — and that is **wrong in a way that would not
  fail a test**. The existing consumer keys on `typeof detail.lensDiff ===
  "string"` and, finding no entry, falls back to the full PR diff — the path built
  for captures written before `lensDiff` existed. `""` is a real value the router
  produces for a lens whose slice is empty, so an emptied field would be taken
  literally and **replay the lens against nothing**, quietly, instead of landing on
  the fallback that is already there. Absence is the shape that route already
  understands.
- **The builder is not inside the writer's `try/catch`.** The hazard as written was
  "stay inside the existing `try/catch`". There isn't one to stay inside:
  `buildStageDetail` is evaluated as an *argument* to `writeStageDetail`, so it
  runs before the guard, inside `Promise.all(allLenses.map(...))`. A throw there
  takes out the whole panel. The hash therefore carries **its own** guard rather
  than relying on one that does not cover it — the same conclusion, reached from
  the opposite fact.
- **One existing assertion had to be inverted, not adjusted.** The merged test
  *"a missing lensDiff or scopeNote degrades to an empty string"* justified itself
  with *"a consumer reading `detail.lensDiff.length` never has to guard the field's
  absence"*. That reasoning is now exactly backwards, so the test was replaced
  rather than patched, and the corresponding *Fail directions* row above is
  superseded by the one below.
- **The estimated 5–10× reduction holds only at the bottom of the range.** Measured
  below: 4.7× on the smallest PR and 69× on the largest. The default payload
  scales with file count and finding count rather than with diff bytes, so the
  ratio is not a constant — it grows with exactly the diffs that were the problem.

## Fail directions

| path | on doubt | why |
|---|---|---|
| `createHash` throws (a crypto policy that refuses SHA-256) | **omit `lensDiffSha256`**, keep the rest, never throw | a capture must never fail a review round, and `buildStageDetail` runs *outside* `writeStageDetail`'s `try/catch` — inside `Promise.all(allLenses.map(...))`, where a throw aborts every other lens. A missing hash costs a drift check on one row; a thrown one blocks a PR on instrumentation |
| `stageDetailDiffContentEnabled` (the flag) | **OFF** | unset / `""` / whitespace all mean OFF. Inverted from the capture gate on purpose: an unconfigured repo must not start shipping verbatim third-party diff text, and the hash still detects drift without it. The cost of a wrong default here is bulk and attack surface; there, it was a silently unwired diagnostic |
| an unrecognized flag value (`"banana"`, `"yes"`) | **OFF** | each gate falls to its **own** default on a value it cannot parse. That is why `"banana"` is ON for capture and OFF here — one rule, two defaults, not two rules |
| `lensDiffBytes` / `lensFiles` | derived unguarded | both are total over a string, and `sliceDiffByFile` already runs over the whole diff on every round in the router. Wrapping them would add a degraded shape with no failure mode to reach it |
| `buildStageDetail` (the payload) | a stable shape, never a throw — but `lensDiff` **absent**, not `""` | **supersedes the equivalent row above.** Every field the capture emits still degrades to a stable value; the diff body is now a field it may legitimately not emit *at all*, and its absence is the signal the consumer's pre-`lensDiff` fallback already reads |

## Explicit non-goal

**No verdict may change. This is serialisation only** — which byte of the input is
recorded, not which findings are. Both modes derive from the same inputs, neither
mutates them, and a test asserts the two payloads are **identical except for the
body**. Everything the section above says about `buildStageDetail` being pure still
holds; nothing was moved into or out of the decision path.

**No consumer changes.** Upstream still reads `stage-detail.json` nowhere, so this
is writer-only. The fork-side eval consumers already handle an absent `lensDiff`
(that is the path this omission targets) and are updated separately.

**No change to which findings are captured.** `samples`, `verifications`,
`scopeNote` and the population split are untouched. The only question this PR
answers differently is whether the diff *content* rides along.

## Verification

- [x] `node --test "scripts/agent/*.test.mjs"` — 512 tests, 511 pass, 0 fail, 1
      skipped (pre-existing). No `node_modules` needed for this lane.
- [x] Flag off → **no `lensDiff` key** (asserted with `in`, not `=== ""`), hash,
      bytes and file list all present.
- [x] Flag on → body present **and** byte-identical to the router's output, with
      the same hash as the off path.
- [x] The hash is a known-answer constant, not a recomputation: a literal digest
      for the empty string and for a two-file fixture. Recomputing the expectation
      with the same `createHash` call would assert only determinism.
- [x] The hash is of the **raw** slice: six byte-distinct variants of one diff
      (leading space, trailing space, extra newline, CRLF, trimmed) must produce
      six distinct digests, so a trim or a normalisation cannot creep in unnoticed.
- [x] `lensFiles` from a multi-file slice, in slice order; `lensDiffBytes` in
      UTF-8 bytes, asserted against a multi-byte string where it exceeds
      `String.length`.
- [x] The default payload round-trips through `JSON.stringify`/`parse` unchanged.
- [x] Both gates, in both directions, including the unrecognized-value case that
      demonstrates each falling to its own default.

### Size, measured

Same method and the same four commits as the table above — real diffs through the
real `lensReviewPlan`/`sliceDiffByFile` routing, two findings per sample, three
verifier verdicts per lens. The "body ON" column reproduces that table, which is
what makes the comparison a like-for-like one:

| PR diff | lenses | per run, body ON | per run, **default** | reduction | largest lens, default |
|---|---|---|---|---|---|
| 9.6 KB (#638) | 2 | 24.9 KB | **5.2 KB** | 4.7× | 2.6 KB |
| 17.4 KB (#636) | 5 | 104.2 KB | **13.7 KB** | 7.6× | 2.7 KB |
| 204.6 KB (#588) | 6 | 1002.2 KB | **18.4 KB** | 54.5× | 3.3 KB |
| 470.7 KB (#622) | 6 | 2029.5 KB | **29.5 KB** | 68.7× | 5.5 KB |

What the default path drops is the diff's **volume**, not its every trace. The
payload still carries `lensFiles`, which grows with the number of files routed to
each lens, and on these four samples that term is 2%, 6%, 16% and **48%** of the
payload respectively (2, 25, 86 and 284 routed paths). On a wide PR the file list
is the single largest thing left in the file.

So the honest claim is the narrow one: the payload no longer scales with how much
was *written*, only with how many files were touched and how many findings were
raised. Growth is sub-linear rather than absent — 5.7× more payload across 49×
more diff. That is still the result worth having: the 2 MB worst case becomes
29.5 KB, which turns the collector job's storage question into a much smaller one
without pretending it has disappeared.

---

# Follow-up: route the capture out — from both panels

Two changes that are one change. The capture has never left a runner: the upload
step could not see the files it was pointed at. Fixing that also settles where the
second producer's copy goes, because the fix is the reason a naive copy of the step
would have failed the same way.

1. **The glob never matched.** `.agent-review` is a dot-directory, and
   `upload-artifact` excludes hidden paths by default. Five real panel runs, zero
   artifacts.
2. **`agent-review-on-demand.yml` now uploads the same capture.** #641 left this
   under "Not built"; the reason it gives holds for scoring the gate and not for the
   measurement this feeds. See "Why the second producer" below.

They ship together because the invariant test written for (1) is what proves (2)
correct — it scans every workflow's upload steps, so the new step is covered with no
additional test, and would have failed without the flag.

## The problem

The section above closes with a prediction: *"the first managed PR after this
merges will produce the artifact."* It did not, and neither did the four after it.
Every panel run since #641 merged that provably reached the lenses —
`30799533061`, `30803409664`, `30803718950`, `30836949850`, `30837818619` — logged

```
No files were found with the provided path: .agent-review/*/stage-detail.json.
```

Five rounds of capture, zero rows collected.

Nothing in the script is at fault, and the same job proves it. In run
`30837818619` all six lenses reported `success`, so each one passed the
unconditional `writeStageDetail` call — it sits after the skip and fail-closed
returns and before the verdict write, so a lens that produced a verdict went
through it. `STAGE_DETAIL_CAPTURE` echoes **empty**, which
`stageDetailCaptureEnabled` resolves to ON exactly as the fail-direction table
above intends. No `stage-detail capture failed (continuing)` line, so nothing
threw. And the per-lens directories demonstrably held real content: each check
run's `output.summary` is 836–2,838 characters read straight out of
`.agent-review/<lens>/summary.md`, written by `writeVerdict` into the *same*
`lensOut` from the *same* `mkdirSync`.

The fault is in the glob. `upload-artifact` resolves patterns through
`@actions/glob` with `excludeHiddenFiles: !include-hidden-files`, and
`include-hidden-files` defaults to **false**. The globber's search root is the
pattern's non-wildcard prefix — for `.agent-review/*/stage-detail.json` that is the
**directory** `.agent-review` — and its traversal skips any item whose basename
starts with a dot:

```js
// @actions/glob/lib/internal-globber.js
if (options.excludeHiddenFiles && path.basename(item.path).match(/^\./)) {
  continue;
}
```

The root is the first item on the stack. It is skipped before `readdir`, so the
entire subtree is never enumerated. Not "the files were filtered out" — the
directory was never opened.

What made this read as a write bug for so long is the sibling step. **The
execution-log upload, in the same job, from the same hidden directory, works.**
It names its two files literally, so each search root is the *file*, whose basename
is not hidden, and no hidden component is ever inspected. One step succeeding and
one step silent, three lines apart in the same YAML, is the whole reason the
evidence pointed at `writeStageDetail`.

`ci.yml`'s `.harness-reports/` upload already carries `include-hidden-files: true`
for precisely this reason. #641 did not carry it across.

## The change

- [x] `include-hidden-files: true` on the `Upload per-lens stage detail` step, with
      the mechanism written down at the point of use — the flag reads as being
      about *files* and is in fact about the *directory*, which is why copying the
      step elsewhere without it will fail the same way.
- [x] Amend the `if-no-files-found: ignore` comment to say what it cannot do. It is
      still correct (capture off, or every lens skipped, are both normal), but it
      is also what turned this into five silent rounds, and the next reader deserves
      both halves.
- [x] One test, in `review-panel.test.mjs` beside the `writeStageDetail` tests:
      parse every `upload-artifact` step out of the real workflows and require
      `include-hidden-files: true` on any path that makes the globber **walk** (a
      wildcard, or a trailing `/`) through a dot-prefixed segment. Comment lines are
      stripped first, the same trap #630/#640/#651 each hit; a literal file path is
      correctly exempt, because that is genuinely immune.
- [x] The same step in `agent-review-on-demand.yml`'s `review` job, after the panel
      runs and before the comment is posted — so the capture survives even when the
      comment step fails. Same name, path, retention and flag.
- [x] `STAGE_DETAIL_CAPTURE` / `STAGE_DETAIL_DIFF_CONTENT` on the on-demand panel
      step, passed RAW. A **no-op today** — both repo variables are unset, which is
      the same ON/OFF pair this job already resolved by passing neither. What it buys
      is that the two producers cannot drift the moment someone sets one.
- [x] The test asserts the **pair**, not one step: two producers, one name, one
      path, both flagged. `filter`, not `find` — with two identically-named steps a
      `find` would assert about whichever file the directory listing yielded first
      and leave the other free to regress.

## Why the second producer

#641 filed on-demand parity under "Not built": *"advisory `@claude review`
invocations are not the population a tuning corpus should be scored on."* That is
right about scoring **the gate** and does not apply to the measurement this feeds.

Severity-weighted precision has `minor` and `nit` buckets and the independent
reviewer we compare against is nit-heavy, so separating *"we missed it"* from *"we
found it and called it minor"* requires the panel's **non-blocking** findings.
`samples` is the only channel that carries them — its own sibling `verifications` is
blocking-only, and every permanent channel (check-run `output.text`, the rendered
comment) is critical/major. Measured over all 17 real on-demand comments: **249
blocking against 387 non-blocking** (25 critical / 224 major / 315 minor / 72 nit).

So advisory rounds are still not scored as gate decisions. Their per-sample
severities are the comparison data, which is a different use and the one that was
otherwise uncomputable.

Uploading from that job needs no new permission and grants none: `upload-artifact`
requires no scope, and the job keeps `checks: read` with no `checks: write`. The glob
cannot pick up a branch-planted `.agent-review/evil/stage-detail.json` because
"Clear stale verdicts" does `rm -rf .agent-review` before the panel runs. The gating
`review-panel` job has the identical property — its SDK cwd is the untrusted branch
checkout too — and already uploads two artifacts.

## Corrected from the plan

- **"Ruled out: hidden-file exclusion, because the sibling upload succeeded from
  the same hidden directory."** Wrong, and wrong in the most useful way — the
  sibling's immunity *is* the mechanism, not evidence against it. A glob and a
  literal path resolve through different code in `getSearchPaths`, so "same
  directory, same job, one worked" says nothing about the other.
- **"A throwaway diagnostic PR is the next step."** Not needed. `@actions/glob` is
  40 lines of readable traversal and the option is a published input; a local
  repro against the real package answered it in one run, and no CI round was spent.
- **"Perhaps no panel ran after #641 merged."** They ran. Most `agent-review-panel`
  workflow runs carry **no artifacts at all**, because the `gate` job exits before
  `review-panel` starts — so a run list is not a panel list. The five above are the
  ones holding `review-panel-execution`, which is proof the job reached the
  uploads.

## Fail directions

| path | on doubt | why |
|---|---|---|
| the upload glob | **upload**, including dot-prefixed paths | the population is written by this pipeline into a directory this pipeline chose. There is no untrusted content to exclude here: the branch's own `.agent-review` is `rm -rf`-ed before the panel runs, and `include-hidden-files` still only admits paths the pattern already matched |
| `if-no-files-found` | stays `ignore` | unchanged and still right — an empty capture is normal. The lesson is not to make it warn, it is that a *tolerant* step needs its precondition pinned by a test rather than watched by a human |
| the new test | **fails loudly** | it is the only thing standing between a future hidden-path upload and another five silent rounds. It asserts the parser found ≥8 of the repo's 11 upload steps and that at least one hidden glob exists, so it can never pass by finding nothing |
| the on-demand upload step | `if: always()`, `continue-on-error` | it must not be able to fail an advisory review. It sits before the comment step so a capture survives a failed comment, and after the panel so there is something to capture |
| the on-demand `STAGE_DETAIL_*` pair | passed **raw**, resolved in the script | the same reason #641 gives for the gating twin: a `&& 'x' \|\| 'y'` default in YAML puts the inverted logic where no test can reach it. `stageDetailCaptureEnabled` is tested; a workflow expression is not |

## Explicit non-goal

**No script change, and no change to what is captured.** `writeStageDetail`,
`buildStageDetail`, the gate and the payload are all untouched and were never
wrong. Both producers already wrote these files; only the route out is new. The five
lost rounds are not recoverable and are not worth trying to recover: they are five
rows of a corpus that will have thousands.

**No collector, still.** Nothing reads `stage-detail.json` after this. Two producers
instead of one is the point of doing them together — the collector gains a second
source with no new case to handle.

**No advisory round is made gating.** No check run, no conclusion, no required check,
no new scope. The on-demand job's permissions are byte-identical before and after.

## Verification

- [x] **The mechanism, reproduced locally.** `@actions/glob@0.5.0` against a
      `.agent-review/{correctness,docs}/stage-detail.json` fixture, with
      `upload-artifact`'s own glob options:

      | pattern | excludeHiddenFiles | files found |
      |---|---|---|
      | `.agent-review/*/stage-detail.json` | `true` (today) | **0** |
      | `.agent-review/*/stage-detail.json` | `false` (fixed) | 2 |
      | the two literal execution-log paths | `true` | 2 |
      | the two literal execution-log paths | `false` | 2 |

      The debug output names the cause outright: the glob's search path is the
      directory `.agent-review`, the literal paths' search paths are the files.
      This is the production log, both steps, exactly.
- [x] **Artifact layout after the fix.** One search path, so `search.ts` returns
      `rootDirectory: searchPaths[0]` — the artifact holds
      `<lens>/stage-detail.json`, which is the layout the collector was planned
      against. Unchanged by this fix; confirmed, not assumed.
- [x] `node --test "scripts/agent/*.test.mjs"` — **658 tests, 657 pass, 0 fail, 1
      skipped**; 657/656 on `upstream/main` (`dfc7ec674`).
- [x] **The test fails on all three regressions**, each naming the right file:

      | tree | assertion that fires |
      |---|---|
      | the gating step without the flag (= #641 as shipped) | `agent-review-panel.yml "Upload per-lens stage detail" globs the hidden path … without include-hidden-files: true` |
      | the on-demand step without the flag (= a naive copy) | same message, `agent-review-on-demand.yml` |
      | the on-demand step deleted | `both the gating and the on-demand panel must upload the stage-detail capture` |

      The middle row is why these ship together: the test written for the bug is what
      makes the parity step correct, with nothing added.
- [x] The invariant holds across every existing upload step: `ci.yml`'s
      `.harness-reports/` already sets the flag; `docker-publish.yml`'s
      `${{ runner.temp }}/digests/*` has no hidden segment; every
      `claude-execution-output.json` and `.tgz` upload is a literal path.
- [x] **Both workflows parse**, and the on-demand `review` job's permissions are
      unchanged: `{contents: read, pull-requests: read, checks: read, issues: write}`
      — no `checks: write`, no addition.
- [ ] **The artifact itself, from either producer.** Still unverified end-to-end and
      cannot be from here: the gating side needs one managed PR to run the panel, the
      on-demand side one `@claude review`. The number to check against the size table
      is the largest per-lens file, which is the check #641 asked for and never got.
- [ ] **Two producers, one artifact name — a collector requirement, recorded now.**
      `stage-detail.json` carries no field naming the workflow that wrote it, so a
      collector resolving "artifacts named `review-panel-stage-detail` for PR X"
      gets both producers with nothing in the payload to tell a gating round from an
      advisory one, and would double-count one head sha as two rounds. Recoverable
      from run metadata (`event: issue_comment` versus the panel's `workflow_run`).
      Not a blocker here; it must be settled in the collector.
