# One normalised record for a review finding, and our arm's mapping into it

A **new** document rather than a section appended to
`archive/2026/08/20260806-eval-replay-runner-todo.md`, which owns the runner —
and not only because that one is archived. What needs to be findable later is not
"the eval harness grew two files" but the **schema decisions**: which population
is "a finding by our arm", and why "did this gate?" is not a boolean. Those
outlive both modules, and every scorer built after this one reads them.

## The problem

**Two reviewers, two incompatible shapes.** Our panel writes `verdict.json`
findings carrying `lane`, `novelty`, `unsettled` and a per-finding verifier
outcome; CodeRabbit posts markdown comments. Nothing can be compared until both
map into one record, and no such record existed.

**And the harness's draft of one derived gating from severity alone.** The fork's
`signal-harvest.mjs:92`:

```js
blocking: BLOCKING.has(severity),
```

Zero references to `lane` in the module — measured, all 206 lines. Since #668
that answer is wrong in one specific direction: a `critical` routed to `backlog`
is reported and does **not** gate, so every demoted finding was labelled a
blocking one. It is the precise error `buildStageDetail`'s docstring warns
readers against: *"A reader must treat a MISSING lane as 'unknown', never as
'blocking' … reading absence as blocking would silently score demoted findings as
gating ones."*

It also re-declared `BLOCKING` locally (`:29`, `new Set(["critical","major"])`)
under a comment claiming it mirrored `severity.mjs`. It did match. Nothing
enforced that it would, and the same re-typing pattern has already cost this
project a paid harvest.

**This is the third of four sites where the lane is discarded** (spec §10.1).
#682 fixed the second; the fidelity PR is fixing the first; the fourth waits on
the verifier-validity PR. Each fails silently and each is in a different PR's
blast radius, so no single reviewer looking at one diff can catch the set.

### And one identity rule lived in three places, against its own advice

`review-panel.mjs`'s `findingKey` carried this docblock:

> Extracted so `sameFinding` can be built ON it rather than beside it — **a
> second copy of this expression could drift looser than the merge it is supposed
> to agree with**, and that drift is what would let a verification be skipped for
> a finding the merge then keeps separately.

The second copy was **eleven hundred lines below it**, inline inside
`compareSampleAgreement` (`:1265`), byte-identical. A third lived in the harness.
The key was private, so a fourth was the only way for anything outside the panel
to key findings the way the panel does.

## The change

- [x] **`scripts/agent/finding-key.mjs`** — the key, in one file, importing
      nothing. The expression is moved unchanged, deliberately including its
      absence of a null guard: it runs on findings `coerceFindings` has already
      normalised, and "hardening" it here would widen what the merge accepts.
- [x] **`review-panel.mjs` imports it**, and `compareSampleAgreement` uses it
      instead of its inline duplicate. Two call sites, three lines deleted.
      `rebuttal.mjs`'s `findingKeyOf` is left alone — a different rule for a
      different job, and its own docblock says *"Deliberately NOT the matching
      mechanism."*
- [x] **`eval/finding-record.mjs`** — the record, its builder, a strict
      validator, and a census helper. Owns the `gating` vocabulary.
- [x] **`eval/adapters/panel.mjs`** — a stored run envelope → records, lane
      preserved, two populations, plus a CLI that prints and stores nothing.
- [x] **`eval/README.md`** — two rows in "What exists today", the gating and
      population tables, and the exact-string-key limit rewritten to name the
      record and say why the looseness is deliberate rather than unfixed.

## The five decisions

### 1. The comparator population is `reported`; `sampled` exists and is labelled

One envelope holds two different sets of findings:

| | Where | What it answers |
|---|---|---|
| `reported` | `payload.findings`, from `verdict.json` | what the panel **said** — after dedupe, clustering, verification and routing |
| `sampled` | `payload.stageDetail[lens].samples` | what it **could** find across repeated tries, before any of that |

**`reported` is the comparator**, because PR 8 parses CodeRabbit's *posted
comments* and the fair like-for-like is what our panel posted. It is also the
only population in which a finding has a lane at all: `buildStageDetail` records
samples as the lens emitted them and `annotateFindings` runs later, so every
blocking-severity `sampled` record reads `gating: "unknown"` — correctly, and
that is the clearest possible argument for not pooling them.

