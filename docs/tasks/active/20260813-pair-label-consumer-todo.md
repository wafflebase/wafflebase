# Read adjudicated finding pairs in the complementarity band

*Extends `20260811-eval-complementarity-scorer-todo.md`. That PR made the overlap a band
because the matcher never merges an undecided cross-arm pair; this one lets an adjudicated
pair leave the undecided pool.*

Built against `main` at **`1902133bf`** (#822).

## The problem

`finding-match.mjs` answers `match` / `maybe` / `no`, and `groupFindings` **never merges a
`maybe`**. The fail direction is right — a false match suppresses a candidate, and a
suppressed candidate is a miss nobody recovers — but it means every undecided cross-arm pair
is counted as **two unique catches, one per arm**. So `complementarity.mjs` reports the
overlap as a band, and on all three pilot replicates the ceiling is **saturated**: every
CodeRabbit-only class has an undecided panel candidate, so *"24 unique to CodeRabbit"* means
24 unresolved pairs rather than 24 established misses.

Resolving a pair is adjudication, not scoring. That work has been done — the eval store holds
adjudicated pair records under `labels/2026-08-10-pilot-reviewed/pairs/<pair_key>.json` — and
**nothing reads them.** Every "label" in `complementarity.mjs` on `main` is a free-text display
label (`stats.label`, `label: runId`).

⟳ **The label store is live and it moved twice while this was being built** — 23 records, then
142, then **357** in one afternoon (45 `gold`, the rest `silver`). Every figure below names which
population it was measured over, and the arithmetic's anchor check is pinned to the store's
**committed** state (`3241f07`, the 23 gold records) so it stays reproducible however far the
working tree runs ahead. **Do not quote a silver count from this document as current** — quote
the pinned anchor, or re-derive.

Measured on `main` before this change:

| replicate | classes | both | cr-only | band |
|---|---|---|---|---|
| k1 | 164 | 8 | 22 | `4.9% .. 21.1%` |
| k2 | 171 | 6 | 24 | `3.5% .. 20.4%` |
| k3 | 166 | 3 | 27 | `1.8% .. 21.6%` |

## The change

**`eval/pair-labels.mjs`** — the record definition and the resolver. `SCHEMA_VERSION`, frozen
`PAIR_VERDICTS` / `VERDICT_EFFECT` / `LABEL_SOURCES` / `LABEL_AVAILABILITY`, `pairLabelKey`,
`keysOf`, `validatePairLabel`, `readPairLabels`, `resolveClasses`, `pairLabelCensus`. Shaped
after `finding-record.mjs`: a frozen vocabulary, a strict validator that throws, a read path
that degrades and counts what it dropped, and a census that carries its own `n`.

It is a **separate module from the item- and finding-level labels** because a pair label
states a fact about a *relationship between two findings* rather than about one finding, and
it has no arm of its own. It is also keyed differently, deliberately: `pair_key` is
`sha256(file|line|summary of the panel side ‖ the same of the CodeRabbit side)[0:12]` and
**not** `finding-match.mjs`'s `contentDigest`, which keys a single finding, is the matcher's
business, and already moved once when #780 widened the operand it reads. A human's verdict
must not be lost because the matcher was refactored.

**`eval/complementarity.mjs`** — consumes it. Every undecided pair row gains a `pair_key` (so
the queue is adjudicable without a second tool to compute one) plus `panel_class` /
`coderabbit_class`; the payload gains a top-level `labels` block; the CLI reads the store and
prints what the verdicts did. **Additive only** — `overlap.*` and
`unresolved.jaccard_upper_bound` keep exactly the meaning they had, which is what lets
`report.mjs` render unmodified.

### The arithmetic, and the one decision that is the whole PR

For one replicate, with `b` classes already `both`, `s` CodeRabbit-only classes resolved
`same`, `d` distinct panel classes that newly become shared, and `m` CodeRabbit-only classes
still holding an undecided pair:

```
floor   = (b + d) / (classes − s)
ceiling = (b + d + m) / (classes − s − m)
```

**A `same` verdict raises the floor and leaves the ceiling exactly where it was.** The
ceiling's numerator gains what its denominator loses, and it cancels. Only a class with
*every* one of its pairs decided can move the ceiling.

🔴 **`d` and `s` are different numbers, and conflating them is the bug this PR is most likely
to have shipped.** Two CodeRabbit classes resolving into one panel class make that panel class
shared **once** while removing **two** classes from the union.

🔴 **A pair label does NOT re-partition the panel's own classes.** A `same` verdict says a
CodeRabbit finding and a panel finding are one defect. It does not say two *panel* findings
are one defect, even when both are labelled `same` against the one CodeRabbit finding — and
that case is real, not hypothetical: on k2, **4 of the 7** CodeRabbit classes a `same` verdict
touches have **two** distinct panel partners (5 resolved classes, 8 distinct partners).

Measured over k2's 171 classes, against the 23 gold verdicts in the label store's committed
state — the numerator is **11 either way**, so the entire difference is in the denominator:

| | classes | which classes leave | floor |
|---|---|---|---|
| **this rule** | 171 → **166** | **5**: the resolved CodeRabbit-only classes | **11/166 = 6.6%** |
| transitive closure | 171 → **159** | **12**: those same 5, **plus 7 panel classes** absorbed into another panel class | 11/159 = 6.9% |

Those 7 are the cost of the inference: a verdict about a CodeRabbit finding and a panel finding
would silently decide that two *panel* findings are one defect. `finding-match.mjs` uses
**complete linkage** precisely to refuse that, and a label store must not smuggle single linkage
in behind it. Nobody adjudicated those panel/panel pairs.

### Three verdicts, three behaviours

`insufficient-basis` is a **third answer**, not a spelling of `different`. It means *"I could
not tell"*, so a class holding one is **unfinished** and its contribution to the ceiling
stands. Pooling it with `different` would collapse the ceiling on evidence nobody has — the
flattering direction. The human used it on 8 of the first 23 labels; the 2026-08-13
re-adjudication took it to **0 of 23**, because every one of those eight was a pair whose
CodeRabbit prose a parser had emptied. **A live verdict with a zero count today is exactly
when a vocabulary gets quietly dropped**, so it is frozen and tested directly.

### Tiers are never pooled, and the API is what enforces it

`resolveClasses` takes **one** tier (default `gold`) and there is no argument meaning "all of
them", so a pooled band is unspellable. Every tier present in the store gets its own entry
under `labels.by_tier`, and `labels.tier` names the one the headline came from.

This is not fussiness, and it stopped being hypothetical during the build. A silver pair labeler
exists for this corpus and **failed its own pre-registered validation at 17/23**. When this
module was started its verdicts were deliberately outside the store; by the time it was finished
they were in it, and **still arriving** — measured twice, three hours apart:

| | gold | silver |
|---|---|---|
| 14:58 | 45 records · `7.3% .. 20.4%` · 0 classes finished apart | 97 records · `4.7% .. 17.2%` · 4 finished apart |
| 17:00 | **45 · `7.3% .. 20.4%` · 0** | **312 · `5.4% .. 14.2%` · 8 finished apart** |

**The gold band did not move and the silver ceiling fell 3 more points in three hours.** A
pooled band would not just have been narrower than the evidence justified — it would have been a
**moving number**, drifting downward with every batch from a labeler nobody has validated, and
nothing in the output would have said which tier was moving it. That is the argument for the
API refusing to express it, rather than for a convention saying not to.

### Seven availability states, because "no label moved this number" has six causes

`not-supplied` · `no-store` · `store-empty` · `none-for-replicate` · `none-matched` ·
`resolved-nothing` · `resolved`. The distinction the pilot forces is `none-for-replicate`
against `resolved-nothing`: **the 23 labels are k2's, and k1 and k3 have none**, so a band
that reported the same number for a labelled and an unlabelled replicate would be the
four-availability-states lesson one level up. `none-matched` — labels *do* name this run and
still match nothing — is a drift signal and is kept apart from both.

### The drift guard, which nothing else does

Each record carries `diff_sha256`. `store.labelStatus()` is named in `ANNOTATION-GUIDE.md` §8
and **was never built**, so this is the only guard a pair label has. A label whose
`diff_sha256` disagrees with its corpus item's `meta.json` is **refused, not skipped**: a
mismatch means the item was re-extracted after the adjudication, so the verdict is about code
the store no longer holds — and that is true of every label for that item, not only of the
pairs that happen to match today. Scoring the rest would mix two diffs with nothing in the
output saying so. `diffShaOf` is a **required** input for the same reason `assertEffort`
failed: a guard whose input never arrives never fires.

The hash is read from each item's own `meta.json` rather than from the corpus manifest's copy
of it, because a re-extraction is the event the guard exists to catch and the manifest's copy
moves for the same reason.

## Corrected while building

### 1. The store's verdicts are not the ones the plan described

The handoff and the census's §5 both describe **10 `same` · 5 `different` · 8
`insufficient-basis`**. On disk today it is **13 `same` · 10 `different` · 0
`insufficient-basis`** — the 2026-08-13 re-adjudication of 12 records under the one-fix rubric,
which the census records in §4 but §5's tables predate. The 6.6% target still reproduces
exactly, because the three extra `same` verdicts land on CodeRabbit classes the other
verdicts had already resolved or that were already shared.

### 2. Indexing only `pair_key` would have lost a third of the movement

#801 rewrote CodeRabbit summaries, so 6 of the 23 keys moved and each record carries
`pair_key_at_801` beside `pair_key`. Measured on k2 at `main`: **5 of the 22 applied labels
match only through the alternate field, and 4 of those 5 are `same` verdicts.** The alternate
fields are therefore a named frozen list (`ALTERNATE_KEY_FIELDS`) rather than one field, so
the next re-parse adds a line in one place instead of needing a grep.

### 3. The argument order of the key is load-bearing and fails silently

`pairLabelKey(panel, coderabbit)` — swapped, it produces a different 12-hex key, which does
not throw and does not warn. Every label simply matches nothing, and a label store that
resolves zero pairs looks exactly like a store nobody has filled. The key's test is therefore
a **regression against the store**: it recomputes the key from the two findings inside a real
record and asserts it equals the 12 characters `inspect-maybes.mjs` filed that record under.
A bug at both ends of a round trip is invisible to the round trip.

### 4. A `same` verdict on an already-shared class must count nowhere

4 of k2's 22 applied labels sit on CodeRabbit classes **both arms already claim** (2 distinct
classes). Crediting them would double-count a class into the floor, so the resolver keys off
the class's **current claim**, never off the label's existence.

