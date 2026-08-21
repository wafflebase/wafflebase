# Score cost and wall-clock latency over stored replay envelopes

A **new** document rather than a section on the volume-and-mix scorer's: that file
owns *how many findings and of what kind*, and this one owns *what the review cost
and how long it took*. They share a directory and nothing else — this module reads
run envelopes, not finding records, and touches no matcher.

## The problem

`scripts/agent/eval/` can freeze a pull request, replay it through the panel, and
store an immutable envelope of what the replay cost: `cost_usd`, `turns`, `calls`,
and a duration. **Nothing reads any of it.** The first question anyone asks of an
automated reviewer — *what does it cost to run, and how long do I wait?* — has no
code behind it, while 21 stored replays already hold the answer.

It is also the question that gets answered wrongly the most cheaply, because
**every envelope carries two time fields and only one of them is elapsed time**:

| field | what it is |
|---|---|
| `duration_ms` (+ `duration_source`) | the panel's own wall clock for the round, from `review-timing.json` |
| the summed SDK-call figure beside it | the flat sum over every SDK call, which the panel makes **concurrently** |

The second reads exactly like a duration and is bigger. **Measured over the 21
stored replays it overcounts the first by 1.36×–3.27× per item (median 2.51×), and
by 2.40× at run level — 512 minutes of summed SDK time against 213 minutes of real
elapsed time.** A scorer that read it would report our own arm's latency two to
three times too high, against a CodeRabbit number that is real wall clock, on a
metric that needs no labels and therefore ships before anything has been
validated. Nothing would go red.

The field is not a defect. It is real data about SDK compute and its docblock in
`run.mjs` says outright that it is *"NOT a duration"*. The hazard is that it is
**adjacent, plausible and larger**, which is the shape of every silent-degradation
bug this directory has produced.

Three more misreadings are available in the data as it stands:

| The reading | What the pilot actually shows |
|---|---|
| "big pull requests cost more, so price by size" | Cost is dominated by a **per-item floor**: 47% of a replicate, and the 1004-line item costs 3.1× the 22-line one for **46× the lines** |
| "latency scales with diff size" | The **smallest** item was the second-slowest: 22 lines took 9.6 minutes, 160 lines took 7.0 |
| "we cost $4.70 a review against CodeRabbit's $X" | Theirs is a flat subscription. There is no per-review price on that side and therefore no ratio |

## The change

`scripts/agent/eval/cost-latency.mjs` — `costLatencyOf(runs, opts)` plus a CLI that
prints. It reads a store, computes, and writes nothing; it spawns nothing, calls no
model and makes no network call at all (unlike the volume scorer, which reads the
CodeRabbit API — this one has nothing to ask it for).

Per item and per replicate: cost, wall clock, turns and calls. Across replicates: a
**range**, never a bare mean. Plus a size-bucketed view, a `duration_source` census,
and two metrics §3.4 asks for that are emitted as **explicit nulls with reasons**.

### One reader for the duration, and it reads the pair

`wallMsOf` is the only place `duration_ms` is read, and it reads `duration_source`
beside it. The number alone cannot distinguish *"the panel took no time"* from
*"nobody recorded how long it took"*, and the store permits `null` precisely so the
second is spellable. A disagreement between the two halves — a finite duration filed
under `absent`, a null filed under the measured source — **refuses** rather than
picking one, because it means the writer and this reader disagree about what the
field is.

The summed field is not named anywhere in the module. A test greps the source for
it, which is lesson 1 applied to a naming hazard: the guard that aborts is worth
more than the fix it guards.

### `duration_source` has THREE values, not two

The handoff for this PR named `review-timing.json` and `absent`. The runner writes a
third, `not-run` (`run.mjs:955`), on every pre-spawn refusal and on the exception
path — an item where **no panel ran at all**, which is a different absence from *"the
panel ran and wrote no timing file"*. Pooling them would report "we could not time
it" for an item that was never reviewed. The census keeps all three apart and prints
every one at n=0.

This is also the only vocabulary in the module with **no exported owner** — the
runner writes the strings inline, so there is nothing to `pin` against. The remedy
is the opposite of a default: an unrecognised value gets its own bucket **and** a
completeness reason, so a fourth flavour appearing upstream shows up as an
unexplained count rather than folding into one of the three.

### Two money questions, kept apart, and neither is called "cost"

```text
spend.total_usd    what this run's stored envelopes add up to, failures included
review.cost_usd    the distribution over `ok` items only — what one review costs
```

