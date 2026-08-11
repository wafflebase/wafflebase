# Score agreement across K replicate runs of one corpus

A **new** document rather than a section on `20260811-eval-volume-mix-scorer-todo.md`.
That file owns *"how much does each reviewer produce"* and explicitly **refuses** to
aggregate across replicates, naming this as the module that would. The two answer
different questions from the same records, and the rule this one establishes — **a
single reliability number is a way of losing half the result** — is not about volume.

## The problem

The replay lane bought three complete replicates of one reviewer over one corpus
(`pilot-01__k1/k2/k3`, `panel_sha 46da673dd`, `config_hash sha256:1c7853debf4e…`,
corpus `2026-08-10-pilot-reviewed`, 21 replays, $92.93 in the store). **Nothing reads
more than one of them at a time.** Every number the benchmark can currently produce
is computed from a single replicate, and a scorer that pools K runs by accident is a
worse outcome than one that refuses to: the union of K runs grows with K, so our arm's
volume would rise with the sample size while the other arm's stayed fixed.

The question this closes is spec §3.2's: **ask the same reviewer the same question
three times — does it answer the same way?** It needs no labels, which is why it can
be answered today, and it is the one metric our replay uniquely enables.

The failure mode is the scorer failure mode, not the plumbing one. A broken extractor
throws and a broken adapter refuses; **a broken agreement scorer returns a ratio
between 0 and 1** that nobody can check. Two such ratios are available from this data
by accident:

| The subset | What a naive scorer does with it |
|---|---|
| Two runs whose `panel_sha` or `config_hash` differ | Reports the difference between **two reviewers** as one reviewer's instability |
| An item whose replay ended `status: "error"` | Scores a truncated finding set as **disagreement**, so the panel looks unreliable because the harness failed |

## The change