### 5. My own vocabulary pin caught me

`complementarity.mjs` pins the vocabularies it compares against at import time. I widened
`LABEL_AVAILABILITY` from five states to seven and left the pin asserting five; the module
refused to load with *"a vocabulary this module compares against has changed upstream"*. The
guard worked on its author, which is the best evidence it will work on the next person.

### 6. A mutation survived, and it was a real gap

Deleting the "prefer an already-shared partner" rule changed no test. Proven ineffective
first: with a single partner there is nothing to prefer, so the branch is observable only when
a verdict names two panel classes of **different** claim — and then the choice decides whether
the floor's numerator gains. A test was added, with class ids chosen so **sort order is
adverse** (`C-apanel` sorts before `C-both`), because ids that sorted favourably would let the
test pass with the rule deleted. 33 of 33 mutations caught after it.

### 7. Review found the transitive-closure figure wrong in both places, differently

The module header said *"7 classes leave the denominator instead of 5"* and this document said
*"5 classes leave the denominator instead of 7"* — the same number reversed between two files,
which is what a figure nobody re-derived looks like. Re-measured: **the implemented rule removes
5 classes and transitive closure removes 12** (those 5 plus **7 panel** classes). The "7" was
real and was the panel side; both sentences had attached it to the wrong quantity. The table
above now carries the breakdown rather than a difference, because a difference is the form that
let this survive.

