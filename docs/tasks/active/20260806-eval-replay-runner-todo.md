# The replay runner: ask the panel the same question twice

`scripts/agent/eval/run.mjs` takes a frozen corpus item, runs the real review panel
over it as a subprocess, and stores an immutable record of what happened. Plus the
panel adapter that owns the subprocess contract, and the run-side half of the store.

`review-panel.mjs` is unchanged. No lens's behaviour and no gate decision moves, and
nothing in the panel imports anything from `eval/`.

## The problem

The review panel is a **non-deterministic judge**, and there is currently no way to
ask it the same question twice. A check run records a verdict; the diff behind it
moves; two commits later the manifest that produced it is gone. So "did that tuning
change help?" cannot be answered, because the input never held still and neither did
the reviewer.

#677 froze the input — a corpus item is the diff, the changed files, the issue text
and the metadata of one past pull request. #680 pinned the reviewer's configuration.
This is the thing that puts the two together and actually re-runs the panel, offline,
as many times as you like, writing down per lens what each one did.

### The four defects underneath, and the direction they all fail in

The two modules this lands are ports of the fork harness's `run.mjs` and
`adapters/reviewer.mjs`, and the audit found five defects in them. Four fail in
**exactly the same direction**: they turn a broken review into a clean one.

| # | What happened | What the envelope said |
|---|---|---|
| 1 | every finding rebuilt as `{lens,severity,file,summary,evidence}` | the `lane` the gate routed on, deleted |
| 2 | `runAgent` resolved `{outDir, code, stdout, stderr}` and the caller assigned **none of it** | a panel that exited non-zero: `status: "ok"` |
| 3 | the panel prints whether the novelty gate ran; that line reached `stdout` and was dropped on the same statement | nothing |
| 4 | `readJson(panel.json) ?? []` | a crashed panel: `findings: []`, `stageDetail: {}`, `status: "ok"` |
| 5 | `duration_ms` from `sumExecutions`'s flat sum | our own arm's latency, 3–5× high |

A false clean review **is not noise — it is a perfect score.** It inflates precision,
deflates recall, and nothing about it looks wrong in any log. That is why the whole
design of this PR is fail-direction rather than feature.

Defect 1 is the one that cannot be repaired later. The `lane` rests on a `git blame`
of the tree under review, and that tree is gone after merge — so a replay that drops
it has destroyed the only copy. It is site **A2 of four** (`spec-and-plan.md` §10.1);
PR 6 fixes A1 and the bias survives with no symptom if A2 is left. Upstream already
fixed this exact bug once and published the postmortem: `normalizeFindings` *"used to
rebuild each finding as exactly `{severity,file,summary,evidence}`, which silently
dropped everything the orchestrator annotates onto a finding after the lens produced
it. That was a real bug rather than a tidy contract."*

### Three smaller ones, same files

