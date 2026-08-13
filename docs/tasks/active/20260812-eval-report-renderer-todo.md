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
