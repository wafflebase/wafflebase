# Score volume and mix over finding records from both arms

A **new** document rather than a section on `20260807-eval-finding-record-todo.md`,
which owns the record: that file is about a **shape**, and this one is about the
first code that turns the shape into a **number somebody will quote**. The rule it
establishes — *for every number, know what its denominator is and what is missing
from it* — is what has to be findable later, and it is not about the record.

## The problem

`scripts/agent/eval/` can freeze a pull request, replay it, and map both
reviewers' findings into one record. **Nothing reads a record.** There is no code
anywhere that answers "how many findings does each reviewer produce, of what
severity, anchored where" — the questions that have to be answered before any
comparison of the two reviewers means anything, because a difference in accuracy
says little when one arm reports four times as much as the other.

The failure mode is different from everything before it in this directory. A
broken extractor throws; a broken runner exits non-zero; a broken adapter refuses.
**A broken scorer returns a number.** It is plausible, it is well-formatted, and
nothing goes red — so the risk this file is designed against is not a crash but a
*result computed over the wrong subset*.

Four such subsets already exist in the data as it stands today:

| The subset | What a naive scorer does with it |
|---|---|
| Items whose replay ended `status: "error"` | Scores them as **zero findings**, and in a precision metric a false clean review is a perfect score |
| A replay whose novelty gate was **off** beside one where it was **on** | Pools them, and reports a blocking population that is a property of the harness, not of the reviewer |
| CodeRabbit findings that state **no severity anywhere** | Pools the adapter's `nit` floor with measured severities, so a value nobody stated moves the mix |
| Findings CodeRabbit wrote against a commit our arm **never reviewed** | Compares two reviewers on two different snapshots and prints one number |

## The change

`scripts/agent/eval/volume-mix.mjs` — a library plus a CLI that prints. It reads a
store, computes, and writes nothing; it spawns nothing and calls no model. The
CodeRabbit arm makes read-only GitHub API calls, exactly as its adapter does.

**Exactly the six metrics spec §3.1 and §3.5 name, and no seventh.** Findings per
PR · findings per 100 diff lines · severity mix · nit ratio · localisation rate ·
scope discipline · restatement rate. Nothing that needs a label, an adjudication
or a ground truth, which is what makes it shippable now; and no cross-arm
matching, which belongs to the complementarity scorer and a looser notion of
identity than the record carries.

### Three vocabularies, each with a middle value that says "we could not tell"

Built the way `GATING` and `WINDOW` are built, and for the reason this project has
written down twice: **absent has more than one cause, and pooling them is a
scoring bug.** Each is a frozen `answer ← cause` map, so the two can never be
stated independently and disagree.

- **`LOCALIZATION`** — `resolved` · `unresolved` · **`unresolvable`**. The third
  is the one that keeps the number honest: a corpus item holds the diff, the
  changed-file list and the metadata, **not the tree**, so a citation into
  untouched code names a file that may well exist and cannot be confirmed from
  here. Filing that under `unresolved` reports *our* inability to check as *the
  reviewer's* failure to cite.
- **`SCOPE`** — `in-diff` · `outside-diff` · `unknown`, computed from the frozen
  diff's post-image hunk ranges.
- **`RESTATEMENT`** — `restated` · `restated-per-arm-label` · `not-restated` ·
  `not-applicable` · `unknown`. See below; this one is the whole point.

### Scope discipline is computed from the diff, not from `novelty.origin`

Using the panel's own novelty annotation would have been three lines and is wrong
twice: `annotateFindings` stamps novelty only on `critical`/`major`, so **only 36
of the pilot's 142 panel findings carry one** — exactly its 36 `major` findings —
and CodeRabbit records have no such field at all, so the metric would not be
comparable across arms, which is its only purpose.

So it is derived from the one input both arms were given, and **the novelty
annotation is used as an independent second opinion** on the 36 that have one:

```
introduced   -> in-diff        22   agree
pre-existing -> outside-diff   11   agree
pre-existing -> in-diff         2   DISAGREE
relocated    -> in-diff         1   not comparable (relocated code is added at the new site)
```