**`sampled` ships anyway**, because it carries the one signal the reported set
cannot: how many independent detection samples raised each finding, which is the
reliability metric's input. The fork harvested only this population; shipping
only the other would have dropped that signal silently. Every record says which
one it is, one call never mixes them, and the builder has **no default
population** — a caller must name it.

The sampled population deliberately does **not** join the lane in from the
`verifications` rows, even though those carry the annotated twin. Attaching a
post-gate fact to a pre-gate finding would make one record two populations, which
is the confusion the split exists to prevent.

### 2. Gating is four-valued, and the cause is recorded beside it

`gates` · `does-not-gate` · `unknown` · `not-applicable`, with `gating_basis`
naming which of seven causes produced it. The mapping basis → value is the source
of truth and the validator refuses a record whose pair disagrees, so the two can
never be written independently.

**Why not a boolean.** It cannot spell "we could not tell", so the moment one is
written every unknown becomes one of the two answers — silently, and in the
direction that inflates the blocking population.

**Why four rather than the three the plan asked for.** `demoted` is one of *two*
distinct ways a panel finding does not gate:

- the novelty gate routed it to `backlog` — `laneCounts` tallies exactly these;
- its severity never reached the gate. `annotateFindings` stamps a lane only on
  `critical`/`major`, so for a minor or a nit **the absence of a lane is the
  design, not missing data**, and the panel's own docstring says so.

Filing a nit under `demoted` would make "how many findings did the gate demote?"
disagree with `laneCounts`' `backlog` count — one word, two numbers, which is
this project's signature failure. So the middle value says only what is certain
and the basis says which cause it was. `not-applicable` is the same split one
level up: CodeRabbit never gates, and that is not uncertainty. Pooling it into
`unknown` would make "how much of our data has an unrecorded gate decision?"
scale with the size of the other arm.

**The causes of `unknown`, kept apart** (lesson 6: absent has more than one
cause): `lane-absent` — blocking severity with no lane, which is a capture
predating #668 *or* the `sampled` population; `lane-unrecognized` — a lane
outside `LANES`, where guessing costs the most.

**The one predicate deliberately not reused** is the panel's own `findingGates`,
which reads a missing lane as **gating**. That is right for a gate — it fails
toward blocking because it decides whether to stop a merge — and wrong for a
scorer, which must not turn "not recorded" into a verdict. Two jobs, two rules.

### 3. `mergeSignals` does not come along

Deferred to the PR that gives it an input. It folds a finding record plus
*independent* signals into a draft label, and **zero independent signal
collectors exist** — no judge model, no GitHub miner — so it would land as code
whose only reachable branch returns *"no independent signal — panel prediction
alone cannot label (circular)"*. Rule 4: every PR is defensible on the day it
lands.

There is a second reason beyond rule 4. Drafting a label is a different artifact
from recording a finding, and bundling the two is what made the fork's module do
two jobs at once. The label store is a later PR's to design, and a draft-label
shape frozen now would be frozen before its consumer exists.

### 4. The key is the panel's exact key, and it is not a matcher

`file::lowercased-summary`, via the relocated `findingKey`, because anything that
must agree with `dedupeFindings`, `compareSampleAgreement` or
`review-lens-stats.json` has to key findings the way they do. Its limit is real
and stated in the README: **one defect reworded counts as two.**

