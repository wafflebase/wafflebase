# Persist scores and render a comparison report — `eval/report.mjs`

## The problem

`scripts/agent/eval/store.mjs` has documented two directories since #677 and **nothing
has ever written to either of them**:

```
scores/                 metrics — RE-SCOREABLE, never written under runs/
  per-run/<run_id>/<scorer_id>.json
  by-config/<config_hash>__<corpus_version>/<scorer_id>.json
reports/<comparison_id>.md   static A-vs-B comparisons
```

`EvalStore` exposes eleven methods and not one of them is a score or a report method:
`putCorpusItem`, `putCorpusManifest`, `getCorpusItemInput`, `getCorpusManifest`,
`getCorpus`, `listCorpusItems`, `putRun`, `getRun`, `putItem`, `getItem`, `hasItem`,
`listItems`, `listRuns`. The three merged scorers (`volume-mix.mjs`,
`complementarity.mjs`, `reliability.mjs`) each say the same thing in their own words —
*"Reads only; writes nothing into the store"* — so **every metric this project has
computed exists only as terminal output.**

Two consequences, and the second is the one that matters:

1. **A metric cannot be re-scored against its predecessor.** #780 moved the pilot's
   defect-class count from 219 to 245 with no model call. That is the cheap half of
   this benchmark working exactly as designed — and there is nowhere to file either
   number, so the delta lives in a chat log.
2. **A report assembled by invoking the scorers would not be reproducible, and would
   fail silently rather than loudly.** `complementarity.mjs` and `volume-mix.mjs` reach
   the CodeRabbit arm through `adapters/coderabbit.mjs`, whose `corpusRecords` calls
   `gh api`. With no repository context that adapter yields **zero CodeRabbit records
   and a plausible empty result** — not an error. So a renderer that fetched would
   print a one-armed comparison that looks exactly like a two-armed one.

## The change

Three files. Nothing existing is modified except `store.mjs`, which gains methods.

**`store.mjs` — `putScore` / `getScore` / `putReport`.**

- 🔴 **`scores/` and `reports/` are RE-WRITABLE**, deliberately and against the grain
  of the rest of the module. `putRun`'s refuse-on-conflict discipline is not copied,
  and its reasoning does not transfer: `putRun` refuses a differing `config_hash`
  because two reviewers' items must never be filed under one run id, which is a
  statement about an *observation* of a non-deterministic judge. A score is a
  *derivation* over observations that remain immutable underneath it. Argued at
  `SCORES_DIR`, because the next reader will assume the store is uniformly write-once
  — two of its three write paths are.
- **Every path component is validated by the existing `requireSegment`**, not
  sanitised, and not by a second validator. `<scorer_id>` and `<comparison_id>` arrive
  from a command line, and `reports/../../README.md` built from an unvalidated one
  writes outside the store.
- **`configHashSegment` derives `sha256-<hex>` from `sha256:<hex>`.** This is *not*
  the fork's `[:/\\] → -` mangle that `_runDir` condemns: the input is refused unless
  it matches `SHA256_TEXT` first, so over that fixed-width domain the map is
  **injective** — the only colon is at index 6 and no hash can spell a `-` there. It
  also matches the `sha256-…__smoke` artifact already on disk from the fork era, so
  the store keeps one naming convention rather than gaining a second.
- **`writeFileAtomic` is reused**, not re-implemented. A half-written
  `reliability-v1.json` that happens to parse is a metric nobody can tell from a
  complete one.
- **An empty report is refused.** A zero-byte file at a path that exists reads as *"the
  comparison produced nothing to say"* rather than as the failed render it is.

**`report.mjs` — persist, then render.**

- **`--persist` files a scorer's `--json` verbatim**; the renderer reads `scores/`.
  The module never imports a scorer's compute path, so the render is offline and
  reproducible. `report.test.mjs` drives it with plain objects and no store at all.
- **🔴 The renderer is TOLD what to expect; it does not discover it.** `--run-id` and
  `--config-hash` are required on the render path even though the store could be
  listed. Absence is the thing this report must be able to say — of five sections, two
  have no scorer built — and **absence is only observable against a declared
  expectation.** A renderer that rendered whatever it found would omit an unbuilt
  scorer's section silently, and a reader cannot tell an omitted section from a
  measured zero.
- **Four availability states, because a blank cell is none of them.** `present` (which
  includes a real measured **zero**), `not-computed` (nobody measured it),
  `not-measurable` (structurally impossible on this data), `suppressed` (measured and
  withheld for a thin denominator). Lesson 6 applied to presentation: an empty table
  cell could mean any of the four, and a reader acts differently on each.
- **`figure(value, n, unit)` refuses without `n` and without a unit.** Decision 33 and
  decision 28 turned into a constructor rather than a convention — on this data
  reproducibility *reverses* between file level and finding level, so a unitless
  figure is ambiguous between two true answers that point opposite ways.
- **No clock.** A `generated_at` would make two renders of one dataset differ in bytes,
  so a re-render could not be diffed against its predecessor to show that nothing
  moved. The report is identified by its comparability key instead.
- **`comparison_id` is derived from `(config_hash, corpus_version)`** via the store's
  own `byConfigSegment`, so the report file and the `scores/by-config/` directory it
  renders from are named by one rule, and the reviewer pair is printed in the header.

## Corrected while building

**① The arm ratio picked a replicate, and the choice flattered our arm.** The first
draft divided by `Math.max(...panelValues)` and published the pilot's headline as
**4.9×** where the project's own figure is **4.7×** — because the maximum is k2's 147
and the published number is k1's 142. Small, invisible to any reader, and in the
direction that favours us. The panel produced three counts, so the ratio is three
ratios and the **range** is what is printed (`4.6×–4.9×`, which contains 4.7×). A test
now pins the range and asserts the single-aggregate form is absent.

**② A `not measurable` cell tripped a merged CI guard, and the guard was right to
fire.** `ask.test.mjs`'s *"no module under scripts/agent statically imports a
third-party package"* matched `eval/report.mjs → not computed`. Its `WITH_FROM` regex
is `/^\s*(?:import|export)\b[^;]*?\sfrom\s+["']([^"']+)["']/gm`, and `[^;]*?` spans
newlines — so a refusal message reading *"…indistinguishable from 'not computed'"*,
sitting after `export function notMeasurable(reason) {` with no intervening semicolon,
parses as a static import of the package `not computed`. **The message was reworded;
the guard was not touched.** Worth knowing before someone weakens it: any prose
containing ` from "…"` after an `export`/`import` line trips it, and the false-positive
rate is a property of that regex rather than of this file.