Two guards came out of the same review, both places where a rule existed only as a convention:

- **`opts.pairLabels` is now REFUSED in the `union` and `intersection` views.** The CLI already
  declined to pass labels there and said why in a comment, but this module is a library and a
  convention held in one caller is not a guard — the next caller is the one that gets it wrong.
- **`readPairLabels` now rejects a record whose `corpus_version` disagrees with the directory it
  was read from.** Without it a misfiled record reached the drift guard, had its `diff_sha256`
  compared against an item of the same id in the *wrong* corpus, and aborted the whole run with
  an error about a diff hash — a file in the wrong directory, reported as a hash mismatch.

A third change came from `main` rather than from the review. **#817 landed `eval/labels.mjs`,
which exports `LABELS_DIR`** — the constant this module had defined locally, with a note to
import and delete it the moment any module owned it. It does now, so the local literal is gone
and the import is in its place; `PAIRS_SUBDIR` stays here, because `labels.mjs` has no
counterpart and says so itself: *"`pairs/` under the same corpus version belongs to a different
label type"*. That is the only thing the two modules share, and it has to be shared or they read
different trees.

Not changed, having been checked: a line beginning `#801` was reported as parsing into a
Markdown heading. It does not — CommonMark requires a space after the `#` run, and GitHub's own
renderer (`POST /markdown`) returns `<p>#801 rewrote…</p>`.

