# Score precision over adjudicated finding labels, and refuse the two metrics this corpus cannot answer

A **new** document rather than a section on an existing one. Every other scorer under
`scripts/agent/eval/` measures what a reviewer *produced* — how much, how consistently,
at what cost. This is the first that reads the record saying whether any of it was
*true*, and the rule it establishes — **three different ways of having no number, and
they must never collapse into one** — is not a refinement of any of them.

## The problem

`scripts/agent/eval/labels.mjs` and `adjudicate.mjs` landed a finding-label record and a
blinded CLI that writes one. Nothing reads them. Every number the benchmark can produce
today is about volume, and the question the whole exercise exists to answer — *is the
answer right?* — has no consumer at all.

Writing that consumer is not arithmetic. Four specific things make a precision figure on
this data wrong in ways nothing downstream can detect:

| | |
|---|---|
| **A missing denominator looks exactly like a thin one.** CodeRabbit raised **0** `critical` findings and **3** `major` ones across the corpus — measured, and reproduced by this scorer's own claim census | A cell that prints `n<5` for `critical` tells a reader to wait for labels that can never arrive. The two cells are different facts and must render differently |
| **A label that fails to join its claim silently shrinks the denominator.** It inflates nothing, so nothing looks wrong | The pair-label store hit this exact bug one level up and reported *"0 of 349"*. A CodeRabbit `finding_key` hashes a summary **we** parsed out of their markdown, and that parser is being corrected — which is why `labels.mjs` demands `parser_vintage` on that arm |
| **The unit crosses a level and keeps its name.** `label`, `claim`, `defect class` and `reading` all sound like each other, and precision is a ratio over two of them | `adjudicate.mjs` bundles by defect class, so **N labels can come from one reading**, and 428 labels from 245 readings is not a dataset of 428 independent judgements |
| **Two metrics are unanswerable on this corpus, permanently** | Absolute recall and the miss profile need `true_defects[]` — defects found by something outside both arms. A set built from what reviewers found cannot contain what they missed. That is a property of the corpus, not a gap in a scorer, and a scorer that left them merely "unbuilt" would invite somebody to build them |

## The change

Two new files, and **no existing file is touched.**

`scripts/agent/eval/validity.mjs` — `validity-v1`, scope `cross-run`. Four computable
metrics (precision, severity-weighted precision, a relative-recall band, the
false-positive profile), two permanent refusals, a per-arm claim census, a per-arm join
census, and a CLI whose `--root` has no default.

`scripts/agent/eval/validity.test.mjs` — 39 tests.

Nothing is written, nothing is spawned and nothing is spent. `store.mjs` needs no change:
`validateScore` (`store.mjs:383`) only requires the scorer id to be a legal path segment,
so there is no registry to extend.

### Three ways to have no number, and the fourth that has one

`AVAILABILITY` is `present | suppressed | not-computed | not-measurable` — **the
renderer's own vocabulary**, imported from `report.mjs` and checked for set equality at
import, because a cell from here is eventually handed to its `renderCell`, which refuses
any state it does not know. The three absent states are decided by `availabilityFor` from
the denominator plus what is known about the claims behind it:

```
labelled_findings = 0, claim population exhausted   → not-measurable   (final)
labelled_findings = 0, claims still unlabelled      → not-computed     (pending)
0 < labelled_findings < min_n                       → suppressed       (thin)
labelled_findings >= min_n                          → present
```

`exhausted` has to be **earned**: every distinct claim the arm made already carries a
label. That is what makes `critical` on the CodeRabbit arm `not-measurable` while a
partially-labelled arm's identical zero is `not-computed`, and the reason string names
the arm's own stated-severity census rather than gesturing at the corpus.

A suppressed cell carries its denominator and **no value, no numerator and no interval** —
`segmentation.mjs`'s rule, for its reason: a payload is a file anybody can read, so
"withheld" has to mean the number is not in it. `MIN_N` (`segmentation.mjs:114`) and the
Wilson interval (`:152`) are imported rather than restated.