**③ `repeated()` prepends its own dashes.** Called as `repeated(argv, "--run-id")` it
returns `[]`, and the per-run persist failed with *"run id must match … got null"*.
Reused from `reliability.mjs` rather than copied — two implementations of this already
exist in `eval/` (`complementarity.mjs`'s is `runIdsFrom`) and a third would be the one
that drifts.

**④ `--dry-run` returned before the exit code was set**, so a dry run over two absent
sections exited 0. That is the wrong way round: a dry run writes nothing but prints the
whole report to stdout, which makes it the mode most likely to be piped somewhere. The
exit code is now set before the branch.

**⑤ Reaching into a cell without asking whether it held a value** rendered *"reproduces
on undefined of undefined items"*. Every table row now goes through `renderCell` /
`renderValue`, so a scorer that omitted a figure prints why.

**⑥ The report's own metadata table had empty header cells** (`| | |`), which violated
the no-empty-cell invariant the report asserts about itself. Named columns now.

**⑦ Mutation testing found a real gap in the write/read asymmetry.** Deleting
`_scorePath`'s `requireSegment("scorer id", …)` left every test green, because
`putScore` validates twice — `validateScore` checks it first. But **`getScore` never
calls `validateScore`**, so `_scorePath` is the only guard on the read path, and a read
escapes the store just as effectively as a write. A `getScore` traversal assertion was
added and the mutation is now caught.

**⑧ Two of the handoff's figures are of different vintages.** Its *"21.9% in all three ·
50.7% in exactly one"* are the **pre-#780** grouper's numbers, quoted beside a
**post-#780** Jaccard (0.438 · 0.434 · 0.430). Measured on current `main` the recurrence
figures are **56/245 = 0.229** and **118/245 = 0.482**, which match `STATE.md`'s own
predicted post-#780 values exactly. The rendered report carries the measured ones.

**⑨ Review found a partial per-run set was silently dropped.** The CLI filtered the `null`
placeholders out of the per-run score array, so with 2 of 3 `volume-mix-v1` files present the
section rendered *"panel — 2 replicates"* and a two-value range while the document's own header
table listed three — the only trace of the third was a line on stderr. The comment directly above
the code said it must not do this. The nulls are passed through now, `volumeFigures` counts the
holes, and the section states them **on the page** above the table.

**⑩ The total row ignored a guard every severity row honoured.** `coderabbit_total` and
`pooled_ratio` used `replicates[0].coderabbit` unconditionally, so when the CodeRabbit arm read
differently across replicates every severity row correctly said *"not measurable"* while the
**bold total** underneath printed a confident ratio over a denominator the same function had just
declared unreliable. The bold row is the one a reader quotes. Both now take the same guard and the
same reason string, hoisted to `INCONSISTENT_ARM` so the rows and the total cannot drift apart.

**⑪ `renderValue` protects an absent cell; it cannot protect a hollow one.** A `gate.agreement`
carrying `ratio` and `n` but no `k` reached the page as `**1.000** (undefined/7)`, and a
`recurrence.overall` missing `in_all` threw `TypeError` from inside the formatter and **aborted
the whole render** — the CLI exited 1 with no report at all. Guarded at extraction by
`isProportion` / `whyNotProportion`, which check field by field and name which half is missing.
The existing test believed it had ruled this out but only exercised `gate: {}`, which takes the
absent-object path; it now covers both hollow cases.

**⑫ The caveats hard-coded facts about one corpus.** *"One of the seven items… `pr-524`"* and
*"three values"* were emitted unconditionally, and *"contains all three"* likewise — while the CLI
accepts any `--corpus-version` and any number of `--run-id`. Rendering another corpus therefore
asserted a confound about items it had not measured, three lines under a header table printing the
real item list. `SELF_REVIEW_ITEMS` is now intersected with the corpus being rendered (and says so
when the intersection is empty), and both counts are derived. **Mutation testing found the gap in
the fix's own test:** K=1 takes a different branch and K=3 makes a hard-coded `3` identical, so
only a K=2 case discriminates — that case was added.

**⑬–⑯ Four refinements from plan PR 14's session (#808), which round-tripped 149 real
segmentation cells through `segmentationFigures` without editing this module.** The contract itself
needed no change — 149/149 cells rendered, none blank, `NaN` or `undefined`, and per-cell `min_n`
was the right call. What it found:

- **⑬ §5's caption was a false statement, and this module inherited it.** It read *"on a corpus this
  small every cell is expected to be suppressed"*. Measured: **76 of 149 cells report — 51%.** The
  prediction is true **per pull request**, where the fattest denominator on a 7-item corpus is 4
  items, and false **per finding**, where several buckets clear min-n on both arms. Decision 12 has
  carried the unqualified sentence since 2026-08-06; **decision 38** is the correction, and it is
  **decision 28 — name the unit — for the fifth time in three days.** Not our error originally, but
  this was the last place to catch it before the report has an audience.
- **⑭ `renderCell`'s `fmt` parameter was dead at all nine call sites**, and §5 is its first real
  consumer: every other section formats through its own `pct`/`num` inside a template string, so
  nothing had ever needed it. A real cell printed as `0.6944444444444444`. `num` is now passed **at
  the call site** and the default is untouched — changing the default would reformat CodeRabbit's
  measured `critical` zero as `0.000`, a precision this data does not have. ⚠ **The fixtures could
  not have caught it:** the only two values they ever fed `renderCell` were `0.229` and `0`, both of
  which `String()` renders correctly. A `25/36` fixture was added.
- **⑮ Decision 40 — two cross-arm rows measure GitHub, not a reviewer.** CodeRabbit's localisation
  and in-diff rates are exactly **1.000 in all 22 reporting cells**, because an inline review comment
  is anchored to a diff line *by construction*. So *"CodeRabbit localises 100%, we localise 80%"* is
  a fact about the comment API. #808 deliberately did not filter these out — which cells to show is
  the report's call — so it lands here, in §6 beside the radar refusal, being the same species of
  argument.
- **⑯ An axis nobody can build had no cell to live in, which inverted this module's own principle.**
  The four availability states existed per **cell** and not per **axis**, so `defect_type` — which
  needs adjudicated labels that do not exist — appeared in the scorer's console output and vanished
  from the published report. That is exactly the silent drop the docblocks argue against. The
  scorer's `axes` array is now rendered, each absent axis with the scorer's own reason.

**Validated against #808's real payload**, not only fixtures: 149 cells, 76 reported, 73 withheld,
`defect_type` rendered as declared-but-uncomputed, and no long decimal, `NaN`, `undefined` or blank
cell anywhere in a 320-line document.

## Fail directions

| When | What happens | Why that is the safe direction |
|---|---|---|
| A scorer has never been run | `getScore` → `null`, section renders **"not computed"** with the scorer named | A blank section would read as a measured zero. Two of five sections are in this state today |
| A score file exists and will not parse | **Throws**, naming the scorer and the path | `null` would tell a renderer nobody measured this when the truth is that the measurement is unreadable, and the report would print *"not computed"* about a number sitting right there |
| A quantity is structurally impossible (CodeRabbit retest pairs, a ratio against an arm that raised none of that severity) | **"not measurable"** with its reason | Distinct from *not computed*, because running a scorer would not help. `Infinity` or an em-dash would read as a ratio so large it proves something |
| A cell was measured and withheld | **"suppressed: n=2 < 5"**, with both numbers from the payload | The threshold belongs to the segmentation scorer; a default here would caption its grid with a number it no longer uses |
| A figure has no `n` or no unit | **Refused at construction** | It cannot be printed at all, which is stronger than a convention nobody checks |
| A re-score arrives | **Overwrites** | Re-scoreability is what `scores/` is for. A different reviewer lands in a different path by construction, so "re-score" and "different reviewer" are never the same write |
| A path component contains `..` or a separator | **Refused**, on both the read and the write path | The alternative writes outside the store |
| A section input is missing | Report renders, **exit code 1** | The absences are on the page, so the report is correct — but it is not the complete comparison, and a pipeline must not quote it as one by ignoring stderr |
| `--root` is absent | **Refused, no default** | Git history is permanent. This module must be structurally incapable of writing inside its own repository |

## Explicit non-goals

- **No new metric.** Every figure is a field of a scorer's payload. The only arithmetic
  is the min/max of replicate values (which decision 33 requires) and the
  severity-stratified count ratio (which §3.1 asks for), and both use helpers imported
  from the scorers that own them.
- **No segmentation engine.** That is plan PR 14. This renders its absence, and states
  what its output is expected to look like when it lands.
- **No cost or latency figure**, and no cross-arm ratio for either — ever, not merely
  until #791 merges. CodeRabbit is a flat subscription with no per-review price, and the
  two latencies measure different things with the bias in our favour.
- **No radar chart.** See the report's own limits section; the reasoning is on the page.
- **No `maybe` resolved and no pair label read.** They do not exist yet.
- **No CI workflow.** That is Wave 7.
- **Nothing in the gating path touched.** No scorer, adapter, lens, matcher or gate is
  modified.

## Verification

- [x] `agent:tests`, **two invocations, the way the lane runs them since #774**:
      **1737 (1736 pass · 0 fail · 1 skipped) + 55 (55 pass · 0 fail · 0 skipped)**,
      against a **freshly measured** baseline of **1696 (1695 · 0 · 1) + 55** on
      `upstream/main` at `d327ee410`. **+41 tests, +0 failures, skip count unchanged.**
      Both trees were extracted separately and had the same `node_modules` symlinked
      into them before either was measured.
- [x] `eslint scripts` (lockfile-pinned `9.24.0`) — **exit 0**, on both trees.
- [x] **51 mutations, 51 caught**, re-run against the final bytes of all four files.
      Two initially survived. Neither was dismissed as ineffective: one traced to the
      read/write asymmetry in ⑦, the other to the K=2 gap in ⑫. Both got the missing
      assertion.
- [x] **A re-score overwrites rather than refusing**, with the pilot's real pre- and
      post-#780 figures, and leaves exactly one file in the directory.
- [x] **A run item is still write-once**, so the score exception did not widen to
      observations.
- [x] **`../` in a `scorer_id`, a `comparison_id`, a `corpus_version` and a `run_id` is
      refused**, on the read path as well as the write path, and nothing is created.
- [x] **All four availability states render distinctly**, verified by fixture and again
      on the real pilot report, where three of them occur at once.
- [x] **The renderer runs with no network and no `gh` on `PATH`** — verified by
      rendering the real report under `env -u GH_REPO -u GITHUB_TOKEN -u GH_TOKEN` with
      `PATH` stripped to `node` plus `/usr/bin:/bin`.
- [x] **Every figure in the pilot report reproduces the project's recorded numbers**:
      142 · 147 · 139 panel findings against CodeRabbit's 30; majors 36 · 32 · 32
      against 3; overlap 3.6% · 2.3% · 3.0% with ceilings 21.1% · 20.4% · 21.6%,
      saturated on all three; gate agreement 7/7 = 1.000; Jaccard 0.438 · 0.434 · 0.430
      (range 0.008); routes agreeing on 21/21 item-runs and 111/111 lens checks. The
      two recurrence figures differ from the handoff's by the documented #780 delta —
      see ⑧.
- [x] **Verified from the committed tree**, not the working copy.
- [x] ⚠ **`eval/run.test.mjs` flakes on this machine, pre-existing and not from this
      diff.** Two END-TO-END cases (`a failed item KEEPS its raw panel output`, `a throw
      inside the item loop still deregisters the worktree`) fail intermittently: measured
      **2 of 4 runs red on `upstream/main` alone** against 1 of 3 on this branch, and this
      diff touches neither `run.mjs` nor `run.test.mjs`. It is the shared-state fault from
      #682 that snapshots `os.tmpdir()`. **Reported, not repaired** — fixing it inside an
      unrelated PR would make this diff unreviewable.
- [ ] **Not verified: atomicity under a real interruption.** The tests prove the rename
      happens (removing it goes red) and that no `.part-` debris survives a successful
      write, which is what is observable without killing a process mid-write.
- [x] **The segmentation contract is verified against a real producer**, not only fixtures —
      #808's payload regenerated from `reference/eval-segmentation-scorer.diff` and rendered end to
      end. ⚠ **No segmentation score is filed in the store**: #808 writes nothing (it needs this
      PR's `putScore` merged first), so §5 of the published report still reads *"not computed"* —
      now with its unit.
- [ ] **Not verified: the shape `cost-latency-v1.json` will have.** #791 is still open,
      so `costLatencyFigures` unpacks nothing beyond its identity fields and takes the
      absence path. When #791 merges the section grows; today it renders *"not
      computed"*, which is the honest state.

---

# Follow-up — render §4, and correct §2's adjudication budget

*2026-08-13, against `main` `1902133bf`. The section above shipped §4 as a single line
and said why: it could not render fields whose shape was still in review. Those fields
have been merged for a day and the section did not grow, so it has been rendering
`not computed` over a 32 KB payload that was sitting in `scores/` unread.*

## The problem

**§4 was the report's one blind section.** `costLatencyFigures` returned `cross_arm` and
a sorted list of the payload's key names. Everything the cost scorer measured — spend per
replicate, cost and wall clock per review, the cost-vs-size fit, the duration census, and
CodeRabbit's own latency — reached `scores/` and stopped there.

**And §2 contained a sentence that understated the adjudication work by an order of
magnitude:**

> *"The queue is 409 undecided pairs, of which 15 score ≥ 0.7 — so adjudicating this
> costs tens of pairs rather than hundreds."*

That conflates the two bounds of the band. The ≥ threshold head moves the **floor**, one
pair at a time. The **ceiling** does not move until a CodeRabbit finding has *every* one
of its pairs decided — until the last one is settled the finding could still turn out
shared. So the ceiling's budget is the queue attached to the undecided findings, which is
hundreds of decisions. **The sentence was wrong in the comfortable direction**, which is
why it survived review.

## The change

### §4 is two blocks that share no table, and the layout is the argument

Every instinct a reader brings to this section is one the data cannot support. They want
a cost per review to compare — there is no per-review price for a flat subscription. They
want a latency ratio — the two clocks time different things, and the honest version says
we are the slower one. **Put the two latencies in one table and the reader does the
division themselves**, so they are never in one table, never on one axis, and every
figure carries the name of the interval it was measured over rather than the word
"latency" alone.

| block | figures |
|---|---|
| **Our panel** | spend per replicate (n=3), cost per review (n=21), wall clock per review (n=21, interval named), replays with no wall clock (**0 of 21**), the per-replicate cost-vs-size fit |
| **CodeRabbit** | latency (n=7, interval named), the second anchor (n=5, and why it pools fewer), cost as `not measurable` with its reason |
| **Cross-arm** | `not measurable` **permanently**, and `cost_per_real_finding` as `not computed` with what would unblock it |

`not-measurable` rather than `not-computed` on the cross-arm row is the whole point: a
re-run does not close it. It is a **result**, not a hole waiting on a scorer.

### All four availability states, and a measured zero is `present`

- `present` — every panel figure, CodeRabbit's latency, **and `0` untimed replays of 21**.
  A measured zero and a blank cell are the same width on the page and opposite in meaning,
  so the row prints `0 of 21`: it says every replay was timed, which is a fact about the
  store rather than an absence.
- `not-computed` — `cost_per_real_finding`, in the scorer's own words, and CodeRabbit's
  latency on a payload written before the arm's read was wired in.
- `not-measurable` — CodeRabbit's cost, and the cross-arm row.
- `suppressed` — a cost-vs-size fit the scorer withheld for too few points, rendered with
  **both** the `n` it had and the `min_n` it wanted. Both come from the payload; a default
  here would caption the scorer's refusal with a threshold it no longer uses.

### §6 carries the n=2 production pair, and §4 does not

`PRODUCTION_LATENCY_PAIR` is listed, not derived — like `SELF_REVIEW_ITEMS`, and
intersected with the rendered corpus for the same reason. `pr-549` and `pr-605` carry
`agent-review-*` check runs on the frozen commit itself, so on those two the panel ran in
production from the same trigger CodeRabbit's second anchor uses: **ours 18.7 and 19.0
min against theirs 8.0 and 8.6 — about 2.2× longer.** §4's replay figures (9.3 against
6.8) therefore understate us by roughly that factor. **It is a stated limit on §4's
minutes, never a row inside it**: n=2 is far too thin for a claim, and promoting it would
swap one misleading number for another.