Not "fixed" with fuzzy matching here. Similarity is a second mechanism for a
second job — `finding-match.mjs` (#646), applied by the cross-arm matcher — and
swapping identity for similarity inside the record is how our sample-agreement
numbers would quietly stop matching the panel's, with nothing anywhere looking
wrong. Two jobs, two mechanisms, said in the module's own docblock.

`file` and `summary` are carried **verbatim** so the key stays derivable from the
record's own fields; trimming either would leave a reader recomputing the key and
silently getting a different one. `line` is recorded but is **not** part of the
key, because the panel's key has never had one.

### 5. Nothing is written to the store

Records are derived data: recomputable from an immutable envelope,
deterministically and for free. Persisting them buys nothing and spends the
store's write-once rule on a shape that is cheap to recompute and expensive to
correct — and the label store belongs to a later PR. So this ships a pure library
plus a CLI that prints. **What breaks without persistence: nothing.** The
derivation has no clock, no network and no model in it.

## Corrected while building

- **"No replayed finding carries a real lane" is not quite the shape of it.**
  The plan's framing implies replayed findings have no lane. Measured: with no
  `--base-sha`, `noveltyOf` returns `origin: "unknown"` for everything and
  `routeFinding` falls through to `blocking` — so every blocking-severity finding
  **does** carry `lane: "blocking"`, and `novelty.origin: "unknown"` beside it.
  What cannot occur is `lane: "backlog"`. That matters for the record: a
  gate-off replay reads `gates`, which is a true statement about that replay and
  a misleading one about the shipped gate. Handled by stamping
  `panel.gate_state` on every record rather than by weakening the finding-level
  answer, which would make every pre-fidelity record `unknown` and useless.
- **The lane is absent for a third reason nobody listed.** Not just "predates
  #668" and "no location to route" — the whole `sampled` population is
  structurally pre-annotation. The fork harvested from exactly there, so its
  gating field could not have been right even with a `lane` check bolted on: it
  was reading a population that has no lanes at all.
- **A test that pins padding is not a test that pins the key.** The first
  version of the relocation guard passed against a re-introduced inline copy
  that also collapsed *internal* whitespace — looser than the merge, and the
  exact drift the docblock warns about. The suite now asserts internal spacing is
  preserved, which is what makes the copy fail.
- **The builder does not fill the arm namespace.** It was tempting to have
  `buildFindingRecord` derive `lane`/`novelty`/`verification` itself. It must
  not: those are panel vocabulary, and a record module that knows them is not
  expressible for a reviewer that has none. The adapter supplies the namespace;
  the builder carries the finding whole and derives only the shared fields.

## Fail directions

- **The adapter degrades, and says what it dropped.** A finding that is not an
  object is skipped and reported in `dropped` with its lens and index; the CLI
  prints the count. A read path that drops data without saying so reads
  downstream as "we measured everything".
- **The builder and the validator refuse.** They are the handoff point, and a
  malformed record reaching a scorer costs a wrong number rather than a loud
  failure. No default population, no default arm namespace, no `gating` that
  disagrees with its own stated cause.
- **`unknown` is the fail direction for the lane.** Where the fork failed toward
  `blocking` (inflating the blocking population), this fails toward "we could not
  tell", which suppresses a record from a blocking count instead of inventing one
  for it. A scorer that ignores `unknown` under-reports; one that pooled it into
  `gates` would over-report and look fine.
- **Zero and nothing are different shapes.** `population_state: "present"` with
  no records is a clean review — a true negative and a real data point.
  `"absent"` means the panel wrote nothing usable. In a precision metric a false
  clean review is not noise, it is a perfect score.
- **A failed item still produces records**, carrying `panel.item_status`.
  Filtering them out here would hide how much of a run failed; a scorer excludes
  anything that is not `ok`, and cannot do that if the records never existed.

## Explicit non-goals

- **No cross-arm matching.** No `matchFindings`, no similarity, no clustering.
- **No CodeRabbit parsing.** The `coderabbit` arm is named in the vocabulary and
  nothing fills it.
- **No metric.** No precision, no agreement, no κ, no counts presented as a
  result. The census helper counts records so a CLI can print an `n`; it scores
  nothing.
- **No store methods and no labels written.**
- **`eval/run.mjs` and `eval/adapters/reviewer.mjs` are untouched.**
- **`dedupeFindings`, `findingGates`, every lens and the gate's decisions are
  unchanged.** The only behavioural surface touched upstream is the relocation of
  a three-line key and the deletion of its duplicate.
- **No upstream export added.** Moving the key into its own module is what let
  this PR skip that, which keeps review latency off the critical path.

## Verification

Measured on this machine, from the committed tree, with **no `node_modules`
present**.

- [x] **`cd scripts/agent && node --test '**/*.test.mjs'` — 1366 tests, 0 fail,
      6 skipped.** Baseline measured on `upstream/main` (`49e463c41`) the same
      way: **1331 / 0 fail / 6 skipped**. +35 tests, **no new skips**. The 6 are
      the documented no-install pair: 1 for the absent Agent SDK, 5 for
      `lint-config.test.mjs` without a root `eslint`.
- [x] `eval/test-lane.test.mjs` passes with the new suites present — the
      `**/*.test.mjs` glob reaches `eval/adapters/panel.test.mjs`.
- [x] `npx eslint scripts` exits 0 (pinned `eslint@9.24.0`).
- [x] **The lane survives.** A `critical` finding with `lane: "backlog"` produces
      `gating: "does-not-gate"`, basis `lane-backlog`, severity still `critical`.
      Under the rule this replaces, four of the end-to-end fixture's five
      findings would have been blocking; one is.
- [x] **An absent lane is `unknown`** — not gating, not demoted, `panel.lane`
      stays `null` rather than being defaulted. Test named for it.
- [x] **The relocated key is behaviour-identical**: `dedupeFindings` collapses
      exactly the findings the key calls identical, and `compareSampleAgreement`
      answers by that key and no other.
- [x] **The inline duplicate is gone**, and `review-panel.test.mjs` passes
      untouched (169 tests, 0 fail, no edits to that file).
- [x] **Ten mutations, nine caught**, each with the assertion that went red — see
      the table below.
- [x] **A real end-to-end, free**: a corpus item frozen into a store, replayed
      through the REAL `run.mjs` with `adapters/stub-panel.mjs`, then read back
      by the CLI. `4 reported record(s) — 1 gates, 2 does-not-gate, 1 unknown`.

### Mutations

| # | Mutation | Red | First message |
|---|---|---|---|
| 1 | restore `blocking: BLOCKING.has(severity)` | 9 | `+ 'gates' - 'does-not-gate'` |
| 2 | make an absent lane gate (copy `findingGates` in) | 6 | `'gates' !== 'unknown'` |
| 3 | re-declare `BLOCKING` locally **and let it drift** | 2 | `+ gating: 'unknown' - gating: 'does-not-gate'` |
| 3b | re-declare `BLOCKING` locally, copy still **matches** | **0** | — see below |
| 4 | rebuild the finding from a field list | 3 | `- lane: 'blocking', - mergedFrom: […]` |
| 5 | loosen the relocated key (lowercase the file) | 1 | `Expected "actual" to be strictly unequal to 'a/b.mjs::x'` |
| 6 | drop the `gating`/`gating_basis` agreement check | 1 | `Missing expected exception.` |
| 7 | let a missing findings list read as `present` | 1 | `+ 'present' - 'absent'` |
| 8 | first-occurrence-wins instead of `dedupeFindings` | 1 | `+ 'minor' - 'critical'` |
| 9 | drop `population` from the record | 2 | `+ 'reported' - 'sampled'` |
| 10 | re-introduce a **drifted** inline key copy in `compareSampleAgreement` | 1 | `actual: 'identical', expected: 'disjoint'` |

**3b is the honest one, and it is reported rather than hidden.** A local
`BLOCKING` that still agrees with `severity.mjs` fails nothing, because there is
nothing yet to disagree with — no test can catch a copy that is correct today.
What the suite can do is catch it the moment it drifts, and it does (mutation 3),
because `what counts as blocking is severity.mjs's answer` asserts `gatingOf`
against `classify` across every known severity plus four malformed ones. The
argument for importing rather than re-typing is that the drift cannot happen, not
that a test would notice it on day one.

**Mutation 10 is why the key test was rewritten.** Its first version passed
against the drifted copy, because every assertion differed only in padding — which
a `\s+ → " "` copy also collapses. The suite now pins internal spacing.

### Not verified

- [x] **Replayed against the real panel** — 10 Aug 2026. The eval store holds
      `runs/pilot-01__k1`: adapter `reviewer` (not the stub), `panel_sha
      46da673dd`, corpus `2026-08-10-pilot-reviewed`, 7/7 items `ok`, $32.91,
      1495 turns. Building a record from every finding those seven real
      payloads carry — `buildFindingRecord` + `validateFindingRecord`, arm
      `panel`, population `reported` — gives **142 records built and validated,
      0 failures**. The mapping has now been asserted against findings a model
      produced, which is what this item asked for.
- [x] **The lane-aware path is live on real data.** The fidelity PR does pass a
      `--base-sha`: every envelope in that run reads `base_sha_passed: true`
      with `gate.state: "on"`. It changes numbers — `gatingCensus` over the 142
      records resolves as `gates: 35, does-not-gate: 107, unknown: 0`, with
      basis `lane-blocking: 35`, `lane-backlog: 1`, `non-blocking-severity:
      106`. The `lane-backlog` record is a `major` that the lane, not the
      severity, kept out of the gating set — the exact case that was inert.