## Fail directions

| Part | On failure | Why that is the safe way |
|---|---|---|
| `readPairLabels` on an unparseable or invalid file | drops it, records the file and the reason in `unreadable` / `invalid` | a dropped label can only cost a resolution, so the band comes out **wider** than the truth. Reported so "23 records, 22 usable" stays sayable |
| `diff_sha256` disagrees with the corpus item | **refuses the whole scoring run** | the opposite direction to the row above, and deliberately: this one means the labels are about code that is gone, and a band over the survivors would silently mix two diffs |
| `diffShaOf` not supplied | refuses | an optional guard input is not a guard |
| two labels of one tier disagreeing about one live pair | refuses, naming both records | one pair has one verdict; a key indexed under two would make a published number depend on which file was read first |
| a label matching no live pair | applied to nothing, **listed** with its own `pair_key_moved` / `still_maybe_at_801` provenance | the two causes — promoted to a match, or the key moved again — are not separable from the queue alone, so the record's own provenance is carried rather than a guess |
| a class with an undecided pair left | stays in the undecided pool | one `different` verdict on one of ~14 pairs resolves nothing: any of the other 13 could still be the match |
| labels for another tier | resolved separately, never averaged in | see above |
| `opts.pairLabels` in a `union` / `intersection` view | refuses | a verdict resolves a pair inside ONE draw; applying it to a pooled class set corrects a deliberately unfair comparison with a per-replicate fact. Refused rather than ignored, because a caller who asked for a resolved bound and silently got an unresolved one has no way to tell |
| a record filed under a corpus version it does not claim | dropped, counted and named as invalid | it is unusable for the same reason any malformed record is, and rejecting it AT THE READ keeps the error about the misfiled file rather than about the diff hash it would otherwise trip |
| no labels at all | every count is exactly what it was before this PR, and `availability` says which of the seven reasons | a band that reads the same for a labelled and an unlabelled replicate is the bug |

## Explicit non-goals

- **No matcher change.** No `clusterFindings`, no `findingSimilarity`, no threshold, no
  `gateFor`. Decision 24 stands: re-thresholding to make `maybe` pairs resolve trades this
  benchmark's error for a worse one in the panel's own harvest path.
- **No write path.** This PR only reads `labels/`. There is no `put`, and no pair was
  adjudicated while building it.