### §2 names both budgets

The floor's budget is the ≥ threshold head. The ceiling's is the pairs attached to the
findings that carry an undecided panel candidate — a count the payload already has. Both
numbers are read from the payload and each is labelled with which bound it buys, and the
sentence now says **hundreds of decisions, not tens**.

## Corrected while building

### 1. The exact ceiling budget is not derivable here, and saying so beat approximating it

The handoff asked for a specific measured figure — **334 pairs for k2**, from
`k2-budget.mjs`. It is not renderable, for three measured reasons:

- It deducts pairs owned by an **already-shared** CodeRabbit finding (68) and pairs
  **already carrying a gold label** (15). The first needs a per-finding pair count the
  complementarity scorer does not emit; the second needs the label store, which this
  renderer must not read.
- It was measured against a queue of **417**, at an unmerged head. The store's own
  payload reads **418** for the same replicate on today's `main`, and the queue moves
  whenever the matcher or the CodeRabbit records move.
- **Nothing here computes a number.** A constant in this file would survive every
  re-render unchanged while every figure around it moved — which is the defect the old
  sentence had, one order of magnitude larger.

So §2 states the reasoning and the bound it can support, and **names the deduction it is
not stating**. `complementarity.mjs` emitting a per-finding pair count would let a later
PR print the exact figure; that file is owned elsewhere and is not touched here.

### 2. A per-LINE no-ratio check passes the layout it exists to forbid

The cross-arm guard first asserted that no rendered line carried both intervals. Mutation
testing put the two arms' minutes in two **rows of one table** and the test stayed green
— which is precisely the layout the recorded decision forbids. A reader divides what is
next to each other; they do not need it on one line. The check now works per **table**,
and rejects both a shared interval name and a shared pair of rendered minute values.

### 3. The `suppressed` threshold looked read and was not

Hard-coding `3` passed every assertion, because the fixture's `min_n` is 3. That is the
exact defect `suppressed`'s own docblock warns about. Found by mutation; the test now
asserts against a payload whose threshold is 6.

### 4. `renderCell` already bolds its absences

The first draft wrapped it in a second pair of asterisks, which markdown collapses into a
literal `*`. Caught in the real render, not by a test — the tests asserted the words and
not the marker.

## Fail directions