### The join is the part most likely to be wrong, so it is the part that is counted

`JOIN_STATUSES` has **five** values, not two. Only `joined` enters a denominator:

- `stale-parse` — the label's `parser_vintage` is not the current parse. **Checked before
  the key**, deliberately: a stale parse may still produce a matching key, and admitting
  it would pool a judgement about text we can no longer reproduce with judgements about
  current text.
- `parse-vintage-unknown` — the label carries a vintage and no current one was supplied
  to compare it against. Refused rather than assumed current, which is the direction
  `harvestVintage` itself chose.
- `unmatched` — the key names no claim. The keys are **listed**, not summarised.
- `claims-not-supplied` — no claim population for this arm at all. Without this state
  every label would read `unmatched`, which is a wrong census rather than a missing one.

Every one of the five is counted, the counts sum to the arm's label total, and each
becomes a completeness reason. Nothing is dropped.

### Levels, named in the field name

`labelled_findings` and `readings` are on every cell, in all four states.
`labelled_findings` is the denominator; `readings` — `labelCensus`'s own
`distinct class_id + unbundled` (`labels.mjs:699`) — is the only number a claim about
independence may use. The payload carries a `levels` dictionary so no reader has to infer
which is which, and the claim census counts `distinct_finding_keys` and says in the field
name that it is **not** a defect-class count.

### Relative recall is a band, and it needs no cross-arm matcher

The denominator is the union of the two arms' confirmed-real sets and **nobody knows the
overlap**. So the union is bounded set-theoretically instead, which imports nothing from
the complementarity lane:

```
union_low  = max(a, b)   →  high = a / union_low
union_high = a + b       →  low  = a / union_high
```

Both bounds are emitted and there is **no `value` key**. Both arms' support gates it,
because the band has a tautology at each end: with no labelled finding on the **other** arm
it collapses to `[1, 1]` — *"we found 100% of confirmed defects"* — and with none on
**this** one it collapses to `[0, 0]`. Each is true of the arithmetic and false about the
world, so both are refused, and a numerator below `min_n` is withheld.

### Tiers are never pooled

`label_source` is part of every cell's key, so a `gold` precision and a `silver` precision
are two cells and there is no arithmetic that produces one figure over both.
`assertOneTier` refuses a mixed set at cell construction.

## Corrected while building

- **The severity import path had to be re-derived rather than carried forward.** This
  module derives its severity weights from `KNOWN`, so it must read the same scale the
  label validator does. `labels.mjs:42` imports `../severity.mjs`; the directory also
  carried a byte-identical `vendor/pipeline/severity.mjs` until #830 removed the mirror
  and #850 returned the pipeline without it. The comment on the import now records that
  history instead of claiming the second copy exists.
- **The metric plan located a `critical`/`major` availability split in CodeRabbit's
  *stated* severity census while stratifying precision by the *annotator's*. Those are two
  different axes.** An adjudicator may call a `nit` claim `critical`, so a stratum keyed on
  the annotator's severity cannot take its availability from the reviewer's distribution.
  Resolved by keeping the metric on the annotator's severity — it is the truth side of the
  ratio, and weighting by the severity an arm *claimed* would let an arm set the weight of
  its own errors — and putting the reviewer's distribution in the claim census beside it
  under `distinct_keys_by_stated_severity`, where the `not-measurable` reason quotes it.
- **"Counts suppressed below `min_n`" would delete the FP profile.** A count of wrong
  claims is not a proportion, and withholding it leaves a row that says nothing. So counts
  always print and **shares** follow the min-n rule, each carrying its denominator.
- **Cells were originally built only for tiers that had a *joined* label**, which made an
  arm whose labels all failed to join disappear from the grid entirely — the same silent
  absence the join census exists to prevent. Now every tier with any label on the arm gets
  its cells, with a denominator of zero and a reason pointing at the join census.
