# Score complementarity: overlap, unique-to-arm and severity agreement

The first code that reads a **defect class**. `finding-match.mjs` can say *"these forty
findings are twenty-six defects"*; nothing asks the question the classes exist to answer —
*of those defects, which did both reviewers raise, and which did only one?*

A **new** document rather than a section on `20260810-defect-class-grouping-todo.md`, which
owns the grouping: that file is about a **relation**, and this one is about the first number
somebody will quote out of it. The rule it establishes — *the reviewer we can replay and the
reviewer we cannot are not symmetric, and every count has to say how many tries each one got*
— is not about the relation.

Measured against `upstream/main` at `62b5b986b935`. (It moved three times during this work —
`64ac5d4998a8` → `f860743fbdb7` → `62b5b986b935` — and the branch was brought up to date with a
merge from `main` in between. The last move matters: **#773 landed `eval/volume-mix.mjs`**, so
the test baseline rose from 1618 to 1661 and every count below is against the later one.)

## The problem

Two reviewers ran over the same seven pull requests at the same commits. Nothing can say
whether they found the same things.

**And the obvious way to compute it is wrong in a way nothing detects.** Our arm has three
replicates in the store; CodeRabbit has exactly one historical review per pull request,
posted once, which cannot be re-run at any price. Pool the three replicates into one
"panel" set and our arm gets **three chances at every defect while the other arm gets one**
— *unique to us* inflates, *unique to them* deflates, the overlap falls, and every number
that comes out is a perfectly ordinary number. There is no error message and no red test.

The asymmetry is large rather than theoretical. Per-item volume moved **−33% to +67%**
between two replicates of one corpus, so a pooled figure is not a small over-count of a
stable quantity; it is a sum over a wide distribution presented as a property of the panel.

Three more subsets produce a plausible wrong answer the same way:

| The subset | What a naive scorer does with it |
|---|---|
| An item where CodeRabbit reported **nothing** | Cannot tell a clean review from an arm that failed to load, because both are zero classes. One is a true negative and a data point; the other is missing data |
| A CodeRabbit finding written **after** the commit we replayed | Compares the two arms on two different snapshots and prints one number |
| An item whose replay ended `status: "error"` | Scores its absence as a clean review — decision 8 at item level |

## The change

`scripts/agent/eval/complementarity.mjs` — pure functions plus a CLI that prints. It
reads a store, computes, and **writes nothing**; it spawns nothing and calls no model. The
CodeRabbit arm makes read-only GitHub API calls, exactly as its adapter does.

`complementarityOf(records, opts) → { classes, byArm, byItem, overlap, severity, unresolved, stats }`.
Records in, counts out: no store, no network, no clock, so the scorer is testable against
fixtures rather than against one dataset.