- **No score file** → the section renders `not computed` with the reason, as before.
- **A schema-1 payload** (no latency block) → the latency cell degrades to `not computed`
  with the payload's own reason, and the panel's figures still render. A renderer that
  crashed on last week's score file could not be diffed against it, which is what this
  module's purity buys.
- **A latency figure with no interval name** → **refuses**. The caption and the number
  must fail together; a fallback constant would keep printing the old interval after the
  scorer changed which instant it starts from.
- **A corpus without `pr-549`/`pr-605`** → §6 says it could not bound §4's minutes on this
  corpus, rather than asserting two timings about items that are not in it.

## Explicit non-goals

- **No cross-arm ratio**, in any form. A test constructs both arms' figures and asserts
  the rendered §4 contains no quotient of them and no table holding both.
- **The 2.2× production figure is not a headline.** n=2, and it is in the limits.
- **No timestamp.** `buildReport` and `renderReport` stay pure and clockless, so two
  renders of one dataset differ only where the data differs.
- **The understated spend total is still not printed as a total.** `$92.93` does not
  appear. What §4 prints is the scorer's per-replicate spend **series** with an `n`, and
  the standing caveat about deleted envelopes remains in §6 — see the note below.
- **`complementarity.mjs`, `pair-labels.mjs`, `labels.mjs` and `store.mjs` are untouched.**

## A note on printing spend at all

The section above chose not to print a spend figure, because the store's total is known to
understate true spend by one deleted envelope and nothing inside the store can see by how
much. That decision was re-examined rather than inherited, and it is **kept for the total
and reversed for the series**: `$92.93` is a single accounting number a reader quotes as
"what the pilot cost", while `$30.49 ($29.53–$32.91) over 3 replicates` is a distribution
with its `n`, which is what the scorer measured. The understatement applies to both, is
the same size for both, and remains stated in §6.

## Verification

- [x] **`agent:tests`, both invocations, from the committed tree**: **1866 + 56 = 1922,
      0 fail, 0 skipped**, against a freshly measured **1857 + 56 = 1913** on `main`
      `1902133bf` — **+9**, both trees set up identically.
- [x] `npx eslint scripts` exits 0.
- [x] **Rendered against the real store, end to end**, over all three replicates: §4
      prints the panel's `$30.49 ($29.53–$32.91)` / `$4.17` / `9.3 min` and CodeRabbit's
      `6.8 min (2.6–14.4)`, each with its `n` and its interval.
- [x] **Rendered against the real store with a schema-1 cost payload too**, which is what
      is committed there today: the panel's spend and fit still render and the latency
      cell prints the scorer's own reason. **B1 does not depend on B2.**
- [x] **18 mutations, 18 caught**, including the two that were the point: a cross-arm
      ratio as a sentence, and the two arms' minutes in one table.
- [x] The report still has **no clock** — the byte-identical re-render test passes
      untouched.
- [ ] **Not verified: `suppressed` on real data.** No replicate has fewer than 3 priced
      items, so that cell is unit-tested only.
- [ ] **This PR renders; it does not re-render.** The published report under `reports/`
      does not change until somebody re-runs the scorers and the renderer against the
      store. That is not this PR's job and it is deliberately not done here.
- [ ] **Not run:** `verify:self`, `verify:fast`, `verify:browser`, `verify:integration`,
      `build`.

## Review round — five defects fixed, three findings declined

*2026-08-13. Thirteen findings from the review panel; six were three restatements of two
root causes. Every one was checked against the code before being actioned.*

### 5. A refused fit was labelled STRUCTURAL rather than re-runnable

`fitCell` fell through to `notMeasurable` when the payload stated no `min_n`. That reads
as *"no such quantity exists however long anyone runs anything"* — and a third priced item
disproves it outright. The label decides what a reader does next: stop, or score more
replicates. The fallback is now `notComputed`; `suppressed` is used only when the payload
states the threshold it failed, which keeps the fourth state honest without inventing a
number. The no-spread-in-x refusal takes the same path, for the same reason.

### 6. §6's latency caveat was gated on the wrong arm

It required **CodeRabbit's** latency to be `present`, so any score file carrying our wall
clock and not theirs lost the caveat entirely — fallback included. That is the payload
where it matters most: §4 prints our minutes and nothing bounds how they may be read
against a figure the reader already has. The gate is now "either arm rendered minutes".
With neither arm's minutes it stays silent, which is correct rather than arbitrary: a
caveat about minutes has nothing to attach to. On today's committed score file §4 prints
no minutes at all, so the section is silent for that reason and not by accident.

### 7. A latency cell took its `n` from the parent of the series it validated

`series()` checks `ms.n`; the cell then printed `self_timed.n`. Equal in today's producer,
so invisible — and a payload carrying `ms` without the sibling count made `figure` refuse
and aborted the whole render. Validating one number and printing another is how a
denominator drifts silently. Both cells now read the series' own `n`.

### 8. Interval enforcement was asymmetric

CodeRabbit's minutes refused without an interval name; ours fell back to the literal
`unnamed`. Ours is the figure a reader is likeliest to quote against theirs, so an unnamed
interval here is precisely how the two come to look commensurable. Both refuse now.

### 9. The production ratio was hard-coded beside the numbers it came from

`2.2x` was asserted next to `18.7 / 19.0` and `8.0 / 8.6`. Recomputed from those four
values the mean ratio is **2.3×**, so the sentence contradicted its own inputs — and the
kit's 2.2× turns out to come from a different figure (the 17.8-min production *median* in
`agent-review-panel.yml`'s header), not from this pair. It is now derived from the constant,
so editing a minute value moves it and it can never disagree with the pair it summarises.
This is the one place a cross-arm latency ratio is legitimate, and only because both sides
are the same interval — production, from one trigger. The test recomputes it rather than
pinning a literal, because a literal assertion happily agreed with the wrong number.

### Declined — §4's payload shape. ⟳ AND THE PREMISE EXPIRED WHILE THIS WAS BEING WRITTEN

Three findings said §4's pooled keys, the latency block and `min_n` are absent from the
merged scorer, so the section could only ever render `not computed` for its headline
figures.

**That was true of `main` `1902133bf` and is no longer true of `main`.** The scorer-side
change merged at 2026-08-13T08:05Z, and `main` `bb07acd4` now exports `MIN_FIT_ITEMS` and
emits `panel.review_wall_ms`, `panel.review_cost_usd`, `panel.latency_interval` and
`coderabbit.latency.self_timed` — checked against the file at that sha rather than assumed.
So the producer these paths were written for exists, and every one of them is reachable on
real data. **The findings were correct when raised and are now obsolete.**

They were declined on their merits before that landed, and the reasoning is kept because it
is what a reader needs if the question comes back:

- §4 rendered each missing field as an absence **with the scorer's own reason**, which is
  the required behaviour rather than a failure. The figures were not "in the payload but
  unrendered" — the payload did not contain them.
- **Reading the per-replicate `review.wall_ms` instead** was rejected: those existed, but
  that payload named no interval for them, and publishing our minutes without their
  interval is the one thing decision 35 forbids. An absence with a reason beats a figure
  that cannot say what it measured.
- **Deleting the paths until the producer landed** was rejected: they would have to be
  rebuilt to render the same section, and the report's design is that a section states what
  it expects and reports the gap.

⚠ **One consequence for finding 5 above.** `min_n` now arrives, so the `not-measurable`
mislabel it fixed is no longer reachable from the pilot's own scorer. The fix stays,
because the renderer must not depend on a producer choosing to state its threshold — but it
is now a robustness guard rather than a live bug, and this doc should not claim otherwise.

### Re-verification

- [x] **1959 + 56 = 2015, 0 fail, 0 skipped** from the committed tree, against **1952 + 56
      = 2008** measured on this branch's own head before the review round — **+7**, both
      trees set up identically. `eslint scripts` exits 0.
      ⟳ **Re-measured against the branch tip rather than `main` `1902133bf`.** An
      *Update branch* merge landed on the pull request at 08:00Z and brought 53
      `scripts/` files with it, so the earlier baseline of 1857 describes a tree this
      branch no longer has. Neither `report.mjs` nor `report.test.mjs` was among the 53
      — checked before rebuilding on the merge rather than over it.
