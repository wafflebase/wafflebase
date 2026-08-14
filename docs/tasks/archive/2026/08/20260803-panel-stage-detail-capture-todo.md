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
- [x] **The artifact itself, from either producer** — verified 10 Aug 2026
      against production. Both producers have uploaded real captures:
      `agent-review-panel.yml` (`event: workflow_run`, `channel: gating`) and
      `agent-review-on-demand.yml` (`event: issue_comment`, `channel: advisory`),
      25+ artifacts standing. **The largest per-lens file, which #641 asked for
      and never got: 32.0 KB** (PR 757, `design-fit`), against 24.2 KB (PR 738,
      `correctness`), 15.6 KB (PR 718) and 9.4 KB (PR 734). Their PR diffs were
      25.6 / 18.0 / 13.7 / 15.8 KB.

      **This is 3.5–12× the size table's default-path prediction** (2.6–5.5 KB
      largest lens). The table modelled two findings per sample and three
      verifier verdicts per lens; a real round carries more findings and much
      longer evidence prose, and that term — not diff volume — now dominates
      the file. The direction of the earlier conclusion is unchanged and the
      absolute cost is still negligible (a whole round zips to 10–29 KB), but
      the "largest lens, default" column under-predicts and should not be
      quoted as a ceiling.
- [x] **Two producers, one artifact name** — settled in the payload, not
      deferred to the collector. The artifact name now carries the PR
      (`review-panel-stage-detail-pr-<N>`) and `meta.json` names the producer
      directly: `workflow` (`agent-review-panel.yml` vs
      `agent-review-on-demand.yml`), `channel` (`gating` vs `advisory`),
      `event`, `runId` and `runAttempt`. A collector no longer has to recover
      the distinction from run metadata, so the double-counting risk this item
      recorded cannot arise.

---

# Follow-up: record the lane the gate routed on

Two lines. The capture records every finding that reached the verifier and what the
verifier said, and omits the one thing the **gate** decided: which lane the finding
was routed to. That field cannot be added later, which is the only reason this is
worth its own change rather than waiting for a consumer to need it.

## The problem

`annotateFindings` attaches `lane` — `blocking`, `discarded` or `backlog` — and it
returns copies (`{ ...f, lane }`), which is what makes it safe. The capture is handed
the array that went *in*:

```js
const kept = keepUnrefuted(
  annotateFindings(detected, verdicts, await noveltiesFor(detected)),  // labels land here
);
…
writeStageDetail(lensOut, buildStageDetail({ fresh: detected, … }));   // this gets the unlabelled array
```

The annotated array is never named, so nothing else can reach it.

Two of the three lanes survive that loss; one does not.

| lane | in a capture written today | why |
|---|---|---|
| `discarded` | **recoverable** | `dropped` on each row is `isDroppingVerdict` over the recorded verdict — the same predicate, already stored |
| `blocking` | **recoverable** | it is the residue: neither dropped nor demoted |
| `backlog` | **gone** | set from `novelty.origin`, which is a `git blame -C -C -C` of the tree *as it stood during the review* |

`backlog` is why this cannot wait. The blame runs against the branch under review;
once that branch moves the answer is unobtainable, and the artifact expires at 30
days regardless. So a capture written without the lane is indistinguishable from one
where nothing was demoted — which is the difference between *"this finding blocked
the PR"* and *"this finding was waved past."* That is the whole question a gate is
scored on, and #608 opened this corpus on the grounds that nothing records it.

This is the third follow-up on the same capture, and all three are the same shape: a
producer gap found by trying to consume the output. Worth naming as the expected
case rather than a run of bad luck.

## The change

```js
const annotatedFresh = annotateFindings(detected, verdicts, await noveltiesFor(detected));
const kept = keepUnrefuted(annotatedFresh);
…
fresh: annotatedFresh,   // was: fresh: detected
```