An `error` item is not a cheap review; it is a review that did not happen. The pilot
has the case on file: an `infra` error item that had spent **$2.49** before dying.
Pooling it into the second would make a rate-limited run look economical.

⚠ **The store's own total is honestly lower than what was actually paid, and this
module cannot see the difference.** `putRun` recomputes `totals` from the envelopes
*present*, and that $2.49 item was deleted during the K=3 repair — so its spend is
in neither `run.json` nor anything computed here. That is stated as a standing
caveat in the output rather than corrected, because the evidence for it is outside
the store by construction. **Nothing is hardcoded and the store is not "fixed".**

### The size story is a floor and a slope, and there is no average per line

`fitCostToSize` reports `cost ≈ intercept + slope × (lines / 1000)` per replicate,
with `fixed_share` — the fraction of the bill that is per-item overhead.

**No average cost-per-line is emitted anywhere, at any level, and a test asserts
that no such key exists.** `Σcost / Σlines` is arithmetically fine and reads
backwards: under a fixed floor the cheapest item per line is the biggest one, so the
average makes a 1004-line review look ~15× more efficient than a 22-line one. The
same size-confound swings findings-per-100-lines by 19× on this corpus. A marginal
slope cannot be misread the same way — it is explicitly the cost of the *next*
thousand lines rather than the cost of the average one.

For latency there is **no fit at all**, deliberately. The intercept would have no
budgetary meaning and the data violates monotonicity on real pairs. Instead
`sizeOrder` counts every pair of items and whether the bigger one also scored
higher — concordant, discordant, tied. A reader who wants to write *"X scales with
size"* has the exceptions in front of them, counted.

### Four guards that refuse, two of them borrowed, and the rest that label

| Guard | Why it refuses rather than segments |
|---|---|
| `assertOneReviewer` — **the reliability scorer's** | Cost is a property of the pair `(config_hash, panel_sha)` (decision 13). A different lens set or panel commit is a different price, so a pooled table prices a reviewer that never existed |
| `assertRequestedCorpus` — **likewise** | Pricing one corpus's replays against another's diff sizes gives a number that looks right and measures nothing, and a corpus label the data cannot verify is refused too |
| `sizeOf`'s bucket check | `meta.scope` and `scopeSize(additions, deletions)` are one fact derived twice; a disagreement moves an item between buckets, and on a 7-item corpus one bucket holds a single item |
| `wallMsOf`'s pair check | See above |

**The first two are imported rather than written**, and that is the point: both files
ask one question of one store for one reason, and two guards sharing a name while
drifting apart is the failure this directory documents most often. The borrowed pair
is also the stricter — it refuses an input where *no* run states an identity, which
this file's own first draft returned `null` for. Only the input shape is adapted, and
the adaptation is a projection out of the stored envelope rather than a second source
of truth. A test asserts the wiring reaches them, because an adaptation that quietly
produced an empty list would leave both guards running and never firing.

**One deliberate divergence from that same scorer:** it also calls `assertItemsOk` and
**aborts** on a failed item, because a truncated finding set reads as disagreement and
would make the panel look unreliable when the harness failed. Cost has the opposite
requirement — a failed replay still spent money, and refusing the run would make that
spend invisible — so a failed item is reported here, under `spend` and never under
`review`. Two scorers, one store, two correct answers.

Everything else **labels**: a failed item, a missing timing file, a corpus item no
run reached, a `run.json` total that disagrees with its own items. The split is the
volume scorer's: the refusals mean the number would be wrong, the labels mean it is
right about less than a reader may assume.

## Corrected while building

### 1. `duration_source` had a third value the plan did not know about

Covered above. Found by grepping the writer rather than trusting the handoff's
summary of it — which is the same procedure that found `stageDetail`'s keying and
`conclusion`'s meaning.

### 2. A `variance === 0` guard does not catch three items of the same size

The no-slope guard was written as `sxx === 0`. It does not fire: `100/1000` is not
exact in binary, so the mean of three copies of it is not the value itself, and the
x-variance of three identical sizes comes out at **2e-33 rather than 0**. The fit
then divided by a rounding error and returned a slope of exactly `0` with a straight
face. **Line counts are integers**, so the guard now counts *distinct sizes*, which
is exact. Found by a mutation test, and it is a real defect rather than a missing
test: the surviving mutation was the *correct* code and the original was wrong.

### 3. A substring search for `"ratio"` can never fail

