# Collapse matched findings into defect classes

`scripts/agent/finding-match.mjs` could answer *"do these two findings describe one
defect?"*. It could not answer *"how many defects are these forty findings?"*, and the
gap between those two questions is not a loop.

Extends the module merged as #646. Measured against `upstream/main` at `740bac37dc15`.

## The problem

`matchFindings(a, b)` is a **pairwise** verdict, and it is already load-bearing:
`harvest.mjs` calls it through `bestMatch` to decide whether a CodeRabbit blocker restates
something the panel raised. Every consumer that needs the *set-level* answer has to build
it, and the obvious way to build it is wrong in a way nothing detects.

**`match` is not transitive.** The relation is token containment over the smaller summary
(`rounds.mjs :: findingSimilarity`), and containment does not compose. Measured on a
constructed three-finding fixture in the test file:

```
A~B  match 0.43        A: "the paste handler bypasses the read only guard on the editor surface"
B~C  match 0.57        B: "the paste handler bypasses the clipboard sanitiser before insertion"
A~C  no    0.00        C: "the clipboard sanitiser strips attributes before insertion into the model"
```

A transitive closure over those verdicts answers *one* defect. The matcher says A and C
are not the same defect, and no pair witnesses the claim that they are. Scale that up and
a whole pull request becomes one "defect" one chain-link at a time — **and nothing goes
red while it happens.** The row count falls, which reads as success. That is the failure
this change is shaped around, and it is why the deliverable is really the assertions
rather than the grouping.

## The change

`groupFindings(findings, opts) → { groups, links, stats }`, plus two internal changes to
pay for it.

| | |
|---|---|
| `groupFindings` | new. Every finding lands in exactly one class; classes never span pull requests; a class of one is a row |
| `LINKAGE` | new export, `"complete"`. The policy is a value, not a comment, and it is mixed into every group id |
| `matchAnchored` | `matchFindings`' body, with the two anchors passed in. Not exported — an anchor that did not come from `extractAnchor(a)` would make one pair have two answers |
| `bestMatch` | mines the needle's anchor once instead of once per candidate. Behaviour-identical; `extractAnchor` is pure |

`matchFindings`, `extractAnchor`, `anchorIsEmpty`, `compareAnchors`, `linesOverlap`,
`tokenOverlap` and `bestMatch` keep their signatures. **`harvest.mjs` is unmodified.**

### The nine decisions

**1 — Linkage is COMPLETE.** Two groups merge only when *every* cross pair between them is
`match`. So every pair inside a class is itself a `match`, and a curator auditing any two
members is auditing the whole claim.

Rejected single linkage on the module's own fail direction, not on taste. Under single
linkage a class asserts something no pair witnesses, and the error is the unrecoverable
one: two claims merged into one class credit one arm with the other's catch, and the
report says one defect where there were two. Complete linkage fails the other way — more
classes than defects — which costs a curator a second look. Demonstrated on the A~B~C
fixture above: **2 classes, `{B,C}` and `{A}`**, because B~C is the stronger pair and
merges first.

**2 — A `maybe` never merges, and never vanishes.** It becomes an entry in `links`. So the
candidate reaches a curator and nothing is suppressed, which is the module's stated fail
direction one level up. Consequence made visible rather than implied: `stats.links.maybe`
carries the count, and every class lists the classes it might belong with in
`group.candidates`.

**A `match` that complete linkage DECLINED is also a link**, with `blocked_by` naming the
pair that stopped it. This is the one place the policy loses information relative to single
linkage, so it may not be left to be inferred from an absence.

**3 — Order independence is structural, not tested-in.** The merge order is *all* `match`
pairs sorted by score descending, ties broken by the two members' content digests. Nothing
in that sentence mentions the input array, which is the proof: pair list, sort key and
merge test are all functions of the findings. Two pairs that tie on both keys are
genuinely interchangeable, because equal digests mean equal `(item, arm, run, lens, file,
summary, evidence)` — every input the matcher reads.

One pass suffices because completeness is **monotone**: merging never makes a blocked merge
possible, only the reverse.

