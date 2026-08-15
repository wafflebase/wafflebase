# Choose the token metric by ARM, not by run

A **new** document rather than a section on
`archive/2026/08/20260803-finding-level-matching-todo.md`, which owns the matcher and is
archived, or on `20260810-defect-class-grouping-todo.md`, which owns `groupFindings` and is a
*consumer*. This one is about which similarity a pair gets and why.

## The problem

`tokenOverlap` scores a cross-source pair as **shared tokens over the smaller token set**. With
the numerator fixed, that is *constant in the length of the longer operand*:

| 3 shared, short side 6 tokens | other side 6 | 12 | 24 | 48 |
|---|---|---|---|---|
| containment | 0.50 | 0.50 | 0.50 | 0.50 |
| dice | 0.50 | 0.33 | 0.20 | 0.11 |

Upstream chose containment deliberately, and the reason is written down: *"the panel restates one
defect at different levels of detail, and Jaccard penalises the extra specifics in the longer
wording, which is precisely the wrong behaviour here."*

**That is an argument about one reviewer restating itself.** It is not an argument about two
different reviewers, where a long text covering a short one is the arithmetic of shared file
vocabulary rather than evidence of agreement. And `gateFor` routes **same-arm-different-run down
the cross-source path**, so the argument's own population and the population it governs had come
apart. Three live callers, three shapes, one metric:

| caller | pairs | shape | wants |
|---|---|---|---|
| `eval/reliability.mjs:535` | panel k1 vs k2 vs k3 | one reviewer, two replicates | containment |
| `harvest.mjs:1642` | panel vs CodeRabbit **prose** | 14 tokens vs 32 | dice |
| `eval/complementarity.mjs:638` | panel vs CodeRabbit **title** | 14 tokens vs 7 | dice |

⚠ **The prose row is easy to get backwards.** `attributeToPanel`'s `neutral()` reads `f.summary`,
but the call site one frame up has already put `finding.detail` into that field — *"Prose for the
token comparison, the whole body for the anchor layer."* The field is named `summary` and holds
the prose.

**Why the cross-arm half is worth changing.** `harvest.mjs` uses the verdict to decide when one
reviewer's finding restates another's, and a match **suppresses** the candidate: a false one
deletes a real finding from the corpus with no later pass able to recover it, while a false
non-match files a duplicate a curator strikes out in one line.

## The change

1. `tokenOverlap` is **unchanged** — containment, for same-arm pairs.
2. New `crossArmTokenOverlap` — Dice — for pairs from two different arms.
3. New `CROSS_ARM_SIMILARITY = 0.22`, the bar for that metric only.
   `DEFAULT_SIMILARITY` still governs everything else.
4. `matchAnchored` takes `opts.sameArm`; `gateFor` derives it and names three cases.
5. **The gate structure is untouched.** Same-arm-cross-run keeps L2's location and anchor gate
   exactly; only the metric and its bar differ. That is what makes `reliability.mjs` reproduce.

`summaryTokens`, `findingSimilarity`, `clusterFindings`, every lens and the gate are untouched.

## Corrected while building

**1. The number that motivated this task was wrong, and it was mine.** The measurement behind
*"false positives 6 → 3"* used a hand-written containment that **omitted `MIN_SHARED_TOKENS`**.
With the floor, as shipped, the two metrics are indistinguishable on that population. Every number
here now comes from the **real exported functions** of each tree.

**2. A median is not a distribution.** I expected Dice @ 0.30 to reproduce the baseline on
`reliability.mjs`, since panel-vs-panel medians are 14 tokens against 14. It does not — 269
classes against 245, in-all-three 16.0% against 22.9%. Panel summaries run 52–536 characters, so
the *pairwise* population is asymmetric even though the medians match. **This is the third time in
one day a summary statistic concealed the thing that mattered** — after the file-vs-finding
severity reversal and the replicate-total-vs-per-item cost spread. Check the spread before
reasoning from a median.

**3. Two earlier drafts both moved a published number, and neither had to.** A single global metric
forced a choice between them: 0.22 raised `reliability.mjs`'s just-published in-all-three from
22.9% to 23.8% — *upward, via our own change, five hours after publication* — and 0.25 halved the
harvest gain to avoid it. Routing by arm removes the choice rather than splitting it.

**4. A mutation survived, and it was the one this change most needed caught.** Flipping `gateFor`'s
unreadable-arm case to same-arm passed all 71 tests. The trap-1 test asserted
`stats.gate.defaulted > 0`, which is true under *either* routing. It now uses a pair whose verdict
differs between the two metrics — 3 shared tokens across 3 and 25, containment 1.00 versus Dice
0.214 — and asserts the two findings do **not** merge.