The test asserting that no arm-to-arm ratio appears in the result searched the JSON
for `ratio` — which is inside **`duration`**. It was red for the wrong reason on the
first run, and had the module happened not to emit `duration_source` it would have
been green forever. Now it matches quoted keys. *A check that cannot fail is
decoration* — lesson 3, found on this PR's own test rather than on its code.

### 4. "CodeRabbit's latency cannot be computed" was wrong, and the module said so

The first version of the declared gap read *"their arm supplies an END timestamp per finding and no
start"*. The first half is right and the conclusion is not. There is no *push* time — a finding's
`posted_at` is the end, and the two obvious substitutes are both wrong in ways worth recording: the
commit's committer date can precede the push by hours, and the pull request's `created_at` is not the
trigger for a review of a later commit. Measured across the seven items, those two candidate starts
disagree by **up to 38 hours**.

But CodeRabbit brackets its own work: it stamps a marker when it takes a job. So the gap now reads
**measurable, and not from anything this scorer reads** — the read belongs to the arm's adapter, not to
a scorer that touches no network. The distinction matters more than the wording, because *"this number
cannot exist"* stops a reader looking and this one can exist.

⚠ **The mechanism this document first proposed for it was wrong, and is corrected in §7 below.**
The first version said the status comment is *"edited in place, so the two revision timestamps are a
duration it timed itself"*. Measured properly, that pair is wrong by **8×**. Read §7 rather than this
paragraph for the interval.

### 5. Four defects found in review, three of them the same failure

Fixed after the first push, and worth listing together because three are one shape —
a value that is absent printing as though it were measured:

- **The unknown size bucket printed `null–null` lines.** An item with no frozen
  input has an empty line-count series, interpolated straight into the string. It
  now goes through the same empty-series formatter as every other range and prints
  `n/a (n=0)`.
- **An unknown size was bucketed but never LABELLED.** The result could read
  `COMPLETE` and exit 0 while a size bucket said `(unknown)` — every per-size figure
  quietly about less than the corpus. It is now a named completeness reason, and
  therefore a non-zero exit. Derived from the scored rows rather than from what the
  caller passed, so a caller that built its size map wrongly is caught by the same
  check as one that could not read an item.
- **Two dollar figures in one message at different precisions**, which invites a
  reader to blame the formatting for the gap.
- **The comment on `replicate_spend_usd` said ~6%** while the field it describes is
  `spread_over_min` and prints ~11%. Both numbers are real and they have different
  denominators; the comment now names which.

### 6. Three of the first mutation pass's survivors were test gaps, not ineffective mutations

All three were checked against the "prove the mutation changed behaviour at all"
rule before writing anything, and all three had genuinely changed behaviour on
inputs the tests did not supply: tied sizes never occur in the pilot fixture, a
one-replicate fixture cannot tell an item count from an observation count, and the
declared-gaps test checked the reasons without checking the values. Three tests
widened; no code changed.

### 7. ⟳ The other arm's interval is settled, and this file's proposed mechanism was 8× wrong

*Appended after the interval was decided elsewhere and measured by the arm's own adapter. §4 above is
kept because it was confident and documented; where the two disagree, this section wins.*

**`t0` is CodeRabbit's OWN start marker** — the HTML comment it stamps when it takes a job, per
**invocation** for an on-demand `@coderabbitai review` and once per **pull request** for its status
comment, taking the latest such marker before the finding. **`t1` is the earliest CodeRabbit artefact
on the frozen commit**, off the arm's own `posted_at`. Interval name
`coderabbit-start-marker-to-first-finding`; **n=7/7, median 6.8 min, range 2.6–14.4.**

**What §4 got wrong.** It proposed the status comment's `created_at → updated_at` pair. That reads
**53.7 min against a true 6.6 on pr-415** — wrong by 8× — because *the last edit is the last edit of
anything*: the comment is re-edited long after the review lands. The same rule is right to within
**4 seconds** on the per-invocation ack. **A rule that is right on one comment kind and 8× wrong on
another is not a rule**, and the failure is this project's signature one — a value that is a property
of the container read as a property of the work.

**Two other starts were rejected, and one of them this file measured itself.** A push-time proxy from
`min(check-run started_at)` on the frozen commit agrees with the marker to **0.1–0.4 min on the five
automatic items** — but **2 of 7 pilot items are on-demand**, where it times a *human*: pr-549 reads
**183.7 min** from the push against **7.8** from CodeRabbit's own ack, and **pr-605 has the same defect
behind an innocent 9.8 min**, so an outlier rule that catches the first keeps the second. It also
depends on *our* CI having run on that commit, which is a fact about our repository. The pull request's
`created_at` and the commit's `committer.date` were rejected for the reasons §4 gives.