- [x] **Rendered end to end against `main`'s merged scorer** (`bb07acd4`, which is #791's
      successor merged at 08:05Z): §4 prints the panel's `$30.49 ($29.53–$32.91)`,
      `$4.17`, `9.3 min` and `0 of 21`, and CodeRabbit's `6.8 min (2.6–14.4)` plus the
      second anchor's `6.7 min (2.8–14.8)`, each with its `n` and its interval. §6's ratio
      renders as the derived **2.3x**. Every path the review called unreachable is
      reachable on real data.
      ⚠ **This branch's own tree cannot show that yet** — it merged a `main` one commit
      short of that scorer, so on the branch as it stands those rows still read
      `not computed` with the scorer's own reasons. An *Update branch* would close the
      gap; that is the maintainer's button, not this commit's job.
- [x] **29 mutations, 29 caught** (18 original + 11 for this round). Five re-introduce the
      defects above and all five go red.
- [x] Two mutations survived the first pass and both were genuine test gaps, not
      ineffective mutations: the `not-measurable` fallback had no test, and the `n`-source
      fix needed a fixture where the series and its parent DISAGREE, since they are equal
      by construction in today's producer. Both now covered.
- [x] Re-rendered against the real store on the committed score file: the fit table, the
      measured zero and every absence read as before; §6 correctly silent because §4
      prints no minutes on that payload.

# Follow-up — §2 leads with the directional rates and renders the adjudicated band

*2026-08-20, on top of the two sections above. The complementarity scorer resolves
adjudicated pairs into a labelled band and files it under `labels` in its payload;
nothing read it. Three changes to this renderer: the figure a reader meets FIRST, the
figure that was computed and invisible, and one hardcoded limit whose premise went
false while its conclusion stayed true.*

## The problem

**① The section led with a Jaccard, and that figure is rhetorically wrong.** Its
denominator is the union, and on this data the union is mostly classes only the panel
raised — so the number falls when our arm says MORE, which is not disagreement. A reader
meets `3.5%` and concludes the two reviewers barely agree. The same three counts say
something else: on `pilot-01__k2` the panel raised 6 of CodeRabbit's 30 defect classes
before adjudication and 12 of 30 after, while raising 135 classes CodeRabbit never had.
**`8.2%` and `40.0%` are the same dataset**, and only the first is dragged by our own
volume.

**② The adjudicated band was computed, filed, and invisible.** `report.mjs` reads
`overlap.jaccard` and `unresolved.jaccard_upper_bound`, which are deliberately the
UNLABELLED figures — the scorer left them untouched so a consumer that had never heard of
a label renders what it always rendered. The consequence is that every hour of
adjudication was worth nothing on the page: the store holds 357 pair records, 43 of them
apply to `pilot-01__k2`, and the report said `3.5%`.

**③ §6's first limit was an assertion with no input.** It read *"No adjudicated labels
exist."* That premise is now false — 357 pair labels, 45 of them `gold` — while its
conclusion, that no precision figure appears anywhere, is still true. A sentence that
cannot go red when the world moves under it is lesson 1's exact shape, and this one was
one merge away from publishing a falsehood as a limit.

## The change

### §2 leads with two directional rates; the Jaccard sits beside them, labelled

A directional rate is `both / (both + <the other arm>_only)` — *"of everything THIS arm
raised, how much did the other arm raise too?"* — over four fields §2 already prints in
its own table. Two of them, in a table above the band table, each with its `n` and its
unit, per replicate and never pooled.

**The denominator is the point.** Each rate divides by the arm it describes, so neither
moves when the other arm gets louder; the Jaccard's denominator is the union, so it does.
That is stated on the page rather than left to be noticed, and it is checked by a test
that doubles the panel-only class count and asserts the CodeRabbit-side rate does not
move while the Jaccard nearly halves.

**A replicate with adjudicated pairs gets a SECOND row rather than an upgraded first
one.** `pilot-01__k2` appears twice — `unadjudicated` and `43 gold label(s) applied` —
because the movement from 6 of 30 to 12 of 30 is what adjudication bought, and one row
that quietly became the other would hide it.

### And the ceiling was arithmetic about the two counts, not a matcher limitation

One sentence, guarded to the saturated case where the identity is exact: with 30
CodeRabbit classes against the panel's 142, even a perfect match on every one of them
leaves `30/142 = 21.1%` — which is precisely `pilot-01__k1`'s ceiling. It reproduces all
three ceilings exactly, and it retires a figure this project has read as a property of
the matcher for a week.

### The adjudicated band, in its own subsection, with four things never separated from it

`labels.headline.band.after` is rendered beside the unlabelled band rather than instead
of it, per replicate. Four things travel with the number, because this is the first
figure in the report that is genuinely PARTIAL rather than absent — and a partial figure
does not protect itself the way an absent one does:

**THE TIER is a column.** `ANNOTATION-GUIDE.md` §6: a `silver` label is an AI
read-through *pending human confirmation* — *"usable but imperfect; do not treat as the
ceiling."* The scorer names the most trusted tier present as the headline and resolves
every other tier separately; both facts are rendered, the non-headline tiers unbolded
under a heading that refuses them as the band. **The store now holds a silver tier, so
this is not hypothetical: silver's ceiling MOVES on k2 where gold's does not, making the
unconfirmed band the tighter one.**

**THE CAUSE is words.** `pair-labels.mjs` distinguishes seven availability states. Five
render as `not computed` with their own sentence; two — `resolved` and `resolved-nothing`
— render as a figure, because a band that was looked at and did not move is a
measurement. `LABEL_CAUSE` is pinned against `LABEL_AVAILABILITY` at import time.

**`ceiling_moved` IS READ**, never inferred by diffing two percentages, and rendered in
both directions with its reason.

**THE DENOMINATORS travel with the band**: how many pairs were adjudicated out of how
large a queue, on how many replicates of how many.

### Two provenance counts that are not one fact

`census.keys_moved` counts pairs whose **address** changed when a finding's text was
re-parsed — the verdict is untouched and the label still applies through its alternate
key. `census.needs_readjudication` counts **verdicts** flagged as doubted. Today they are
**6** and **0**. They are rendered as two sentences bound to two fields, and a test swaps
the payload's two values and asserts the two sentences swap.

### §6's first limit is derived from the label census

Two kinds of label, and only one of them makes a precision figure: a **pair** label
answers *"are these two findings the same defect?"* and is what §2's band rests on; a
**validity** label answers *"is this finding real?"* and is what precision, recall and
correctness need. The store holds hundreds of the first and none of the second, so §6 now
states both counts, names the two questions apart, and draws the same conclusion it
always drew. With no pair labels filed it renders the original sentence unchanged — it is
a derivation, not a rewrite.

## Corrected while building

### 1. 🔴 The first draft printed the Jaccard point without its ceiling — and a test from #805 caught it

The lead table's last column held a bare `3.5%` under a `Jaccard` header. Demoting the
figure beneath the two rates does not make it safe to print unqualified: it is the LOWER
BOUND of an interval, and it was now the first number in the section. `report.test.mjs`
has asserted since #805 that no code path prints the overlap point without its ceiling,
and it went red. **The column holds a band.** The test's row count moved from 3 to 6
because §2 now has two tables of replicate rows; its assertion was widened to every one
of them and strengthened with a check that exactly three are the bolded band-table copies.

**This is the second time that invariant has earned its keep, and it was earned against a
change that had just spent four paragraphs explaining why the point must not be quoted
alone.**

### 2. The drift warning fired on the two replicates that were behaving correctly

`labels.headline.labels.unmatched` is 45 on `pilot-01__k1` and `pilot-01__k3` — every
label matches nothing there, because every label is `pilot-01__k2`'s. The first draft
rendered *"45 gold label(s) match no undecided pair"* under both, which is the definition
of `none-for-replicate` rather than a finding about it, and it buried the one that means
something: **2** on k2. `complementarity.mjs` makes exactly this exclusion for exactly
this reason, and this renderer now makes it too.

### 3. `ceiling moved: no` on a row with no band

The other-tiers table gave every row a yes/no. *"The ceiling did not move"* and *"there
is no band here to move"* are the same word and different facts — the distinction the
whole subsection is built on, one column to the right. A row with no band gets an
em-dash.

### 4. The exact ceiling budget is now derivable, and is still not printed

