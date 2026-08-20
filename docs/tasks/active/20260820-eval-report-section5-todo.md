# Render §5 as a grid per metric — `eval/report.mjs`

*A separate file rather than a section appended to `20260812-eval-report-renderer-todo.md`,
which owns this renderer: a second change to `eval/report.mjs` is in flight in parallel
and two appends to one doc would collide. The renderer's own doc stays the subsystem's
history; this one is the §5 restructure.*

## The problem

§5 renders a three-dimensional cube as a one-dimensional list. Measured on the report
the first real CI run committed to the data store:

```
§5 today: 163 lines
one table, 149 consecutive data rows, 2 columns
73 of the 149 cells carry NO VALUE   ("**suppressed**: n=0 < 5")
widest data row 155 characters
```

The first column is a flattened composite key, so the grid has to be rebuilt by eye,
149 times:

```
| metric=localization_rate/severity=critical/arm=panel | **suppressed**: n=0 < 5                       |
| metric=in_diff_rate/severity=major/arm=panel         | 0.694 (n=36 findings; median of 3 replicates) |
```

**The cube is metric × axis-bucket × arm and the renderer emitted it flat.** The
grouping was never missing: `segmentation.mjs`'s `segmentLabel` says in its own comment
that flattening loses the ordering and that *"the payload carries the three components
separately BESIDE the label"* — and `renderSegmentation` read only `segment` and did
`for (const c of sg.cells) out.push(…)`.

Three consequences, and the second is the reason this is worth a pull request:

1. **Half the section says nothing, at full row height.** 73 rows of `suppressed: n=…`
   is not more honest than one count that names the same segments; it is the same
   honesty spread over 73 lines.
2. **The section cannot do the job it exists for.** §4's deliverable is *where each arm
   wins* — a comparison — and panel and CodeRabbit sat dozens of rows apart on the same
   bucket. Putting them on one line is the whole point and was impossible.
3. **An axis with no rows had three possible explanations and the page gave one.** The
   payload's `pairs_not_computed` — twelve metric × axis pairs the scorer refused as
   meaningless rather than thin — was never rendered at all, so a reader of
   `nit_ratio` could not tell a refusal from an oversight.

## The change

Two files. `segmentation.mjs` is untouched: no payload field is added, and nothing the
payload does not already state is computed.

**`report.mjs` — `segmentationFigures` regroups; `renderSegmentation` renders a grid.**

- **The cube's coordinates are carried through.** `metric`, `axis`, `bucket` and `arm`
  travel with each cell; `axes[].arms` and `axes[].unit` and `metrics[].spec` and
  `metrics[].currency` are read. All were already in the payload.
- **`groupSegmentation` regroups and counts, and computes nothing.** Every value, `n`,
  unit and suppression verdict is the scorer's. The only arithmetic is `length` over
  cells whose state the scorer already decided — the same arithmetic `reported` and
  `withheld` have done since the section was written.
- **One grid per metric: bucket down, arm across.** Order is the payload's, by first
  appearance. Sorting here would be the renderer inventing a ranking, and a
  locale-sensitive comparator would put the byte-identical re-render property at risk.
- **A row must hold at least one measurement.** A segment withheld on *every* arm is
  counted and **named** under its grid instead of getting a row. A segment withheld on
  *one* arm keeps its row, and the withheld arm reads `**suppressed**: n=3 < 5` in
  place — no value, nothing that can be misread as one.
- **The unit is hoisted into the column header**, and only while every reported cell in
  that column agrees on it. That is `renderValue`/`unitOf`'s stated condition — drop
  the `(n= unit)` suffix only where the unit is rendered adjacently — and it is where
  most of the row width was: `findings with a stated severity; median of 3 replicates`
  repeated in every cell of every row.
- **`—` means one-armed, not thin.** Three of the seven axes are declared for a single
  arm because the field they cut on exists in one arm's records only. A bigger corpus
  closes a thin cell and never closes that one, so they do not share a symbol; the
  legend is generated from `axes[].arms`.
- **Each grid leads with the count of surviving cross-arm comparisons**, counted over
  the rows in the table below it rather than read from the payload's `comparisons`, so
  a row the renderer drops can never be counted as one a reader can see. The two agree
  on this payload: 22.
- **A metric with no reporting cell gets a sentence, not an empty table** — that is
  `findings_per_pr` and `findings_per_100_lines`, 24 of the 73 withheld cells, both
  counted in pull requests on a 7-item corpus.
- **The two refusals that are statements about a metric are rendered with the scorer's
  own reason**; the other ten are one unit mismatch repeated and are counted. The split
  is structural — the metric's `currency` against the axis's `unit`, both in the
  payload — not a match on the reason text, so an unfamiliar refusal lands in the
  rendered group.
- **`wrapProse`** folds generated sentences to the width the report's authored prose is
  written at, and never inside a code span.
- **One explanatory paragraph**, in the voice §2 already uses: what the section cuts,
  what moves a cell, and what no cell can tell you.

## Corrected while building

- **The brief said 151 rows and "73 of 151".** It is **149 cells** — 76 reported, 73
  withheld. 151 was the table's 149 data rows plus its two header rows. The share is
  49%, not 48%.