**🔴 And the direction of the bias is the opposite of what was feared.** This is the correction that
matters to a reader of *this* module:

| | interval | environment | pilot |
|---|---|---|---|
| **us** | panel process, `review-timing.json` | **offline replay** | median **9.3** min, n=21 |
| **CodeRabbit** | its own marker → its first finding | production | median **6.8** min, n=7 |
| **us, production** | CI-start → our lens check runs | production | **18.7 and 19.0** min, **n=2** |

The third row settles it. On the two items carrying `agent-review-*` check runs at the frozen commit,
both arms' clocks start from the same event, and ours reads **18.7 / 19.0** against their **8.0 / 8.6**
— **about 2.2× LONGER.** The spec warned for months that latency would read 3–5× too high *against*
us; in production it reads too **low, in our favour**, and publishing *9.3 vs 6.8* unqualified would be
the most misleading number this project could produce. ⚠ Note also that **9.6 is replicate k1's median
alone** (k2 8.7, k3 9.3); the figure over all 21 replays is **9.3**. Every per-item `9.6` in this
document is pr-524's k1 wall clock and is correct as an item figure.

**So the declared gap is rewritten rather than deleted**, and it now carries three things it did not:
the interval's name, the rejected mechanisms *with* their measured errors, and the fact that arriving
at a number does not make the two arms comparable. **Separate blocks, separate units, no shared axis
and no ratio** — minutes need that discipline more than dollars, because they look commensurable.

**Still not built here, deliberately:** the latency block itself. It becomes `seriesOf` over the
poolable figures with the interval named in the field, its `n` and range beside it, and the absent
census with its zeros — fed in as an **injected option** so this module stays hermetic and its tests
stay fixture-only. That waits on the adapter read landing; consuming a shape that does not exist yet
would make this PR indefensible on the day it lands, which is the rule that governs every PR here.

## The numbers

Every figure below is this module's output over the real store — `pilot-01__k1`,
`__k2`, `__k3` on corpus `2026-08-10-pilot-reviewed`, one reviewer throughout
(`config_hash sha256:1c7853de…`, `panel_sha 46da673dd46d`). **21 of 21 replays
`ok`; `duration_source: review-timing.json` on all 21; `absent` and `not-run` both
0.**

| replicate | spend | per review (min–median–max) | wall (min–median–max) | floor + slope | fixed share |
|---|---|---|---|---|---|
| `__k1` | $32.91 | $2.33 · $4.57 · $7.18 | 7.0m · 9.6m · 18.8m | $2.20 + $5.20/1000 lines | **47%** |
| `__k2` | $29.53 | $2.45 · $3.65 · $6.73 | 7.2m · 8.7m · 17.7m | $2.10 + $4.41/1000 lines | 50% |
| `__k3` | $30.49 | $1.89 · $4.17 · $7.57 | 4.1m · 9.3m · 18.1m | $1.77 + $5.38/1000 lines | 41% |

**A replicate costs $29.53–$32.91** — the store's total for the pilot is $92.93.

Per item, across all three replicates:

| item | lines | bucket | cost | spread of min | wall |
|---|---|---|---|---|---|
| pr-524 | 22 | S | $1.89–$2.56 | 35% | 6.5m–9.6m |
| pr-471 | 160 | M | $1.99–$2.45 | 23% | 4.1m–7.2m |
| pr-415 | 273 | M | $3.65–$4.57 | 25% | 7.2m–9.3m |
| pr-549 | 385 | L | $3.30–$3.86 | 17% | 9.3m–10.8m |
| pr-465 | 725 | L | $5.51–$6.81 | 24% | 11.0m–11.5m |
| pr-429 | 792 | L | $4.37–$6.36 | 46% | 7.4m–11.2m |
| pr-605 | 1004 | L | $6.73–$7.57 | 12% | 17.7m–18.8m |

**The price is far more stable than the product.** Replicate spend moves ~11% across
K while per-item *finding volume* on the same items moves 12–67%. Per-item cost
moves 12–46%, which is the same order as the between-item signal in the M bucket —
so a single item's cost is one draw, not a property of the item, and this module
never prints one without its range.

**Ordered by size**, out of 21 pairs per replicate: cost is concordant on 20 / 18 /
19, wall clock on 18 / 15 / 17. Both trend with size and **neither is monotonic**;
the latency exceptions are real and specific (22 lines slower than 160).