The section above declined to print it because the deduction needed a per-finding
undecided-pair count the scorer did not emit. **It emits one now** — one row per
CodeRabbit-only class under each tier's `resolution.{resolved,finished_apart,
still_undecided}[].pairs`. So the sentence saying the count does not exist became false
and is corrected. What still does not exist is a TOTAL, and summing an array is a number
the renderer computed: the invariant at the top of the file, and the reason the figure was
declined twice already. **The sentence names the field and still refuses the number**; a
test computes the total (263 on the fixture) and asserts it does not appear on the page.
The total belongs to the scorer that owns the arithmetic — one `reduce`, one field.

### 5. Two mutations that survived, one of them a real test gap

A mutation that reversed §6's central clause — *"only the second bounds this report"* →
*"only the FIRST"*, i.e. claiming the labels we HAVE are what precision needs — passed
every assertion. The test checked the counts and the two questions and not the claim that
joins them. Fixed with an assertion on the clause itself. The other survivor was
**ineffective rather than uncaught**: randomly re-sorting a three-element frozen array
usually leaves it in place, so the mutation often changed nothing. Re-run deterministically
with `.reverse()`, the ordering test catches it.

## Fail directions

- **A score file with no `labels` block** renders the subsection with its own stated
  cause and nothing else — no band table, no census sentences, no invented zeroes. The
  committed pilot score is such a file today, so this path is exercised on real data.
- **An eighth availability state, or a reordered trust scale**, breaks the import rather
  than rendering an empty cause or promoting a provisional band to the headline.
- **A label store that disagrees with itself across replicates** — impossible through the
  CLI, which reads it once per run — is reported on the page, and the counts printed are
  stated to be the first read's.
- **An arm that raised nothing** has no directional rate: `0/0` is `null`, not `0.000`,
  which would read as measured total disagreement.
- **A dropped or unreadable label file** can only widen a band, so its count is printed
  beside the bands it did not widen, including at zero.
- **A store that gains validity labels** changes what §6 says, because §6 now reads the
  census rather than asserting over it.

## Explicit non-goals

- **No pooling, and no labelled aggregate.** The `union` and `intersection` views carry
  no labels by construction and are not in the payload this renderer reads at all.
- **`complementarity.mjs`, `pair-labels.mjs` and `store.mjs` are untouched.**
- **No new metric.** The directional rates are a presentation of counts §2 already
  printed; the band is a field.
- **No re-render of the published report.** `reports/` does not change until somebody
  re-runs the scorers and the renderer against the store.

## Verification

- [x] **`agent:tests`, both invocations, from the committed tree**: **2245 + 56 = 2301,
      0 fail, 1 skip**, against a freshly measured **2224 + 56 = 2280** on the same base —
      **+21**. Both trees extracted separately with the same lockfile-pinned
      `eslint@9.24.0` `node_modules` symlinked into each, so the skip count is comparable;
      the single skip is the Agent SDK one. Both `iso` runs used a private `TMPDIR`.
- [x] `npx eslint scripts` exits **0** on both trees (it caught two `no-regex-spaces` in
      the new tests first).
- [x] **38 mutations, 38 caught**, each by the test named for it — including the five that
      are the point: a `resolved-nothing` band rendered as a cause, a `none-for-replicate`
      band rendered as a figure, `ceiling_moved` inferred instead of read, both provenance
      captions carrying one count, and §6's limit hardcoded again.
- [x] **Rendered against the real store, end to end**, over all three replicates: §2 goes
      from **41 lines to 133**, prints k2's adjudicated band `[7.3%, 20.4%]` beside its
      unlabelled `[3.5%, 20.4%]` and its rates `12 of 30 — 40.0%` / `12 of 147 — 8.2%`,
      k1 and k3 as `not computed` with `none-for-replicate` stated, and the `silver`
      tier's `[5.4%, 14.2%]` unbolded with its moved ceiling flagged. §6 reads
      *"357 adjudicated PAIR label(s) exist (45 `gold` · 312 `silver`), and no validity
      label does."*
- [x] The report still has **no clock** — the byte-identical re-render test passes
      untouched, and a second one covers the labelled path.
- [ ] **Not verified on real data:** a `distant` tier, a `none-matched` replicate, a
      `store-empty` corpus, an unreadable label file, and a census that disagrees across
      replicates. None occurs in the store; all are fixture-tested.
- [ ] **This PR renders; it does not re-render.** The published report under `reports/`
      does not change until the scorers and the renderer are re-run against the store.
- [ ] **Not run:** `verify:self`, `verify:fast`, `verify:browser`, `verify:integration`,
      `build`.

# Follow-up — the validity section, readable provenance, and §1/§3 explained

*2026-08-20, on top of the three sections above. Built against `upstream/main` at
`3b7a067`, then REBASED onto `39debb4` after #909 landed §5's restructure — see
"Rebased onto #909" at the end of this section for what that changed and what it did not.*

* Three changes: a section for the metric this benchmark is eventually FOR, a
header a reader can act on, and two sections that stated figures without saying what they
were figures of.*

## The problem

**① `validity.mjs` merged (#905) and was wired into nothing.** Measured on the base:
`report.mjs` carried **0** references to `validity-v1` and `score-all.mjs` **0** references
to validity. So precision — the only metric in this project about whether a finding is
TRUE — appeared on the page as one sentence in the limits. A reader cannot tell prose in a
footer from a metric nobody thought of, and the two are exactly the distinction this
renderer's four availability states exist to draw. Worse, the two metrics this corpus can
**never** answer had no representation at all: `absolute_recall` and `miss_profile` were
declared not-computable inside the scorer and invisible outside it.

**② The header named the reviewer as two hashes and nothing else.**

```
| reviewer | `panel_sha 46da673dd46dd5576626ee6d1b4e2e40728345e0` · `sha256:1c7853deb…f01` |
```

A digest has no ordering. It can say *different* and never *older, in which respect* — so
the page invited comparison against a panel that no longer exists without saying that is
what a reader would be doing. Everything needed was already in the store and unread:
`runs/<id>/config.snapshot.json` holds `config_id`, `target`, `sdk_version`,
`config_hash_version` and `lenses[]` with a model on each, and `run.json` holds
`panel_sha` and `panel_sha_source`. `store.getRun` already returns the snapshot beside the
envelope, and the render path already called it.

**③ §1 and §3 stated figures and assumed the reader knew why they mattered.** §2 and §4
carry their reasoning inline and it works — *"read the two directional rates before the
Jaccard"*, *"the two figures time different things"*. §1 printed `4.6×–4.9×` with no
sentence saying that a count is a count; §3 printed two figures that point opposite ways
without saying what reproducibility is a property OF.

## The change

### §6 — every metric spec §3.3 names, as a cell in the same four states as every figure

A sixth `SECTIONS` entry and a `validityFigures()` in the house style. One grid, six rows,
`metric | status | unit`. Today four rows read `not computed` with the label census behind
them and two read `not measurable` with the scorer's own reason — and the section is
**last**, because the order in `renderReport` is the argument: measured first, bounded
second, unavailable third. Limits moves from §6 to §7; **§5 is untouched**, deliberately,
because `prompts/report-rewrite-section5.md` owns it in a parallel branch.

**The refusal is a REFUSAL, not a coercion.** A payload declaring `absolute_recall` as
anything other than `not-measurable` stops the render. `not-computed` tells a reader to
wait for a judgement; these two can never be judged, because a corpus assembled from what
two reviewers said cannot contain what they both missed. A renderer that translated one
state into the other would print the softer word over a permanent refusal and nothing
downstream could tell. The follow-up paragraph **names** the two metrics rather than
saying "the last two rows" — a caption keyed to position would quietly point elsewhere the
day the scorer reorders `METRICS`.

**Three cell shapes, three adapters, because they are not one shape.** `precisionCell`
carries `value`; `relativeRecallBand` carries `low`/`high` and **no `value` at all**,
deliberately, since a point estimate is what that metric may not publish while the
cross-arm overlap is unresolved; `fpProfile` carries a `false_findings` count printed at
any size beside a `share_availability` for the proportion. Reading `.availability` across
all three would leave every profile group unlabelled and `renderCell` refuses that. Each
figure's `n` is `labelled_findings` and never `readings` — 428 labels written from 245
readings and 428 written from 428 are different datasets, and only the first number
belongs under the ratio.

### `score-all.mjs` runs it, and two things had to change to let it

**`reads_api: true`, and the handoff said `false`.** `validity.mjs`'s usage text says it
"costs nothing", which is about money; the same sentence goes on to say the CodeRabbit arm
makes read-only GitHub calls. It rebuilds that arm's claim population through
`adapters/coderabbit.mjs`'s `corpusRecords` — `fetchCodeRabbitPr` once per item, five
endpoints each. So the budget model no longer holds a literal: `API_READERS` derives both
reader counts from `STEPS`, and `estimateApiCalls` is `k * per_replicate + cross_run`.
**The 7-item pilot at K=3 now costs 210 core calls, not 175.** The 2026-08-13 measurement
is not stale — the pass grew by one cross-run reader, which is `items × 5`. Left at
`false` the preflight would have asked for 175 against a real 210 and cleared, and the
pass would have met the limit part way through: a score filed from a partial CodeRabbit
arm, which reads exactly like a clean review.

**`partial_exit`, because validity exits 1 on a store nobody has adjudicated.** That is
its correct answer, permanently — `process.exitCode = verdict === "complete" ? 0 : 1`, and
today the verdict is `partial`. Under this driver's plain exit-code rule the lane would
have filed six scores and then aborted on the one whose honest output is the absence. So
one step declares one tolerated code, and the tolerance is checked **harder** rather than
more loosely: `assertPartialIsDeclared` accepts it only if the payload parses and says
`partial` in its own words. Exit 1 over a `complete` payload refuses (the code and the
payload disagree and one of them is wrong); a payload with no verdict refuses (the check's
input never arrived — lesson 7); 2 and 137 refuse as before; and a step declaring no
tolerance gets the old rule unchanged. The scorer's reasons reach the log and the scorer id
reaches `summarise`, because a tolerated failure that printed nothing is indistinguishable
from a clean pass in a job log.

### The header says which panel, on which model, under which SDK

`reviewerFigures(runs)` takes the run envelopes exactly as `store.getRun` returns them plus
the id — no new accessor, no new file format, nothing recomputed. It renders the six lens
ids with the model, sample count, effort and gating each one runs, `config_id`, the replay
target, the SDK version, and `panel_sha` short with the full one kept once beside it,
because the full hash is the join key and somebody will need it.

**Every axis is compared across replicates and a disagreement is REPORTED, never
resolved.** Three replicates carry three snapshots and nothing in the store forces them to
match; a config edited between two legs leaves one lens on a different model, and printing
replicate 1's answer would describe a reviewer that produced a third of the data. When the
lens set disagrees the lens table is **empty** rather than showing one leg's, and each
disagreeing axis becomes a row naming what every replicate said. Agreement is stated once,
because "we checked and they match" and "nobody checked" are otherwise the same silence.

⚠ **`captured_at` is not an axis.** The pilot's three snapshots differ in it by 19 hours
and describe one reviewer — which is exactly why `config-hash.mjs` classifies it as
cosmetic. A comparison over whole snapshot bytes would report a disagreement on every
honest store, and a guard that fires on every real input is the same as not having one.

### §1 and §3 explain their metric before their numbers

Two sentences each, in the voice §2 already uses. §1: the section counts findings, it moves
when a reviewer raises more or fewer claims, and it cannot see whether the reviewer is more
often right. §3: it asks whether the same reviewer run again says the same thing, it moves
with anything that changes sampling, and it is silent on correctness — three replicates
that agreed perfectly could agree on three findings that are all wrong. No glossary, no
second-person coaching, and every figure keeps its `n` and its unit because `figure`
refuses without both.

**No stated limit was softened into an apology.** *"Cross-arm latency: not measurable —
PERMANENTLY"* is stronger as a result than as a regret, and a test asserts the document
contains none of `unfortunately`, `we were unable`, `we could not measure`, `sadly`,
`regrettably`.

## Corrected while building

### 1. 🔴 `reads_api: false` came from the handoff and was wrong in the flattering direction

The prompt supplied the `STEPS` row with `reads_api: false` and told the next session to
check it against the module before asserting it. Checked: it reads the API. The error would
have been invisible — a preflight that clears is a preflight that says nothing — and it
understates in the direction that lets the pass start.

### 2. 🔴 A mutation SURVIVED, and it was ineffective rather than uncaught

The ordering half of §3's explanation — *does it precede the table?* — was mutation-tested
by INSERTING the explanation below the table. It survived. Not because the assertion is
weak: the explanation then appeared **twice** and `indexOf` found the copy still sitting
above the table. Checking that a mutation changed behaviour at all costs five seconds;
concluding "missing test" and writing one costs much more. It is now two edits and one
mutation — a move, not an insert.

### 3. The `not computed` reasons were 250 characters wide, which is note 2's own complaint

The first pass repeated the label census into every metric row: *"the store holds 0 finding
label(s) for this corpus version over 0 reading(s), and X is a ratio over labels"*, four
times. That is the §5 defect reproduced in a table of six rows. The census is now stated
once above the grid and each row says only what is true of it — and the sentence stopped
claiming `fp_profile` is a ratio, which it is not.

### 4. A block comment ended early on a glob

`runs/pilot-01__k*/config.snapshot.json` inside a `/** … */` closed the comment at the
`*/` and the test file stopped parsing. Same family as the NUL-byte separator rule in the
conventions: a path with a glob in it belongs in prose, not in a block comment.

### 5. `0 labels over 0 readings` states the same thing twice

`readings` is on the page because a judgement count and a reading count are different
denominators. At zero it qualifies nothing, so the second level now appears only once there
is something for it to qualify.

## Fail directions

- **No validity score filed** → §6 renders `not computed` naming the scorer, and
  `report.mjs` exits 1 as it already does for any absent section. The absence is on the
  page; the exit code stops a pipeline quoting it as complete.
- **A score file with no `metrics` block** → a DIFFERENT `not computed`, because the
  refusals are half of what this section carries and a payload naming no metric cannot say
  which it refused.
- **A cell in a state this renderer does not know** → refuses. The scorer checks its
  vocabulary against ours at import (`assertAvailabilityMatchesRenderer`); this is the
  second door, and a near-miss synonym reaching a cell must stop the render rather than
  produce a row with nothing in it.
- **A metric with no declared unit** → refuses. A literal here would caption a scorer's
  figure with a word the scorer never used.
- **No run envelopes** → the provenance block renders `not computed` with its reason, and
  the two hashes above it are untouched. `panel_sha` stays REQUIRED; provenance is
  optional because it is provenance and not identity.
- **A replicate with no config snapshot** → named, and it does not count toward agreement.
  Silently dropping it would leave the header describing a lens set two of three legs never
  confirmed.
- **A lens field the snapshot does not state** → the words `not stated`. `security` carries
  no `effort`; the panel's default lives in `review-panel.mjs` and inferring it here would
  print a value the snapshot never recorded.
- **validity exits non-zero for a real fault** → the lane refuses, as before. Only the one
  declared code is tolerated and only with the payload's own confirmation.

## Explicit non-goals

1. **§5 untouched** — grid, prose and explanation. `prompts/report-rewrite-section5.md`
   owns it in a parallel branch, and the only change here that reaches it is that Limits
   renumbered from §6 to §7.
2. **No scorer changed.** `validity.mjs`, `segmentation.mjs` and the rest are wiring
   targets, not edits. Every reason string on the page is the scorer's own words, so the
   report cannot drift from what the scorer refused to compute.
3. **Nothing computed that the payload does not state.** The only arithmetic is counting
   how many cells are in which state, which is what §5 already does for its grid.
4. **No label written and `adjudicate.mjs` not run.** A validity section with zero labels
   is the correct output today.
5. **The published report is not re-rendered.** That is a lane dispatch.
6. **Band and profile detail tables are unexercised by real data.** They render, they are
   fixture-tested against the scorer's own constructors, and no store has a cell for them
   yet. Stated rather than implied.

## Verification

- [x] **`agent:tests`, both invocations, from the committed tree**: **2323 + 56 = 2379, 0
      fail, 0 skip**, against a freshly measured **2307 + 56 = 2363** on the rebased base
      — **+16**, two of them added by the review round below. (Pre-rebase, on `3b7a067`, it
      was 2302 + 56 against 2288 + 56; the base has moved twice since, to #909 and then to
      `ddb6235`, and the baseline is 2307 + 56 on both because nothing upstream has touched
      these five files.) Both trees extracted separately with the same lockfile-pinned
      `eslint@9.24.0` `node_modules` and the same `scripts/agent/node_modules` symlinked
      into each, so the skip count is comparable and zero on both. Both `iso` runs used a
      private `TMPDIR`.
- [x] `npx eslint scripts` exits **0**, from the committed tree.
- [x] **25 mutations, 25 caught, each by the test named for it.** The harness verifies it
      applied each one — needle count exactly 1, file hash changed — and restores the tree
      byte for byte, because three sessions in this project have shipped a harness that
      under-reported in the flattering direction. Five that are the point: the permanent
      refusal coerced to `not-computed`, a figure's `n` taken from `readings`, the lens
      table falling back to replicate 1 on a disagreement, `captured_at` becoming an axis,
      and `reads_api` written `false`.
- [x] **Rendered against the real store, end to end**, over all three replicates, into a
      scratch copy so nothing was written to the data repo: **370 lines to 444** on the
      rebased base (#909 took main's own render from 394 to 370; this section adds 74). §6 reads
      `not computed` on four metrics with the label census behind them and `not measurable`
      on two with `what_would_change_it`; the header names all six lenses with
      `claude-opus-5` on five and `claude-sonnet-5` on `docs`, and states that all three
      replicates agree.
- [x] **`validity.mjs` run against the real store** (35 read-only API calls, no money): 0
      labels, 426 distinct panel claims, 30 CodeRabbit claims, both arms `pending`,
      `partial`, exit 1 — which is the state `partial_exit` exists for.
- [x] The report still has **no clock** — the byte-identical re-render test passes
      untouched, and a new one covers the enlarged document with both the reviewer block
      and §6 attached, plus the no-blank-cell sweep over every table row.
- [ ] **Not verified on real data:** a present precision cell, a relative-recall band, a
      false-positive profile group, a lens set that disagrees across replicates, and a
      replicate with no config snapshot. None exists in the store; all are fixture-tested,
      and the validity fixtures are built by calling the scorer's own `precisionCell`,
      `relativeRecallBand` and `fpProfile` rather than typed out, so the shapes are the
      scorer's and not this session's guess at them.
- [ ] **This PR renders; it does not re-render.** The published report under `reports/`
      does not change until the scorers and the renderer are re-run against the store, and
      that run now costs 210 core API calls rather than 175.
- [ ] **Not run:** `verify:self`, `verify:fast`, `verify:browser`, `verify:integration`,
      `build`.

## Rebased onto #909

*#909 — "Render the report's segmentation section as a grid per metric" — landed while this
was open, and both changes touch `report.mjs` and `report.test.mjs`. It was a mechanical
rebase and not a logical one, which was the prediction the two were built in parallel on;
recorded here because "it merged cleanly" and "it still means the same thing" are different
claims and only one of them a merge tool can make.*

**ONE conflict, and it was positional.** Both changes inserted a new block into the same
gap — between `segmentationFigures()` and `sectionFor()`. #909 put `groupSegmentation()`
there; this change put `VALIDITY_CELL_LISTS`, `validityFigures()`, `unitFor()` and
`validityCell()`. Nothing overlapped in meaning, so both survive in the order each belongs:
`groupSegmentation` stays beside the §5 machinery it was written for, the validity block
follows. `report.test.mjs` merged with no conflict at all, because #909 inserted its tests
at §5's own block and this change appends at the end of the file — which is the convention
both prompts specified for exactly this reason.

⚠ **`git apply -3` could not do it and that is not a defect.** A `--depth=1` clone lacks
the base blob a three-way merge needs, and `git apply` is atomic, so the attempt left the
tree untouched rather than half-patched. The merge was done per file with `git merge-file`
over three trees already on disk: the base at `3b7a067`, this branch's version, and
`39debb4`.

**Two couplings that the clean merge did NOT prove, checked by hand:**

- 🔴 **#909's §5 prose-wrap test slices `md.indexOf("## 5.")` to `md.indexOf("## 6.")`.**
  Before this change `## 6.` was the limits heading; now it is the validity heading. The
  slice still bounds exactly §5 — but only because this change put a section there. Had
  validity been numbered anything else, or appended after the limits, #909's test would
  have silently widened to cover two sections or thrown on a missing index. It is noted
  here because the next section added to this report inherits the same coupling.
