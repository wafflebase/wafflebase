# Cut the volume and mix metrics by file class, severity, size and authorship

A **new** document rather than a section on `20260811-eval-volume-mix-scorer-todo.md`.
That file owns *"how much does each reviewer produce"* and reports one row per arm; this
one owns *"where does each reviewer's number differ"*, and the rule it establishes — **a
cell below its minimum n is withheld, and the number is not in the payload at all** — is
not about volume.

## The problem

`eval/volume-mix.mjs` produces five numbers per arm over every finding at once: a nit
ratio, a localisation rate, a scope-discipline rate, findings per PR and findings per
100 diff lines. Every one of them is an average over a population nobody chose. *"Our
reviewer localises 80% of its findings"* is a different claim from *"it localises 82% in
`code` files and 40% in `docs/design`"*, and only the second tells a reader where to
look — which is what spec §4 asks the report for and what nothing computes.

The failure mode here is not a crash. **A segmented scorer's bug is a plausible
number**, and on this corpus the two ways to produce one are structural rather than
accidental:

| The subset | What a scorer that does not guard gets | Why it is not a small error |
|---|---|---|
| A cell holding 1–4 findings | A ratio between 0 and 1, printed like any other | Slicing 7 pull requests and 30 CodeRabbit findings six ways produces these by the dozen. A blank cell gets questioned; a number does not |
| A cell at `k=0` or `k=n` | The textbook interval, `[0,0]` or `[1,1]` | Those are the two commonest cells in a small grid, and both directions read as certainty drawn from a sample of any size |

## The change

`scripts/agent/eval/segmentation.mjs` — pure functions plus a CLI that prints.
`scoreSegmentation({arms, geometry, items, minN, axisIds})` returns one payload whose
`cells` are the grid; there is no store, no network, no clock and no `--out`.

**It defines no metric.** Every value comes from a helper that is already upstream —
`severityMix`, `localizationOf`, `scopeOf`, `proportion`, `median` — called over a
filtered record list. What is new is the slicing plus two rules and one arithmetic
function.

### 1. Suppression, and it is policy rather than presentation

A cell whose denominator is below `min_n` (5, spec §4.1) is **withheld**: it carries the
`n` and the `min_n` that decided it, and it carries **no `value`, no `k`, no interval and
no per-replicate values**. Not a value a renderer skips — the keys are absent. A payload
is a file anybody can read, so a suppressed cell that still held its figure would be one
`jq` away from being quoted, and the test that asserts those keys are missing is the
load-bearing test of this PR.

The threshold rides on **every cell**, not only on the payload, so no consumer can
caption this grid with a threshold it no longer uses. An override below the spec's 5 is
possible and is announced beside the grid.

### 2. A Wilson 95% interval on every proportion

**Nothing under `scripts/agent/` computed a confidence interval before this** — grepped,
zero hits. The four edges are the reason to use Wilson rather than the textbook formula,
and each is pinned to its exact closed form:

| | Wilson | the textbook interval |
|---|---|---|
| `k=0` | `[0, z²/(n+z²)]` — the uncertainty is in the upper bound | `[0,0]`: "we saw none, so there are none" |
| `k=n` | `[n/(n+z²), 1]` | `[1,1]` |
| `n=1` | `[0, 0.793]` or `[0.207, 1]` — says almost nothing, correctly | a point |
| `n=0` | **no interval, with the reason** | `0/0` |

A median is not a proportion, so it carries an explicit "no interval, and why" rather
than a missing field.

### 3. §4.1's two currencies, enforced rather than described

A `finding`-denominated metric may be cut by any axis. An `item`-denominated one may
only be cut by an `item` axis, because *"median minor findings per PR"* keeps all seven
items in its denominator whatever the severity bucket says — a numerator filter wearing
a segment's label, and a different metric from the one being segmented. Every skipped
pair is reported with its reason instead of being silently absent.

### The axes, as the code that owns them actually defines them