**It computes no matching of its own.** `groupFindings` (#759) decides when two findings are
one defect; this file consumes `groups`, `links` and `stats` and counts. A second notion of
"same defect" beside the matcher's is how two numbers about one dataset come to disagree.

### The decision this module exists to make explicit: `VIEWS`

| view | what it answers | how it is labelled |
|---|---|---|
| **`per-replicate`** (default) | ONE panel run against CodeRabbit's one review | **the headline.** The only view whose two unique-catch counts are symmetric |
| `union` | a class counts for us if **any** replicate raised it | *"our arm at K=3 vs CodeRabbit at K=1"* — an **upper bound** on our coverage |
| `intersection` | a class counts for us only if **every** replicate raised it | *"classes present in all 3 replicates"* — what the panel finds reliably enough to find every time |

**The default refuses more than one panel run id**, with the reason in the message. The two
pooled views must be asked for by name, every result carries `stats.draws` (`panel: 3,
coderabbit: 1`), and the CLI prints them under a `BOUNDS — NOT the headline` banner. The
range across replicates is printed and the mean is not: *a mean with no spread is the shape
of every bad number this project has already shipped once.*

At K=1 all three views agree by construction — they differ in how they read K draws, not in
what they do with one — and a test pins that, because a view that changed the answer at K=1
would be doing something else as well.

### Every arm/item pair carries an explicit state, and it is an input

`opts.coverage` is a required list of `{ arm, item_id, state }` rows, `state` from
`panel.mjs`'s existing `POPULATION_STATES` (`present` / `absent`). Vocabulary reused, not
invented.

It is an **input rather than a derivation because it cannot be derived.** A class set holds
only findings, so zero classes for an arm on an item is the same shape whether the reviewer
read the pull request and found nothing or whether we failed to load it. Only the adapter
knows which — both of them already return `population_state` per item for exactly this — so
an undeclared pair is **refused**, and a frame that declares one arm and not the other is
refused too. An item where any arm is `absent` is dropped from every pooled figure and named
in `stats.items.not_comparable`.

`absent` wins across rows: with K replicates an item has K panel rows, and an item one
replicate never reached is a hole in that view rather than a clean review in the other two.

### `window` is asserted, never filtered

`assertComparableWindow` refuses the whole scoring run when any CodeRabbit record reads
`after-window`, and the CLI prints the census by value **and by basis** before it computes
anything. Decision 22 made `window` a guard rather than a scoring input; this is the guard.

`unplaceable` is deliberately **not** refused. On a corpus frozen at the commit CodeRabbit
reviewed an unplaceable finding is in-window by construction — pr-415's three sat exactly on
the commit its item is frozen at, unplaceable only because a force-push later removed that
commit from the pull request. Dropping them would remove 10% of the comparator for a reason
that is about git history rather than about review.

### Severity agreement, and the translation it compares against

For a class both arms claimed: the **most severe** thing each arm said about it, the
distance on `KNOWN`, and `exact` / `adjacent` / `further-apart` with a direction. Most
severe rather than a mean — an arm that says `critical` once and `nit` twice has called the
defect critical, and averaging an arm's own claims answers a question nobody asked.

⚠ **This compares our rubric against a TRANSLATION of CodeRabbit's, not against CodeRabbit's.**
Decision 17: `trivial` becomes `nit`, a section heading becomes `minor` or `nit`, and a
finding stating none anywhere is floored at `nit`. It is not fixable here — the translation
is the only way the two scales meet at all — so the census is **split** by
`coderabbit.severity_basis` and the two halves are never pooled, which is what that field's
own docblock requires. Our arm's floor is flagged too: `normalizeSeverity` maps an
unrecognised severity to `major`, which blocks, and `severity_raw` is its only trace.

### The overlap is a LOWER bound, and the module says how loose

A `maybe` never merges, by policy — so every undecided cross-arm pair is currently counted
as **two** unique catches, one per arm. `unresolved` reports how many CodeRabbit classes have
a panel class the matcher left undecided, and what the overlap would be if a curator resolved
every one of them.

On this data that ceiling **saturates** — see the numbers below — and the module says so in
those words rather than printing a number that reads as a real bound.

**The queue's size and the queue's cost are different numbers, so both are printed.** Sorted
strongest first, with the count at or above `TRIAGE_SCORE` (0.70) beside the total. The
distribution is bottom-heavy by construction: L2 answers `maybe` for any cross-source pair
with a location tie, and two findings on one file have a location tie whether or not they are
about the same thing. Measured on k1 — **412 undecided cross-arm pairs, 315 of them below
0.50, and 17 at or above 0.70.** *"412 unresolved, 17 worth reading"* is actionable where
*"412 unresolved"* reads as intractable.

`TRIAGE_SCORE` is a **reporting aid and nothing more**: it re-thresholds nothing, promotes
nothing, and enters no count this module reports. `matchFindings` owns the
`match`/`maybe`/`no` decision and its bar is calibrated; a scorer that quietly moved it would
be adjudicating.

## Corrected while building

### 1. `groupFindings` reads `lens` off the finding; a finding record does not have one

The same-run gate is `trim(a.lens) !== trim(b.lens) || trim(a.file) !== trim(b.file)`
(`finding-match.mjs:263`), read off the finding itself. `buildFindingRecord` puts the lens in
the **arm namespace** (`record.panel.lens`), correctly — a reviewer with no lenses must not
have a top-level one — and `groupFindings` exposes `itemOf`, `armOf` and `runOf` accessors
but **no `lensOf`**.

So a record handed to `groupFindings` unmodified reports `lens: undefined` on **both** sides
of every pair, `"" !== ""` is false, and the absolute (lens, file) gate silently degrades to
a file-only gate. Nothing fails. Classes just quietly merge across lenses.

This module therefore **widens** each panel record with a top-level `lens` before grouping —
a copy plus one field, never a rebuilt field list — and `assertLensPresent` refuses the run
if the lens is not there to hoist, so a field that moves upstream breaks the scorer instead
of loosening a gate. All 428 panel findings across the three replicates carry one, so it is a
guard rather than a correction today.

**Measured, because the choice moves a number and had to be stated rather than defaulted
into:**

| replicate | classes (gate as documented) | classes (file-only gate) | both arms | overlap |
|---|---|---|---|---|
| k1 | **166** | 146 | **6 either way** | 3.61% vs 4.11% |
| k2 | **173** | 153 | **4 either way** | 2.31% vs 2.61% |
| k3 | **164** | 136 | **5 either way** | 3.05% vs 3.68% |

**The shared-class count does not move at all.** Cross-arm pairs are always cross-source and
L2 never reads a lens, so the gate choice touches only how many of OUR OWN findings collapse
into one class — 20 to 28 intra-panel merges per replicate — and therefore only the
denominator. The direction matters: the documented gate is the one that *inflates* our unique
count, so it is stated here rather than left implicit. Reported as finding 1 below.

CodeRabbit records deliberately get **no** hoisted lens even though the adapter fills one:
`gateFor` makes every pair involving that arm cross-source, and its own reason applies —
CodeRabbit's lens is a category→lens guess of ours, so gating on it would partition one
reviewer's comments by our annotation.

### 2. The upper bound on overlap is saturated, which is itself the finding

The first version printed *"at most 21.1%"* and stopped. Then the count came out at **24 of
24** — every CodeRabbit-only class has an undecided panel candidate — which makes the ceiling
"all of them" and therefore worth nothing.

It is not a corner case. L2 answers `maybe` for any cross-source pair with a location tie
that misses the token bar, and two findings on **one file** have a location tie by
definition, so undecided is the default for same-file pairs. The output now says so in
those words, because a saturated ceiling printed as a number is a number somebody quotes.

### 3. `run.json`'s `status: "complete"` is not evidence a leg is usable

`complete` is derived from every planned item being **present**, and an `infra` error item
writes an envelope — so a leg that failed two of seven items reports `complete`. The CLI
checks `items_ok` against `item_count` and refuses the leg, rather than scoring it over the
items that did work: its missing items are holes, and the per-item rows would otherwise
report them as an arm that answered with nothing.

Checked against the store: all three pilot legs read **7 ok of 7** after the 2026-08-11
repair, so this is a guard rather than a correction.

### 4. "Cross-arm" read off the CLASSES over-counted the undecided queue by 12

The first version of the triage count asked *"does one class carry panel and the other
carry CodeRabbit?"*. A **shared** class carries both, so a link from it to a panel-only class
satisfies that test while joining two **panel** findings. It reported **424** undecided
cross-arm pairs on k1 where the true count is **412**.

Caught by disagreement rather than by a test: an independent inspector that pairs every panel
record against every CodeRabbit record through `matchFindings` directly returns 412, and two
numbers about one dataset must not disagree. The fix reads the arms off the two **findings** a
link joins — `link.members` carries their digests and `groupFindings`' own group members carry
each digest's arm — which reproduces 412 and 17 exactly.

**It then failed a second time, silently and in the safe direction.** The digest→arm map was
built from this module's own class rows, which deliberately do **not** carry members, so it
was empty and the queue read zero. The map is built from the raw `grouped.groups` instead.
Both mistakes are pinned by a test now, and the second is the argument for the first: a
lookup that silently yields nothing is the shape of every bug in this project.

### 5. Four defects found in review, every one of them silent

None changes a published number — all seven pilot items are comparable, every record is
well formed and no item id carries whitespace — so each is a latent fault on a path the pilot
does not reach. That is exactly why they are worth writing down: **each fails silently and in
a plausible direction.**

- **The undecided queue counted pairs from items nothing else counted.** `links` spans every
  item the grouping saw, while the classes it was matched against are the SCORED set —
  comparable items only. A link on an item one arm never answered for resolved to no class,
  and was pushed onto the queue anyway with `item: null`. The queue and the overlap it
  qualifies would have had different denominators. Both classes must now resolve before a pair
  is counted.
- **A coverage frame keyed item ids differently from the grouping.** `defaultItemOf` trims, so
  a record carrying `" pr-1 "` is grouped under `"pr-1"` and its class reports the trimmed id.
  A frame keyed on the raw string matches no class, so `scored` filters **every class away**
  and the run reports 0 of 0 — total, and with no error. One `itemKey` helper now normalises
  both sides, and `stateOf` normalises its argument too.
- **A repeated `--run-id` was scored as two draws.** Each is scored as an independent replicate,
  so naming one twice prints the same leg twice and reports a range across "two" draws that is
  one. Worse, the union and intersection views were fed that leg's records **twice** while
  `stats.draws` still read 1, since the draw count derives from the distinct run ids on the
  records. Refused as a usage error rather than deduped — deduping would hide the typo.
- **Inputs that were not record objects vanished.** They were filtered out before grouping, so
  `groupFindings`' own `stats.skipped` never saw them either and nothing anywhere said a
  record had been dropped. Counted now, in `stats.records.malformed` and in `concerns`.

### 6. A `--run-id` cannot be repeated through `parseArgs`

`parseArgs` is single-valued by construction (`a[key] = argv[i + 1]`), so a three-replicate
invocation would have scored one leg and said nothing. `runIdsFrom` collects the repeats
from `argv` instead of teaching `parseArgs` to accumulate — that function is shared by six
CLIs in this family, and a flag that became an array only when repeated would change what
every one of them reads. It also refuses to swallow the next flag as a value, which is the
form of the bug that would silently score one replicate.

## The numbers

Measured 2026-08-11 against the real store, corpus `2026-08-10-pilot-reviewed`, runs
`pilot-01__k1` · `__k2` · `__k3` (7 items each, all `status: "ok"`, novelty gate **on**),
population `reported`. **Window census: `in-window=30 · unplaceable=0 · after-window=0`, all
30 on basis `commit-is-review-commit`** — the census that exists after #771; before it, three
of pr-415's read `unplaceable`.

**Headline — one draw against one draw, three times:**

| | k1 | k2 | k3 |
|---|---|---|---|
| defect classes | 166 | 173 | 164 |
| **both arms** | **6 (3.6%)** | **4 (2.3%)** | **5 (3.0%)** |
| panel only | 136 (81.9%) | 143 (82.7%) | 134 (81.7%) |
| CodeRabbit only | 24 (14.5%) | 26 (15.0%) | 25 (15.2%) |
| severity: exact / adjacent / further | 1 / 3 / 2 | 1 / 1 / 2 | 0 / 2 / 3 |
| panel harsher / CodeRabbit harsher | 5 / 0 | 3 / 0 | 2 / 3 |

**Overlap = 2.3% – 3.6%, n=3 replicates.** Not a mean.

**The bounds, which are not the headline.** Union of the three replicates: 271 classes, 6
both (2.2%), 241 panel-only, 24 CodeRabbit-only. Intersection: 84 classes, of which **56 are
ours in all three replicates** and 2 are shared — and **187 classes are dropped by that view**,
printed, because our arm raised them in one or two replicates but not all three.

**Per item (k1), because the asymmetry is per item too:**

| item | panel | CodeRabbit | both | panel-only | CR-only | overlap |
|---|---|---|---|---|---|---|
| pr-415 | 26 | 3 | 2 | 24 | 1 | 7.4% (n=27) |
| pr-429 | 19 | 7 | 0 | 19 | 7 | 0.0% (n=26) |
| pr-465 | 33 | 6 | 2 | 31 | 4 | 5.4% (n=37) |
| pr-471 | 21 | 2 | 0 | 21 | 2 | 0.0% (n=23) |
| pr-524 | 9 | 1 | 0 | 9 | 1 | 0.0% (n=10) |
| pr-549 | 12 | 5 | 0 | 12 | 5 | 0.0% (n=17) |
| pr-605 | 22 | 6 | 2 | 20 | 4 | 7.7% (n=26) |

**Four readings, and the first bounds every other sentence anyone writes from this table.**

- 🔴 **The overlap number is a lower bound and its ceiling is saturated.** Every one of the
  24–26 CodeRabbit-only classes has at least one panel class the matcher called `maybe`. So
  *"24 unique to CodeRabbit"* means **24 unresolved pairs**, not 24 established misses, and
  the true overlap is somewhere in `[3.6%, 21.1%]` on k1. Closing that gap needs adjudication
  — a curator, or the designed-and-unbuilt L3 — and cannot be done inside a scorer.
  **But the adjudication is small.** Of k1's 652 cross-arm pairs: 6 `match`, 412 `maybe`, 234
  `no`; and of the 412, **315 score below 0.50 and only 17 reach 0.70** (5 at 1.00, 6 in
  0.80–0.89, 6 in 0.70–0.79). Read by hand, the five at 1.00 all look like one defect said
  twice — the clearest is pr-471, where both arms name the **same file and the same line 67**
  and both say the task doc has a duplicate empty `Review` section, and the matcher still
  answers `maybe`. That is not a defect: `matchFindings` requires `tokens >= 0.3` and denies
  `symbolOverlap` a vote on clearing the bar, which is right for `harvest.mjs`, where a false
  `match` SUPPRESSES a real candidate. **In this benchmark a false `maybe` has the opposite
  cost — it inflates both arms' unique-catch counts.** Same threshold, different cost
  structure; stated here, not changed here.
- **Four of the seven items share nothing at all**, including pr-429 where CodeRabbit raised
  7 findings and our arm 19. That is the strongest single argument in the data for running
  both reviewers, and it is also the item where the saturated ceiling bites hardest.
- 🔴 **The severity census sits on a population that is itself not reproducible.** Measured
  across the three replicates over the (item, file) sets each one flagged: **34.3% of
  blocking-severity anchors appear in all three replicates and 40.0% in only one** (n=35).
  Blocking findings churn **more** than average, not less — all findings are 40.7% / 32.1%
  (n=81) — so the spread cannot be written off as nit noise, even though nits are the
  churniest individually (17.6% / 58.8%, n=34). So a 1-exact / 3-adjacent / 2-further split
  over 4–6 shared classes is **a sample, not a property of either reviewer.** Reporting per
  replicate rather than a mean is most of the defence; this is why it matters.
  **The saving grace, in the same breath: the gate verdict never moves.** All 7 items reach
  the same verdict in all three replicates (6 gated, pr-471 clean ×3), on blocking-lane counts
  of 35 · 34 · 30. What gates is reproducible; what gets reported is not.
- **Where the two arms disagree on severity by two steps, both cases are missing-test-coverage
  findings** — `touchUpdatedAt`'s guard is untested (pr-465) and vim-mode coverage for
  `routeVimHistoryToStore` (pr-605) — our arm `major`, CodeRabbit `nit`. **n=2.** Worth one
  look, not a claim.
- **Our arm is the harsher one on shared defects in two replicates of three** (5/0 and 3/0),
  and not in the third (2/3). With 4–6 shared classes per replicate, the direction is not
  established by this data.

**And one thing this module structurally cannot state.** All 30 CodeRabbit records carry a
header-field severity, so the `unstated` half of the severity census is empty on this corpus
and its branch is exercised only by fixtures.

## Fail directions

| When this fails | What happens | Why that is the safe way |
|---|---|---|
| More than one panel run reaches the default view | **Throws**, naming the run ids | K draws against 1 is the one error this module exists to prevent, and it is invisible in the output |
| An arm/item pair is undeclared, or only one arm is declared for an item | **Throws**, naming the pairs | The missing declaration is exactly the one that reads as a true negative |
| A CodeRabbit record is `after-window` | **Throws**, before any count | The two arms would be compared on different snapshots. Filtering instead would shrink the comparator for a reason that is ours |
| A panel record carries no `lens` | **Throws** | The alternative is a gate that quietly becomes a looser gate — silent degradation of a guard |
| An item's replay ended `error`, or a leg reports `items_ok < item_count` | **Refused** by the CLI and by the scorer, with the item named | An error item is not a zero. A clean review — `present`, zero findings — *is* a data point and stays poolable |
| A record is population `sampled`, or carries an arm outside `ARMS` | **Throws** | `sampled` has no CodeRabbit counterpart, so the comparison does not exist |
| An arm did not answer for an item | Item **labelled** not comparable, excluded from every pooled figure, printed per item, CLI exits non-zero | A read-path shortfall, not a caller error: the result is right about less, and must not be quotable as complete by ignoring stderr |
| A CodeRabbit finding is `unplaceable` | **Scored**, counted, named in `concerns` | In-window by construction on a corpus frozen at the reviewed commit |
| A rate has no denominator | `null`, printed `n/a` | `0/0 → 0.000` is what a blank branch looks like and it reads as a measurement |
| A vocabulary this file compares against is renamed upstream | **Throws at import** | A guard that greps for a renamed value never fires and never complains — lesson 7, applied to a string |

## Explicit non-goals

- **No reliability.** Agreement between replicates — Jaccard, κ — is a different metric over
  the same records. The `intersection` view counts classes every replicate raised; it does
  not score how much the replicates agree.
- **No matching.** `groupFindings` decides what one defect is. Where its call site seemed
  wrong, it is reported below and not patched: #759 landed with 0 order-dependence over 28
  permutations, so the prior is that the call site is wrong.
- **No adjudication of the `maybe` queue**, which is what would turn the lower bound into a
  number. It needs a curator or the unbuilt L3, and both cost money per pair.
- **No precision, recall or validity** — those need labels.
- **No segmentation grid, no intervals, no report renderer.**
- **No restatement rate.** Spec §3.5's fourth row needs rounds, and an item replays one pass.
- **Nothing written**, into the store or anywhere else. Scores are derived data.
- **No edit to `finding-match.mjs`, the adapters, `finding-record.mjs` or anything under
  `clusterFindings`.** Two findings for them are recorded below instead.

## Findings for the modules this consumes

None is fixed here; all are edits to merged files this change has no other reason to touch.

1. **`groupFindings` has no `lensOf` accessor, so its same-run gate silently depends on the
   caller's record shape.** It reads `finding.lens` while `finding-record.mjs` deliberately
   puts the lens in the arm namespace, and it has accessors for `item`, `arm` and `run` but
   not for this one. A caller that passes records unmodified gets a file-only gate and no
   warning — worth 20 to 28 classes per replicate on the pilot. A fourth accessor beside the
   other three closes it; this module hoists the field and asserts instead.
2. **`panelRecords` does not return the envelope's `status`.** It rides on each record as
   `panel.item_status`, so an item that ended `error` with **zero findings** carries its
   status nowhere a scorer can see — and that is precisely the item decision 8 most needs
   excluded. The CLI works around it by reading the envelope from the store.
3. **Within-arm restatement across lenses is never collapsed, and that is the same-run gate
   doing it.** Two of k1's five strongest undecided pairs are the *same panel defect* —
   `database.e2e-spec.ts:309`, a duplicated e2e test — reported once by `correctness` and once
   by `design-fit`, each pairing separately against the one CodeRabbit comment. The gate
   requires an identical lens, so the two never merge and one defect occupies two classes.
   **This is very likely why #759 measured within-arm collapse at only 1.4%:** the gate
   partitions by lens before anything can collapse. Filed beside finding 1 because it is the
   same accessor: the gate's strictness is right for round-to-round comparison and is being
   applied to a cross-lens question it was not calibrated for.
4. **A degenerate CodeRabbit record exists, and it inflates the queue.** On pr-549 one
   finding's summary is literally `/node_modules/`. It carries almost no token content, so
   every panel finding on that file scores 0.85–0.88 against it on location alone — it
   accounts for **3 of k1's 17 strongest undecided pairs**, none of which a human could
   adjudicate. A parse artefact rather than a matcher or adapter defect, named here because a
   triage queue that leads with it wastes the first thing a curator reads.

## Verification

- [x] `agent:tests` on the **committed tree**: **1689 tests, 1689 pass, 0 fail, 0 skipped**,
      against a freshly measured `upstream/main` (`f860743fbdb7`) at
      **1661 / 1661 / 0 / 0**. **+28.** Both trees extracted with `git archive` and given
      identical `node_modules` (root → eslint 9.24.0 as the lockfile pins it; `scripts/agent`
      → the Agent SDK), so 0 skips on both rather than an environment artefact.
- [x] `eslint scripts` exits **0** on the branch tree and on the base tree, at the pinned
      9.24.0.
- [x] **Every new test mutation-tested: 38 mutations, 38 caught, 0 survivors**, source
      restored byte-for-byte afterwards. The mutations cover each guard's condition, both
      severity branches, the `absent`-wins rule, the intersection's `every`, the
      comparable-items `every`, the null-denominator rule, the repeated-flag parse, the
      queue's sort direction, its triage count, the arm the cross-arm test reads, both
      halves of the item-id normalisation and each coverage-row guard on its own.
      **One survived the first pass and was ineffective rather than uncaught** — reversing the
      queue's sort changed nothing because all three pairs in that fixture scored exactly
      0.50, so no order was observable. Proving that took five seconds and was worth it: the
      fix is a fixture with three distinct scores (1.00 / 0.75 / 0.50, driven by
      `symbolOverlap` exactly as the real 1.00 pairs are), not a second test.
- [x] Run end to end against the real store over all three replicates, and the six shared
      classes of k1 **read by hand** against their summaries and files: each is one coherent
      defect described twice, not a co-location artefact.
- [x] The window census **reproduced from the CodeRabbit adapter's own CLI** before scoring
      anything: `30 record(s), in-window=30, commit-is-review-commit=30`.
- [x] The lens-hoist decision **measured both ways** on all three replicates, table above.
- [x] The undecided queue's score distribution and the 17 pairs at or above 0.70 **read by
      hand** on k1, and the severity-stratified churn re-derived from the three replicates'
      payloads directly rather than through this module.
- [ ] **Not verified: an `after-window` record on real data.** The corpus is frozen at the
      reviewed commit, so the assertion is exercised by fixtures only. The same is true of
      an `absent` arm, an `error` item, an unstated CodeRabbit severity and a coerced panel
      severity — every one of them is unit-tested and none occurs in this store.
- [x] The duplicate-`--run-id` guard exercised end to end: `--run-id k1 --run-id k2 --run-id
      k1` exits **2** with `--run-id must name distinct runs; repeated: k1`, and two distinct
      ids pass it and reach the store. Observed, not unit-tested — see the box below.
- [ ] **Not verified by a test: `main()`.** The sibling adapters in this directory test their
      exported functions and not their CLIs, and a CLI test here would need a store to write
      to, which these tests deliberately do not have. So the duplicate-run-id guard and the
      non-zero exit on a partial result are **observed by running the CLI** rather than
      pinned. The complete case was observed exiting **0**; the partial path is read but
      unrun.
- [ ] **Not verified: more than three replicates**, or a corpus other than the pilot.
- [ ] **Not run:** `verify:self`, `verify`, `verify:fast`, `verify:browser`,
      `verify:integration`, `build`. This diff is `scripts/agent/**` and a task doc; nothing
      here can affect them, and CI runs them on the PR regardless.

---

## Follow-up (2026-08-13): the band now reads adjudicated pairs

The section above states the overlap as a band because `groupFindings` never merges a `maybe`,
and notes that resolving one "needs a curator or the designed-and-unbuilt L3, and both are
somebody else's PR". The curator's verdicts now exist in the eval store, and
`eval/pair-labels.mjs` is the record definition plus the resolver that reads them. Every count
in this document is unchanged: the labelled band lives in new payload fields beside the
unlabelled ones, because `report.mjs` renders from these.

**See `20260813-pair-label-consumer-todo.md`** — including a defect it found in the ceiling
described above (`jaccard_upper_bound` can exceed 1 when several CodeRabbit-only classes point
at one panel class) and deliberately did not fix.