- **The miss profile's refusal reason did not name the corpus.** Caught by its own test,
  which asserts the reason names the corpus property rather than a missing feature.
- **A hand-written repeated-flag reader was deleted** on noticing `reliability.mjs` already
  exports `repeated` and `segmentation.mjs` already uses it. A second reader is how two
  CLIs come to disagree about what `--run-id x --run-id y` means.

### Found by review, after the first pass, and fixed here

Eight defects, and six of them are the classes of error this file spends its length
warning about — which is the argument for the review rather than against the design.

| | |
|---|---|
| **A second availability vocabulary.** This file said `reported` where `report.mjs:186`'s `AVAILABILITY` — the vocabulary `renderCell` refuses anything outside — says `present`. Three of four values coincided, so a payload looked renderable and was not | The vocabulary is now imported and checked for **set equality at import time**, and a test hands a cell of **every** state to the real `renderCell`. A near-miss synonym is worse than a different word |
| **The claim population was narrower than the labelled one.** The CLI excluded items whose envelope status is not `ok`; `adjudicate.mjs` queues from every stored item without consulting the envelope | Such an item's claims are now **counted and its status reported**. The per-PR scorers exclude them for a different question — a failed replay would read as a careful reviewer in a median — and copying that rule here dropped real judgements to `unmatched` |
| **`distinct_keys_by_stated_severity` read a floored value.** `normalizeSeverity` maps an unrecognised severity to `major`, so a finding nobody called blocking was counted as one the arm "called major" — and a `not-measurable` reason was built on that count | Routed through `volume-mix.mjs`'s exported `severityIsStated`, exactly as `segmentation.mjs` does, into a `severity-unstated` bucket. Measured on the corpus: **0 of 426 panel claims and 0 of 30 CodeRabbit claims** are floored, so the caption is now true rather than accidentally true |
| **The recall band guarded the other arm's denominator and never its own numerator's support**, so an arm with one labelled finding out of 426 claims published a band, and an arm with none published `[0, 0]` | This arm's labelled count now gates it too — refused at zero, withheld below `min_n`. The mirror of the one-armed `1.0`, which was already guarded |
| **The CLI read every label but supplied only the selected arm's claims**, so `--arm panel` invented a CodeRabbit arm on which every label was `claims-not-supplied`, and returned `partial` and exit 1 for a question it had answered correctly | `--arm` now selects the judgements as well as the population |
| **A per-tier cell printed a per-arm sentence.** `claimPopulation` is per arm, correctly — no claim can take a further label of any tier once it has one — but the reason read *"none was judged critical"*, which is false the moment a label of another tier judged one | The reason names the tier |
| **The operator weight-override path was never exercised** | A test drives it end to end through `scoreValidity`, proves a flat vector collapses the weighted figure onto plain precision, and proves an illegal vector is still refused |
| **The FP profile's `stated_severity` axis was only asserted to exist**, on a fixture where it equalled the annotator's severity — so reading the wrong field would have passed | A fixture where the reviewer said `nit` and the adjudicator said `major` for all six claims, so the two axes cannot both be right |

## Fail directions

| What fails | What happens | Why that is the safe way |
|---|---|---|
| No labels exist | Every figure is absent, the payload is `partial`, the CLI exits **1** | The honest result. A scorer that printed something for an unadjudicated store would be printing something it made up |
| A label does not join its claim | It is counted under its own status, its key is listed, and a completeness reason names it | The alternative is a denominator that quietly shrank, which inflates nothing and so is never noticed |
| The current parser vintage cannot be read | Every CodeRabbit label reads `parse-vintage-unknown` and leaves the denominator | Ask what happens when the check's input never arrives. Unknown is refused, never assumed current |
| An arm's claim population is not supplied | Its labels are placed nowhere and said so; no precision is computed for it | Reporting them all `unmatched` is a wrong census rather than a missing one |
| A cell is thin | Denominator only, no value, no numerator, no interval | A blank cell gets questioned and a number does not |
| A stratum has no denominator at all | `not-measurable`, with a reason naming the arm's own claim census | Calling it thin tells a reader to wait for labels that can never arrive |
| A label is from another corpus version, or is an item label | **Refuses.** | Both would put a judgement about different code, or about a different question, into a finding denominator |
| A CodeRabbit finding is `after-window` | **Refuses**, via `assertComparableWindow` | A finding about code our arm never reviewed cannot share a cell with one about the reviewed snapshot |
| A label file is unreadable | Counted into the payload and into the completeness reasons | An unreadable label is a judgement that was made and cannot be re-asked |