| Axis | Unit | Arms | Buckets |
|---|---|---|---|
| `severity` | finding | both | `KNOWN` (4), plus `severity-unstated` when observed |
| `file_class` | finding | both | `FILE_CLASSES` (**5**), plus `no-file` |
| `diff_size:scopeSize` | item | both | S · M · L, cross-checked against the frozen `meta.scope` |
| `provenance` | item | both | **3** — `human`, `local-cli-agent`, `autonomous` |
| `novelty` | finding | panel | `ORIGINS` (4) plus `not-annotated` |
| `coderabbit_category` | finding | coderabbit | discovered from the data — their CHILL vocabulary, verbatim |
| `window` | finding | coderabbit | `WINDOW` (4) |
| `defect_type` | — | — | **declared and NOT computed**, with the reason |

Two of spec §4's rows named vocabularies that do not exist in the code they cite, and
both are corrected in place rather than reproduced: file class is five classes, not six,
and authorship is three values, not two — collapsing `local-cli-agent` into either side
would be a judgement this scorer has no basis for.

**Diff size has two colliding scales**, so the one used is part of the axis id and
therefore of every segment label. `scopeSize` is three buckets and is what the manifest
froze into `meta.scope`; the five-bucket XS…XL scale §4 calls *"the report's own"* is
**implemented nowhere under `scripts/`** — grepped — so it is not offered rather than
invented.

**`defect_type` is declared and refused.** It is the axis a reader most wants, it is
assigned at adjudication, no adjudicated labels exist, and pre-filling it from a lens id
would report our own routing as a property of the defect. An omitted axis and an
unbuildable one look identical in a table.

## Corrected while building

**1. 🔴 The first draft published a ratio larger than 1, on real data, and nothing went
red.** `n` was taken from the thinnest replicate and `k` from the median one, so the grid
printed `in_diff_rate/severity=nit/arm=panel: 0.833 (25/17)`. The value was k3's 25/30,
the denominator was k1's 17, and the pair was never a pair. Found by reading the output,
not by a test.

The fix is not "use the same leg" — it is an **invariant that refuses** when `k > n` or
when `value ≠ k/n`, plus a split that names both numbers: a reported cell carries the
median leg's `value`, `k` and `n` together, a suppressed cell carries the **thinnest**
leg's `n` (the denominator that actually failed, so `n=2 < 5` is a true sentence), and
the suppression **test** reads the thinnest leg because an aggregate over K is only as
supported as its weakest draw. Both `n`s are in the payload on every cell.

**2. 🔴 A tautology cleared min-n and got published.** `nit_ratio × novelty` reported
**1.000 (112/112)** with a tight interval, which reads as a strong finding about
pre-existing code. It is arithmetic: `annotateFindings` stamps novelty **only on
critical/major**, so every annotated bucket has a nit ratio of 0 and `not-annotated` has
1. The novelty axis is severity-confounded **by construction** — a fact about the
annotation, not about the code's age. Both this pair and the obvious `nit_ratio ×
severity` are now declared in `TAUTOLOGICAL_PAIRS` with reasons. A tautology is more
dangerous than a thin cell precisely because it has a fat denominator.

**3. The plan's assumption about novelty was half right.** The handoff expected either a
frozen origin on the record or an axis that cannot be built, because `noveltyOf` is async
and reads git. Measured: the origin **is** frozen onto the record by the replay
(`panel.novelty.origin`) — 36 · 35 · 33 of 142 · 147 · 139 records across the three
replicates — so the axis is computable without touching git. What the assumption missed
is the population: those 36 are the blocking stratum, so the axis has a different
denominator from every other axis, and the other 106 records are `not-annotated` rather
than `unknown`.

**4. A raw control byte nearly went into the source.** The composite key separator was
written as a literal `U+001F`, which makes `file` call the module *data* and `grep`
silently find nothing in it — the defect `volume-mix.mjs` already has two of. It is
`String.fromCharCode(31)` instead, and the file is plain ASCII.

**5. Three mutations survived the first pass, and none was a missing test.** Each was
*ineffective for the inputs the test used*, which is a different diagnosis with a
different fix. Dropping the `[0,1]` clamp changes nothing at n ∈ {1,5,10,30,142} and
lands 7e-18 below zero at **n=27** — so 27 is now in the loop. Disabling the delegation
to `assertComparableWindow` still threw, from this file's own fallback, whose message
happens to contain the string the test matched. Disabling the grid-level `min_n` guard
still threw, from `cellFrom`. Two assertions were retargeted onto the wording only the
intended guard produces; nothing was weakened.

## The numbers — the pilot's grid, measured once with the code frozen

```
node eval/segmentation.mjs --root <store> --corpus-version 2026-08-10-pilot-reviewed \
  --run-id pilot-01__k1 --run-id pilot-01__k2 --run-id pilot-01__k3