**33 of 35 comparable pairs agree, and both disagreements have the same cause:**
the finding is anchored on a **context line inside a hunk** — pr-415's
`database.e2e-spec.ts:309` and `datasource.service.ts:202`, both lines git prints
around a change without changing them.

That is not a defect in either rule; it is the definition. **`in-diff` means "in a
changed region", not "on a changed line".** A hunk's post-image range includes the
context git prints, a reviewer was shown those lines, and CodeRabbit can post an
inline comment on one — so counting only `+` lines would score the two arms
differently for a reason that is about diff formatting rather than about either
reviewer. "Which line did this change introduce?" is `novelty.mjs`'s question.

### One deliberate asymmetry between two of the metrics

A finding citing a path the frozen diff does not touch reads **`outside-diff`** for
scope and **`unresolvable`** for localisation. That is not an inconsistency: the
two metrics ask different questions of one record. *"Is this anchored inside the
diff?"* is answerable — a path the diff does not touch is certainly not inside it,
whether it exists or was hallucinated. *"Does the citation resolve?"* needs the
tree. Each answer is sound for its own question, and a reviewer reading both
columns should expect this row to differ between them.

### Restatement: a **run** is not a **round**

Spec §3.5 asks for the share of findings that repeat one *from an earlier round of
the same pull request*. The available thing that looks like a round is `run_id`,
and it is not one: K replicates are K independent tries at the **same** snapshot,
which is reliability. `eval/README.md` already states the consequence for our arm
— *"an item replays one pass: no multi-round fix loop and no prior-findings
recheck, so round-to-round behaviour is out of scope"* — so our arm reads
`not-applicable`, basis `arm-records-no-rounds`.

Measured on the pilot: **every one of the seven items has exactly one CodeRabbit
review round too.** So the honest output of this metric on this corpus is
`n/a (n=0)` on both arms, and a scorer that printed *"restatement 0%"* would be
reporting that neither reviewer repeats itself, about data in which neither
reviewer was ever asked twice. That is the entire reason the vocabulary has a
`not-applicable` value and the rate excludes it from its denominator.

CodeRabbit's own ♻️ Duplicate tier is carried as a **separate** answer
(`restated-per-arm-label`), never pooled with `restated`: one is our measurement,
the other is the other arm's claim. `"duplicate"` is `harvest.mjs`'s private
`CR_TIERS` value, so it is the one string this module re-types — pinned by a test
that runs `parseCodeRabbitReview` over a real Duplicate section and asserts the
tier it returns, the way `codeRabbitItemId` is pinned against `buildItemMeta`.

### Four guards that refuse, and one that labels

The split is deliberate: **a caller error means the number would be wrong; a data
shortfall means it is right about less than somebody may assume.**

| Refuses | Because |
|---|---|
| `assertOnePopulation` | `reported` and `sampled` answer different questions and only the first has a CodeRabbit counterpart |
| `assertComparableWindow` | an `after-window` record is about code our arm never saw. **Asserted, not segmented** — the corpus was re-frozen at the reviewed commit and this is now 0 across all seven items, so `window` is a guard rather than a scoring input |
| `assertOneRunPerItem` | a mean, a union and an intersection over K runs are three different metrics, and the union grows with K — so our arm's volume would rise with K while CodeRabbit's stayed fixed |
| `assertRunMatchesCorpus` | `runs/` must never be globbed. Selecting by `run_id` is half the protection; checking the run says it replayed *this* corpus version is the other half |

`pin()` checks the three literals this file compares against — `"after-window"`,
`"unstated"`, `"no-gate-in-arm"` — against the modules that own them, **at import
time**. This is lesson 7 applied to a string rather than a field: `assertEffort`
failed not because its rule was wrong but because its input stopped arriving, and
a guard that greps for a renamed value never fires and never complains.

