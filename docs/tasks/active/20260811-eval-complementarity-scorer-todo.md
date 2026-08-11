# Score complementarity: overlap, unique-to-arm and severity agreement

The first code that reads a **defect class**. `finding-match.mjs` can say *"these forty
findings are twenty-six defects"*; nothing asks the question the classes exist to answer —
*of those defects, which did both reviewers raise, and which did only one?*

A **new** document rather than a section on `20260810-defect-class-grouping-todo.md`, which
owns the grouping: that file is about a **relation**, and this one is about the first number
somebody will quote out of it. The rule it establishes — *the reviewer we can replay and the
reviewer we cannot are not symmetric, and every count has to say how many tries each one got*
— is not about the relation.

Measured against `upstream/main` at `f860743fbdb7`. (It moved from `64ac5d4998a8` mid-build;
the two differ only in `.github/workflows/ci.yml` and documentation, and the test lane
measures the same at both.)

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

### 4. A `--run-id` cannot be repeated through `parseArgs`

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
- **Four of the seven items share nothing at all**, including pr-429 where CodeRabbit raised
  7 findings and our arm 19. That is the strongest single argument in the data for running
  both reviewers, and it is also the item where the saturated ceiling bites hardest.
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

## Two findings for the modules this consumes

Neither is fixed here; both are edits to merged files this change has no other reason to touch.

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

## Verification

- [x] `agent:tests` on the **committed tree**: **1640 tests, 1640 pass, 0 fail, 0 skipped**,
      against a freshly measured `upstream/main` (`f860743fbdb7`) at
      **1618 / 1618 / 0 / 0**. **+22.** Both trees extracted with `git archive` and given
      identical `node_modules` (root → eslint 9.24.0 as the lockfile pins it; `scripts/agent`
      → the Agent SDK), so 0 skips on both rather than an environment artefact.
- [x] `eslint scripts` exits **0** on the branch tree and on the base tree, at the pinned
      9.24.0.
- [x] **Every new test mutation-tested: 25 mutations, 25 caught, 0 survivors**, source
      restored byte-for-byte afterwards. The mutations cover each guard's condition, both
      severity branches, the `absent`-wins rule, the intersection's `every`, the
      comparable-items `every`, the null-denominator rule and the repeated-flag parse.
- [x] Run end to end against the real store over all three replicates, and the six shared
      classes of k1 **read by hand** against their summaries and files: each is one coherent
      defect described twice, not a co-location artefact.
- [x] The window census **reproduced from the CodeRabbit adapter's own CLI** before scoring
      anything: `30 record(s), in-window=30, commit-is-review-commit=30`.
- [x] The lens-hoist decision **measured both ways** on all three replicates, table above.
- [ ] **Not verified: an `after-window` record on real data.** The corpus is frozen at the
      reviewed commit, so the assertion is exercised by fixtures only. The same is true of
      an `absent` arm, an `error` item, an unstated CodeRabbit severity and a coerced panel
      severity — every one of them is unit-tested and none occurs in this store.
- [ ] **Not verified: the CLI's non-zero exit.** `main()` has no test — the sibling adapters
      in this directory test their exported functions and not their CLIs, and a CLI test here
      would need a store to write to, which these tests deliberately do not have. The complete
      case was observed exiting **0**; the partial path is read but unrun.
- [ ] **Not verified: more than three replicates**, or a corpus other than the pilot.
- [ ] **Not run:** `verify:self`, `verify`, `verify:fast`, `verify:browser`,
      `verify:integration`, `build`. This diff is `scripts/agent/**` and a task doc; nothing
      here can affect them, and CI runs them on the PR regardless.