```

**149 cells: 76 reported, 73 withheld (49.0%). 22 of 53 two-arm segments have both arms
reported.** Complete on coverage: 7 of 7 corpus items on both arms, one gate state
(`on`), one reviewer (`config_hash sha256:1c7853de…`, `panel_sha 46da673dd`).

🔴 **The prediction that this grid would be entirely blank is true per PULL REQUEST and
false per FINDING, and the difference is the unit.** Every per-PR cell is withheld — the
fattest is `diff_size=L` at n=4 items — exactly as §4.1's table says. Per finding, both
arms clear the threshold in several buckets, because CodeRabbit's 30 findings split
`major 3 · minor 13 · nit 14` and ours are 142/147/139.

A sample of what survives both arms' suppression tests:

| segment | panel | CodeRabbit |
|---|---|---|
| `localization_rate` · `file_class=code` | 0.817 (n=109) | 1.000 (n=12) |
| `localization_rate` · `file_class=prose` | 0.778 (n=9) | 1.000 (n=12) |
| `in_diff_rate` · `file_class=code` | 0.771 (n=109) | 1.000 (n=12) |
| `nit_ratio` · `file_class=code` | 0.755 (n=98) | 0.917 (n=12) |
| `nit_ratio` · `diff_size:scopeSize=L` | 0.741 (n=85) | 0.917 (n=24) |

**What the grid says about the corpus rather than about either reviewer:**

- **`severity=critical` is withheld at n=0 and the basis says why it is not empty:** 0
  findings in replicate 1, 3 in replicate 2, 1 in replicate 3. A cell described as empty
  here would repeat a claim this project has already published and corrected.
- **The `provenance` axis is not degenerate**, contrary to the plan's expectation of one
  bucket: 4 human items, 2 autonomous, 1 `local-cli-agent`. Per finding all three
  buckets clear the threshold; per PR none does. The axis still **cannot carry a claim**
  — 3 autonomous PRs exist in the whole 106-PR pool — so its cells are reported and its
  attribution is declared unavailable.
- **`window` is 30 of 30 `in-window`**, so the axis costs one reported cell and three
  withheld ones, and `assertComparableWindow` never fires on this store.
- **No cell in the pilot's grid is a measured zero.** The only zero-valued cells were the
  two tautologies now excluded, so that path is covered by a test rather than by data.

## Fail directions

| Part | On failure | Why that is the safe direction |
|---|---|---|
| A thin cell | **Withheld**, with `n`, `min_n` and the reason it is thin | The alternative is a number nobody can check |
| `n=0` on a proportion | No interval, with the reason | An absent measurement is not a wide one |
| Two gate states, two corpora, one run twice | **Refuses** | Each would describe the harness as a property of the reviewer |
| Two review windows, window axis not selected | **Refuses**, delegating to `assertComparableWindow` verbatim | That guard names this scorer as its remedy; selecting the axis is the remedy, not an override |
| A record on an item the caller did not list | **Refuses** | A per-PR median needs the item list to count the items that produced nothing, and an undeclared item skews it in the flattering direction |
| A `value`/`k`/`n` triple that is not internally consistent | **Refuses** | It shipped once; the ratio was larger than one |
| An unrecognised severity, origin, provenance or window value | Own bucket, or refuses where the vocabulary is ours to trust | A value filed under one it resembles is invisible; a foreign vocabulary that drifted is a refusal |
| An item with no frozen geometry | Reads `item-unavailable` through the existing helpers; density leaves the denominator and `n` says so | `findings / 0` is either Infinity or a silent skip |
| A per-PR bucket with quiet items | Counts them as **0** | Dropping them makes the median rise as the reviewer gets quieter |

## Explicit non-goals

- **No new metric.** Five metrics, all of them already computed by `volume-mix.mjs`.
- **No labels, no adjudication, no precision or recall.** `defect_type` is declared
  `not-computed` and every validity metric stays out.
- **Nothing else is touched** — not `volume-mix.mjs`, not `reliability.mjs`, not
  `finding-match.mjs`, no adapter, no workflow, no store. Two new files.
- **No writing and no spending.** No `putScore` call: the payload is what `--json`
  prints. Filing it into a store is a later PR's business.
- **No matcher re-thresholding.** Cross-arm cells here are two independent single-arm
  cells read side by side; nothing resolves a `maybe` pair.
- **The five-bucket diff-size scale is not implemented.** It exists in prose only, and
  inventing it would be defining a bucketing rather than segmenting by one.
- **Every cell is single-arm.** There is no pooled cross-arm denominator, because
  CodeRabbit's 30 findings would bind every one of them.

## Verification

- [x] `agent:tests`, the real CI lane (two invocations since #774) — **1792 tests (1736
      + 56), 1791 pass, 0 fail, 1 skipped**, against a freshly measured `main`
      (`49b51885a`) at **1755 (1699 + 56) tests, 1754 pass, 0 fail, 1 skipped**. **+37**,
      which is exactly this file's test count. Both trees were extracted with `git
      archive` and given identical `node_modules` symlinks **before either was measured**,
      so the single skip (the Agent SDK) is a property of both trees rather than an
      environment artefact.

      ⚠ **`eval/run.test.mjs` failed 2–3 rotating tests mid-session on BOTH trees, and it
      is not this change.** Another session was running its own mutation harness over the
      same file at the time; the documented shape of that flake is two concurrent runs of
      this file both failing on a shared `os.tmpdir()` snapshot. Reproduced on the base
      tree with none of this code present, with a *different* failing test each run
      (`a failed item KEEPS its raw panel output`, `a throw inside the item loop still
      deregisters the worktree`, `the reaper is WIRED UP`), and clean again — 56/56 — once
      the other harness stopped. Not investigated further and not touched.
- [x] `eslint scripts` exits **0** at the lockfile-pinned 9.24.0, on both trees.
- [x] **Mutation testing: 54 mutations, 54 caught, 0 survivors** — and each by the test
      that *claims* to prevent it, checked by test name rather than by the suite going
      red. Three survived the first pass; all three were ineffective rather than
      uncaught, and all three are written up above.
- [x] Verified from the **committed tree** (`git archive <branch> | tar -x`), not the
      working copy; both new files are byte-identical between the two.
- [x] Measured against the real store **once, with the code frozen**, and the whole run
      is free and repeatable: 149 cells over 3 panel replicates and 30 CodeRabbit
      findings, in about 4 seconds plus the read-only GitHub calls the CodeRabbit arm
      makes.
- [x] Every upstream claim re-checked at `file:line` on `main` before it was used:
      `FILE_CLASSES` `review-panel.mjs:226`, `classifyFile` `:281`, `scopeSize`
      `metrics.mjs:486`, `ORIGINS` `novelty.mjs:61`, `noveltyOf` `:244` (async, takes
      `{repo, file, line, baseSha, cache}` — hence the frozen origin), `classifyProvenance`
      `extract-corpus.mjs:123`, and `localizationOf` · `scopeOf` · `severityMix` ·
      `proportion` · `median` · `gateSegmentOf` · `itemGeometry` in `volume-mix.mjs`.
      **No confidence-interval helper exists anywhere under `scripts/agent/`.**
- [ ] **Not verified: how a report renders this grid.** No merged renderer reads a
      `segmentation-v1` payload, so the shape is asserted against its own tests here and
      the rendering is out of this PR's reach. The payload is additive-only — a consumer
      reading `segment`, `suppressed`, `n`, `min_n`, `value` and `unit` needs nothing
      else — and every other field is extra.
- [ ] **Not verified: any figure a label would produce.** Precision, recall and defect
      type are Wave 5/6 and no adjudicated labels exist. This scorer segments behaviour,
      not quality.