## The numbers

Against `main` at `a6f25053e` (includes #779, #780, #782), pilot corpus
`2026-08-10-pilot-reviewed`, store at `09c27e9`.

**`eval/reliability.mjs` — the whole output is byte-identical**, `diff` clean:

| | before | after |
|---|---|---|
| defect classes | 245 | **245** |
| in all 3 | 56/245 = **22.9%** | **22.9%** |
| Jaccard | 0.438 · 0.434 · 0.430 (mean **0.434**) | **identical** |
| gate agreement | 7/7 | 7/7 |

**`eval/complementarity.mjs`** — the one disclosed move, under decision 29:

| | before | after |
|---|---|---|
| defect classes | 166 | 165 |
| **both arms (overlap)** | 6/166 = **3.6%** | 7/165 = **4.2%** |
| CodeRabbit only | 24 = 14.5% | 23 = 13.9% |
| cross-arm `maybe` links | 412 | 411 |
| ceiling | 21.1% | 21.1% *(unchanged)* |

Per item only `pr-549` moves: both 0 → 1. The pair is panel *"`isEmptyBulletLine` also accepts `*`
and `+`…"* against CodeRabbit *"Missing over-indent guard in `isEmptyBulletLine`…"*. It is not
adjudicated; it is reported because it moved.

**Cross-arm metric, on 3608 pairs from different pull requests** (all known non-matches) plus the
6 the incumbent calls `match`:

| shape | metric | false matches | true matches kept |
|---|---|---|---|
| PROSE (harvest) | containment @ 0.30 | 16 / 3608 | 4 / 6 |
| PROSE | **dice @ 0.22** | **1 / 3608** | **3 / 6** |
| TITLE (complementarity) | containment @ 0.30 | 2 / 3608 | 6 / 6 |
| TITLE | **dice @ 0.22** | **2 / 3608** | **6 / 6** |

⚠ The right-hand column is 6 pairs deep and **circular** — those 6 were selected by containment.
It shows recall is not silently destroyed; it is not a recall measurement.

## Fail directions

- **Absent provenance routes CROSS-ARM.** `harvest.mjs` compares through `neutral()`, which
  carries no `arm` and no `run`; inferring same-arm from `a.arm === b.arm` would compare
  `undefined === undefined`, get `true`, and silently restore containment at the only production
  cross-arm caller. Both `matchAnchored` and `gateFor` default the other way.
- **A longer operand now scores lower cross-arm, never higher.**
- **The floor fires first in both metrics**, before any division.
- **Same-arm behaviour is bit-for-bit what it was**, which `reliability.mjs`'s clean `diff` proves
  rather than asserts.

## Explicit non-goals

- **No assignment / fan-out fix** — still the next PR, and the k2 adjudication has made it the
  higher-value one.
- **No stemming, vectors, sentence encoder or model-judged similarity.** All need labels.
- **No `summary` → `detail` swap** at the complementarity call site.
- **`codeRabbitDetail`, `CR_PROSE_END` and `CR_HEADER` untouched** — another session holds
  `harvest.mjs` for the title fix and it lands first.
- **No `maybe` resolved, promoted or re-thresholded.**

## Verification

- [x] `agent:tests`, both invocations, branch: **1691 + 55 = 1746**, 0 fail, 0 skipped
- [x] freshly measured baseline at `a6f25053e`, both trees set up identically:
      **1684 + 55 = 1739** → **+7 tests**
- [x] ⚠ `eval/run.test.mjs` failed 2 on **both** trees when the two lanes ran back to back — the
      shared-state flake `01-CONVENTIONS.md` documents. Re-run serially, both are 55/55. Not
      caused by this change; it reproduces on the untouched baseline.
- [x] `eslint scripts` exit **0** on both, eslint **9.24.0** (the lockfile pin)
- [x] **`reliability.mjs` output byte-identical** — `diff` clean, 245 · 22.9% · 0.434
- [x] `complementarity.mjs` before/after run end to end
- [x] **seven mutations, each caught by the intended test:**

  | mutation | tests red |
  |---|---|
  | `opts.sameArm` absent defaults to true | 3 |
  | `gateFor` unreadable arm → same-arm | 1 *(survived the first version of the test)* |
  | `gateFor` same-arm always false | 6 |
  | cross-arm metric → containment | 5 |
  | bar → 0.20 | 1 |
  | bar → 0.25 | 1 |
  | drop the floor in `crossArmTokenOverlap` | 1 |

- [ ] **not verified: whether the one changed verdict is correct.** There is no adjudicated pair
      set. This PR does not claim the new metric is more accurate — it claims the containment
      rationale is applied to the population it was written for, and that same-arm scoring is
      provably unchanged.