- **`STAGE_DETAIL_DIFF_CONTENT` was never set** — zero occurrences across the whole
  fork harness. It defaults OFF, so every replay's capture omitted `lensDiff`, and the
  downstream fixture builder's pre-`lensDiff` fallback (`routedDiffByLens?.[lens] ??
  refs.diff`) fired on *every* capture, recording the **whole pull-request diff** as
  the stage input. PR 4 closed the routing hole; this is the same over-read arriving
  through a second door.
- **`sdk_version` was asserted, not measured** — defaulted to the literal `"0.3.217"`
  and written into `run.json` as provenance. A wrong recorded version is worse than an
  absent one: it attributes a result to a build that never ran it.
- **`repo_context_files` was unstable across replicates** — `.materialized` was
  written *inside* the archived tree, and the count ran before the write on first
  materialisation and after it on every cache hit. So the same commit reported `N`
  then `N+1`. A fidelity field that differs between K replicates of one item is worse
  than no field: a scorer segmenting on it splits one population in two.

## The change

Six files, three new, three edited.

| File | What |
|---|---|
| `eval/adapters/reviewer.mjs` | the three-method seam — `prepareInput` / `runAgent` / `captureArtifacts` — and the one place the panel's subprocess contract lives, as data |
| `eval/adapters/stub-panel.mjs` | a stand-in panel: writes canned output, exits with a chosen code. Why every test of this subsystem is free |
| `eval/adapters/reviewer.test.mjs` | the adapter's **first** test file. It has owned the subprocess contract since it was written and has never had one |
| `eval/run.mjs` | the runner: resolve the config, materialise the lenses, prepare, spawn, capture, classify, store. Idempotent and resumable by `--run-id` |
| `eval/run.test.mjs` | every pure decision, plus five end-to-end replays through the stub |
| `eval/store.mjs` | the run slice: `putRun` · `getRun` · `hasItem` · `putItem` · `getItem` · `listItems` · `listRuns`, plus `validateRunEnvelope` |
| `eval/store.test.mjs` | the run slice's tests |
| `eval/README.md` | the runner in "what exists today", the outcome taxonomy, the layout, the revised known limits |

The subprocess contract itself is **intact and not rewritten**: all six flags and all
six output files were re-verified against `review-panel.mjs` at `bb21ff953`. The
audit's 6/6 and 5/5 result now has a test behind it — `reviewer.test.mjs` asserts the
flags the **stub actually received**, and cross-checks each flag against the panel's
own usage block and each output file against the panel's own writes. A point-in-time
audit result became a standing assertion.

### How defect 2 is fixed, which is the part worth reading

Not by remembering to read the exit code. `captureArtifacts` used to take an `outDir`
string, so three fields — `code`, `stdout`, `stderr` — had to be picked up by a caller
that did not, and nothing anywhere failed. It now takes the **run result**, and refuses
a string outright. The exit code cannot be dropped again without the call throwing.

## The five decisions

### 1. The outcome taxonomy: one bit for poolability, a closed list for the reason

`status` is `ok` or `error`, and **`ok` means exactly one thing: this item is a real
verdict and may be pooled as one.** `skipped` is gone, because nothing produced it —
an item the runner never attempted is simply absent.

`reason` is a closed list (`ITEM_REASONS`, asserted by the tests to be exhaustive):
`panel-exit` · `no-panel-json` · `gate-degraded` · `gate-unreported` · `no-lens-diff`
· `infra` · `no-output` · `no-repo-context` · `exception`.

**The fail direction, written down:** an item whose panel exited non-zero must never
be poolable as a real verdict. It is `error`, whatever the panel managed to write.

**The order of the checks is itself the decision.** A crashed panel satisfies several
at once — non-zero exit, no `panel.json`, zero SDK calls — so they run from the most
upstream *cause* to the most downstream *symptom*, and the recorded reason names the
cause. Getting that backwards yields a run of envelopes that all say `no-output` and
give nobody anything to fix. The gate checks sit **above** the content checks
deliberately: if the gate did not run, the item is not a measurement of the shipped
reviewer at all, so which findings it produced is beside the point.

Three reasons are **fatal to the whole run**, not to one item: `gate-degraded`,
`gate-unreported`, `no-lens-diff`. All three are misconfigurations that will be
identical for the next nineteen items, and each of those items costs money. The
failing item is **stored first** — the evidence is what makes it fixable — and then
the run aborts with `status: "aborted"` and the reason in `notes`.

### 2. The gate assertion: soft where OFF is expected, hard where it is degradation

The distinction the prompt drew, implemented as drawn:

| Situation | Response |
|---|---|
| no `--base-sha` passed, gate reports OFF | **expected today.** Recorded, not failed on |
| `--base-sha` passed, gate reports OFF | **hard error**, fatal. `gate-degraded` |
| no `--base-sha` passed, gate reports **on** | **hard error**, fatal. Impossible in the panel, so seeing it means the plumbing is not what this module believes |
| no `novelty gate:` line at all | **hard error**, fatal. `gate-unreported` |

A naive hard assert would have failed every run until PR 6 lands, and the soft case is
why. But recording it is non-negotiable either way: without the state in the envelope
a scorer cannot tell a run that had the gate from one that did not, and **pooling
those two is the measurement error this lane exists to prevent.**

The fourth row is an addition, and it is the one that argues for itself: the panel
prints exactly one of three lines, so silence means either it died before routing or
the line moved. A contract that moved without anyone noticing is precisely what this
project keeps getting burned by, and `unreported` must never be recorded as `on` —
claiming the gate ran is the one answer nothing downstream can recover from.

`parseGateState` matches the **distinguishing phrase**, not the sentence. The wording
carries an em dash and an interpolated sha, and a regex pinned to the whole line would
fall silently to `unreported` on a punctuation edit — turning a passing assertion into
a failing one for a reason that has nothing to do with the gate.

To make any of this assertable, `runAgent` takes a `baseSha` and passes `--base-sha`
when given. **The runner never gives one** (see the seams below). That is the seam,
not the work.

### 3. `STAGE_DETAIL_DIFF_CONTENT` is ON for replays, and the capture is asserted

#644 made it opt-in and the reasoning was good: the diff body is 76–97% of the payload
and is verbatim contributor-authored text from a possibly-forked branch, so in
production it should be requested rather than defaulted. Two things make a replay the
exception, and #644's own docblock names the first: the flag's single consumer is *"a
replay that feeds a lens the bytes it actually saw."* The second is that those bytes
are **already in our own frozen corpus item**, so carrying them exposes nothing new.

Turning it on is not enough, and this is the half that matters: **the flag's absence
is silent.** So the runner asserts the capture came back with `lensDiff` rather than
trusting that setting the variable worked. A flag whose absence is silent is a flag
that needs an assertion.

The assertion counts the **key**, never the bytes. `lensDiff: ""` is a real value the
router produces for a lens whose file-class slice is empty, and treating it as missing
would report a working capture as broken. And a lens that wrote no stage detail at all
— skipped, crashed, inapplicable — is `no-capture`: nothing to over-read, so nothing
to assert.

### 4. `panelSha` is not optional, and a dirty tree is refused

#680 decided the pooling key is the pair `(config_hash, panelSha)`: `config_hash`
identifies the lens composition and cannot see the panel's *code*, so a new verifier
stage or a changed gate leaves it identical. `capture-meta.mjs` (#673) already records
`panelSha` for live captures. If a replay envelope omitted it, replays and live
captures could not be pooled on the same key and half of #680's decision would
silently do nothing. `validateRunEnvelope` therefore **refuses** an envelope without a
40-hex `panel_sha`.

How it is obtained, and the two calls that go with it:

- `git -C <dir of review-panel.mjs> rev-parse HEAD`. The runner resolves the panel as
  **its own sibling**, so running from a feature branch measures that branch's panel —
  the trap the fork's `capabilities.md:163` warned about.
- **A dirty tree is refused.** HEAD's sha describes HEAD's bytes; a modified panel is
  not the commit it claims to be, and recording HEAD anyway is the same
  "asserted, not measured" failure as the hardcoded `sdk_version` this PR deletes.
- The dirtiness check is **scoped to `scripts/agent/` and excludes
  `scripts/agent/eval/`**. The harness is not the reviewer, so editing the runner must
  not block a replay — and it is the same exclusion the README's known-limits table
  already tells a reader to run by hand.
- `--panel-sha` records one deliberately, and `panel_sha_source` says `"flag"` rather
  than `"git"`, so a scorer can exclude told-not-measured runs. It is **required**, not
  merely allowed, when `--panel-script` points anywhere other than the sibling:
  replaying one script while stamping another's commit is exactly the mislabelling
  this field exists to prevent.

### 5. An absent transcript is a NAMED state, and PR 3 already decided it

Found where the prompt said to look — `store.mjs`'s header, from #677:

> *any reader of one must return a NAMED state — `{state: "absent" | "local" |
> "remote"}` — never `null`, never `""`. A falsy value is indistinguishable from an
> empty transcript.*

So: no `getTranscript` on the surface (unchanged), nothing gzipped into the store
(the fork's `putItem` did), and every envelope carries `transcript: {state: "absent"}`
with `TRANSCRIPT_STATES` enforced at the write path. The convention stops being a
convention. Spec §8 keeps transcripts out of git, so `absent` is the ordinary answer,
not a failure.

## Two smaller calls

**Latency records its own absence.** `duration_ms` is the panel's wall-clock from
`review-timing.json` via #669's exported `readWallMs`, or **`null`** with
`duration_source: "absent"`. It is never the summed value as a *fallback* — that would
re-introduce the 3–5× overcount silently, which is the defect. The sum is still
recorded, under `sdk_duration_ms_sum`, a name that is not a duration. A run's totals
sum `duration_ms` only over items that have one and carry that `n` as
`duration_items`, because treating an unknown wall-clock as zero would make a run of
ten items with three timings look three times as fast as it was.

**A run id is validated, not sanitised.** The fork ran every id through a
`[:/\\] → -` replace, which silently maps two **distinct** run ids onto one directory
— for a subsystem whose entire job is telling two runs apart, the worse failure. The
ids the runner generates pass `store.mjs`'s existing segment grammar unchanged, so
nothing needed mangling in the first place.

## Corrected while building

**The config-snapshot comparison had to be by hash, not by bytes — and the first
version broke every resume.** `putRun` freezes `config.snapshot.json` as identity and
refuses a *different* one, which is the hole the fork left open (`// ignored
(write-once)`) and the one that lets half a run's items come from a different
reviewer. The first version compared canonical JSON, and the idempotence test went red
immediately: a snapshot carries `captured_at`, so two runs of an identical
configuration differ in bytes **by construction**. This is the same trap
`extract-corpus.mjs` avoided by keeping a clock out of the corpus manifest, arriving
from the other direction. It compares `config_hash` now — the thing #680 built to
answer this exact question — and falls back to bytes only for a snapshot carrying no
hash at all, because a snapshot with no identity cannot be checked any other way. A
different `--config-id` over the same lenses is therefore allowed, deliberately:
`config_hash` is configuration identity and a config id is a human label, so
relabelling is not a change of reviewer.

**The infra reason was passing the lens's raw string through, and a test caught it.**
`reason infra has no usable message` — the string was `"429"`, which in an envelope
tells a reader nothing. It is wrapped now, naming the lens and why the item is not a
verdict (the reviewer never ran; the gate failed closed to "block"). The assertion
that caught it was `message.length > 10` over every reason in the vocabulary, which
looked like padding when it was written.

**Two of my own tests survived mutation, and both were tautological in the way this
project has a name for.** The `sdk_version` test compared the resolved option against
`scripts/agent/package.json` — which happens to hold `0.3.217`, the very literal the
fork hardcoded, so re-hardcoding it passed. `pinnedSdkVersion`'s own docblock warns
about exactly this ("a test that only compares the result against the same file it was
read from is tautological") and its `readFile` is injectable for exactly this reason. It
is injected now. And the `repo_context_files` stability test pre-wrote a marker saying
`2` beside a tree of two files, so re-walking gave the same answer; the tree now holds
a third file standing in for whatever accumulates in a cache directory that outlives
one run — which is what the fork's own in-tree marker was.

**The write-order test could not see the order it claimed to protect.** It asserted
both files exist and that removing `envelope.json` makes `hasItem` false — neither of
which distinguishes the two orders. The order only has an effect on an interrupted
write, so the interrupted write is now replayed: a directory is placed where
`payload.json` should go, `putItem` throws part-way, and the item must read **absent**.
Under the reverse order `hasItem` would be true with no payload beside it and a
resumed run would skip that item forever.

## Fail directions

| Part | On failure | Why that is the safe way |
|---|---|---|
| `captureArtifacts` and every file read | named state, never a throw and never a default | it is a read path, and the states it reports **are** the findings |
| `panel.json` absent or not a list | `panel: null`, `findings: null` | a clean review genuinely produces `findings: []`, so failure must not share its shape |
| `review-timing.json` absent | `duration_ms: null`, `duration_source: "absent"` | the summed alternative is 3–5× high; an explicit null is a number PR 13 must handle |
| non-zero exit / missing panel output / infra / no calls | `error`, run continues | item-specific: a single item can crash on a huge diff or a transient API failure |
| gate degraded, gate unreported, capture missing `lensDiff` | `error`, item stored, **run aborts** | run-wide misconfigurations. Each further item costs money and would fail identically |
| `prepareInput` handed an empty diff | refuses before the spawn | the panel fails closed on one, so the spawn is a guaranteed-wasted replay |
| a dirty panel tree, or no readable HEAD | refuses before anything is written | a run that cannot name its reviewer is not poolable with any other, and the refusal is free |
| `putItem` handed an envelope missing `panel_sha`, `gate.state` or a named `transcript` | refuses; nothing lands | the single write path refuses on any doubt |
| an existing run item | refuses, naming `--run-id` | it is an observation of a non-deterministic judge, not a re-derivable extraction |
| a corpus item absent from the store | logged, **no envelope written** | recording one would put an item in the run that was never replayed |
| `materializeRepoAt` cannot archive the commit | `{path: null, files: 0, error}` with git's own stderr | a silent 0-file checkout is how the #521 pilot billed $44 |
| `listRuns` over an unreadable `run.json` | skips that directory | read paths degrade to fewer records |

## Explicit non-goals

Nothing here is PR 6, and the seams it needs are named below rather than half-built.

- **No real git worktree.** The tree comes from `git archive`, so it has no `.git`.
- **`--base-sha` is never passed.** The adapter accepts one and the assertion is live;
  the runner supplies none, because an archived tree cannot resolve a base and the
  gate would report OFF — which this PR correctly treats as a hard error.
- **`--require-repo-context` stays default OFF.** Flipping it belongs with the thing
  that makes it satisfiable.
- **No per-run cost caps, no timeouts.**
- **No metric.** No precision, no recall, no reliability, no scoring, no matching.
- **No stage modules** (PR 19), no `signal-harvest.mjs` (PR 7), no label or score store
  methods (PRs 7, 16, 19).
- **`config_hash` is not re-derived** — #680 owns it and is called.
- **`review-panel.mjs` is untouched** beyond importing symbols it already exports
  (`readWallMs`, `sampleCountFor`, `stageDetailDiffContentEnabled`, `parseArgs`).
- **No CI workflow.** Spec decision 5 puts the 60 replays in a `workflow_dispatch`
  job; this PR lands the runner, not the job.
- **The payload is not capped or trimmed.** With diff content on, `payload.json` is
  roughly the size of the routed slices — for a real 4-file item, 1 KiB; for a large
  one it approaches the whole diff per lens. The runner **logs the payload size per
  item** rather than capping silently. Sizing it properly is the S3 migration's.

### The seams PR 6 needs, by name

1. `reviewerAdapter().runAgent(inputs, {…, baseSha})` — pass it, and the
   `gate-degraded` assertion becomes the guard that proves the worktree works.
2. `materializeRepoAt({repoSource, commit, cacheRoot})` — one function, one caller, a
   fixed `{path, files, error}` shape. Replace `git archive` with a worktree here.
3. `resolveRunOptions().requireRepoContext` — flip the default; the guard and its
   `no-repo-context` reason already exist and already store a zero-cost error item.
4. `ITEM_REASONS` / `FATAL_REASONS` — add a cost-cap reason to the first, and decide
   whether it belongs in the second.

## Verification

Measured on this machine, at `scripts/agent`, with the lane's own command
`node --test '**/*.test.mjs'`.

- [x] **1116 tests · 0 fail · 0 skip.** Baseline on `upstream/main` `3247650ae` (the
      squash merge of #680): **1057 · 0 · 0**. Delta **+59**. For orientation, the
      pre-#680 `main` `bb21ff953` measured **1002 · 0 · 0**, so #680 was +55.
- [x] **No new skips without `node_modules`: 6, exactly the baseline** — 1 Agent SDK +
      5 `lint-config`. Every subprocess test in this PR runs with no dependencies
      installed at all, because `ask.mjs` imports the SDK lazily.
- [x] `eval/test-lane.test.mjs` passes with the new suites present, including
      `eval/adapters/reviewer.test.mjs` — which is the depth the flat glob missed and
      the case that file was written to catch.
- [x] `npx eslint scripts` (pinned `9.24.0`) exits 0.
- [x] **All five defects proven fixed by a stub-panel test**, one test each, named for
      the defect: `DEFECT 1`…`DEFECT 5` in `reviewer.test.mjs`, plus `DEFECT 2`/`3`/`4`
      at the classifier and end to end in `run.test.mjs`.
- [x] **The lane survives end to end.** A `verdict.json` finding carrying `lane:
      "backlog"` and `novelty: {origin: "relocated", …}` reaches the stored envelope's
      payload with both intact, plus `unsettled` and a field nothing in this repository
      has heard of.
- [x] **28/28 mutations caught**, including all seven the plan named. Four survived on
      the first pass and all four were weaknesses in the tests, not the code — see
      *Corrected while building*.
- [x] **Idempotence shown, not claimed.** Two invocations at one `--run-id` over a real
      corpus item: the second re-ran nothing, and `shasum` over both stored files is
      byte-identical.
- [x] **A full free end-to-end**: `extract-corpus.mjs --prs 664` → a 3176-file
      materialised tree → the stub panel → a stored envelope. `duration_ms: 742318`
      against `sdk_duration_ms_sum: 1189600` — the defect, visible in one item.
- [x] **`repo_context_files` stable across replicates**: 3176 on both, from two
      separate run ids over one commit, with the marker beside the tree rather than in
      it.
- [x] `panel_sha` present, 40-hex, and `validateRunEnvelope` refuses eight bad shapes.
- [x] Verified from the **committed tree**, extracted with `git archive`, not the
      working copy.

### Not verified

- **No replay against the real panel has ever been run.** Every test uses the stub, by
  design: this PR must not spend money. So the six-flag contract is asserted against
  what the stub received and cross-checked against the panel's own source, and the
  five output files against the panel's own writes — but the panel has not been made to
  produce them here. The first real replay is PR 6's, with the worktree.
- **The payload size on a large item is estimated, not measured.** 1 KiB on the
  4-file item used for the end-to-end; a 200-file item is not modelled.
- **`git archive` fidelity on this machine is untested against EDR interference.** The
  end-to-end produced 3176 files, which is plausible, but nothing here asserts it is
  the commit's complete tree.