**Labelled, not refused:** a partial or capped run, items the run never reached,
and items excluded for not being `status: "ok"`. Each lands in
`completeness.reasons` with the item that caused it, and a partial result exits
non-zero so a pipeline cannot quote it as a complete one by ignoring stderr.

## Corrected while building

**Three things were wrong, and two of them were wrong in my own code.**

### 1. The completeness check pooled the two arms — and reported this pilot COMPLETE

The first working version computed coverage as *"which corpus item ids appear in
any row?"*. At the time only pr-524 had been replayed, so the CodeRabbit arm
covered all seven pilot items and ours covered **one** — the union was seven of
seven and the result printed `COMPLETE`. That is precisely the failure this PR
exists to prevent, produced by the PR that exists to prevent it, and it was
invisible until the real store was pointed at it.

Coverage is now **per arm**, plus an explicit `items_comparable` — the items every
arm was scored on — printed as the report's first line, because it bounds every
cross-arm sentence anybody will write from the rest of the output. The remaining
six items landed while this was being built, so the pilot now reads `COMPLETE`
honestly; the guard is what makes those two states distinguishable.

### 2. `run.json`'s `status` is not a statement about corpus coverage

Constraint: *read `run.json`'s status and refuse or label accordingly.* Doing only
that is not enough. `pilot-01__k1` reports `status: "complete"` with
`item_count: 1` — true of the run, whose `--items` named one PR — while the corpus
it names holds seven. `RUN_STATUSES` describes *"every planned item is stored"*,
and the plan is whatever was asked for. So coverage is computed from the item
sets and `run.status` is carried **beside** it rather than trusted as it.

### 3. A rename-only file block made the geometry parser refuse a valid item

Found by mutation testing, not by design. A pure rename emits `diff --git`,
`similarity index`, `rename from/to` and **no `+++` line at all**.
`changedFilesFromDiff` counts that file off the git header; the first version of
this parser registered files only on `+++`, so the two disagreed and the
consistency guard refused the whole item — an over-refusal on input `gh pr diff`
really produces. Files are now registered at the header with no post-image, and a
`+++ b/<path>` upgrades the entry.

That also renamed a basis: `file-deleted-in-diff` → **`file-has-no-post-image`**,
because it has two causes (a deletion, or a rename/mode change with no content
hunk) and naming it after one of them is the mistake this project keeps making.

### 4. Both arms have a severity floor, and only one of them is visible the obvious way

`severity_raw` looked like an arm-agnostic way to ask "did the reviewer state
this severity?". It is not: on a CodeRabbit record `severity` and `severity_raw`
are **always equal** — both derive from the single severity the adapter hands the
builder, after it has already translated — and `finding-record.mjs` says so in
place. Only `coderabbit.severity_basis` sees that arm's floor.

Our arm has a floor too, and nothing names it: `normalizeSeverity` maps anything
unrecognised to `major`, which **blocks**. A lens emitting `"moderate"` lands in
the blocking population with `severity_raw: "moderate"` as its only trace. So
`severityIsStated` has two branches, one per arm, each with its own test. On the
pilot both are guards rather than corrections — 30 of 30 CodeRabbit records carry
a header-field severity and 9 of 9 panel records state a known one.

## The numbers

Measured 2026-08-11 against the real store, corpus `2026-08-10-pilot-reviewed`,
run `pilot-01__k1` (7 items, all `status: "ok"`, novelty gate **on**, $32.91),
population `reported`. **The result is `COMPLETE` and exits 0: both arms are
scored on all seven items.**

```
volume & mix · corpus 2026-08-10-pilot-reviewed · population reported · COMPLETE
  7 of 7 corpus item(s) scored on EVERY arm: pr-415, pr-429, pr-465, pr-471, pr-524, pr-549, pr-605
```