- **No transitive closure over panel classes** — the header above, and the reason the floor
  reads 6.6% rather than 6.9%.
- **No labels in the `union` / `intersection` views.** Those pool K draws against CodeRabbit's
  one; a label resolves a pair inside **one** draw, so resolving inside a pooled view would
  apply a per-replicate correction to a deliberately unfair comparison and produce a number
  that is neither.
- **`report.mjs` untouched.** It renders from the payload's pre-existing band fields and
  continues to render exactly what it rendered before. Displaying the new provenance is that
  module's own change.
- **No item- or finding-level labels.** Different record, different module.
- **No validity or precision metric.** A different PR.

## Findings for the modules this consumes

**`unresolved.jaccard_upper_bound` can exceed 1 on `main`, and I did not fix it.** When
several CodeRabbit-only classes point at **one** panel class, the ceiling adds `m` to `both`
while removing `m` classes from the union — but if `k` classes merge into one panel class,
`both` gains 1 and not `k`. Reproduced on unmodified `main` with one panel finding and three
CodeRabbit findings on one file: `classes 4 · both 0 · m 3` → `3/1 = 3.0`, a Jaccard above 1.

It does **not** affect any real number today: the pilot's three ceilings are 21.1% / 20.4% /
21.6%, because there are many panel classes. Not fixed here because it changes the value of a
field this PR is required to leave alone, and because the labelled band deliberately uses the
**identical** convention — a labelled ceiling computed by a better rule than the unlabelled
one would not be comparable to it, and the difference would narrow the band in the flattering
direction. Worth its own PR with the ceiling defined over *distinct panel partners*.

## Verification

- [x] 🔴 **The arithmetic's anchor, against an independently computed figure and a PINNED
      input: the 23 gold records in the store's committed state (`3241f07`) reproduce k2's floor
      at `6.6%` and leave its ceiling at `20.4%`.** Run with `--root` pointing at a scratch store
      holding the real corpus and runs by symlink and only those 23 records:
      `label-resolved band: 11/166 = 6.6% .. 30/147 = 20.4%   (unlabelled: 3.5% .. 20.4%)`, with
      `ceiling_moved: false`; `22 of 23 gold label(s) match a live undecided pair — same 12 ·
      different 10 · insufficient-basis 0`; `5 coderabbit-only class(es) resolved SHARED · 0
      finished apart · 19 still undecided`. **This is the check that the keys, the class mapping
      and the arithmetic are all right**, and it is pinned rather than run against the live store
      precisely because the live store moves.
- [x] **The live store, 142 records (45 gold · 97 silver), same commit.** Gold band
      `12/165 = 7.3% .. 30/147 = 20.4%` from 43 of 45 gold labels applied (13 `same`, 30
      `different`), **6 classes resolved shared, 0 finished apart, ceiling unmoved**. The 22
      gold labels added after the anchor resolved one more class and moved no ceiling, which is
      the predicted behaviour on a label set that still finishes nothing.
- [x] 🔴 **Tier separation, demonstrated on real data rather than argued from fixtures.** The
      silver verdicts resolve to a materially narrower band with `ceiling_moved: true` and
      classes finished apart, from a labeler that failed its own pre-registered validation at
      17/23 — `4.7% .. 17.2%` at 97 records and `5.4% .. 14.2%` at 312 three hours later, while
      gold stayed at `7.3% .. 20.4%` with nothing finished apart. Pooled tiers would have
      published a **moving** number sourced from that labeler; the API cannot express the pooled
      band, the headline names its tier, and the CLI prints `! tier(s) NOT in this band:
      silver=N`. This is the case S5 was written for, and it arrived during the build.
- [x] **No ceiling moved on any replicate.** k1 `4.9% .. 21.1%` and k3 `1.8% .. 21.6%`
      unchanged and reported `none-for-replicate`; k2's ceiling identical before and after.
