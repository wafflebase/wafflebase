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
      **1729 (1728 pass · 0 fail · 1 skipped) + 55 (55 pass · 0 fail · 0 skipped)**,
      against a **freshly measured** baseline of **1696 (1695 · 0 · 1) + 55** on
      `upstream/main` at `d327ee410`. **+33 tests, +0 failures, skip count unchanged.**
      Both trees were extracted separately and had the same `node_modules` symlinked
      into them before either was measured.
- [x] `eslint scripts` (lockfile-pinned `9.24.0`) — **exit 0**, on both trees.
- [x] **35 mutations, 35 caught**, re-run against the final bytes of all four files.
      One initially survived and was traced to the read/write asymmetry in ⑦ rather
      than assumed to be an ineffective mutation; the missing assertion was added.
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
- [ ] **Not verified: atomicity under a real interruption.** The tests prove the rename
      happens (removing it goes red) and that no `.part-` debris survives a successful
      write, which is what is observable without killing a process mid-write.
- [ ] **Not verified: the shape `cost-latency-v1.json` will have.** #791 is still open,
      so `costLatencyFigures` unpacks nothing beyond its identity fields and takes the
      absence path. When #791 merges the section grows; today it renders *"not
      computed"*, which is the honest state.