- 🔴 **#909's backtick-balance assertion runs over the whole document, and its fixture
  leaves §6 in the no-score-filed branch** — so it never sees a rendered metric grid, a
  lens table or a band, which is where this section emits most of its code spans. An
  unclosed span silently swallows the rest of a markdown line. The assertion is now made
  over a POPULATED §6 as well, inside this section's own byte-identical test.

**What did NOT change.** The header block, §6, §1's explanation and §3's explanation render
**byte-identically** before and after the rebase, verified section by section against the
pre-rebase render. #909 touched `segmentationFigures` and `renderSegmentation`; this change
touches neither, and §5's own numbering is untouched.

**Re-measured from the rebased committed tree**, because a count from a pre-rebase tree is a
count against a base that no longer exists: **2323 + 56 = 2379, 0 fail, 0 skip** against a
freshly measured **2307 + 56 = 2363** on `39debb4` — **+14**, the same delta as before.
`npx eslint scripts` exits 0. All **25 mutations re-run on the rebased tree, 25 caught by
the test named for each** — the needles are text rather than line numbers, so #909's
insertions moved nothing they match.

## Review round — three findings, all valid, all the same family

*Three findings came back on this branch and all three were reproduced before anything was
changed. Two are one defect wearing two hats.*

### 1. 🔴 Two hardcoded claims that §6 can falsify — the frame, and §7's first limit