`scripts/agent/eval/reliability.mjs` — pure functions plus a CLI that prints.
`reliabilityOf(runs)` takes `[{ run_id, records, sampled, items }]` and returns the
five §3.2 metrics; there is no store, no network, no clock and no `--out` (a test
asserts the module's only static `node:` imports are `path` and `url`).

**Spec §3.2 (a)–(e), and nothing else:**

| | What it computes | Denominator |
|---|---|---|
| **(a)** Finding-set agreement | Jaccard over defect classes, **per pair** (k1↔k2, k1↔k3, k2↔k3) with the three values and their range — never a bare mean | classes either run reached |
| **(b)** Recurrence | the full 3/3 · 2/3 · 1/3 distribution, overall, per item, per severity | classes over K |
| **(c)** Verifier agreement | raw agreement **and** κ, with the marginals | classes in both runs where **both sides carry a real verdict** |
| **(d)** Gate agreement | per item across K, from the `panel[]` rows, cross-checked against the finding lanes | items whose verdict is known in every run |
| **(e)** Per stage | detection (`population: "sampled"`) → reported, per item and per run, plus (a) and (b) recomputed on the detection population | as above, per population |

Every one is **stratified by severity** and every ratio **carries its `n`** — because
the pilot measured the churn to *be* severity-dependent, so one pooled figure would
average a gate verdict that never flips together with a nit population that reproduces
6% of the time.

### Grouping is per pair for (a) and (c), and once over K for (b)

`groupFindings` is not pairwise-stable: complete linkage merges two groups only when
**every** cross pair between them is a `match`, so a third replicate's members can
block a merge the two runs alone would have made. Slicing a pair out of one K-way
grouping would therefore make a pair's answer depend on how many other replicates were
passed in. So (a) and (c) group each pair on its own and (b) groups all K, and the two
class counts differ for exactly that reason — 183/171/175 per pair against 219 over
three. Both denominators are reported.

### Three refusals, each aborting

They are most of this PR, and each is mutation-tested.

| Refuses | Because |
|---|---|
| **Two reviewers, or two corpora** | The pooling key is `(config_hash, panel_sha)` for the reviewer and `corpus_version` for the subject. Decision 13: when the panel moves, only the corpus **items** carry forward, never the results — and the fork's checkout determines `panel_sha`, so this is live rather than theoretical. An input that states **no** reviewer identity is refused too: zero identities is not "one reviewer", it is an unprovable pool |
| **An item whose envelope `status` is not `ok`** | A failed replay is not a clean review, and the two are indistinguishable at the record level. **`undefined` is refused as well**, which is the load-bearing half: `adapters/panel.mjs`'s per-item read does not return `envelope.status`, so a caller reaches this case by forgetting, and defaulting it to `ok` would pool exactly the items the guard exists to exclude |
| **Fewer than two runs** | Reliability over one replicate is not a weaker number, it is undefined. A repeated run id is refused for the same reason: a run compared with itself reports perfect agreement |

It **aborts rather than excluding**, and the escape hatch is in the message: a
partially-failed replicate is scorable for the items that succeeded, and choosing them
is the operator's call rather than a default this file makes by dropping rows. Hence
`--item` is repeatable as well as `--run-id`.

### Two vocabularies whose middle value says "we could not tell"

Built the way `GATING` and `LOCALIZATION` are built, for the reason this project has
now written down three times: **absent has more than one cause.**

- **`GATE_VERDICTS`** — `gated` · `clean` · **`unknown`**. The rule is the workflow's,
  read off `agent-review-panel.yml`: `blocking && applicable`, conclusion mapped
  (`success` → success, `skipped` → neutral, else failure), block on anything not
  success. `unknown` is for a payload with no rows — reading that as "no lens failed"
  would manufacture a clean gate out of a missing input, and an item with an `unknown`
  verdict in any replicate reports `agrees: null`, never `true`.
- **`VERIFIER_VERDICTS` / `VERIFIER_NON_VERDICTS`** — `confirmed-high` ·
  `confirmed-low` · `errored`, against `not-run` · `split`. The spec says
  *"confirmed / refuted"*; the real vocabulary has four values and **refuted is not
  among them.** `errored` means the verifier ran and failed, and is never a refutation;
  `not-run` means it never looked, which on this data is structural (it runs on
  blocking severity only) and is excluded from (c)'s denominator with its count;
  `split` is our own inability to attribute one outcome when a run's members in one
  class disagree.

### κ is not a number field anywhere

`cohenKappa` returns an object carrying `raw_agreement`, `observed`, `expected`, the
**marginal distribution of each side**, and the caveat — so a consumer cannot render κ
without them, and the renderer prints them on the same line. `kappa` is `null`, never
0, when it is undefined: at expected agreement 1 a 0 would read as *"no better than
chance"* for a rater that never disagreed with itself.

**There is deliberately no pooled κ.** The three pairs share classes, so pooling would
count a class present in all three runs three times and print an `n` that overstates
the evidence threefold.

### One deliberate divergence from the gate, and one from `matchFindings`

The workflow fails **closed** on a lens the payload never recorded (`raw = p ?
p.conclusion : 'failure'`) because it is deciding whether to stop a merge. This scorer
reads that as `unknown`, because a scorer must not turn "not recorded" into a verdict —
the same split `finding-record.mjs` documents for the lane, where the panel's private
`findingGates` reads a missing lane as gating and `gatingOf` does not. On the pilot the
divergence is unreachable: all 21 payloads carry all six rows.

The lane route reads each record's own `gating` rather than re-testing
`lane === "blocking"`, so "what blocks a PR" keeps one definition — and a `backlog`
finding (5 of the pilot's 428) correctly does not gate.

## Corrected while building

### 1. My own reviewer guard fired on a poolable input — the bug it exists to prevent

The first version hashed `(config_hash, panel_sha, corpus_version)` into one key and
compared the set. A finding record **cannot carry `corpus_version`** — `provenanceOf`
does not put it there, correctly, since it is a property of the run — so the
record-derived key carried a `"?"` in that slot while the envelope-derived key carried
the real value, and **every run disagreed with itself.** The guard aborted on three
genuine replicates of one reviewer.

That is an absence pooled with a value, which is the failure this whole file is about,
committed inside the guard against it. The reviewer and the subject are now checked
separately, a value nobody stated is not a value, and an unstated corpus reports `null`
rather than aborting — while two *different* stated corpora still do.

### 2. Two mutations survived, and neither was fixed by weakening a test

- **`in_all` reading the 1/K bucket survived** because §3.2's worked example is
  symmetric: two classes in 3/3 and two in 1/3, so both buckets hold 2 and the test
  could not tell them apart. The unit fixture is now asymmetric (2 in 3/3, 1 in 1/3).
- **The per-item detection delta survived** because only the run-level `null` was
  asserted. Without the guard, a run with no sampled population reported *"+3 findings
  appeared after detection"*. Both levels are asserted now.

### 3. "37/37" is a per-lens denominator, not a per-item one

The handoff's *"they agreed 37/37"* for the two gate routes is the **per-(item, lens)**
comparison on **one** replicate — 42 lens slots minus 5 inapplicable. Measured across
all three: **21/21 item-runs and 111/111 applicable lens slots.** Both are now computed
and printed, and only the item-level one aborts on a disagreement: a legitimate
per-lens mismatch is imaginable (a lens whose only blocking finding the verifier
discarded is filtered out of `verdict.json` upstream of the record), while the
item-level routes are the gate's own decision.

### 4. The lane command in CI is two invocations, not one

`verify-self.mjs`'s `agent:tests` has run everything except `eval/run.test.mjs` and then
that file alone since #774. Measured both ways; the totals agree, and the two-invocation
figures are the ones quoted below because they are the ones CI produces.

### 5. I was INFERRING the within-run gate from the record shape, and it went stale in review

The first version answered *"which gate did the within-run pairs get?"* from the
records: no record exposes a top-level `lens`, therefore the gate is file-only. True of
`groupFindings` as it stands, and **false of `groupFindings` in general** — a change
that teaches it to fall back to `panel.lens` makes the gate lens-aware while every
record still looks identical from here. Measured against that change: this file printed
`file-only` while the grouper was gating on the lens, and the figure it qualified had
already moved by 26 classes.

That is the project's signature failure in miniature — a field answering the question it
was defined for rather than the one its name suggests — committed in the line whose only
job was to warn about it. It now **probes** the grouper instead: two synthetic findings,
same run and file, differing only in the lensed arm's lens, and whether they land in one
class or two is the answer. Its test asserts *self-consistency* with what the grouper
actually did rather than the constant `file-only`, so it cannot go stale, and a second
assertion pins that the verdict does not depend on the records passed in — which is
exactly the property that distinguishes a probe from an inference, and the mutation that
regresses to the old inference is caught by it.

### 6. The severity story REVERSES between file level and finding level

The file-level proxy in the handoff kit measured blocking severity as *churnier* than
average (40.0% of blocking-flagged files in exactly one replicate against 32.1%
overall). At finding level the opposite holds: **`major` classes are the most
reproducible stratum** (38.2% in all three, 32.7% in exactly one) against an overall
50.7% in exactly one. Both measurements are real and they are about different units —
a file is flagged if *any* finding lands in it, so one churny nit makes a whole file
churn. **The file-level stratification does not survive to finding level, and the claim
built on it should not be quoted.**

## The numbers

Measured **once**, with the code frozen, 2026-08-11, against the real store
(`dlgpdmsly2/wafflebase-agent-eval`), all three replicates, all seven items
`status: "ok"`, novelty gate **on**. Exits 0 — `COMPLETE`.

```
reliability · 3 replicate(s) pilot-01__k1, k2, k3 · corpus 2026-08-10-pilot-reviewed
             reviewer 46da673dd/sha256:1c7853debf4ed · COMPLETE
  ONE ARM ONLY: CodeRabbit retest pairs n=0. Nothing below is a comparison.
```

**The result, and it has two halves that must travel together:**

> **The gate verdict reproduced on 7 of 7 items. The set of findings behind it
> reproduced about a fifth of the time.**

| | Measured | n |
|---|---|---|
| **(d) Gate verdict agreement** | **7/7 = 1.000** (6 gated, pr-471 clean ×3) | 7 items × 3 runs |
| Gate routes agree (panel rows vs lanes) | 21/21 item-runs · **111/111** lens slots | — |
| Blocking-lane findings per run | 35 · 34 · 30 (spread 17%) | 428 records |
| **(a) Jaccard, per pair** | **0.415 · 0.421 · 0.429** (range 0.013) | 183 / 171 / 175 classes |
| **(b) In all three replicates** | **48/219 = 0.219** | 219 classes |
| In exactly one replicate | 111/219 = 0.507 | 219 classes |
| **(c) Verifier raw agreement** | **15/15 · 9/9 · 10/10 = 1.000** | 34 comparable pairs total |
| **(e) Detection → reported** | 158→142 (−16) · 161→147 (−14) · 156→139 (−17) | 21 replays |

**(a) came out at 0.42, below the file-level proxy's 0.61 — the direction the handoff
required.** File level is coarser, so agreement there is an upper bound on this. Every
per-item value is in `MEASURED` below; the spread across items (0.32–0.62) is wider
than the spread across pairs (0.013), which is the same "per item is one draw"
conclusion volume-mix reached from a different metric.

**Severity stratification, and this is the headline stratified:**

| stratum | classes | in all 3 | in exactly one |
|---|---|---|---|
| `critical` | 4 | **0/4 = 0.000** | 4/4 = 1.000 |
| `major` | 55 | 21/55 = **0.382** | 18/55 = 0.327 |
| `minor` | 126 | 25/126 = 0.198 | 61/126 = 0.484 |
| `nit` | 34 | 2/34 = **0.059** | 28/34 = **0.824** |

**Nits barely reproduce at all (6%), majors reproduce best (38%), and all four
`critical` findings in the whole pilot appeared in exactly one replicate.** The last
row is n=4 and must be quoted with it.

**(c) is degenerate, exactly as predicted, and the numbers are worth stating anyway:**
raw agreement is **1.000 on all three pairs** over 15, 9 and 10 comparable pairs.
κ = 1.000 on k1↔k2 (two outcomes present) and **undefined** on the other two — one
outcome holds every rating, so expected agreement is 1. Across all 21 replays the
verifier emitted `confirmed-high 89 · confirmed-low 6 · errored 2 · null 331` and
**not one refutation**, so κ carries no information about this verifier here. Excluded
from the denominator: 109/105/108 `not-run` and 7/10/12 `split`. **7 blocking-severity
records carry no verification at all** — reported, not explained.

**(e) says the noise is in detection, and the later stages do not add much:** the
detection population agrees *better* than the reported one (0.452 · 0.475 · 0.457
against 0.415 · 0.421 · 0.429), so dedupe, clustering, verification and lane routing
slightly **reduce** cross-run agreement rather than cleaning it up. The delta is
−16/−14/−17 findings, ~10% of each replicate.

### Why every figure above is a LOWER bound, measured

Two mechanisms, both counted rather than argued:

- **5565 cross-run `maybe` pairs never merged** across the three pairwise groupings
  (1941 · 1776 · 1848), against 611 `match`es in the K-way grouping. A `maybe` is a
  pair the matcher called *plausible* and the policy refuses to merge, so each one
  splits a same-defect pair into two classes, inflating the union and deflating the
  ratio. Nothing here re-thresholds or promotes one: resolving a `maybe` is
  adjudication, not scoring.
- **19 · 15 · 16 locations carry more than one finding within a single run** (43 · 35 ·
  34 records, 16 · 14 · 16 of them cross-lens). A run's class count therefore carries
  its own restatements, so a run that said one thing twice looks like it disagreed with
  a run that said it once. A confound, not a bug — and printed so a reader can size it.

**Which gate the within-run pairs took is PROBED rather than assumed:** `file-only`
today, and 0 of 428 records expose a top-level `lens` (all 428 carry one at
`panel.lens`). Cross-run pairs are unaffected — 9387 of 13952 pairs took the
cross-source gate, 0 defaulted.

### Which grouper these numbers were measured against, and what moves under the other

**Every figure above was measured against `groupFindings` as it stands on `main`
(`76f87ce`), where the same-run gate does not read a record's lens.** That is not a
detail to leave for a reader to discover: a change to that gate moves every
denominator here, so the numbers are pinned to the grouper that produced them and the
alternative was measured rather than predicted.

The change in question is open, not merged, and its default makes records lens-aware
with no caller change (`defaultLensOf` reads `finding.lens`, then the lensed arm's
`panel.lens`). Measured by running this scorer, unmodified, against that grouper:

| | `main` `76f87ce` | with the lens-aware gate |
|---|---|---|
| Jaccard per pair | 0.415 · 0.421 · 0.429 (mean 0.422) | **0.438 · 0.434 · 0.430** (mean 0.434) |
| K-way defect classes | 219 | **245** |
| in all three | 48/219 = 0.219 | **56/245 = 0.229** |
| in exactly one | 111/219 = 0.507 | 118/245 = 0.482 |
| `major` / `minor` / `nit` classes | 55 / 126 / 34 | 58 / 148 / 35 |
| detection-stage Jaccard | 0.452 · 0.475 · 0.457 | 0.467 · 0.486 · 0.472 |
| **same-run pair verdicts** | **611 match** · 5817 maybe · 7524 no | **503 match** · 5639 maybe · 7810 no |
| **cross-source pair verdicts** | **9387** | **9387 — identical** |

Three things that table settles, none of which was obvious beforehand:

- **The lens reaches only the same-run gate.** Cross-source pair verdicts are
  *identical* (9387 either way), because L2 never reads a lens. So a change there
  cannot move which findings the matcher considers the same defect *across*
  replicates; it moves how many classes each run contributes.
- **The arithmetic bridge is the flipped verdicts, not a resemblance between two
  numbers.** 108 same-run pairs flip from `match` to `no` (611 → 503) and that yields
  **+26 classes**, because breaking one pair inside a class of four splits it once
  rather than six times. An earlier draft of this section called +26 *"consistent
  with"* the 20/20/29 classes the accessor's own author measured collapsing per
  replicate; those are three separate per-replicate groupings against one pooled
  grouping, so they are not comparable quantities and the loose equivalence is
  removed. Credit to that session for the correction.
- **Today's figures are the CONSERVATIVE ones, which is the opposite of the intuition.**
  Splitting a within-run cross-lens class raises the union and should deflate Jaccard —
  but when *both* runs restated the same location it raises the intersection too, and on
  this data that dominates: agreement goes **up** by 0.012. So the lens-blind gate this
  PR measured against understates agreement rather than flattering it.

**Nothing this PR publishes carries a `D-` class id** — checked, 0 occurrences in the
54 KB of `--json` output — so the accessor's accompanying `contentDigest` change, which
does move those ids for record-shaped input, cannot move a figure here.

**And the scorer's tests pass against both groupers**, unmodified: 39/39 either way.
The gate census is read by key rather than `deepEqual`d, so the key that change adds
(`lens_unreadable`) prints automatically instead of reddening the lane.

## Fail directions

| When this fails | What happens | Why that is the safe way |
|---|---|---|
| Runs span two reviewers or two corpora | **Aborts**, listing each identity and the runs that carry it | The one error whose only symptom is a plausible number |
| No run states a reviewer identity | **Aborts** | Zero identities is not "one reviewer"; an unprovable pool is worse than a missing number |
| An item's envelope status is `error`, or absent | **Aborts**, naming the item and its reason, and pointing at `--item` | A truncated set reads as disagreement, so the panel would look unreliable because the harness failed |
| Fewer than two runs, or one run twice | **Aborts** | Agreement between an observation and itself is not a measurement |
| The two gate routes disagree on any item-run | **Aborts**, naming the item, the run and both answers | One of the two is wrong; a scorer that picked a winner would publish the wrong one silently |
| A lens check disagrees with its lane | **Reported** in `completeness.reasons` and printed | A legitimate mismatch is imaginable (a discarded lane), and it does not invalidate the item-level verdict |
| A payload carries no `panel[]` rows | The verdict is `unknown`, the item is `agrees: null` and excluded from (d)'s denominator | Reading it as `clean` would manufacture a decision from a missing input |
| An item is missing from one replicate | Its own figures quote the K it had; the pair that lacks it excludes it; `completeness` says so and exits non-zero | A per-item number that cannot name its K is not attributable |
| No sampled population is supplied | (e)'s deltas are `null` and the detection stage is `available: false` with its reason | `0` would read as "detection raised nothing extra" |
| A record's `verification` is a value this file does not know | Counted in `outside_vocabulary`, excluded from the denominator, and surfaced in `completeness.reasons` | Lesson 7: a vocabulary that grew is a guard that stopped guarding |
| Any ratio has no denominator | `ratio: null`, printed `n/a (n=0)` | `0/0 → 0.000` reads as a measurement of a reviewer that produced nothing |

## Explicit non-goals

- **No CodeRabbit retest pairs, and no pair-finder.** §3.2's other half needs a pull
  request CodeRabbit reviewed twice with the finding's lines untouched between reviews.
  Measured (#739): every one of the seven items has exactly **one** finding-bearing
  review — the extra `reviews` rows on #465 and #471 carry `bodyFindings = 0` and are
  acknowledgement replies. **The number of usable pairs is 0**, which is what §3.2 asks
  be reported honestly, and it is in the output as `coderabbit_retest_pairs`. A finder
  that can only return 0 is untestable against real data, so it is not built; it becomes
  buildable when the full corpus admits a PR with two finding-bearing reviews.
  **Consequence, stated in the report's second line: every figure here describes our
  panel and is not a comparison.** CodeRabbit cannot be re-run.
- **No κ on presence/absence.** Over the union of *observed* classes there are no true
  negatives, so expected agreement is undefined and the number would be meaningless
  while looking authoritative. κ belongs to (c), where the universe is bounded.
- **No adjudication of `maybe`s, no re-thresholding, no promotion.** Counted, never
  resolved. `finding-match.mjs` is untouched.
- **No within-run sample agreement.** `config.snapshot.json` confirms `samples: 1` on
  all six lenses, so there is no second sample to agree with. Every number here is
  across replicates.
- **No precision, recall or validity** — those need labels (Wave 5). No segmentation
  grid, no Wilson intervals, no renderer.
- **Nothing written and nothing spent.** No `--out`, no replay, no dispatch, no network.
- **No edit to** `finding-match.mjs`, `finding-record.mjs`, the adapters,
  `eval/README.md`, `volume-mix.mjs` or anything the gate reads.

## Findings for the modules this consumes

Neither is fixed here; both are edits to merged files this change has no other reason
to touch.

1. **`panelRecords`' per-item read still does not return the envelope's `status`** —
   the same finding volume-mix filed, now load-bearing for a refusal rather than an
   exclusion. It rides on each record as `panel.item_status`, so an item that ended
   `error` with zero findings carries it nowhere a scorer can see. The CLI reads the
   envelope from the store, and `payload.panel` — the gate's own input — is not a record
   field at all, so it comes from there too.
2. **`groupFindings` cannot see a finding record's lens** on `main`: a record carries it
   at `panel.lens`, so the same-run gate compares two absent values and passes on file
   alone. The open accessor change fixes it, its default needs nothing from this module,
   and its effect on every figure here is **measured above** rather than left to land as
   a surprise. Nothing cross-run moves — 9387 cross-source pair verdicts, identical
   either way.

## Verification

- [x] `agent:tests`, the real CI lane (two invocations since #774) — **1699 tests
      (1644 + 55), 1699 pass, 0 fail, 0 skipped**, against a freshly measured
      `upstream/main` (`76f87ce`) at **1660 (1605 + 55) / 1660 / 0 / 0**. **+39.** Both
      trees extracted with `git archive` and given identical `node_modules` symlinks
      before either was measured, so the 0 skips is a property of both trees rather
      than an environment artefact. `main` moved from `9d68ee0` to `76f87ce`
      mid-session; both trees were rebuilt at the new tip and re-measured rather than
      carried over, and the counts and the store measurement are byte-identical
      (the intervening commits touch `packages/design-editor`, `packages/frontend` and
      `hunt-ui-tool.mjs` — nothing this module reads).
- [x] `eslint scripts` exits **0** at the lockfile-pinned 9.24.0, on both trees.
- [x] **Mutation testing: 41 mutations, 41 caught, 0 survivors** — and each by the test
      that *claims* to prevent it, checked by name rather than by the suite going red.
      Three survived a first pass across two rounds; each was fixed by strengthening a
      fixture or adding an assertion rather than by weakening a test, and all three are
      written up above. The third is the instructive one: replacing the gate PROBE with
      the record-shape inference it replaced is **behaviour-preserving on `main`** —
      which is exactly why the inference looked correct — and is caught only by
      asserting that the verdict is independent of the records handed in.
- [x] **The whole suite runs green against BOTH groupers** — 39/39 with `main`'s
      `finding-match.mjs` and 39/39 with the open lens-accessor version, unmodified. The
      gate census is read by key rather than `deepEqual`d, so the key that change adds
      prints instead of reddening the lane.
- [x] Measured against the real store **once, with the code frozen**, and the full
      output is reproducible for free: `node eval/reliability.mjs --root <store>
      --corpus-version 2026-08-10-pilot-reviewed --run-id pilot-01__k1 --run-id
      pilot-01__k2 --run-id pilot-01__k3`. Runs in ~1 s.
- [x] Every claim taken from the handoff kit re-checked at `file:line` against
      `upstream/main` before it was used: `groupFindings` `finding-match.mjs:549`,
      `gateFor` `:497`, `codeRabbitRecords` `coderabbit.mjs:524`, `corpusRecords`
      `:698` — all four correct.
- [x] Every store-level claim re-measured rather than carried over: the per-item
      finding counts, the verification population (`89 · 6 · 2 · 331`), the
      severity split of who carries a verdict (`critical` 4/4, `major` 93/100, `minor`
      and `nit` 0), `samples: 1` on all six lenses, the blocking-lane counts
      (35 · 34 · 30), and the k1 detection delta (`158 → 142`, per item
      −3/−5/−1/−1/0/−5/−1). All confirmed; one rounding difference (pr-415's spread is
      13%, not 12%).
- [x] The gate rule is pinned against **real** `panel[]` rows (pr-415 gated with an
      inapplicable `skipped` docs lens beside it, pr-471 clean ×3), not invented ones.
- [x] §3.2's worked example passes as a test: **0.67 / 0.50 / 0.67**, mean 0.61, and
      recurrence f1 3/3 · f2 3/3 · f3 1/3 · f4 1/3.
- [x] Verified from the **committed tree** (`git archive <branch> | tar -x`), not the
      working copy.
- [ ] **Not verified against real data: every refusal.** All three abort in unit tests,
      and the gate-route disagreement does too, but all 21 pilot replays are `ok` under
      one reviewer with both routes agreeing — so the corpus exercises only the happy
      path. The `status: "error"` refusal has a real subject waiting: the poisoned first
      K=3 attempt (5 ok · 2 error) is exactly the input it exists to stop.
- [ ] **Not measured: agreement at K > 3, or on any other corpus.** Three points
      estimate a spread; they do not bound one.
- [ ] **Not run:** `pnpm verify:self`, `verify:fast`, `verify:browser`,
      `verify:integration`, any `packages/**` suite. Nothing here can affect them and
      CI runs them on the PR regardless.