### Which of these numbers may be quoted

- ✅ *"A review of this corpus costs $1.89–$7.57 and takes 4–19 minutes, for this
  reviewer."* Named pair, stated range.
- ✅ *"About 47% of the bill is a per-item floor, so the budget scales with the number
  of pull requests rather than their size."*
- ❌ *"A review costs $4.70."* That is `__k1`'s mean over seven items spanning 45× in
  size, and `__k3`'s median is $4.17.
- ❌ *"A review takes 30 minutes."* That is the summed SDK figure this module refuses
  to read.
- ❌ Anything comparing these dollars with CodeRabbit's subscription.
- ❌ Anything about cost per *real* finding. Zero adjudicated labels exist.

## Fail directions

| When | What happens | Why that is the safe way |
|---|---|---|
| An item's `duration_source` and `duration_ms` disagree | **Refuse the whole read** | The pair is the schema; if the two halves disagree, every latency figure downstream rests on whichever is wrong |
| A timing file is missing (`absent`) | Excluded from every latency figure, with its own `n` and a named reason | Averaging in a zero makes a review that was never timed the fastest one |
| No panel ran (`not-run`) | Counted in its own census bucket, never in `absent` | Two absences with different causes are two facts (lesson 6) |
| An item ended `error` | Its spend counts in `spend`, never in `review` | A failed review priced as a cheap one flatters the arm that fails |
| A run spans two reviewers or two corpora | Refuse | A pooled price describes a product nobody shipped |
| An item is not frozen under this root | Size is `null`, and it lands in an `(unknown)` bucket | A `0` would put it in the smallest bucket and pull that bucket's cost up |
| Anything is incomplete | Labelled reason + **non-zero exit** | A pipeline cannot quote a partial result as a complete one by ignoring stderr |
| An item was deleted from the store | **Undetectable**, and said so in the output | Honest about the one thing it cannot see, rather than silent |

## Explicit non-goals

- **No stage attribution.** Which stage spends the money is §3.6; `stageDetail` and
  `payload.json` are not read here at all.
- **No cost per finding of any kind**, real or otherwise. The substitute would be
  quoted as the real metric.
- **No ratio between the arms**, and no shared key name or unit between them.
- **No renderer, chart or markdown report.**
- **Nothing is written.** The eval store's README reserves `scores/` for persisted
  metrics; both merged scorers print instead, and this follows them. Persisting is a
  later PR's decision, so the result carries a `scorer_id` and nothing writes it.
- **Nothing existing is modified.** Three new files, no edits.

## Two notes for the modules this consumes

1. **The `duration_source` vocabulary has no exported constant.** `run.mjs` writes
   `"review-timing.json"`, `"absent"` and `"not-run"` as inline literals at two
   sites, so a consumer cannot pin against it the way `volume-mix.mjs` pins
   `WINDOW` and `GATING_BASIS`. Not changed here — it is a merged module this PR has
   no other reason to touch — and the census's unrecognised bucket is the local
   remedy.
2. **`run.json`'s `totals` are trustworthy about the envelopes present and about
   nothing else.** Worth knowing before anyone quotes a project-wide spend from it.

## Verification

- [x] `agent:tests` — **1786 tests (1730 + 56)** against a base of **1756 (1700 +
      56)**. **+30.** The base is this branch's own tip with only this PR's three
      files removed, rather than a `main` sha: `main` moved five times during the
      work and the branch has been brought up to it each time, so the tree measured
      is the tree that will exist after merge.
      - The **rest** lane is **1730 pass, 0 fail, 0 skipped**, deterministic across
        every run.
      - The **iso** lane (`eval/run.test.mjs` alone) reaches **56 pass, 0 fail** on
        the committed tree *and* on the base — but it is **flaky on this machine,
        identically on both**, so the clean run is not evidence on its own. Across
        13 runs it produced 0–3 failures, and every failure was one of two tests
        that snapshot `os.tmpdir()` and assert no new directory appeared: *"a failed
        item KEEPS its raw panel output; an ok item does not"* — which
        `01-CONVENTIONS.md` already records as pre-existing from #682 and
        reproducing on `main` alone — and its newer sibling *"a throw inside the
        item loop still deregisters the worktree"*, the same shape on
        `eval-lenses-*`.
      - **The mechanism looks like this machine rather than the code:** `eval-item-*`
        debris in `os.tmpdir()` grew from 720 to 986 directories over this session,
        ~13 per run, which is what a `rmSync` intermittently denied by the endpoint
        security software would leave behind — and a cleanup that fails is exactly
        what makes a "no new directory appeared" assertion fail. **Base and branch
        behave the same, so this diff is not the cause; neither test is in a file it
        touches.** 🔴 **Not fixed, deliberately** — repairing another change's flake
        inside this diff would make it unreviewable and hide the report. Two invocations, because the lane runs everything except
      `eval/run.test.mjs` and then that file alone. Both trees extracted with `git
      archive` and given identical `node_modules`, so 0 skips on both is a
      measurement rather than an environment artefact.