No new argument, no new field computed anywhere, no additional `git blame` — the
novelties were already awaited on that line for the gate's own use. `annotateFindings`
**maps**, so the array is the same length in the same order as `detected`, which is
what lets it stand in without disturbing the `freshVerdicts` pairing.

`novelty` rides along with the lane, so a later pass can read *why* a finding was
demoted instead of trusting the label.

### Why `fresh` only

`prior` is deliberately left raw. Prior-round findings are annotated with `null`
novelties on purpose — probing a stale line offset could permanently demote a
still-open blocker — so their lane is fully derivable from the verdict already on the
row. Annotating them would add a field carrying nothing a reader could not compute.

### Why not compute the lane inside `buildStageDetail`

It would be a second router, able to disagree with the first. `routeFinding` is the
one routing rule and the gate's own; the capture records its output rather than
re-deriving it. Same reason `dropped` is recomputed through the real
`isDroppingVerdict` instead of being restated.

### The reader contract, stated because absence is ambiguous

A **missing** lane means *unknown*, never *blocking*. Every capture written before
this has no lane at all, and a consumer defaulting absence to `blocking` would score
demoted findings as gating ones — the exact error this change exists to prevent,
reintroduced at the other end. Non-blocking findings are the one exception:
`annotateFindings` returns them untouched by design, so for a minor or nit, absence
is not missing data.

## Fail directions

- **The capture stays best-effort.** Unchanged: `buildStageDetail` is still pure and
  still runs as an argument to `writeStageDetail`, whose `catch` swallows everything.
- **Gating is untouched.** `kept` is still what flows to the merge, the cluster and
  the verdict. The new name is read by the capture only.
- **A misalignment would be silent, so it is pinned.** Passing `kept` — the filtered
  array — would also carry lanes and look right, while pairing every row after the
  first drop with another finding's verdict. There is a test whose whole job is that
  this is not what happens.

## Explicit non-goal

**No behaviour change.** No lens, no verifier, no lane assignment, no gate decision,
no check run, no permission. The routing this records already happened on every round;
the only difference is that it is now written down.

**No collector, still.** Nothing reads `stage-detail.json`. This makes the artifact
worth reading; it does not read it.

**Nothing recovered retroactively.** Captures from before this — of which there are
zero, per the section above — would not gain the field, and the blame they would need
is already gone.

## Verification

- [x] `node --test "scripts/agent/*.test.mjs"` — **666 tests, 0 fail**, against 663 on
      `upstream/main` (`d02973a14`). Exactly +3. Both numbers are given for each SDK
      state, because the skip count moves with it and a single figure would not
      reproduce:

      | Agent SDK | branch | `upstream/main` |
      |---|---|---|
      | installed | 666 tests, 665 pass, 1 skipped | 663 / 662 / 1 |
      | absent (the `agent:tests` lane) | 666 tests, 660 pass, 6 skipped | 663 / 657 / 6 |

      Measured from the committed tree (`git archive`), not the working copy.
- [x] `eslint scripts` — clean, exit 0, on the lockfile's pinned `eslint@9.24.0`.
- [x] **The call-site guard fails on both wrong wirings and survives a rename**, which
      is the property a source-reading test has to earn:

      | tree | result |
      |---|---|
      | `fresh: detected` (= today) | **fails** — "passing `detected` loses the lane forever" |
      | `fresh: kept` (the plausible wrong fix) | **fails** |
      | the variable renamed, wiring intact | **passes** — the name is read from the source, not hardcoded |

      Read from source only because this call site is unreachable otherwise: it lives
      inside `main`'s per-lens closure, which is not exported and needs a git repo and
      live model sessions to enter. What `buildStageDetail` does with an annotated
      array is tested directly.
- [x] **The lane carries information no other field does.** In the lane test both
      findings are `confirmed`, so `dropped` is `false` on both, and the lanes still
      come out `["backlog", "blocking"]`.