`renderWhatThisIsNot()` asserted *"There is no precision figure, no recall figure and no
correctness figure anywhere in this document"* as a literal, and `labelsLimit()` concluded
*"no validity label does"* and *"there is still no precision … figure anywhere above"* from
the complementarity payload alone. §6 renders a precision figure the moment validity labels
exist. Reproduced: a render carrying six labels puts `0.667 (n=6 labelled findings)` in §6
while both sentences were still on the page.

**This is the identical defect `labelsLimit` was written to fix, one metric later.** That
function exists because *"No adjudicated labels exist."* was an assertion with no input and
could not go red when 357 pair labels landed. The fix derived it from the PAIR census — and
left it concluding something about VALIDITY labels it had no input for. So the function read
one payload and made a claim about another, and the frame above every number did the same
with no payload at all.

Both now ask `qualityFigures(s.validity)`, which counts `present` cells per list — precision
cells, bands and reporting profile shares, named separately so a band is never counted as a
precision cell. A **suppressed** cell does not flip either claim: a withheld cell publishes
no number, and the claim is about what a reader can quote. Both sentences revert verbatim
when the premise does, which is what makes it a derivation rather than a rewrite.

### 2. 🔴 `lensSignature` could contradict what the file had already proved

`lensSignature` compares the snapshot's RAW lens fields; `config_hash` compares their
CANONICAL form — `config-hash.mjs` normalises an omitted `effort` to the panel's default
before hashing. **Measured:** a snapshot that omits `effort` and one that states the default
explicitly produce the same `config_hash` and different signatures. On that input the block
printed *"these are not replicates of one reviewer"* and blanked the lens table — over legs
whose hash is identical, which is the definition of one reviewer on the configuration axis,
and which the render path already refuses to proceed without.

**The pilot has exactly that shape**: `security` omits `effort` where every other lens states
one, so a snapshot regenerated by a `config-build.mjs` that inlines defaults would trip it.

`config_hash` is now an axis, and it outranks the signature: a lens difference under an
agreeing hash is demoted to `cosmetic_differences`, renders as ⚠ rather than 🔴, and the
lens table still renders. Under a DISAGREEING hash it keeps the full refusal. A hash that is
not stated outranks nothing — the demotion is earned, never assumed.

⚠ **And the fixture was wrong in the direction that hid this.** The disagreement test moved
a lens's `model` while leaving `config_hash` identical, which the store cannot produce: a
model is inside the hash. Left alone, that fixture would have "proved" the demotion rule
safe while it silently swallowed real reviewer changes. `pilotRun` now takes `configHash` and
the test moves both together.

## Verification of the review round

- [x] All three findings **reproduced first**, against this branch's own code, before any
      change: the two sentences printed over a §6 that showed a figure, and two snapshots
      hashing identically while signaturing differently.
- [x] **2323 + 56 = 2379, 0 fail, 0 skip** from the committed tree, against **2307 + 56 =
      2363** on `ddb6235` — **+16**, two of them this round's.
- [x] `npx eslint scripts` exits **0**.
- [x] **The approved output is unchanged.** The header block, §1, §3, §6, the frame and §7
      render byte-identically before and after these fixes on the real store — every change
      is on a path today's data does not take, which is exactly why the defects survived
      the first pass.
- [ ] **The 25 mutations were NOT re-run after this round.** They were verified 25/25 on the
      pre-fix tree; the three fixes are covered by their own tests, which were written
      against reproductions rather than after the fact. Stated rather than implied.