- [x] **Re-measured every time `main` moved**, four times: cut at `a5f414e`, then
      `c615b8c` when the reliability scorer merged mid-build — which is what made two
      of this file's guards duplicates and why they are now imported — and finally at
      the branch tip after it was brought up to `main`. No baseline was carried
      forward; each pair of trees was extracted with `git archive` and given
      identical `node_modules`, so 0 skips on both sides is a measurement rather than
      an environment artefact.
- [x] `eslint scripts` exits **0** on the committed tree, at the pinned 9.24.0.
- [x] **Mutation testing: 40 mutations, 40 caught by the test that names the
      behaviour, 0 survivors.** Three survived the first pass; each was checked for
      effectiveness before anything was written, all three had really changed
      behaviour, and all three were fixed by widening a test rather than weakening
      one. A fourth survivor was a real code defect (the `variance === 0` guard
      above) and is fixed in the code.
- [x] **A test fails if the module ever names the summed SDK-call field** — a source
      grep, plus a behavioural test with a fixture whose summed value is 3.1× its
      wall clock.
- [x] Run against the **real store** over all three replicates: reproduces every
      published per-item cost and wall figure, the $32.91 / $29.53 / $30.49
      replicate totals, and the `$2.20 + $5.20 per 1000 lines · 47% fixed` fit to
      the cent. Exit 0, `COMPLETE`.
- [x] The `duration_source` census prints all three values including the two at
      **n=0**.
- **Not verified on real data: every path that handles an absence.** `absent`,
  `not-run`, an unrecognised source, an `error` item and an unfrozen corpus item
  are all unit-tested and none has ever occurred in the store — all 21 replays
  are `ok` and timed. That is the state in which a mishandled absence goes
  unnoticed, which is why each has a test and a printed census entry rather than
  a default.
- **Not verified: CodeRabbit's amortised price**, because no list price has been
  supplied. The path is unit-tested; with no inputs it emits `null` and its
  reason, which is what it will do until someone states the subscription terms.
- **CodeRabbit's latency was measured OUTSIDE this module**, and the settled
  figure is **2.6–14.4 min, median 6.8, n=7/7** over the same seven pull requests
  — the `coderabbit-start-marker-to-first-finding` interval of §7, printed by the
  arm's own adapter. ⟳ **The by-hand comment-edit-history method this bullet used
  to cite, and the 2.5–14.4 it produced, are SUPERSEDED**; §4 records them as
  history because the mechanism it proposed is wrong by 8× and a deleted wrong
  answer gets reinvented. **Nothing here computes any of it**, and no figure from
  it appears in the code — it is recorded so the declared gap can say *measurable*
  rather than *impossible*, and so whoever wires it up starts from a checked
  number rather than the superseded one.
- **Not run:** `verify:self`, `verify:fast`, `verify:browser`,
  `verify:integration`. Nothing here can affect them and CI runs them anyway.

---

# Follow-up — consume the arm adapter's timing read, and retire the latency gap

*2026-08-13, against `main` `1902133bf`. This is the last step of the interlock the
section above set up: that PR declared `coderabbit_latency_ms` as measurable-but-not-here
and named the shape it would arrive in; the arm's adapter then built the read. Nothing
consumed it, so the gap outlived the work that closed it.*

## The problem

`costLatencyOf` emitted `coderabbit.latency = {wall_ms: null, reason}` on every path,
and `declaredGaps()` returned `coderabbit_latency_ms` unconditionally. Both were correct
when written and neither was still true: `adapters/coderabbit.mjs` exports `latencyOf`,
which measures the interval that gap names — `coderabbit-start-marker-to-first-finding`
— on 7 of 7 pilot items. **A gap that outlives the read it asked for is a gap nobody
believes**, and the next reader either re-derives the number or, worse, substitutes one.