- [x] **Size, measured.** +198 bytes per blocking fresh finding worst case (a
      `relocated` origin with both shas and an `alsoAt`), +94 in the ordinary
      non-demoted case. Against a per-lens capture of 5–30 KB that is under 1%, and it
      is orthogonal to the diff tiering above.
- [x] **Purity holds.** The existing "derives only — it never mutates its inputs" test
      is unchanged and still passes; `annotateFindings` copies, so the findings the
      panel gates on are the same objects they were.
- [x] **The field itself, in a real artifact** — verified 10 Aug 2026. In
      production captures `lane` sits at `verifications[].finding.lane` and
      appears on **fresh rows only**; no `prior-round` row in any artifact
      examined carries one. Observed values: `blocking`, `discarded`, `backlog`.

      The "none on a minor" half could not be shown from the captures alone —
      every verification row they record is `major`, so the minor case is
      vacuous there. It is confirmed instead against real model output in the
      eval store (`runs/pilot-01__k1`, adapter `reviewer`): of pr-524's nine
      findings, all four majors carry `lane: "blocking"` and all five minors
      carry no `lane` at all.

---

# Follow-up: make the capture say which PR it is of

The artifact has been leaving the runner since #664 and **nothing inside it says
what it is a capture of.** One new file, `meta.json`, at the root of the same
artifact; retention 30 → 90 in both producers.

## The problem

The section above closes on an unchecked box that predicted this:

> **Two producers, one artifact name — a collector requirement, recorded now.**
> `stage-detail.json` carries no field naming the workflow that wrote it … a
> collector … would double-count one head sha as two rounds. Recoverable from run
> metadata (`event: issue_comment` versus the panel's `workflow_run`).

**The recovery it offers does not exist.** Both workflows are triggered by events
— `workflow_run` and `issue_comment` — that make GitHub execute the DEFAULT
BRANCH's copy of the workflow. From GitHub's point of view the run belongs to
`main`, not to the branch under review. Measured on all three real captures to
date (#665, #666, #669), every one of them reports:

```
head_branch = "main"        pull_requests = []
```

So the run metadata names neither the PR nor the branch, and the two producers
upload under the **same artifact name** with nothing in the payload to separate
them. A consumer has three unanswerable questions — which PR, which channel,
which reviewer version — and the third is the one nobody was going to notice:
reviews from different panel versions are not comparable, and no channel records
which version ran.

This is not a gap in GitHub. It is a deliberate security property — the reviewer
must never execute code from the branch it is reviewing — and it is not going to
change. The producing job holds every answer; it simply never wrote them down.

Attribution also cannot be guessed later. A capture filed against the wrong PR is
worse than a missing one: absence is visible, and a wrong row corrupts the corpus
in a way no downstream check would catch. So the fix belongs in the producer, and
it only fixes captures written **after** it lands — the same one-way property the
lane field had, which is the whole reason this is small and goes first.

## The change

- [x] `scripts/agent/capture-meta.mjs`. `buildCaptureMeta({...})` is **pure** —
      no clock, no filesystem, no environment; `capturedAt` and `lenses` are
      injected. `capturedLenses(outDir)` is the one side effect. A thin CLI joins
      them and writes the file.
- [x] **In a script, not in YAML**, and this subsystem is the argument: #641
      recorded that "a YAML default puts the inverted logic where no test can
      reach it", and #664 existed because a YAML-level mistake was untestable and
      stayed silent for five rounds. The workflow contributes only values it
      already holds.
- [x] The payload: `schema`, `pr`, `headSha`, `baseSha`, `channel`, `workflow`,
      `runId`, `runAttempt`, `event`, `panelSha`, `lenses`, `capturedAt`. Two
      fields carry most of the value. **`channel`** is the only thing that can
      tell a gating round from an advisory one; without it a single commit
      reviewed twice reads as two gating rounds. **`panelSha`** is the reviewer's
      own version, from `git -C .trusted rev-parse HEAD`.
- [x] **No `config_hash`, deliberately.** A separate audit of the existing
      config-hash logic found it omits fields that change behaviour, so two judges
      that decide differently hash identically. A wrong fingerprint is worse than
      none — it merges two populations silently. A raw commit sha is always
      available and always correct, and a config identity can be derived from it
      later. There is a test whose only job is that nobody adds it back as an
      obvious improvement.
- [x] A `Describe the capture` step in **both** workflows, after the panel and
      before the upload, `continue-on-error: true`.
- [x] The artifact name gains the PR number:
      `review-panel-stage-detail-pr-<n>`. A convenience for a human reading the
      artifact list and for a collector fetching selectively; `meta.json` remains
      the source of truth and nothing may parse attribution back out of the name.
      Safe: **nothing downloads this artifact** — the only other references in the
      repo are the two upload steps and this document.
- [x] `retention-days: 30` → **90**, the maximum for a public repo, in both. The
      `retention-days: 1` steps are untouched: those are an intra-run hand-off to
      promote/fix and 1 day is chosen to match that lifetime.
- [x] 14 new tests in `capture-meta.test.mjs`, and the existing
      `uploadArtifactSteps()` invariant test **extended** rather than duplicated —
      it now also pins retention, the artifact name, the meta step's existence,
      its position before the upload, and that each producer names its own
      channel and its own workflow file.

## Corrected while building

- **The upload glob does not match `meta.json`, and the literal path is NOT
  immune to the hidden-files trap the way the execution log is.** The plan said
  "write `.agent-review/meta.json`" and stopped there. `path:
  .agent-review/*/stage-detail.json` matches nothing at the root of that
  directory, so the file would have been written on every round and uploaded on
  none — this subsystem's signature failure, for a third time. The fix is a
  second `path:` entry, and the interesting half is what that entry does **not**
  buy. #664 established that a literal file path escapes the hidden-file
  exclusion because its search root is the FILE. That reasoning does not carry
  here: `getSearchPaths()` **drops a search path that is a descendant of
  another**, so `.agent-review/meta.json` collapses into the glob's
  `.agent-review` root and is skipped with it. Measured against `@actions/glob`
  0.5.0 with upload-artifact's own options — with `include-hidden-files: false`
  the two-path step uploads **zero** files, `meta.json` included. The same
  collapse is what keeps the layout right: one search path means no
  least-common-ancestor calculation, so the artifact is `meta.json` beside
  `<lens>/stage-detail.json` exactly as before.
- **Writing `meta.json` unconditionally would have broken the empty case.** The
  obvious implementation writes attribution every round. But "every lens skipped"
  is normal — it is what `if-no-files-found: ignore` exists for — and an
  unconditional write turns that legitimately empty round into an artifact
  containing attribution and nothing else, which a collector must treat as
  "present but nothing valid inside", i.e. loud. So the CLI writes nothing when no
  lens captured, and `buildCaptureMeta` refuses an empty `lenses` list. The two
  halves make one invariant: **`meta.json` present ⟺ a real capture.**
- **The schema string in the plan and in the design note disagreed**
  (`wafflebase/stage-capture@1` vs `…/stage-capture-meta@1`). Settled as
  `wafflebase/stage-capture-meta@1` — it names the file, not the subsystem, and
  `stage-detail.json` may want its own version line later.
- **The plan's line numbers for the gating file were one low** (upload step at
  `:995`, retention at `:1024`, not `:994`/`:1023`). The on-demand ones were
  exact. Nothing about the conclusions changed.
- **A mutation test can pass by editing a comment.** The first run of the
  mutation harness reported "advisory producer copy-pasted `--workflow`" as
  survived. The test was fine; the harness had rewritten the string where it
  appears in the step's own **comment block**, which the parser strips before
  asserting. These workflows carry more prose than YAML — the same trap #630,
  #640 and #651 hit — and it now catches the people testing the test too.

## Fail directions

| path | on doubt | why |
|---|---|---|
| `buildCaptureMeta` (the payload) | **throws**, naming the field and the value | the single write path, so it refuses on any doubt. A `meta.json` reading `"pr": null` that uploaded anyway is precisely the shape this subsystem keeps producing: collected-looking and unusable. Because the builder is all-or-nothing there is no partial file, so "is this attributable?" is answered by the file's existence and never by inspecting a field |
| the meta step (a refusal) | **no meta.json, exit 1, `::error::`** — and the upload still runs | two separate decisions, deliberately. The upload is unconditional because the lens files remain the only copy for 90 days and a human can still read the run log to see which PR it was; withholding them destroys recoverable data. What is *not* allowed is a bad `meta.json`, and none is written. An `::error::` is an ANNOTATION on the run summary rather than a log line, which is the distinction that let "No files were found" hide for five rounds. Enforcement proper is the collector's: it exits non-zero on a capture with no `meta.json` |
| the meta step (any failure) | `continue-on-error: true` | a capture problem must never fail a code review. The script's own exit 1 carries the signal instead, and the invariant test pins the flag so nobody removes it "to make failures visible" |
| no lens captured | **write nothing**, exit **0**, say so on stdout | capture off, or every lens skipped, is normal. The line is printed anyway: "the artifact was legitimately empty" is a claim a reader should be able to check, and it is indistinguishable from a broken capture if nobody prints it |
| `capturedLenses`, any other read error | **exit 1, `::error::`**, no file | it rethrows, and the CLI catches it: an uncaught readdir error prints a stack trace with no annotation, so the run summary stays clean while the artifact goes out unattributable |
| a count that does not fit a JS number | **refuse** | the digit regex admits a 20-digit run id that `Number` rounds to a different one, and a 30-digit one that becomes `1e+30`. Well-formed and wrong is the single outcome this file exists to prevent |
| `capturedLenses`, missing directory | `[]` | same normal case. Any **other** readdir error propagates: an unreadable capture directory is a real fault and must not be laundered into "nothing was captured" |
| `capturedLenses`, one unreadable lens dir | that lens is not listed; its siblings are | per-lens isolation, the same rule the collector's design takes. One bad directory must not discard four healthy captures |
| `baseSha` absent | `null` — present, and not `""` | an absent KEY is indistinguishable from a file written before the field existed, and `""` is a value a consumer might take literally. The diff base is genuinely unknown when the diff step never ran; a *malformed* one is a refusal |
| `panelSha` unobtainable | `git … \|\| true` yields `""`, the script refuses by name | dying inside the shell under `set -e` would put "exit 128" in the log with no field name. Reaching the script's own refusal names the fix |

## Explicit non-goals

**No collector.** Nothing reads `stage-detail.json` or `meta.json` after this.
This makes the artifact attributable; moving it into permanent storage is the next
PR, and it is separate for a permissions reason rather than a tidiness one.

**No new permission, in either workflow, and none wanted.** The `review-panel`
job keeps `{contents: read, checks: write, issues: write, pull-requests: write}`
and the on-demand `review` job keeps `{contents: read, pull-requests: read,
checks: read, issues: write}` — verified byte-identical before and after. No
`id-token`, no `contents: write`. `upload-artifact` needs no scope and neither
does writing a file.

**No change to what is captured.** `writeStageDetail`, `buildStageDetail`, the
gates and the payload are untouched. `meta.json` is a sibling file, not a field.

**No advisory round is made gating**, and no lens, verifier, lane or gate
decision changes.

**No backfill.** The three existing captures (#665, #666, #669) have no
`meta.json` by definition and will not gain one; they expire 2026-09-03 and are to
be collected by hand, marked as such. A collector correctly refusing them is that
validation path passing its first real test, not a regression.

**No `config_hash`** — see *The change*.

## Verification

- [x] `node --test "scripts/agent/*.test.mjs"` — **708 tests, 0 fail**, against
      693 on `upstream/main` (`e5de00ae9`). Exactly +15, all in the new
      `capture-meta.test.mjs`; the workflow invariant was extended in place and
      adds none. Both numbers given for each SDK state, because the skip count
      moves with it:

      | Agent SDK | branch | `upstream/main` |
      |---|---|---|
      | installed | 708 tests, 708 pass, 0 skipped | 693 / 693 / 0 |
      | absent (the `agent:tests` lane) | 708 tests, 707 pass, 1 skipped | 693 / 692 / 1 |

      Both columns measured with a root workspace install present. Without one,
      five `lint-config.test.mjs` cases skip as well and the figure reads 6 —
      which is the number a run in a bare checkout produces, and the reason a
      skip count is only meaningful with its environment stated.
- [x] `eslint scripts` — clean, exit 0, on the lockfile's pinned `eslint@9.24.0`.
- [x] **Every new assertion mutation-tested — 23 mutations, 23 caught**, each
      naming the right file. The workflow ones: retention back to 30 (both
      producers, each named); the meta step deleted (both, each named); the meta
      step moved to run *after* the upload; `meta.json` dropped from the upload
      path; the artifact name reverted to the un-numbered one; the advisory
      producer copy-pasted with `--channel gating`; the same with
      `--workflow agent-review-panel.yml`; `continue-on-error` removed; the
      payload built by `echo` in YAML instead of the script. The builder's:
      `pr` validation relaxed to accept anything (the `"pr": null` failure this
      change exists to prevent) — caught by both the field test *and* the CLI's
      end-to-end refusal test; `baseSha` omitted rather than `null`; `headSha`
      relaxed to any hex; `capturedAt` accepting a UTC offset; an empty lens list
      accepted; a `config_hash` added back; the caller's array sorted in place;
      `capturedLenses` listing directories with no capture; and the CLI writing a
      `meta.json` after the payload was refused.
- [x] **The artifact layout, from the real workflow config.** Both `path:` values
      parsed straight out of the committed YAML and run through `@actions/glob`
      0.5.0 with upload-artifact's own options, over a `.agent-review` holding
      five captured lenses, one lens directory with no capture, and the sibling
      timing/verdict files:

      ```
      meta.json
      blast-radius/stage-detail.json   correctness/stage-detail.json
      design-fit/stage-detail.json     security/stage-detail.json
      test-adequacy/stage-detail.json
      ```

      `meta.json` at the artifact root, the lens layout unchanged, the
      un-captured lens absent from both the artifact and `meta.lenses`.
- [x] **Both workflows parse** (`yaml.safe_load`), and every job's `permissions`
      block in both files is identical before and after — compared parsed and as
      raw bytes, all 13 jobs.
- [x] Verified from the **committed tree** (`git archive <branch> | tar -x`), not
      the working copy.
- [x] **A real artifact from either producer** — verified 10 Aug 2026.
      Gating side: `meta.json` `pr: 757`, `panelSha:
      ae9375e0be2876d069b81c4b460c59776ce0f24c` — the `main` commit "Stop
      dedupe discarding a second finding with no record (#748)". Advisory side:
      `pr: 738`, `panelSha: 2f67c78fb`, `workflow:
      agent-review-on-demand.yml`. Both carry a `pr` matching the PR they were
      posted on, which is what confirms `steps.pr.outputs.number` and
      `needs.authorize.outputs.pr` arrive non-empty in production.
- [x] **90-day retention on a real upload** — verified, not clamped. The
      earliest standing artifact reads `created_at 2026-08-06T10:11:25Z` /
      `expires_at 2026-11-04T10:01:41Z`: exactly 90 days. The repository's
      `actions.artifact_retention_days` maximum is therefore at least 90, and
      the YAML value is honoured as written.