## Explicit non-goals

- **No report section.** `report.mjs:109`'s `SECTIONS` is a frozen array that `SCORER_IDS`
  derives from at `:119`, and rendering `validity-v1` is a follow-up.
- **No label is written, created or backfilled**, and no adjudication is run. Every
  fixture in the tests is built through `buildFindingLabel`.
- **No cross-arm matching.** Relative recall's band needs none, and `complementarity.mjs`
  and the pair-label store are neither imported nor read.
- **No defect-class grouping.** `finding-match.mjs` is untouched and unimported; a label
  carries the class it came from, and re-deriving one would be a second answer to a
  question that has one.
- **Nothing is persisted.** Like every merged scorer here it reads, computes and prints.

## Verification

Measured on `main` at `98d0565914c169e0d56432f98a2ab6a35d1fa7e9`. Both trees extracted
with `git archive` and given the same `node_modules` (pinned `eslint@9.24.0`,
`@anthropic-ai/claude-agent-sdk@0.3.217`, `zod@4.4.3`), then measured once each.

- [x] `cd scripts/agent && node --test-timeout=60000 --test $(ls **/*.test.mjs | grep -v '^eval/run.test.mjs$')` →
      **2263 tests, 0 fail, 0 skip**; freshly measured baseline on the same tree without
      these two files: **2224, 0 fail, 0 skip**. **+39**, which is this file's whole test count.
- [x] `cd scripts/agent && TMPDIR="$(mktemp -d)" node --test-timeout=60000 --test eval/run.test.mjs` →
      **56 tests, 0 fail**, identical on both trees.
- [x] `npx eslint scripts` → exit **0** on both trees, no output.
- [x] **36 mutations, 36 caught by the specifically-named test.** The harness proves each
      mutation changed the file's bytes before running, uses a replacer function rather
      than a replacement string, restores the subject afterwards and verifies the
      restoration. A mutation caught by a *different* test is reported as a harness
      finding, not as a pass.
- [x] Run against the real store, both arms, `2026-08-10-pilot-reviewed`:

  ```
  arm coderabbit: 0 label(s) · claims 30 distinct key(s) over 30 record(s) in 1 replicate(s)
    claims by STATED severity (the reviewer's own word): critical=0 major=3 minor=13 nit=14
  arm panel: 0 label(s) · claims 426 distinct key(s) over 428 record(s) in 3 replicate(s)
    claims by STATED severity (the reviewer's own word): critical=4 major=98 minor=258 nit=66
  ! no finding label exists for this corpus version, so every figure is not-computed
  PARTIAL, exit 1
  ```

  **Every figure is absent, and that is the correct output for a store nobody has
  adjudicated.** The CodeRabbit census reproduces the corpus's measured 30 / 0 / 3 / 13 / 14
  independently.

- [ ] **No precision figure has been produced from real labels**, because none exist yet.
      The `critical`-versus-`major` distinction, the stale-vintage join and the
      bundled-reading count are exercised against fixtures built to the pilot's measured
      shape, not against the store.
- [ ] **426 distinct finding keys is not 245 defect classes.** The panel arm's claim census
      counts distinct `finding_key`s across the three replicates and gets 426 of 428
      records — exact key equality merges almost nothing, and the corpus's 245 comes from
      `groupFindings`' matching instead. The field name says which level it is; the gap
      between the two numbers is unverified beyond this observation.