The other half of the problem is the one this file has always been shaped around. Once
BOTH arms carry minutes, the field names are the only thing between a reader and a ratio
the data cannot support. Ours is a panel **process's** elapsed time on an **offline
replay**; theirs is a **production** reviewer measured end to end. Where both ran in
production from one trigger, ours took **about 2.2× longer** — the opposite of the
direction this project assumed for months.

## The change

**`coderabbitLatency(perItem)`** takes the adapter's per-item records — not a number —
so every guard that made the number trustworthy travels with it: the author gate, the
in-window rule, the trigger read and the twelve declared absences all stay in the module
that owns them. It emits two figures, each naming its own interval:

| | interval | pooled over | pilot |
|---|---|---|---|
| primary | `coderabbit-start-marker-to-first-finding` | all items | **2.6–14.4 min, median 6.8, n=7/7** |
| secondary | `earliest-check-run-start-to-first-finding` | automatic triggers only | 2.8–14.8 min, median 6.7, n=5/7 |

The secondary is kept because it is derived from **our** CI's clock rather than
CodeRabbit's, so agreement between the two is evidence and disagreement is a question.
It is pooled over the 5 automatic items because on the 2 on-demand ones it times a
human's delay in asking: `pr-549` reads **183.7 min** from the push and **7.8 min** from
CodeRabbit's own acknowledgement. **The number is kept and excluded, not dropped** — an
outlier rule tuned to catch `pr-549` also catches `pr-605`, which is the same event
reading an entirely ordinary 9.8 min, so the trigger is read rather than inferred from
the magnitude.

**`PANEL_INTERVAL`** does for our arm what #799 did for theirs: the interval is a field
(`panel-process-elapsed-on-offline-replay`) rather than a sentence in a docblock.

**`panel.review_wall_ms` and `panel.review_cost_usd`** pool over OBSERVATIONS — one item
in one replicate, n=21 — beside the existing `replicate_spend_usd`, which counts
REPLICATES, n=3. Both were already computable per replicate; neither existed at the
run-set level, and a consumer that wanted one figure with an `n` had to build it and
choose a denominator. The pilot reads **median 9.3 min, n=21**, which is the figure the
recorded interval decision quotes.

**`MIN_FIT_ITEMS`** makes `fitCostToSize`'s existing refusal machine-readable: the
threshold is returned as `min_n` on every path, not only inside the reason's prose. A
consumer rendering "measured and withheld for a thin denominator" needs both the `n` it
had and the `n` it wanted, and parsing the second out of an English sentence is how a
caption comes to contradict the refusal it captions.

**`--coderabbit-latency`** is the CLI flag, and it is **opt-in**. It is the only network
read in this file and it happens in `main()`, never inside `costLatencyOf` — the same
split the arm adapter draws around `fetchCodeRabbitPr`. The library stays pure, its
tests need no network, and the default invocation stays offline and reproducible against
a committed store. With the flag absent the figure is a **declared gap naming the flag**,
never a blank.

`SCHEMA_VERSION` is **2**. `coderabbit.latency.wall_ms` was a scalar that was null on
every path; it is now a block. That is a field changing meaning, which is what the
counter is for.

## Corrected while building

### 8. The census line was a copy of the adapter's exported formatter — found in review

`renderCoderabbitLatency` rebuilt the absence line inline, character for character the body
of `latencyAbsentLine`, while importing `LATENCY_ABSENT` from the module that exports the
function. The adapter exports it precisely so the two reports read alike, and its own
docblock records that an earlier version dropped the unrecognised-flavour row — which makes
giving an unknown absence its own key worthless, because nothing prints it. Now imported and
called, and the test asserts through an unrecognised flavour, which is the behaviour a
re-implementation loses first.

### 8b. The declared gap had to become conditional, not disappear

The first draft deleted `coderabbit_latency_ms` outright. That is wrong in the direction
this file exists to prevent: with the flag absent there is still no figure, and a deleted
gap makes that absence blank instead of explained. It is now emitted **only when no
records were supplied**, with a reason naming the flag — and the test asserts both
directions, because a gap that never appears and a gap that never retires are both
failures and only one of them is obvious.

### 9. 🔴 `requested` is not evidence that anything was measured — found in review

The first version derived `latencyMeasured` from **array-ness**: `coderabbitLatency` set
`requested: true` for any array, and `declaredGaps` dropped `coderabbit_latency_ms` on it.
So `latency: []` — or an array of entries carrying no `latency` — retired the gap while
producing **no figure**, and the completeness guard below read `0 < 0` and pushed **no
reason**. The run reported `complete`, exited 0, and printed *"declared gaps — none"*
beside `latency: n/a (n=0)`. That is the silent success this whole module is shaped
against, reachable from a caller typo.