- **The brief said rows up to 254 characters.** Measured **231**, and that row is the
  `defect_type` axis row, which the brief asks to keep. The widest *segment* row was
  **155**. Both numbers are now in the task doc rather than the prompt so the next
  reader measures rather than quotes.
- **`wrapProse`'s first draft split a code span.** CodeRabbit's taxonomy is used
  verbatim and contains spaces, so a plain space-fold broke
  `` `coderabbit_category=data integrity & integration` `` across two lines and markdown
  rendered the backticks literally. Backtick parity is tracked now, and a test asserts
  every line §5 emits has an even number of them.
- **The withheld sentence was written with a literal 73 in it.** Caught before it
  shipped, and it is the same defect `suppressed()` refuses a defaulted `min_n` to
  prevent: a caption that contradicts its own grid the first time the corpus grows.
  It also had to become conditional — with nothing withheld it printed *"0 rows saying
  nothing is what made this section unread"*.
- **An axis-major layout was measured and rejected.** One grid per axis with metric ×
  arm columns renders in 55 body lines — shorter — but reaches **11 columns** and
  **275-character rows**, worse than the defect being fixed, and it cannot carry units
  at all.

## Fail directions

- **A cell the payload gave no coordinates for is rendered, not dropped.** It goes into
  a flat list under a heading that says the renderer could not place it. A payload from
  before those fields existed therefore still shows every cell it has; the failure is
  visible and recoverable, and the alternative — a silent omission — is the one failure
  this module exists to prevent.
- **A column whose reported cells disagree on the unit keeps the unit in every cell.**
  A header that picked one of two would be the unitless figure `figure()` refuses to
  construct.
- **An axis with no declared `arms` produces no legend entry** rather than a guess. It
  simply is not named as one-armed.
- **A refused pair with an unrecognised shape is rendered, not counted.** The
  unit-mismatch test is a conjunction, so anything that fails either half falls into
  the group that gets read.
- **A code span too long to fold overhangs its line** instead of being broken. An
  over-long line is harmless; a broken code span publishes literal backticks.

## Explicit non-goals

- **`segmentation.mjs` is untouched.** No payload field added, no threshold moved.
- **`min_n` is not raised and nothing extra is suppressed.** The information is fine;
  the presentation was the defect, and shrinking §5 by withholding more would be
  deleting data to fix a layout.
- **No number is computed that the payload does not state.** No total, no mean, no
  rank, no winner. Which direction is better is a property of the metric — a high nit
  ratio is not a virtue — and neither this file nor the scorer owns that judgement.
- **No other section is touched.** §1, §3, the header's provenance and the validity
  section are a separate change, in flight in parallel.
- **The published report was not re-rendered.** Every measurement below comes from
  `--dry-run`, which writes nothing.
- **`pairs_not_computed`'s ten unit-mismatch entries are counted, not listed.** Listing
  twelve near-identical refusals would re-import the noise this change removes.

## Verification

Measured against a freshly extracted `upstream/main` at `3b7a067`, both trees with the
same `node_modules` symlinked in, each measured once. The lane is two invocations
since #774, reported as `rest + iso`.

- [x] **`agent:tests` — 2297 + 56 = 2353 tests, 0 fail, 0 skip.** Base `3b7a067`:
      2288 + 56 = 2344, 0 fail, 0 skip. **+9 tests**, all in `eval/report.test.mjs`.
      (0 skips rather than the documented 6 because both trees have a root `eslint`
      symlinked in, which lets `lint-config.test.mjs` run its 5 cases; the Agent SDK is
      present too. Both trees, identically.)
- [x] `npx eslint scripts` — **exit 0**, eslint 9.24.0, the version `pnpm-lock.yaml`
      pins.
- [x] **The renderer still has no clock.** Two `--dry-run` renders of the same store
      are byte-identical (`cmp`), and the two existing re-render tests pass untouched.
- [x] **19 mutations, 19 caught by the SPECIFICALLY NAMED test.** The harness proves
      each mutation landed by reading the file back and failing if it is unchanged —
      three earlier harnesses in this project silently skipped mutations and scored
      them as passes — and each mutation declares the one test that must redden;
      being caught only by a different test is reported as a harness finding.
- [x] **Rendered from the real store, not a fixture.** §5 before is byte-identical to
      §5 of the report the first CI run committed, so before and after are the same
      data through two renderers:

      | | before | after |
      |---|---|---|
      | §5 lines | 163 | **139** |
      | §5 table rows | 154 | **67** |
      | rows carrying no value | 73 | **0** |
      | widest data row | 155 chars | **78 chars** |
      | whole report | 394 lines | 370 lines |

      The 24-line reduction understates the change: 154 table rows became 67 *while*
      the section gained the refused-pair table it never had. Without that addition §5
      renders in 128 lines.

- [ ] **Not verified: how §5 reads at a corpus large enough to fill the grid.** Every
      measurement here is the 7-item pilot, where three of five metrics report and two
      do not. A corpus that lifts `findings_per_pr` above min-n turns two sentences
      into two more grids, and nothing here says whether five grids is still readable.
- [ ] **Not verified: any renderer other than GitHub's.** The unit in a column header
      makes that header wide — 146 characters on `nit_ratio` — and a narrow viewport
      will scroll it. That is still 85 characters narrower than the widest row the
      section already had.