- [x] **A partial label set never moves the ceiling — tested directly**, in both
      `pair-labels.test.mjs` and `complementarity.test.mjs`, and asserted as
      `band.before.jaccard_upper_bound === band.after.jaccard_upper_bound` rather than
      inferred from two printed numbers.
- [x] **A class held open solely by `insufficient-basis` counts as unfinished**, with the
      `different`-finishes-a-class contrast asserted beside it in one test.
- [x] **A replicate with zero labels is distinguishable from one whose labels resolved
      nothing** — six of the seven availability states are asserted, five of them in one test.
- [x] **A label whose `diff_sha256` disagrees is refused, not skipped** — unit-tested and
      tested through `complementarityOf`.
- [x] **Gold and silver are never pooled**, and the gold band is unchanged by a silver
      verdict on the same pair. A pooled call throws.
- [x] **The payload's pre-existing fields keep their meaning:** `assert.deepEqual(after.overlap,
      before.overlap)` with labels applied, and `report.mjs`'s `complementarityFigures` run on
      a real labelled payload renders the same three bands it rendered before — `4.9%/21.1%`,
      `3.5%/20.4%`, `1.8%/21.6%`.
- [x] **Tests: 1988 + 56 = 2044, 0 fail, 1 skip** (`rest + iso`, the two invocations the lane
      runs since #774) against a **freshly measured** `1986 + 56 = 2042, 0 fail, 1 skip` on this
      branch's own base — **+2**, the review round's two tests. The other 32 this change adds are
      already inside that base, because the base is this branch's first commit with `main` merged
      into it. Both trees extracted separately with the same `node_modules` symlinked into each,
      so the skip count is comparable.
      ⚠ **A count measured against `main` today is NOT comparable to either**: `main` has since
      refactored `scripts/agent/` — a `vendor/pipeline/` move and ~29 agent test files removed —
      and reads `1272 + 58`. The branch is 12 commits behind it and will need updating before
      merge; the two imports that moved (`severity.mjs`, `gh-checks.mjs`) are already re-pointed
      here, and nothing else this change touches has moved.
- [x] **The `iso` invocation's known shared-state failure is pre-existing and identical on
      both trees.** `eval/run.test.mjs`'s *"END TO END: a failed item KEEPS its raw panel
      output"* asserts that no `eval-item-*` directory appears in `os.tmpdir()`, which is
      shared — so it fails whenever that directory holds debris from any other run. Observed
      **54/56 on the branch and 54/56 on unmodified `main`**, and **56/56 on both** with a
      private `TMPDIR`. The debris population moved from 28 directories to 9 during the
      session without anything here deleting one, which is the hazard itself. Known from #682,
      not fixed here, and nothing was deleted.
- [x] **`npx eslint scripts` exits 0** on `eslint@9.24.0`, the lockfile pin; base tree also 0.
- [x] **Every new test mutation-tested: 33 of 33 mutations caught**, each verified to fail the
      test that names the behaviour. One survivor was proven ineffective, then closed with a
      new test — see *Corrected while building* 6.
- [x] **Verified from the committed tree**, not the working copy.
- [ ] **Not verified: a `distant` label.** None exists. `gold` and `silver` are both now
      exercised on real data — see the tier box above. An unreadable label file, a key collision
      and a stale `diff_sha256` also occur nowhere in the store, so those three remain
      fixture-only.
- [x] **A class finished apart, on real data.** Not reachable when this was written — the 23
      gold labels finish none of the 175 pairs owned by the 12 CodeRabbit findings they touch —
      but the silver batch finishes **4**, so the ceiling-moving path is now exercised end to
      end as well as by fixtures. It remains unreachable in the **gold** band, which is the
      correct state of that evidence rather than a gap in the tests.
- [ ] **Not verified: more than three replicates**, or a corpus other than the pilot.
- [ ] **Not run:** `verify:self`, `verify`, `verify:fast`, `verify:browser`,
      `verify:integration`, `build`. This diff is `scripts/agent/**` plus two task docs;
      nothing here can affect them, and CI runs them on the PR regardless.