`measured` is now a separate field and the predicate the gap's own wording implies — **a
pooled figure exists on the primary interval** (`self_timed.ms.n > 0`). And the absence
now has **three** reasons rather than one, because they send a reader to three different
places: nobody asked, records arrived carrying nothing, or records arrived and not one
yielded a poolable interval. Reusing the not-requested wording for the second and third
would tell someone to pass a flag they had already passed.

### 10. A push-proxy shortfall must not be a completeness failure

The first draft counted every non-poolable item as incompleteness. On the pilot that
marks a **correct** run `partial` and exits 1 forever, because 2 of 7 items are on-demand
by design. Only a missing **primary** figure is a shortfall now; the proxy's exclusions
are in the census and on the report line. A guard that fires on the correct case stops
meaning anything — and the test asserts `complete` on exactly that input.

## Fail directions

- **No records supplied** → declared gap with the flag named. Never a blank, never a zero.
- **Records supplied that carry no figure** (empty list, or no poolable interval on any
  item) → the gap **stays declared**, with its own reason rather than the not-requested
  one, and the run is `partial` with a named shortfall. `requested` is never read as
  `measured`.
- **An item with no start marker** → excluded from the figure, counted in the census under
  its own flavour, and named in `completeness.reasons`, which makes the run `partial` and
  the exit code non-zero. **Never pooled as zero**, which would make the other arm look
  instantaneous.
- **An on-demand trigger** → the proxy figure is carried and not pooled. Visible as a
  decision rather than as missing data.
- **`gh` cannot expand `{owner}/{repo}`** → the adapter refuses rather than reporting a
  corpus-wide absence that reads like a repository CodeRabbit never reviewed.

## Explicit non-goals

- **No ratio, and no shared axis.** Not in a field, not in a line of the report. A test
  asserts no quotient key exists in the payload and that the report says so where the
  numbers are.
- **No agreement statistic between the two anchors.** They agree to within 0.1–0.4 min on
  the automatic items and that is worth knowing, but it is a new number and this PR emits
  none.
- **No finding counts.** This scorer reads the adapter's `latency` and discards its
  records; `volume-mix.mjs` owns that population.
- **The report is not re-rendered here.** Changing a scorer does not change a published
  report — somebody must re-run the scorers and re-render.

## Verification

- [x] **`agent:tests`, both invocations, from the committed tree**: **1868 + 56 = 1924,
      0 fail, 0 skipped**, against a freshly measured **1857 + 56 = 1913** on `main`
      `1902133bf` — **+11**, both trees set up identically (root `eslint@9.24.0`, agent SDK
      symlinked into both).
- [x] `npx eslint scripts` exits 0.
- [x] **The pilot figure reproduces from the real store**, `--coderabbit-latency` against
      all three replicates: `latency [coderabbit-start-marker-to-first-finding]:
      2.6m–14.4m (median 6.8m, n=7) — 7 of 7 item(s) poolable, 7 measured`. Exit 0,
      `COMPLETE`.
- [x] The `coderabbit_latency_ms` gap is **retired** on that run and
      `cost_per_real_finding` is **still declared** — asserted as its own test, because
      retiring both is the plausible mistake.
- [x] Our pooled wall clock reads **median 9.3 min, n=21**, matching the recorded
      interval decision; the replicate spend series still reads n=3.
- [x] **17 mutations, 17 caught**, each by the test that should catch it. Six of them are
      the review round's, and two re-introduce the exact defects it found — deriving the
      gap's predicate from `requested` again, and re-implementing the adapter's absence
      formatter inline. The other eleven: pooling the
      proxy regardless of trigger, counting a missing latency as zero, dropping the
      interval name, keeping the gap after measuring, retiring the wrong gap, emitting a
      cross-arm ratio, dropping `min_n`, counting the proxy's exclusion as
      incompleteness, pooling our wall clock over replicate medians, captioning an
      interval onto an absent figure, and reporting `n_measured` as `n`.
- **Not verified on real data: the absence paths.** All 12 latency flavours are
  unit-tested and only the "everything present" one has ever occurred — 7/7 items
  have a marker and check runs. That is precisely the state in which a mishandled
  absence goes unnoticed, which is why each is printed at n=0 every run.
- **Not run:** `verify:self`, `verify:fast`, `verify:browser`, `verify:integration`,
  `build`. Nothing here can affect them and CI runs them anyway.