| | panel, gate on | CodeRabbit |
|---|---|---|
| Findings, 7 items | **142** | **30** |
| Per item, min/median/max | 9 / **21** / 33 (mean 20.29) | 1 / **5** / 7 (mean 4.29) |
| Per 100 diff lines | pooled **4.22** over 3361 lines; per-item median 4.55 | pooled **0.89**; per-item median 1.10 |
| Severity (stated) | major 36 · minor 89 · nit 17 | major 3 · minor 13 · nit 14 |
| Nit ratio | 106/142 = **0.746** | 27/30 = **0.900** |
| Localisation | 113/142 = 0.796 — **27 of the 29 are `unresolvable`** | 30/30 = 1.000 |
| Scope: anchored in-diff | **102/142 = 0.718** | **30/30 = 1.000** |
| Restatement | n/a (n=0), all `arm-records-no-rounds` | n/a (n=0), all `single-round` |

**The headline is the volume asymmetry: 142 findings against 30, a median of 21
per pull request against 5.** Spec §4.1 predicted this shape from live data (a
panel median of 30 against CodeRabbit's 2) and it holds on the replayed corpus at
a smaller ratio — so **CodeRabbit's findings bind every per-finding cell**, and
that is a result rather than a footnote.

Four readings that must travel with those numbers:

- **CodeRabbit's 100% in-diff and 100% localisation are partly structural.** An
  inline review comment can only be posted on a diff line. Our arm reads the repo
  **tree** (`repo_context: tree`, 2907 files on pr-524), so it can and does comment
  on code the pull request never touched — 27 of its 142 findings cite a real
  repository path outside the frozen diff. Those are the `unresolvable` 27: not
  failures to cite, but citations a corpus item **cannot check** without the tree.
  This is exactly why `LOCALIZATION` has three values, and the bucket was empty on
  the one-item run that the vocabulary was designed against.
- **Only 2 of 142 findings are genuinely unlocalised** — one with no file, one with
  no line. Our arm's real localisation failure rate is 2/142, not 29/142, and the
  report now prints the `unresolvable` count beside every rate for that reason.
- **14 of CodeRabbit's 30 findings come from review bodies and 2 from a retired
  header vintage.** Without the parser work in #714 and #719 this arm would read
  16 rather than 30. No *"CodeRabbit found fewer things"* statement is a property
  of CodeRabbit.
- **The window census is now `in-window=30 · unplaceable=0 · after-window=0`,**
  re-read after #771 landed rather than carried over from a note. Before it, pr-415's
  three findings read `unplaceable`, because a force-push removed the reviewed commit
  from the pull request and `placeInWindow` could not order what was not in the list.
  **No metric in this document moved** when that changed: `window` is reported and
  asserted here, never scored, and the assertion refuses only `after-window`. The
  report prints the census for exactly that reason — a scorer that silently accepts
  either one is the failure this project keeps repeating.

**And one caveat this module structurally cannot state.** Lens coverage is not
uniform: five of seven items ran all six lenses, pr-415 ran five, and **pr-524 ran
two** — `design-fit`, `test-adequacy`, `blast-radius` and `docs` all report
`applicable: false, conclusion: "skipped"`, and all four are `blocking: true`. So
pr-524's 9 findings and pr-465's 33 are not measured over the same reviewer.
Lens applicability lives in `payload.panel` and no field of the finding record
carries it, so a scorer reading records cannot qualify its own denominator here.
It is finding 3 below, and it is the largest unstated qualifier on our arm's
volume figure.

### Which of these numbers a reader may quote — measured, not asserted

The pilot has **three complete replicates** of the same reviewer (`panel_sha`
`46da673dd`, `config_hash` `sha256:1c7853debf4e…`, corpus
`2026-08-10-pilot-reviewed`) over the same seven items. That makes the run-to-run
spread of every figure above measurable, and the answer splits sharply:

| | k1 | k2 | k3 | spread |
|---|---|---|---|---|
| Findings, arm total | 142 | 147 | 139 | **+5.8%** |
| Per 100 diff lines, pooled | 4.22 | 4.37 | 4.14 | +5.6% |
| Nit ratio | 0.746 | 0.762 | 0.763 | ±1.7pp |
| Localisation | 0.796 | 0.823 | 0.813 | ±2.7pp |
| Anchored in-diff | 0.718 | 0.728 | 0.741 | ±2.3pp |
| **`critical` findings** | **0** | **3** | **1** | — |

Per **item**, the same data moves far more: pr-549 is 12 · 20 · 16 (**+67%**),
pr-471 is 21 · 14 · 18 (+50%), pr-524 is 9 · 13 · 9 (+44%); the tightest is pr-415
at 26 · 24 · 27 (+13%).

**So the arm-level rows are quotable and the per-item cells are not.** A per-item
count is one draw from a distribution, not a property of the item — which is why
every per-item row in the report carries its `run_id` (`pr-549@pilot-01__k2`) and
why the segment heading names the replicate. It is also why this module **refuses**
to pool replicates rather than averaging them: choosing between a mean, a union and
an intersection over K runs is the reliability scorer's whole question, and the
union in particular would make our arm's volume grow with K while the other arm's
stayed fixed.

**`critical` is not a structurally empty bucket.** Replicate 1 produced none across
142 findings and it would have been easy to read that as a property of the panel;
replicates 2 and 3 produced 3 and 1. Nothing in this module or its tests asserts
that `critical` is absent, and one test exists specifically to prove the bucket is
live and does not leak into the nit ratio.

## Fail directions

| When this fails | What happens | Why that is the safe way |
|---|---|---|
| A record's population, window, replicate or corpus disagrees with the scoring unit | **Throws**, naming the records and the items | A scorer that cannot state its denominator must not emit a number. Every one of the four is a subset that produces a plausible result |
| The vocabulary a guard compares against is renamed upstream | **Throws at import**, before anything is scored | The alternative is a guard that runs forever and never fires |
| The hunk parse and `changedFilesFromDiff` disagree about a file | **Throws**, and the item is unscored | A missed file silently moves every finding on it from `in-diff` to `outside-diff` — a number about our own arm, moving in the direction that flatters the other one |
| A corpus item is not frozen under this root | Its localisation and scope read `item-unavailable`; the item still reports its volume | A read path degrades to less information, never to a confident wrong answer |
| A replay ended `error`, or its population is `absent` | The item is reported with its reason and **excluded from every pooled figure** | An `error` item is not a zero. A clean review — `present`, zero records — *is* a data point and stays poolable |
| A panel item's envelope status is not supplied | Excluded, basis `item-status-unknown` | An `error` item with zero findings is indistinguishable from a clean one at the record level, so unknown must not be pooled as `ok` |
| Any rate has no denominator | `ratio: null`, printed `n/a (n=…)` | `0/0 → 0.000` is what a blank cell looks like when nobody wrote that branch, and it reads as a measurement |
| A path is C-quoted (`+++ "b/na\303\257ve.ts"`) | **Throws** via the consistency guard | A refusal to score, not a wrong score. The fix is to export `stripDiffPathPrefix`/`unquoteGitPath` from `extract-corpus.mjs`; no pilot item has such a path |

## Explicit non-goals

- **No labels, no adjudication, no ground truth** — and therefore no precision,
  recall or F1. That is what makes this shippable today.
- **No cross-arm matching.** Overlap, unique-to-arm and severity agreement need
  `finding-match.mjs`'s looser "same defect, said differently"; identity and
  similarity are two jobs.
- **No segmentation grid, min-n suppression or Wilson intervals.** This emits per
  item and per arm; cutting those by defect type, diff size or file class is the
  segmentation engine's.
- **No aggregation across replicates.** Refused, with the reason.
- **No latency.** `sdk_duration_ms_sum` is in the envelope and is **not**
  wall-clock; the field this module does not touch is the one that would report
  our own arm 3–5× slow.
- **Nothing written.** Scores are derived data, recomputable from immutable inputs.
- **No adapter, `finding-record.mjs` or `harvest.mjs` edit.** Where a metric wanted
  a field they do not expose, it is reported below rather than added.

## Three findings for the modules this consumes

None is fixed here, because all three are edits to merged files this change has no
other reason to touch.

1. **`panelRecords` does not return the envelope's `status`.** It rides on each
   record as `panel.item_status`, so an item that ended `error` with **zero
   findings** carries its status nowhere a scorer can see — and that is exactly the
   item decision 8 most needs to exclude. The CLI works around it by reading the
   envelope from the store. One field on the per-item return would close it.
2. **`stripDiffPathPrefix` and `unquoteGitPath` are private to
   `extract-corpus.mjs`**, so any second reader of a diff's file paths either
   re-implements git's C-quoting or refuses the quoted case. This one refuses.
3. **No finding record says how many lenses ran.** Lens applicability is in
   `payload.panel` and nothing carries it onto a record, so a volume number for our
   arm cannot state whether it is over six lenses or two — and on the one item
   replayed so far it is two. This is the largest unstated qualifier on our arm's
   headline figure and it is not fixable inside a scorer: the record needs the
   field, or the per-item read needs to return the lens census beside the records.

## Verification

- [x] `agent:tests` — **1660 tests (1605 + 55), 1660 pass, 0 fail, 0 skipped**,
      against a freshly measured `main` (`64ac5d499`) at **1618 (1563 + 55) /
      1618 / 0 / 0**. **+42.** Two invocations because #774 split
      `eval/run.test.mjs` into its own `node --test` run; the lane command was
      re-read from `scripts/verify-self.mjs` rather than carried over, since it
      moved after this branch was cut. Both trees extracted with `git archive` and
      given identical `node_modules`, so the skip count is 0 on both rather than an
      environment artefact.
- [x] Measured on a **merge preview** — `main` at `64ac5d499` (with #771, #772 and
      #774 merged) plus this branch's four files — so the numbers describe the tree
      that will exist after merge, not the older base the branch was cut from.
- [x] `eslint scripts` exits **0** on that tree, at the pinned 9.24.0.
- [x] **Mutation testing: 47 mutations, 47 caught, 0 survivors.** 40 of them were
      run against the revision before the reporting changes above; the 7 covering
      the three tests added for those changes were run against the current one. Two
      of the original 40 survived their first pass and neither was fixed by
      weakening a test:
      - `line <= end` → `line < end` in the hunk-range test changed a real answer
        (a citation on a hunk's **last** line) that no test exercised. Test added.
      - Removing the zero-diff-line density guard led to the **rename-only parser
        defect** above, which is a code fix and two tests, not a test.
      One test — the context-line semantics of `in-diff` — adds no mutation coverage
      the boundary test does not already give; it is there to state the rule
      executably, and that is said here rather than claimed as coverage.
- [x] Reproduced both adapters' published censuses from the real store before
      scoring anything, and again after the remaining six items landed: CodeRabbit
      `30 records, in-window=27 unplaceable=3, major=3 minor=13 nit=14`.
- [x] Scope discipline **cross-validated against `novelty.origin`**, which git
      computed during the replay independently of this module: 33 of 35 comparable
      pairs agree, and both disagreements are context lines inside a hunk.
- [x] All 27 `file-not-in-item` findings **hand-checked** against each item's
      `changed-files.txt`: every one cites a real repository path the frozen diff
      genuinely does not touch. Not a path-normalisation artefact.
- [x] A partial run produces a **labelled** partial result and a non-zero exit —
      unit-tested, and observed for real on the 1-of-7 store before the run
      completed.
- [x] `gate_state` segmentation tested, including that gate-off and gate-on
      produce two segments and that nothing adds them together.
- [x] **Three replicates exist and the refusal to pool them is exercised against
      real data**, not just unit-tested: each of `pilot-01__k1/k2/k3` scores on its
      own and the run id is on every row. What remains unverified is any AGGREGATION
      across them, deliberately — that is the reliability scorer's.
- [ ] **Not verified: any item with `status: "error"`, an absent population, or an
      unstated CodeRabbit severity.** All three paths are unit-tested; all seven
      pilot items are `ok`, so the corpus exercises the happy subset of each.
- [ ] **Not run:** `verify:fast`, `verify:browser`, `verify:integration`. Nothing
      here can affect them and CI runs them regardless.