**4 — The gate is derived per PAIR.** One class routinely holds both kinds at once. Picking
one `crossSource` for a whole grouping run applies the wrong rule to some fraction of the
pairs and *nothing fails* — the verdicts are all plausible.

The same-run `(lens, file)` gate is right for exactly one population: two findings from one
run of the lensed panel. A second replicate is not that population (the same defect can
surface under a different lens on a different try, and the absolute lens gate scores that
0), and neither is CodeRabbit-vs-CodeRabbit (its `lens` is a category→lens guess of *ours*,
so gating on it would partition one reviewer's comments by our own annotation).

Measured over 21,055 real pairs: **8,246 same-run, 12,809 cross-source, 0 defaulted.** A
per-call gate would have been wrong for 39% or 61% of them depending on which one was
picked.

**5 — Group ids are content-derived,** `D-` plus 16 hex of a sha256 over the sorted member
digests, the item, and `LINKAGE`. A counter would renumber every class after an insertion,
which makes a score quoted in a report impossible to re-derive.

**The id preimage is NOT `findingKey`, and that is a correction to the plan** — see
*Corrected while building*.

**6 — Singletons are first-class; empty input is a true negative.** A finding nobody else
matched is a unique catch or a miss, which is the most interesting row in the dataset and
the one a filter deletes. `groupFindings([])` → `{groups: [], links: [], stats: {...}}`,
never an error. `null`, `undefined` and non-array input all take the same path.

**7 — Anchors are mined once per finding.** `extractAnchor` runs six regexes over
`summary` + `evidence` and is the expensive half of a pair. `stats.anchors_extracted`
states the count, so the property is checkable rather than claimed. Measured: **8.6× on
n=117** (6,786 pairs, 73 ms vs 624 ms) and **7.8× on n=351** (61,425 pairs, 0.7 s vs
5.6 s).

**8 — Widens, never narrows.** A member carries the whole finding — a shallow copy, so
nothing here can mutate a caller's array — never a rebuilt field list. `lane`, `novelty`,
`gate_state`, `window`, `severity`, `gating` and anything a later round annotates survive
whether or not this file has heard of them. `index` is kept so a caller can still line a
member up with the array it passed in.

**9 — Groups, does not filter.** No severity floor, no `after-window` drop, no
de-duplication of the input. Two entries for one object are two observations and both
appear, because *"how many times was this raised?"* is a question a scorer asks and cannot
ask of an input this function already collapsed.

### The invariant, which is the actual deliverable

`stats.intra_group_non_match` counts pairs inside a class whose verdict is not `match`. It
is **0 for any sound grouping**, and it is computed from the pair table rather than from
the merge loop's own bookkeeping — a bug at both ends of a round trip is invisible to the
round trip. It is the number that goes red if the completeness check is ever weakened.

Measured **0 across all 14 pull requests and 21,055 pairs** of real captured output.

## Corrected while building

**The plan said to hash group ids over `findingKey`. That produces two classes with one
id.** `findingKey` is the panel's *identity* rule — file plus lowercased summary — and its
own docblock says it deliberately cannot tell two wordings apart. Two findings with the
*same* file and summary but disjoint evidence are demoted to `maybe` by L1 and stay in two
classes, and two classes printing one id are one class as far as any reader is concerned.
The digest therefore covers every field the matcher reads plus the provenance that selects
the gate; `findingKey` is carried on each member unchanged, for anything that must agree
with `dedupeFindings`. Test: *"two classes with the same findingKey but disjoint evidence
get DIFFERENT ids"*.

**And the richer digest was still not enough — two classes could digest alike.** Caught by
review after the first push, and my reasoning for calling it impossible was wrong: I argued
that two findings identical in all seven digested fields would always *merge*, so no two
distinct classes could share a preimage. They do not always merge. Cross-source with an
empty `file`, `locationScore` returns 0 — **absent, not equal**, which is a rule this module
already had a test for — so two byte-identical findings reach `maybe` on anchor agreement
alone and stay two classes. Two identical *contentless* findings get there through G0. Both
then hash to one id, and it is not cosmetic: `candidatesOf` is keyed **by id**, so the
colliding classes pool their links and each ends up listing **itself** as a candidate.

Fixed with an occurrence suffix (`…-2`), and explicitly **not** with the input index the
review proposed — an index in the preimage makes the id order-dependent and renumbers every
class when a finding is inserted upstream, which is exactly what a content-derived id exists
to prevent. Verified rather than argued: applying the proposed form turns *"order
independence"* and *"ids are content-derived"* red. Colliding classes are by definition
indistinguishable, so which one takes the suffix is arbitrary and unobservable — confirmed
by re-running the permutation check on a colliding input. `stats.id_collisions` reports it.

**A pair with no evidence at all was scoring 1.00 and merging.** `findingSimilarity` falls
back to exact case-insensitive text equality when either token set degenerates to empty,
*"so a placeholder still matches itself across rounds rather than scoring 0"*. That is
right for the question `rounds.mjs` asks and wrong for this one: `"" === ""`, so **every
contentless finding on a pull request collapsed into ONE class**, which then reads as
several reviewers agreeing on a defect that was never described.

G0 refuses it — the **only** place grouping is stricter than `matchFindings`, deliberately
and in one direction. Demoted to `no` rather than `maybe` because `maybe` claims *partial*
evidence and would mint one adjudication candidate per pair out of nothing (190 of them for
20 such findings). Each finding stays its own class, so nothing is lost;
`stats.no_evidence_pairs` keeps the case visible.

**The refactor of `bestMatch` introduced a path no test guarded.** Reusing the needle's
cached anchor for the *candidate* as well is a one-character mistake that makes every
candidate look like it agreed with the needle on symbols — promotion on location alone,
the one thing the anchor layer must never do. It survived the whole existing suite,
including `harvest.test.mjs`. Found by mutation testing, closed by
*"bestMatch: each CANDIDATE is judged on its OWN anchor, not the needle's"*.

**The handoff's `harvest.mjs` double-count does not exist.** Two independent checks, both
negative — see *What has no consumer today*.

**`harvest.mjs` does not import `matchFindings`.** It imports `bestMatch`
(`harvest.mjs:61`) and calls it once, at `:940`, inside `attributeToPanel`. That is the
only import of this module anywhere in the tree. It matters because it changes which
function had to stay signature-stable, and it is why `bestMatch` — not `matchFindings` —
is the one that got the anchor-reuse treatment and the two new guards.

### The cases that were not on the list

Ten edge cases were handed over and all ten have a named test. These are the ones found
while building, each because a branch existed that nothing would have noticed:

| Test | Why it exists |
|---|---|
| *the A~B~C fixture really is a chain* | the linkage test's premise. Without it, a change to the similarity metric silently turns the fixture into a different one and the linkage test keeps passing for the wrong reason |
| *two classes with the same findingKey but disjoint evidence get DIFFERENT ids* | the plan's id scheme, falsified |
| *contentless findings do NOT collapse into one class (G0)* | found by running the degenerate case and reading the number |
| *ids are content-derived … and a counter would not* | asserts the property a counter lacks — that inserting a finding does not renumber the classes that already existed |
| *the match complete linkage DECLINED is recorded, not lost* | the policy's own cost. It is the only information this linkage discards |
| *GATE: derived per pair* / *unreadable provenance falls back to the TIGHTER rule* | the second one is the fail direction, and it is the one a future edit would get backwards |
| *the blinded claim view is derivable … without re-grouping* | §2.2's blinding is only free if `arm` lives on the member and nowhere the claim text does |
| *WIDENS* / *GROUPS, it does not FILTER* | decision 7 and decision 9 as assertions rather than as prose in a docblock |
| *an accessor that throws is reported* | injected accessors are caller code on a read path |
| *a finding that names no pull request is grouped with NOTHING* | the unattributed partition, which is the difference between a safe default and a silent cross-PR merge |
| *bestMatch: each CANDIDATE is judged on its OWN anchor* | **found by mutation testing this PR's own refactor** — see above |
| *bestMatch: a null candidate is a `no`, never a throw* | the guard moved when the anchor moved out of `matchFindings` |

## Fail directions

| Input | Behaviour | Why that is the safe way |
|---|---|---|
| `null` / non-object entry | skipped, with its index, in `stats.skipped` | `findingKey` is deliberately un-guarded upstream, so an unguarded grouping throws. A guard that drops without counting is the other failure: a clean-looking run over an array half full of nulls |
| a finding that names no pull request | its own partition — grouped with **nothing** — counted in `stats.unattributed` | attribution is never inferred. A class spanning two pull requests is not a defect and nothing downstream can recover from it; a singleton costs a look |
| provenance unreadable (no `arm`) | the pair takes `opts.crossSource` (default `false`), counted in `stats.gate.defaulted` | the same-run gate rejects every different-lens and different-file pair outright, so its `match` set is a **subset** of L2's. Guessing it costs merges we could have made; guessing L2 costs merges we should not have, and only the second is unrecoverable |
| ambiguous pair (`maybe`) | never merges; becomes a link | promoting ambiguity to certainty is the module's stated inversion. A false class suppresses a distinct claim |
| a `match` complete linkage declines | recorded as a link with `blocked_by` | the only information this policy loses. Stated, not implied |
| both sides contentless | `no`, counted in `stats.no_evidence_pairs` | there is no evidence, and no evidence is not partial evidence |
| an injected accessor throws | caught, reported in `stats.accessor_failures`, treated as unattributed | read path: degrade and say so. Swallowing it silently is the failure this project keeps naming |
| empty input | empty group set | an arm that found nothing is a **true negative**, and treating empty as broken deletes the panel's clean rounds |

## Explicit non-goals

- **No change to the similarity metric.** `MIN_SHARED_TOKENS`, the 0.3 threshold and
  `findingSimilarity` are imported, not re-derived. Nothing was relaxed to raise the match
  rate; G0 moves the only rule that moved, and it moves the other way.
- **No hook into `review-panel.mjs :: clusterFindings`.** Out of scope permanently — the
  module header already records why a guard there is pure surface area on a gate path.
- **No L3.** The `maybe` queue is not adjudicated by a model. This change makes the case
  against paying for it sharper rather than weaker: see below.
- **No scorer.** No precision, no relative recall, no run envelope read. `groupFindings`
  computes no metric.
- **No edit to `harvest.mjs`, `finding-record.mjs`, `coderabbit.mjs`, `extract-corpus.mjs`,
  `eval/run.mjs` or any workflow.**

## What the real data says

654 findings from **187 collected `stage-detail` captures across 14 pull requests** — the
same source the module header's *"1,249 pairs from 153 captured findings"* was measured on.

```
item      n  classes  single  largest    pairs  match  maybe-lk  held  inv
pr-632   117       75      43        4     6786     90      3672    37    0
pr-694    80       52      29        4     3160     95      2052    61    0
pr-695    80       54      31        3     3160     83      1735    54    0
pr-681    73       54      35        2     2628     29       902    10    0
pr-684    55       40      25        2     1485     22       454     7    0
pr-737    41       30      22        3      820     32       295    18    0
…
TOTAL    654      497     362        4    21055    380      9448   199    0
```

- **654 findings → 497 defect classes**, 24.0% fewer rows, 362 of them singletons.
- **The largest class is 4.** No blobs. Spot-checked by hand: the size-3 classes are three
  wordings of one defect each, in one file, from one lens across rounds.
- **`inv` is 0 in every row.** The over-merge assertion holds on production data.
- **Order independence holds on the real corpus too**: 0 mismatches over 28 deterministic
  permutations (reverse, and an even/odd stride) of all 14 pull requests.

**The number worth arguing about: 9,448 `maybe` links — 19× the class count.** That is the
honest cost of decision 2, and it is a property of L2 rather than of grouping: any
same-file pair that is not a `match` is a `maybe`, and the module's own calibration
measured 55% of real pairs sharing at least one symbol. Two consequences a consumer must
plan for:

- **The queue needs ranking, not just listing.** `link.score` exists for that, but it is
  `0.5·location + 0.5·max(tokens, symbolOverlap)`, and `symbolOverlap` can inflate it —
  the highest-scoring `maybe` in pr-632 reads `location 1, content 1.00`. A ranker should
  probably use `tokens`, which the current link does not carry separately.
- **It is the strongest argument yet for leaving L3 unbuilt.** Adjudicating this queue with
  a model is 9,448 calls per 654 findings.

## Verification

- [x] **Tests: 1553, 0 fail, 0 skip.** Baseline **1525, 0 fail, 0 skip** on
      `upstream/main` at `740bac37dc15`, measured in the same environment (root and
      `scripts/agent` `node_modules` present in both — without them the same command
      reports 5 and 6 skips respectively, and comparing across that difference is what
      makes a skip count look like a regression). **+28 tests, all in
      `finding-match.test.mjs` (28 → 56)**, two of them on `bestMatch` and one on the
      id collision found in review.
- [x] **Mutations: 29 written, 28 caught.** Every row of the edge-case table, every
      decision above, and two guards on the refactor itself. Two of the first-draft
      mutations were ineffective rather than uncaught and were rewritten: a `maybe` in the
      merge candidate list is stopped by the completeness check, not by the filter, and a
      de-dupe on object identity never fires because the member is a copy.
- [x] **The one that SURVIVED, reported rather than fixed:**
      `intra_group_non_match` hardcoded to `0`. It is undetectable in isolation *by
      construction* — the counter is 0 on correct code, so forcing it to 0 changes no
      output. It only fires in combination with a real merge bug, which is what it is for.
      Verified with a **compound** mutation (single linkage **and** the counter dead): 3
      tests still go red, so the invariant is not the suite's only line of defence.
- [x] **`npx eslint scripts` exits 0** at the lockfile-pinned `eslint@9.24.0`, and also
      exits 0 on the baseline tree, so there is no version drift in the comparison.
- [x] **`harvest.mjs`'s use of `matchFindings` still passes, unmodified.**
      `harvest.test.mjs` green; `bestMatch` returns byte-identical results before and
      after at N = 5, 10 and 30 real candidates.
- [x] **The `bestMatch` speedup, measured at harvest-realistic sizes**: N=10
      1071 µs → 701 µs (1.53×, 20 → 11 anchor extractions); N=30 2899 µs → 1725 µs
      (1.68×, 60 → 31).
- [x] **The linkage decision demonstrated, not described** — on the A~B~C fixture, with
      the premise (`match`, `match`, `no`) asserted in its own test so a metric change
      reddens the fixture instead of silently turning it into a different one.
- [x] **Order independence proven by shuffling**, including group ids: 4 fixed
      permutations in the test, plus 28 over the real corpus.
- [x] **Verified from the committed tree** (`git archive <branch> | tar -x`), not the
      working copy.

**Not verified, and why:**

- **Nothing has been grouped across ARMS on real data.** Every measurement above is
  panel-only, because the CodeRabbit side of the blocking-inline population is 16
  comments across 50 pull requests. The cross-arm path is covered by fixtures only.
- **No consumer exercises this.** See below.
- **The `maybe` queue's usefulness is unmeasured.** 9,448 links is a count, not a
  judgement; whether a curator can work that queue is unknown until one tries.

## What has no consumer today

**Stated plainly, because the honest answer is not the convenient one.** The handoff for
this change proposed a consumer and asked for it to be checked rather than assumed. It does
not survive, on two independent counts:

1. **Structurally.** CodeRabbit's `duplicate` tier is parsed only by
   `parseCodeRabbitReview`, which is reached from `auditPr` — a read-only report that
   writes nothing. The miss-record path (`harvestCodeRabbit`) iterates *inline* review
   comments through `classifyCodeRabbitComment`, and no review-body finding ever reaches
   `toMissRecord`. So the tier that would double-count cannot.
2. **Empirically.** Over **50 recent pull requests**, replaying `harvestCodeRabbit`'s own
   filter chain (CodeRabbit author → parseable → `BLOCKING` severity → `interestingFiles`)
   yields **16 blocking inline comments → 16 defect classes. Zero would be filed twice**,
   and the largest class is 1 everywhere. On the 7 pilot pull requests it is 1 comment,
   1 class, 0.

The panel side is no better: within a single round — the population a reader sees in one
comment — exact-key dedupe leaves 654 findings and grouping finds **645 classes**. Nine
restatements across 6 of 29 rounds, 1.4%, on the `sampled` population, and
`clusterFindings` already covers the reported path.

**So this change moves no number today.** The 24% collapse is across rounds and runs, which
is the benchmark's question and not a question anything in the repository asks yet. What
the diff does change in shipped behaviour is `bestMatch`'s anchor reuse, measured above.

The argument for landing it anyway is not "a later wave needs it": it is that
`matchFindings` is already exported and already load-bearing, the set-level question is the
next thing any caller asks of it, and it is the one place a caller will silently get the
wrong answer. Whether that clears the bar is the reviewer's call, and **resequencing this
behind its first consumer is a defensible answer.**

---

# Follow-up (2026-08-11): `lensOf`, the accessor the same-run gate never had

Measured against `upstream/main` at `9d68ee0970d9`.

## The problem

`groupFindings` documents its same-run gate as **absolute on `(lens, file)`**. For a caller
passing normalised finding records it ran as **file-only**, and nothing said so.

The function injects three accessors — `itemOf`, `armOf`, `runOf` — and reads the **lens
straight off the finding object**, in two places rather than one:

| where | the read |
|---|---|
| `matchAnchored`, the L0 gate | `trim(a.lens) !== trim(b.lens) \|\| trim(a.file) !== trim(b.file)` |
| `findingSimilarity` (`rounds.mjs:521`) | `if (trimmed(a.lens) !== trimmed(b.lens)) return 0;` |

`eval/finding-record.mjs` puts the lens in the **arm namespace**, at `record.panel.lens`. That
is deliberate and is not the bug: `lens` is the first entry in `ARM_ONLY_FIELDS.panel`,
because a panel lens is meaningless on a CodeRabbit record and hoisting it would make the
record's top level lie about what every arm can fill.

So a record reaches the gate with `lens: undefined` on **both** sides,
`trim(undefined) !== trim(undefined)` is `false`, and both gates fall through to the file
check. **Nothing throws, nothing logs, and the output is a set of classes a reader would
accept** — fewer of them, in the direction that makes our arm look more unique, because a
smaller class count shrinks the base of any unique-catch proportion computed over it.

The same absence has a second, worse property: **an unreadable lens and two equal lenses
produce the identical comparison.** There is no value of the output that distinguishes them,
which is why this went unnoticed until a consumer measured the same input twice.

## The change

1. **`defaultLensOf` beside `defaultItemOf`** — `finding.lens` first, then
   `finding[LENSED_ARM]?.lens`. The arm namespace is reached through the existing
   `LENSED_ARM` constant, so the one arm whose lens is real stays named in one place.
   Blank and non-string are *absent*, not a lens.
2. **`opts.lensOf`**, injectable, guarded by the same `read()` wrapper as the other three: a
   throwing accessor is recorded in `stats.accessor_failures` and treated as unreadable.
3. **`node.operand`** — the object handed to the matcher. It *is* the finding unless `lensOf`
   resolved a lens the finding does not carry at the top level, in which case it is the
   shallow copy widened with it. Built once per node, and only when it differs.
4. **`stats.gate.lens_unreadable`** — same-run pairs whose lens was unreadable on at least
   one side, so the `(lens, file)` gate ran as file-only.
5. **`members[].lens`** — the resolved lens, reported beside `arm` and `run`.

### Why the lens is not a parameter of `matchAnchored`

The obvious shape is `matchAnchored(a, b, anA, anB, { lensA, lensB })`. It was rejected on the
argument the module already makes about the anchor, a few hundred lines up: *"an anchor that
did not come from `extractAnchor(a)` would make the verdict disagree with `matchFindings(a, b)`
on the same operands, and a matcher with two answers for one pair is worse than a slow one."*
A gate parameter has exactly that property. Widening the operand does not:
`matchFindings(operand, other)` returns what the grouping saw, so every verdict stays
reproducible by hand from the member it names.

**And it would have fixed only one of the two gates.** `findingSimilarity` re-checks the lens
itself, off its own operand, and an option on `matchAnchored` cannot reach it. This was the
main thing the plan got wrong; see below.

### Why the digest changed too

`contentDigest` now reads `node.operand`. Its docblock says it covers *"every field the
matcher reads (`lens`, `file`, `summary`, `evidence`)"*, and the matcher reads the operand.
Left on `node.finding`, two classes the restored gate correctly separates would digest
**identically**, collide on one id, and take the occurrence suffix that exists for genuinely
indistinguishable classes — turning a fixed bug into a cosmetic one. This is a consequence of
the fix, not a second change.

## Corrected while building

- **The defect is in two gates, not one.** The handoff named `matchAnchored:263`.
  `findingSimilarity` has its own copy at `rounds.mjs:521`. This is what decided the operand
  design over the gate-parameter one — the plan's first shape would have left half the defect
  in place while passing every test written for it.
- **The class counts in the handoff are a both-arms population.** It quoted 166/173/164
  against 146/153/136. On the **panel** `reported` population the same measurement is
  **142/147/139 against 121/127/110**. The *deltas* reproduce — 21, 20, 29 against the stated
  20, 20, 28 — and the ~25-class gap per replicate is CodeRabbit's ~30 comments, which form
  near-singletons and are unaffected: a cross-arm pair is always cross-source and L2 never
  reads a lens. Nothing in the handoff was wrong about the defect; the absolute numbers belong
  to a different input.
- **Raw sampled findings carry no lens at all.** Across 282 real capture files, **0 of 941
  findings** have a top-level `lens`. The lens is the *file name* — `adapters/reviewer.mjs`
  stamps it from the directory, on the stated ground that a finding is model output and a
  fill-the-blank rule would let it declare its own lens. So the arm namespace is not merely
  where the lens is *usually* kept; for this population it is the only place it exists.
- **A `lens` resolved out of the arm namespace is NOT written into the carried finding.** The
  first draft did, and it hands a caller back a shape it never passed in. The resolved value
  is node metadata, exactly like `item`, `arm` and `run`.

## Fail directions

| what fails | what happens | why that is the safe way |
|---|---|---|
| `lensOf` throws | caught, recorded in `stats.accessor_failures` with its index, lens treated as `null` | read path in merged code with live callers; a scoring run may not die on a caller's accessor |
| the lens is unreadable | the pair keeps the **file-only** comparison it has today, and `stats.gate.lens_unreadable` counts it | no behaviour change for anything that reaches this state today, and the state is now visible |
| the lens is blank (`""`, `"   "`) | treated as absent, so the arm namespace is still consulted | otherwise `lens: ""` silently re-opens the whole defect |
| a caller injects a wrong `lensOf` | its findings split more than they should | the module's fail direction: more classes than defects costs a curator a second look, over-merging is unrecoverable |

**It counts and reports rather than throwing, and that is a deliberate departure from lesson 1**
(*"a guard that aborts is worth more than the fix it guards"*). `groupFindings` is merged and
its read path is documented as degrading to fewer records and never throwing. Aborting here
would take down a scoring run over an input that is merely *less precise* than it could be.

## Explicit non-goals

- **The gate's semantics, the thresholds, `LINKAGE` and every verdict rule are untouched.**
  `matchAnchored` is not edited. This makes a documented gate reachable.
- **`finding-record.mjs` is untouched.** Hoisting `lens` to the top level would be the wrong
  fix — `ARM_ONLY_FIELDS` exists for it, and the change would reach every consumer of a record.
- **Cross-lens restatement is NOT collapsed, and this doc does not decide whether it should
  be.** Two panel findings on one file under different lenses stay separate; a regression test
  pins that. Whether the panel's 5–6 lenses describing one defect *ought* to be one class is a
  real open question and it belongs to a scorer, not to a missing accessor. **It is the most
  likely reason the section above measured within-arm collapse at 1.4%.**
- No new export. `defaultLensOf` is module-private, like the other three.

## What the real data says

**The pilot's three replicates, panel `reported` population, through the real adapter**
(`eval/adapters/panel.mjs` → `groupFindings`, records passed **unmodified**):

```
run             n   classes before   classes after   Δ    same-run pairs   gate.lens_unreadable
pilot-01__k1  142        121              142       +21        1567                 0
pilot-01__k2  147        127              147       +20        1566                 0
pilot-01__k3  139        110              139       +29        1432                 0
```

**20–29 of our own findings per replicate were collapsing into classes they do not belong to**,
and `id_collisions` is 0 before and after.

**The same measurement on a corpus 6× larger** — the `sampled` population from **282 capture
files across 19 pull requests, 941 findings**, lens taken from the file name as the adapter
takes it:

```
classes   606 (lens-blind, i.e. today)  →  695 (lens read from the arm namespace)   Δ +89
collapse  35.6% of n                    →  26.1% of n
items whose class count moved: 18 of 19
```

**And the number that would have caught it on day one.** With the lens deleted from the arm
namespace — the shape the code *behaved* as if it had — the new stat reads:

```
pilot-01__k1  gate.lens_unreadable 1567 of 1567 same-run pairs
pilot-01__k2  gate.lens_unreadable 1566 of 1566 same-run pairs
pilot-01__k3  gate.lens_unreadable 1432 of 1432 same-run pairs
```

Every pair, every replicate. That is the line this follow-up is really about: the accessor is
three lines, and the reason the defect survived three replicates is that **no output
distinguished an absent lens from two equal ones.**

## Verification

- [x] **Tests: 1668, 0 fail, 0 skip.** Baseline **1660, 0 fail, 0 skip** on `upstream/main`
      at `9d68ee0970d9`, measured in the same environment — both trees extracted fresh and
      given the *same* two `node_modules` symlinks (root `eslint@9.24.0`, and
      `scripts/agent` for the Agent SDK), because a skip delta across that difference is an
      environment artefact that reads as a regression. **+8 tests, all in
      `finding-match.test.mjs` (56 → 64).**
- [x] **A record from `buildFindingRecord` gates on lens with NO `opts` passed.** Asserted
      against the **real** builder, imported into the test rather than reproduced as a
      fixture, so an upstream rename of `record.panel.lens` reddens this lane instead of
      quietly loosening a gate.
- [x] **Mutations: 12 written, 12 caught**, each by a test that names the right thing —
      including **the default-precedence line** (arm namespace read first: caught only by
      *"the default reads the TOP LEVEL first"*), the `read()` guard, the `||` in the stat's
      condition, the operand at the matcher, the operand at the digest, and writing the
      resolved lens into the carried finding. None survived.
- [x] **A caller that already widens its records with a top-level `lens` is byte-identical.**
      Groups, ids, members, links and **every pre-existing `stats` field** compared string-wise
      before and after, on all three replicates: identical. The two added fields
      (`members[].lens`, `stats.gate.lens_unreadable`) are additive and were stripped for the
      comparison, since including them would make it vacuously false.
- [x] **`stats.gate.lens_unreadable` is nonzero on a lens-less input and zero on a
      record-shaped one** — 1567/1566/1432 against 0/0/0 above, and pinned in a unit test that
      also proves one unreadable side is enough and that cross-source pairs are not counted.
- [x] **`npx eslint scripts` exits 0** at the lockfile-pinned `eslint@9.24.0`, and exits 0 on
      the baseline tree too, so there is no version drift in the comparison.
- [x] **Verified from the committed tree** (`git archive <branch> | tar -x`), not the working
      copy.
- [x] **No shipped behaviour changes.** `groupFindings` has no consumer in the repository —
      `harvest.mjs` uses `matchFindings`/`bestMatch`, neither of which this diff touches, and
      `harvest.test.mjs` is green unmodified.

**Not verified, and why:**

- **#779's own scorer was not run.** `eval/complementarity.mjs` is not on `main`, so there
  is nothing to execute. The property its numbers depend on — byte-identical output for a
  top-level `lens` — was measured directly instead, on the same three replicates it reads.
- **The 166/173/164 figures were not reproduced as stated.** They are a both-arms
  population; reproducing them needs the CodeRabbit arm, which `corpusRecords` fetches from
  the GitHub API. The panel half and the deltas are measured above.
- **Whether cross-lens restatement should collapse is still open.** Reported, not decided.
