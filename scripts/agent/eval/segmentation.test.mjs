// What these tests are FOR. A segmented scorer is the easiest place in this project
// to publish a wrong number, because every cell is small, plausible and unchecked by
// anything downstream. So almost nothing here asserts arithmetic. The assertions sit
// on the four ways a cell goes wrong instead:
//
//   1. A NUMBER THAT SHOULD HAVE BEEN WITHHELD. The whole suppression path is tested
//      from both sides of the boundary, and the strongest assertion in the file is
//      that a withheld cell carries no `value` key at all — not a value a renderer
//      happens to skip.
//   2. AN INTERVAL THAT CLAIMS CERTAINTY. The Wilson edges (`k=0`, `k=n`, `n=0`,
//      `n=1`) are pinned to their exact closed forms, so a mutation to any term of
//      the formula moves a digit a test is reading. A test that only exercised
//      `k=3, n=10` would pass against the textbook interval, which is the formula
//      this file exists not to use.
//   3. AN AGGREGATOR NOBODY CAN SEE. K replicates go into one cell, so the median
//      choice is asserted to be the median AND asserted not to be the max, and the
//      value/numerator/denominator are asserted to come from ONE leg — a real defect
//      caught by running the grid, which published `0.833 (25/17)`.
//   4. AN ABSENCE POOLED WITH A ZERO. A record with no file must not land in `code`,
//      a finding the novelty gate never annotated must not land in `unknown`, an item
//      with no finding in a bucket must still count toward that bucket's per-PR
//      denominator, and a bucket one replicate found nothing in must not be described
//      as empty.
//
// Every fixture is built through `buildFindingRecord`, so a record that could not
// exist cannot be tested against. Nothing here calls a model, needs an API key or
// touches the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN } from "../severity.mjs";
import { classifyFile } from "../review-panel.mjs";
import { ORIGINS } from "../novelty.mjs";
import { scopeSize } from "../metrics.mjs";
import { classifyProvenance } from "./extract-corpus.mjs";
import { buildFindingRecord } from "./finding-record.mjs";
import { itemGeometry } from "./volume-mix.mjs";
import {
  AXES,
  AXIS_IDS,
  DISJOINT_BUCKETS,
  MIN_N,
  METRIC_IDS,
  SCOPE,
  SCORER_ID,
  TAUTOLOGICAL_PAIRS,
  Z_95,
  assertBucketsDisjoint,
  assertDistinctLegs,
  assertOneGateState,
  assertWindowSegmented,
  axisFor,
  cellFrom,
  comparisonsOf,
  diffSizeOf,
  fileClassOf,
  medianLeg,
  noveltyBucketOf,
  pairing,
  provenanceOf,
  renderReport,
  scoreSegmentation,
  segmentLabel,
  severityBucketOf,
  suppressionBasis,
  unitFor,
  wilson,
  windowBucketOf,
} from "./segmentation.mjs";

// --- fixtures ---------------------------------------------------------------

/** One panel finding record. `detail` is the arm namespace the adapter fills. */
const panelRecord = ({ item = "pr-1", run = "run-a", severity = "minor", file = "packages/core/src/a.ts", line = 10, summary = "s", novelty = null, gate = "on" } = {}) =>
  buildFindingRecord({
    arm: "panel",
    itemId: item,
    runId: run,
    population: "reported",
    finding: { severity, file, line, summary: `${summary} ${item} ${severity} ${file} ${line}`, lane: severity === "major" || severity === "critical" ? "blocking" : undefined, novelty },
    detail: { lens: "correctness", lane: severity === "major" || severity === "critical" ? "blocking" : null, novelty, gate_state: gate, config_hash: "sha256:abc", panel_sha: "deadbeef" },
  });

/** One CodeRabbit finding record. */
const crRecord = ({ item = "pr-1", severity = "minor", file = "packages/core/src/a.ts", line = 10, summary = "s", basis = "header-field", window = "in-window", category = "maintainability & code quality" } = {}) =>
  buildFindingRecord({
    arm: "coderabbit",
    itemId: item,
    population: "reported",
    finding: { severity, file, line, summary: `${summary} ${item} ${severity} ${file} ${line}` },
    detail: { severity_basis: basis, window, window_basis: "commit-is-review-commit", category, tier: "", source: "inline" },
  });

/** A frozen diff that gives `a.ts` a post-image range of 10–19, so a finding on
 *  line 10 is `in-diff` and one on line 900 is not. */
const DIFF = ["diff --git a/packages/core/src/a.ts b/packages/core/src/a.ts", "--- a/packages/core/src/a.ts", "+++ b/packages/core/src/a.ts", "@@ -10,4 +10,10 @@", "+const x = 1;"].join("\n");

const GEOMETRY = new Map([["pr-1", itemGeometry("pr-1", { meta: { additions: 10, deletions: 0 }, diff: DIFF })]]);
const ITEMS = new Map([["pr-1", { item_id: "pr-1", additions: 10, deletions: 0, scope: "S", provenance: "human" }]]);

/** The smallest call that produces a grid: one arm, one leg, one axis. */
const gridOf = (records, { axisIds = ["severity"], minN = MIN_N, items = ITEMS, geometry = GEOMETRY, itemIds = ["pr-1"], arm = "panel", run = "run-a" } = {}) =>
  scoreSegmentation({
    arms: [{ arm, legs: [{ run_id: run, item_ids: itemIds, records, corpus_version: "c1" }] }],
    geometry,
    items,
    minN,
    axisIds,
    corpusVersion: "c1",
    corpusItemIds: itemIds,
  });

// --- Wilson: the four edges, pinned to their closed forms --------------------

/**
 * The closed forms are compared to within a few ULP rather than with `===`: the
 * general formula and the algebraic simplification of it are the same number and
 * differ in the last bit or two (measured: 3e-17 at n=1). The tolerance is 1e-15,
 * which is fourteen orders of magnitude tighter than any mutation to the formula —
 * dropping the `z²/(4n²)` continuity term halves the upper bound at k=0 — so it
 * still fails on every change to the arithmetic and passes only on the same maths.
 */
const closeTo = (actual, expected, what) => assert.ok(Math.abs(actual - expected) < 1e-15, `${what}: expected ${expected}, got ${actual}`);

test("Wilson at k=0 is [0, z²/(n+z²)] — an interval, where the textbook formula claims [0,0]", () => {
  // THIS IS THE COMMONEST CELL IN A SEGMENTED PILOT. "We saw none, so there are
  // none" from n=1 is the specific wrongness Wilson exists to avoid, and the upper
  // bound is what carries the uncertainty.
  // n=27 is in the list ON PURPOSE. The algebra gives exactly 0 at most n, but at 30
  // of the first 200 it lands 7e-18 BELOW zero in double precision, and n=27 is the
  // first — so the clamp is load-bearing rather than decorative, and this loop is
  // what proves it. Dropping the clamp survives a loop of 1, 5, 10, 30 and 142.
  for (const n of [1, 5, 10, 27, 30, 142]) {
    const w = wilson(0, n);
    assert.equal(w.low, 0, `k=0 must have a lower bound of exactly 0 at n=${n}`);
    closeTo(w.high, (Z_95 * Z_95) / (n + Z_95 * Z_95), `k=0 upper bound at n=${n} must be z²/(n+z²)`);
    assert.ok(w.high > 0, "the upper bound must not collapse to 0 — that is the naive interval");
    assert.equal(w.undefined_reason, null);
  }
  // The naive interval would be [0,0] here; this one is 0.28 wide.
  assert.ok(wilson(0, 10).high > 0.27 && wilson(0, 10).high < 0.28);
});

test("Wilson at k=n is [n/(n+z²), 1] — where the textbook formula claims [1,1]", () => {
  for (const n of [1, 5, 12, 30]) {
    const w = wilson(n, n);
    closeTo(w.low, n / (n + Z_95 * Z_95), `k=n lower bound at n=${n} must be n/(n+z²)`);
    assert.ok(w.low < 1, "the lower bound must not collapse to 1");
    assert.ok(w.high >= 1 - 1e-12 && w.high <= 1, "the upper bound is 1 at k=n");
  }
  // Measured on the pilot: CodeRabbit localises 30 of 30 findings. Reporting that
  // as "1.000, certainly" would be the arithmetic of a sample of 30 read as proof.
  assert.ok(wilson(30, 30).low < 0.89, "30 of 30 does not license a lower bound above 0.89");
});

test("Wilson at n=1 is still an interval, both ways round", () => {
  const zero = wilson(0, 1);
  const one = wilson(1, 1);
  assert.equal(zero.low, 0);
  closeTo(zero.high, (Z_95 * Z_95) / (1 + Z_95 * Z_95), "k=0, n=1");
  closeTo(one.low, 1 / (1 + Z_95 * Z_95), "k=n=1");
  assert.ok(one.high >= 1 - 1e-12);
  // Both are ~0.79 wide: at n=1 the interval says almost nothing, which is the
  // correct thing for it to say.
  assert.ok(zero.high - zero.low > 0.79 && one.high - one.low > 0.79);
});

test("Wilson at n=0 has NO interval — not [0,0] and not [0,1]", () => {
  const w = wilson(0, 0);
  assert.equal(w.low, null);
  assert.equal(w.high, null);
  assert.match(w.undefined_reason, /no denominator/);
  // A NaN would print as `NaN` and a 0 would print as certainty; neither is an
  // absence, and this is the distinction lesson 6 is about.
  assert.ok(!Number.isNaN(w.low));
});

test("Wilson's interior matches the published value, and narrows as n grows", () => {
  const w = wilson(3, 10);
  assert.ok(Math.abs(w.low - 0.1078) < 5e-4, `expected the published 0.1078, got ${w.low}`);
  assert.ok(Math.abs(w.high - 0.6032) < 5e-4, `expected the published 0.6032, got ${w.high}`);
  // At a fixed p the interval must shrink with n. This is what pins the `z²/(4n²)`
  // term: dropping it leaves the interval nearly right at large n and wrong at the
  // small n every cell in this grid has.
  const width = (k, n) => wilson(k, n).high - wilson(k, n).low;
  assert.ok(width(5, 10) > width(50, 100));
  assert.ok(width(50, 100) > width(500, 1000));
});

test("Wilson refuses input no segment filter should ever produce", () => {
  assert.throws(() => wilson(11, 10), /k=11 > n=10/);
  assert.throws(() => wilson(-1, 10), /non-negative integers/);
  assert.throws(() => wilson(1.5, 10), /non-negative integers/);
  assert.throws(() => wilson(1, 10, { z: 0 }), /positive z/);
});

// --- suppression ------------------------------------------------------------

test("the suppression boundary is exactly min_n: n = min_n reports, n = min_n - 1 withholds", () => {
  const at = cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "findings", minN: 5, legs: [{ run_id: "r", value: 0.6, k: 3, n: 5 }] });
  const below = cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "findings", minN: 5, legs: [{ run_id: "r", value: 0.5, k: 2, n: 4 }] });
  assert.equal(at.suppressed, false, "n === min_n is reported: the rule is n < min_n");
  assert.equal(at.n, 5);
  assert.equal(below.suppressed, true);
  assert.equal(below.n, 4);
  assert.equal(below.min_n, 5);
});

test("a WITHHELD cell carries no value, no numerator and no interval — the number is not in the payload", () => {
  // The load-bearing assertion of this file. A payload is a file anybody can read,
  // so a suppressed cell that still held its figure would be one `jq` away from
  // being quoted, and the suppression would be presentation rather than policy.
  const cell = cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "findings", minN: 5, legs: [{ run_id: "r", value: 0.5, k: 2, n: 4 }] });
  assert.equal(Object.hasOwn(cell, "value"), false, "a withheld cell must not carry its value");
  assert.equal(Object.hasOwn(cell, "k"), false, "a withheld cell must not carry its numerator");
  assert.equal(Object.hasOwn(cell, "interval"), false, "a withheld cell must not carry an interval");
  assert.equal(Object.hasOwn(cell, "values_by_replicate"), false, "nor the per-replicate values");
  // What it DOES carry is the pair that decided it, which is what a renderer prints.
  assert.deepEqual([cell.n, cell.min_n, cell.suppressed], [4, 5, true]);
});

test("a MEASURED ZERO is reported, and is a different cell from every absence", () => {
  const zero = cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "findings", minN: 5, legs: [{ run_id: "r", value: 0, k: 0, n: 6 }], intervalFor: (k, n) => wilson(k, n) });
  assert.equal(zero.suppressed, false);
  assert.equal(zero.value, 0, "0 over 6 findings is a measurement of the reviewer");
  assert.equal(zero.interval.low, 0);
  assert.ok(zero.interval.high > 0, "and it carries the uncertainty a zero has");
});

test("the suppression basis separates an empty bucket from a bucket one replicate found nothing in", () => {
  // Real data: `severity=critical` is 0 findings in replicate 1, 3 in replicate 2
  // and 1 in replicate 3. Describing that cell as "nothing fell here" would be a
  // false statement about the panel, and this project has already published the
  // claim that the panel raises no criticals — from replicate 1 alone.
  assert.match(suppressionBasis([], 0), /no replicate contributed/);
  assert.match(suppressionBasis([0, 0, 0], 0), /in any replicate/);
  assert.match(suppressionBasis([0, 3, 1], 0), /at least one replicate found none/);
  assert.match(suppressionBasis([0, 3, 1], 0), /0, 3, 1/, "the per-replicate counts are named, not just characterised");
  assert.match(suppressionBasis([6, 4, 7], 4), /below min_n/);
});

test("min_n rides on every cell and refuses a threshold that suppresses nothing", () => {
  const grid = gridOf([panelRecord({ severity: "minor" })], { minN: 1 });
  assert.equal(grid.min_n, 1);
  assert.equal(grid.min_n_source, "operator override");
  for (const cell of grid.cells) assert.equal(cell.min_n, 1, "a consumer reads the threshold per cell, so a stale caption is impossible");
  assert.match(renderReport(grid).join("\n"), /min_n is 1, not the spec's 5/);
  // Asserted on the GRID-level refusal's own wording: `cellFrom` refuses a
  // non-positive threshold too, and both messages say "positive integer", so matching
  // that alone would leave the entry guard untested.
  assert.throws(() => gridOf([panelRecord()], { minN: 0 }), /a threshold of 0 suppresses nothing/);
  assert.equal(gridOf([panelRecord()]).min_n_source, "spec §4.1 default");
});

// --- aggregation across replicates ------------------------------------------

test("a cell's value is the MEDIAN leg and never the max", () => {
  const legs = [
    { run_id: "k1", value: 0.2, k: 2, n: 10 },
    { run_id: "k2", value: 0.9, k: 9, n: 10 },
    { run_id: "k3", value: 0.5, k: 5, n: 10 },
  ];
  assert.equal(medianLeg(legs).value, 0.5);
  assert.notEqual(medianLeg(legs).value, 0.9, "the max is the aggregator that published 4.9× against a 4.7× figure");
  // Even K takes the LOWER middle: the conservative half, stated rather than
  // whichever way the sort happened to fall.
  assert.equal(medianLeg([{ run_id: "k1", value: 0.4, k: 4, n: 10 }, { run_id: "k2", value: 0.8, k: 8, n: 10 }]).value, 0.4);
  // A tie is broken by run id so the answer does not depend on input order.
  const tie = [{ run_id: "b", value: 0.5, k: 5, n: 10 }, { run_id: "a", value: 0.5, k: 5, n: 11 }];
  assert.equal(medianLeg(tie).run_id, "a");
  assert.equal(medianLeg([]), null);
});

test("value, numerator and denominator all come from ONE leg, and a mismatch is refused", () => {
  // The regression test for a defect this file shipped and then caught by reading
  // its own output: `n` was taken from the thinnest leg and `k` from the median one,
  // which published `0.833 (25/17)` — a ratio bigger than 1 that nothing flagged.
  const legs = [
    { run_id: "k1", value: 10 / 17, k: 10, n: 17 },
    { run_id: "k2", value: 12 / 19, k: 12, n: 19 },
    { run_id: "k3", value: 25 / 30, k: 25, n: 30 },
  ];
  const cell = cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "findings", minN: 5, legs, intervalFor: (k, n) => wilson(k, n) });
  assert.equal(cell.value_from_replicate, "k2", "the median by value");
  assert.deepEqual([cell.k, cell.n], [12, 19], "k and n are that same leg's, not another's");
  assert.equal(cell.value, cell.k / cell.n);
  // The thinnest leg is still reported, because it is what the suppression rule read.
  assert.equal(cell.thinnest_replicate_n, 17);
  // And the invariant fires on a leg that cannot be internally consistent.
  assert.throws(
    () => cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "findings", minN: 5, legs: [{ run_id: "k1", value: 0.833, k: 25, n: 17 }] }),
    /k=25 exceeds n=17/,
  );
  assert.throws(
    () => cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "findings", minN: 5, legs: [{ run_id: "k1", value: 0.4, k: 5, n: 10 }] }),
    /is not k\/n/,
  );
});

test("suppression reads the THINNEST leg, so a segment one replicate barely saw is withheld", () => {
  const legs = [
    { run_id: "k1", value: 0.5, k: 1, n: 2 },
    { run_id: "k2", value: 0.5, k: 5, n: 10 },
    { run_id: "k3", value: 0.5, k: 5, n: 10 },
  ];
  const cell = cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "findings", minN: 5, legs });
  assert.equal(cell.suppressed, true, "an aggregate over K is only as supported as its weakest draw");
  assert.equal(cell.n, 2);
});

test("the unit names what n counts AND how the replicates were aggregated", () => {
  // Decision 28: a figure that does not name its unit is ambiguous between two true
  // statements. A figure that does not name its aggregation is ambiguous between
  // three draws.
  const proportionMetric = { id: "nit_ratio", kind: "proportion", denominator_noun: "findings with a stated severity" };
  const perItem = { id: "findings_per_pr", kind: "median-over-items", denominator_noun: "PRs" };
  assert.match(unitFor(proportionMetric, 3), /findings with a stated severity; median of 3 replicates/);
  assert.match(unitFor(proportionMetric, 1), /single observation/);
  assert.match(unitFor(perItem, 3), /PRs, value is the median over PRs; median of 3 replicates/);
  // A consumer's figure constructor refuses a unitless cell; so does this one.
  assert.throws(() => cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "", minN: 5, legs: [{ run_id: "r", value: 1, k: 5, n: 5 }] }), /needs its unit/);
});

// --- placing a record in a bucket -------------------------------------------

test("a finding citing NO file goes to `no-file`, never to `code`", () => {
  // `classifyFile` answers `code` for an empty path, which is the right fail-safe
  // for the panel — an unclassifiable file must still be reviewed — and the wrong
  // answer here, because it files a finding with no citation among the ones citing
  // source code. 1 of 142 panel records in replicate 1 has no file.
  assert.equal(classifyFile(""), "code", "the upstream fail-safe this bucket exists to not inherit");
  assert.equal(fileClassOf({ file: null }), "no-file");
  assert.equal(fileClassOf({ file: "   " }), "no-file");
  assert.equal(fileClassOf({ file: "docs/design/a.md" }), "design-spec");
  assert.equal(fileClassOf({ file: "packages/core/src/a.ts" }), "code");
});

test("a finding the novelty gate never annotated is `not-annotated`, not `unknown`", () => {
  // `annotateFindings` stamps novelty only on critical/major, so 106 of the pilot's
  // 142 records carry no `novelty` object at all. Filing them as `unknown` would
  // report "git could not place this code" about code git was never asked about.
  assert.ok(ORIGINS.includes("unknown"), "`unknown` is a real origin, which is why the two must not be pooled");
  assert.equal(noveltyBucketOf(panelRecord({ severity: "minor" })), "not-annotated");
  assert.equal(noveltyBucketOf(panelRecord({ severity: "major", novelty: { origin: "unknown" } })), "unknown");
  assert.equal(noveltyBucketOf(panelRecord({ severity: "major", novelty: { origin: "introduced" } })), "introduced");
  assert.throws(() => noveltyBucketOf(panelRecord({ severity: "major", novelty: { origin: "brand-new-word" } })), /is not one of/);
});

test("an unstated severity gets its own bucket instead of the `major` floor it would inherit", () => {
  // `normalizeSeverity` maps anything unrecognised to `major`, which is BLOCKING, so
  // pooling an unstated finding into `major` grows the blocking stratum with findings
  // nobody called blocking.
  assert.equal(severityBucketOf(crRecord({ severity: "minor", basis: "header-field" })), "minor");
  assert.equal(severityBucketOf(crRecord({ severity: "major", basis: "unstated" })), "severity-unstated");
  assert.ok(!KNOWN.includes("severity-unstated"), "the bucket must not collide with the vocabulary it sits beside");
});

test("the size axis re-derives scopeSize and refuses to disagree with the frozen manifest", () => {
  // The three bucket names are re-typed from `scopeSize`'s own branches, which export
  // no vocabulary to pin against — so this test IS the pin, at both boundaries.
  assert.deepEqual([scopeSize(50, 0), scopeSize(51, 0), scopeSize(300, 0), scopeSize(301, 0)], ["S", "M", "M", "L"]);
  assert.equal(diffSizeOf({ item_id: "pr-1", additions: 40, deletions: 10, scope: "S" }), "S");
  assert.equal(diffSizeOf({ item_id: "pr-1", additions: 200, deletions: 101, scope: "L" }), "L");
  assert.equal(diffSizeOf({ item_id: "pr-1" }), "size-unknown", "an item with no frozen size has no size bucket, and 0 is not one");
  // One fact derived two ways: a stale manifest would re-file every finding on the
  // item, so it refuses rather than preferring either answer.
  assert.throws(() => diffSizeOf({ item_id: "pr-9", additions: 10, deletions: 0, scope: "L" }), /one fact derived two ways/);
});

test("the authorship axis has the THREE values the extractor produces, not §4's two", () => {
  // Pinned by running `classifyProvenance` over the three discriminating inputs,
  // the remedy `volume-mix.mjs` documents for a vocabulary its owner does not export.
  assert.equal(classifyProvenance({ author: { login: "app/yorkie-agent" } }), "autonomous");
  assert.equal(classifyProvenance({ author: { login: "someone" }, headRefName: "agent/12-x" }), "local-cli-agent");
  assert.equal(classifyProvenance({ author: { login: "someone" }, headRefName: "feat/x" }), "human");
  for (const p of ["autonomous", "local-cli-agent", "human"]) assert.equal(provenanceOf({ provenance: p }), p);
  assert.equal(provenanceOf({ provenance: "some-new-pipeline" }), "provenance-unrecognised", "a value we do not know must be visible, not silently dropped from every cell");
});

test("a window value outside the adapter's vocabulary is refused rather than placed", () => {
  assert.equal(windowBucketOf(crRecord({ window: "in-window" })), "in-window");
  assert.equal(windowBucketOf({ coderabbit: {} }), "window-unstated");
  assert.throws(() => windowBucketOf({ item_id: "pr-1", coderabbit: { window: "probably-fine" } }), /is not one of/);
});

// --- which metric may be cut by which axis ----------------------------------

test("a per-PR metric is only cut by a per-PR axis (§4.1's two currencies)", () => {
  const perPr = { id: "findings_per_pr", currency: "item", denominator_noun: "PRs" };
  const perFinding = { id: "localization_rate", currency: "finding", denominator_noun: "findings" };
  assert.equal(pairing(perPr, axisFor("severity")).allowed, false);
  assert.match(pairing(perPr, axisFor("severity")).reason, /numerator filter, not a segment/);
  assert.equal(pairing(perPr, axisFor("provenance")).allowed, true, "provenance is an item axis, so it genuinely segments the PRs");
  assert.equal(pairing(perFinding, axisFor("severity")).allowed, true);
  // And it is reported rather than silently dropped.
  const grid = gridOf([panelRecord()], { axisIds: ["severity"] });
  assert.ok(grid.pairs_not_computed.some((p) => p.metric === "findings_per_pr" && p.axis === "severity"));
  assert.equal(grid.cells.some((c) => c.metric === "findings_per_pr"), false);
});

test("a metric its axis DETERMINES is not computed — including the one that looked like a result", () => {
  // `nit_ratio × severity` is obvious. `nit_ratio × novelty` is not: the novelty
  // annotation is severity-gated, so the pilot's three cells were 0.000, 0.000 and
  // 1.000 (112/112) with a tight interval — a tautology that clears min-n and
  // therefore gets published.
  assert.deepEqual(
    TAUTOLOGICAL_PAIRS.map((p) => `${p.metric}×${p.axis}`),
    ["nit_ratio×severity", "nit_ratio×novelty"],
  );
  for (const pair of TAUTOLOGICAL_PAIRS) {
    const grid = gridOf([panelRecord({ severity: "major", novelty: { origin: "introduced" } })], { axisIds: [pair.axis] });
    assert.equal(grid.cells.some((c) => c.metric === pair.metric), false, `${pair.metric} must not be cut by ${pair.axis}`);
    assert.ok(grid.pairs_not_computed.some((p) => p.metric === pair.metric && p.axis === pair.axis));
  }
});

test("every reported proportion carries a Wilson interval, and every median says why it cannot", () => {
  const grid = scoreSegmentation({
    arms: [{ arm: "panel", legs: [{ run_id: "k1", item_ids: ["pr-1"], records: Array.from({ length: 6 }, (_, i) => panelRecord({ line: 10 + i })), corpus_version: "c1" }] }],
    geometry: GEOMETRY,
    items: ITEMS,
    axisIds: ["provenance"],
    corpusVersion: "c1",
    corpusItemIds: ["pr-1"],
    minN: 1,
  });
  const reported = grid.cells.filter((c) => !c.suppressed);
  assert.ok(reported.length > 0);
  for (const cell of reported) {
    if (cell.metric.endsWith("_rate") || cell.metric === "nit_ratio") {
      assert.equal(cell.interval.method, "wilson-score", `${cell.segment} is a proportion and must carry an interval`);
      assert.ok(cell.interval.low <= cell.value && cell.value <= cell.interval.high, `${cell.segment}: the value must lie inside its own interval`);
    } else {
      assert.equal(cell.interval.method, null);
      assert.match(cell.interval.undefined_reason, /not a count over a denominator/);
    }
  }
});

// --- the grid over records --------------------------------------------------

test("a per-PR median counts the items that produced NOTHING", () => {
  // The measured-zero trap in its most expensive form: dropping the quiet items
  // would report the median over "the items that happened to have a finding", which
  // RISES as the reviewer gets quieter.
  const items = new Map([...ITEMS]);
  const geometry = new Map([...GEOMETRY]);
  const itemIds = [];
  for (const id of ["pr-1", "pr-2", "pr-3", "pr-4", "pr-5", "pr-6"]) {
    items.set(id, { item_id: id, additions: 10, deletions: 0, scope: "S", provenance: "human" });
    geometry.set(id, itemGeometry(id, { meta: { additions: 10, deletions: 0 }, diff: DIFF }));
    itemIds.push(id);
  }
  // Two of six items carry three findings each; four carry none.
  const records = [...Array.from({ length: 3 }, (_, i) => panelRecord({ item: "pr-1", line: 10 + i })), ...Array.from({ length: 3 }, (_, i) => panelRecord({ item: "pr-2", line: 10 + i }))];
  const grid = gridOf(records, { axisIds: ["provenance"], items, geometry, itemIds });
  const cell = grid.cells.find((c) => c.metric === "findings_per_pr" && c.bucket === "human");
  assert.equal(cell.suppressed, false, "six items clears a threshold of five");
  assert.equal(cell.n, 6, "the denominator is every item read, not the two with findings");
  assert.equal(cell.value, 0, "four of six items found nothing, so the median is a measured 0");
});

test("an item with NO finding still lands in its own item-axis bucket", () => {
  // The defect this replaces was silent and total: item buckets were read off the
  // RECORDS, so an item the reviewer found nothing in never made its bucket
  // "observed" — and a fault bucket only becomes a cell when something is observed in
  // it. So an item whose frozen size would not read, or whose provenance is a value
  // this file has not heard of, disappeared from the axis entirely: no cell, no
  // per-PR denominator, no census row. Both cases are precisely what the fault
  // buckets exist to make visible.
  const items = new Map([
    ["pr-1", { item_id: "pr-1", additions: 10, deletions: 0, scope: "S", provenance: "human" }],
    // No `additions`/`deletions` at all, and no finding on it below.
    ["pr-2", { item_id: "pr-2", provenance: "some-new-pipeline" }],
  ]);
  const grid = gridOf([panelRecord({ item: "pr-1" })], { axisIds: ["diff_size:scopeSize", "provenance"], items, itemIds: ["pr-1", "pr-2"], minN: 1 });
  for (const [axis, bucket] of [["diff_size:scopeSize", "size-unknown"], ["provenance", "provenance-unrecognised"]]) {
    const cell = grid.cells.find((c) => c.axis === axis && c.bucket === bucket && c.metric === "findings_per_pr");
    assert.ok(cell, `${axis}=${bucket} must have a cell: pr-2 is in the population and belongs to that bucket`);
    assert.equal(cell.n, 1, "one item is in the bucket");
    assert.equal(cell.value, 0, "and it found nothing, which is a measured zero rather than an absence");
    assert.equal(grid.census.find((c) => c.axis === axis).buckets_observed[bucket], 1);
  }
  // The census counts the axis's OWN unit, and says which: an item axis counts pull
  // requests, so `S` is 1 item here and not the 1 finding on it.
  const size = grid.census.find((c) => c.axis === "diff_size:scopeSize");
  assert.equal(size.observed_unit, "items");
  assert.deepEqual(size.buckets_observed, { S: 1, "size-unknown": 1 });
  assert.equal(grid.census.find((c) => c.axis === "provenance").observed_unit, "items");
  // A finding axis still counts findings, and an item with records is not counted
  // once per record on an item axis.
  const bySeverity = gridOf(
    [panelRecord({ item: "pr-1" }), panelRecord({ item: "pr-1", line: 11 })],
    { axisIds: ["severity", "provenance"], items, itemIds: ["pr-1", "pr-2"], minN: 1 },
  );
  assert.equal(bySeverity.census.find((c) => c.axis === "severity").observed_unit, "findings");
  assert.equal(bySeverity.census.find((c) => c.axis === "severity").buckets_observed.minor, 2);
  assert.equal(bySeverity.census.find((c) => c.axis === "provenance").buckets_observed.human, 1, "two findings on one item is one item");
  // And K legs over the same items is still one observation per item: the ids are
  // unioned across the legs, so a 3-replicate arm does not report three pull requests
  // where there is one.
  const threeLegs = scoreSegmentation({
    arms: [
      {
        arm: "panel",
        legs: ["k1", "k2", "k3"].map((run) => ({ run_id: run, item_ids: ["pr-1", "pr-2"], records: [panelRecord({ item: "pr-1", run })], corpus_version: "c1" })),
      },
    ],
    geometry: GEOMETRY,
    items,
    axisIds: ["provenance"],
    corpusVersion: "c1",
    corpusItemIds: ["pr-1", "pr-2"],
    minN: 1,
  });
  assert.deepEqual(threeLegs.census.find((c) => c.axis === "provenance").buckets_observed, { human: 1, "provenance-unrecognised": 1 });
});

test("the bucket names that must not collide are all checked, and the check can be proved to fire", () => {
  // `pin`'s own argument, applied to this file's guard: it runs over frozen constants
  // at import time, so without an exported check nothing could demonstrate it fires —
  // and a guard nobody can prove fires is decoration. Six pairs, and the list is
  // asserted by name so that dropping one is a red test rather than a quiet gap.
  assert.deepEqual(
    DISJOINT_BUCKETS.map(([name]) => name),
    ["severity-unstated", "no-file", "not-annotated", "window-unstated", "size-unknown", "provenance-unrecognised"],
  );
  assert.equal(assertBucketsDisjoint(DISJOINT_BUCKETS), 6, "and the live constants are disjoint today");
  // It fires on a collision in either kind of vocabulary — the ones imported from
  // their owning modules and the ones re-typed in this file — and the live severity
  // vocabulary is used for one of them rather than a stand-in.
  assert.throws(() => assertBucketsDisjoint([["nit", KNOWN, "a colliding severity bucket"]]), /would be pooled under one bucket/);
  assert.throws(() => assertBucketsDisjoint([["S", ["S", "M", "L"], "a colliding size bucket"]]), /would be pooled under one bucket/);
  assert.throws(() => assertBucketsDisjoint([["human", ["human", "autonomous"], "a colliding provenance bucket"]]), /a colliding provenance bucket/);
  assert.equal(assertBucketsDisjoint([["size-unknown", ["S", "M", "L"], "a bucket that does not collide"]]), 1);
});

test("a malformed leg is refused by name rather than iterated character by character", () => {
  // `records: "abc"` used to reach `for (const r of leg.records)`, which walks a
  // string and files three one-letter "findings". Absent still means empty, because a
  // caller may legitimately pass neither field.
  assert.throws(() => gridOf("not-an-array"), /records must be an array/);
  assert.throws(
    () => scoreSegmentation({ arms: [{ arm: "panel", legs: [{ run_id: "k1", item_ids: "pr-1", records: [] }] }], geometry: GEOMETRY, items: ITEMS, corpusVersion: "c1", corpusItemIds: ["pr-1"] }),
    /item_ids must be an array/,
  );
  assert.match(
    (() => {
      try {
        gridOf("nope", { run: "k9" });
      } catch (e) {
        return e.message;
      }
      return "";
    })(),
    /panel\/k9/,
    "the refusal names the arm and the replicate, which a raw TypeError would not",
  );
  assert.doesNotThrow(() => scoreSegmentation({ arms: [{ arm: "panel", legs: [{ run_id: "k1" }] }], geometry: GEOMETRY, items: ITEMS, corpusVersion: "c1", corpusItemIds: ["pr-1"] }));
});

test("a density with no diff size leaves the denominator, and never reads as infinite", () => {
  // `findings / 0` is either Infinity or a silent skip, so an item whose frozen size
  // would not read is excluded from `findings_per_100_lines` and the `n` says so —
  // while it stays in `findings_per_pr`, where the size is irrelevant.
  const items = new Map([
    ["pr-1", { item_id: "pr-1", additions: 10, deletions: 0, scope: "S", provenance: "human" }],
    ["pr-2", { item_id: "pr-2", scope: "S", provenance: "human" }],
  ]);
  const grid = gridOf([panelRecord({ item: "pr-1" }), panelRecord({ item: "pr-2" })], { axisIds: ["provenance"], items, itemIds: ["pr-1", "pr-2"], minN: 1 });
  const density = grid.cells.find((c) => c.metric === "findings_per_100_lines" && c.bucket === "human");
  const perPr = grid.cells.find((c) => c.metric === "findings_per_pr" && c.bucket === "human");
  assert.equal(density.n, 1, "only the item with a known size is in the density denominator");
  assert.equal(perPr.n, 2, "both items are in the per-PR denominator, where size does not matter");
  assert.ok(Number.isFinite(density.value) && density.value === 10, "1 finding over 10 lines is 10 per 100");
  for (const cell of grid.cells) assert.equal(cell.value === Infinity, false, `${cell.segment} reports an infinite density`);
});

test("a cell whose denominator clears min_n and whose metric cannot answer is a DEFECT, not a suppression", () => {
  // The documented refusal on the far side of the suppression branch: filing it as a
  // thin cell would hide a metric that returned null over a full denominator.
  assert.throws(
    () => cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "findings", minN: 5, legs: [{ run_id: "k1", value: null, k: null, n: 9 }] }),
    /clears min_n=5 and no replicate produced a finite value/,
  );
  // With one answering leg it is a cell again, and the answering leg is the one used.
  const cell = cellFrom({ metric: "m", axis: "a", bucket: "b", arm: "panel", unit: "findings", minN: 5, legs: [{ run_id: "k1", value: null, k: null, n: 9 }, { run_id: "k2", value: 4, k: null, n: 9 }] });
  assert.equal(cell.value, 4);
  assert.equal(cell.value_from_replicate, "k2");
});

test("an item-axis cell narrows the item denominator too", () => {
  const items = new Map([
    ["pr-1", { item_id: "pr-1", additions: 10, deletions: 0, scope: "S", provenance: "human" }],
    ["pr-2", { item_id: "pr-2", additions: 400, deletions: 0, scope: "L", provenance: "autonomous" }],
  ]);
  const geometry = new Map([
    ["pr-1", itemGeometry("pr-1", { meta: { additions: 10, deletions: 0 }, diff: DIFF })],
    ["pr-2", itemGeometry("pr-2", { meta: { additions: 400, deletions: 0 }, diff: DIFF })],
  ]);
  const grid = gridOf([panelRecord({ item: "pr-1" }), panelRecord({ item: "pr-2" })], { axisIds: ["provenance"], items, geometry, itemIds: ["pr-1", "pr-2"], minN: 1 });
  const human = grid.cells.find((c) => c.metric === "findings_per_pr" && c.bucket === "human");
  assert.equal(human.n, 1, "a per-PR median over `human` is over the human items, not over all of them");
  assert.equal(grid.cells.find((c) => c.metric === "findings_per_pr" && c.bucket === "autonomous").n, 1);
});

test("every declared bucket gets a cell, so a zero bucket is visible rather than missing", () => {
  const grid = gridOf([panelRecord({ severity: "minor" })], { axisIds: ["severity"], minN: 1 });
  const buckets = grid.cells.filter((c) => c.metric === "localization_rate").map((c) => c.bucket);
  for (const severity of KNOWN) assert.ok(buckets.includes(severity), `${severity} must appear even with no findings in it`);
  // A fault bucket nothing landed in does NOT get a cell — the census proves it empty
  // instead, so the grid is not padded with rows about nothing.
  assert.equal(buckets.includes("severity-unstated"), false);
  const census = grid.census.find((c) => c.axis === "severity" && c.arm === "panel");
  assert.equal(census.buckets_observed["severity-unstated"], undefined);
  assert.deepEqual(census.buckets_declared, [...KNOWN]);
});

test("CodeRabbit's categories are discovered from the data and used verbatim", () => {
  const grid = gridOf([crRecord({ category: "data integrity & integration" }), crRecord({ category: "functional correctness", line: 11 })], {
    axisIds: ["coderabbit_category"],
    arm: "coderabbit",
    run: null,
    minN: 1,
  });
  const buckets = grid.cells.filter((c) => c.metric === "localization_rate").map((c) => c.bucket);
  assert.deepEqual(buckets, ["data integrity & integration", "functional correctness"]);
  // Their vocabulary is not ours, so it is not flagged as being outside a vocabulary
  // we never declared.
  const census = grid.census.find((c) => c.axis === "coderabbit_category");
  assert.deepEqual(census.buckets_outside_vocabulary, []);
  assert.equal(census.buckets_from, "data");
  assert.equal(grid.cells.every((c) => c.segment.includes("coderabbit_category=")), true, "the label says whose taxonomy it is");
});

test("an axis with no counterpart in an arm produces no cells and says why", () => {
  const grid = scoreSegmentation({
    arms: [
      { arm: "panel", legs: [{ run_id: "k1", item_ids: ["pr-1"], records: [panelRecord()], corpus_version: "c1" }] },
      { arm: "coderabbit", legs: [{ run_id: null, item_ids: ["pr-1"], records: [crRecord()], corpus_version: "c1" }] },
    ],
    geometry: GEOMETRY,
    items: ITEMS,
    axisIds: ["novelty", "window"],
    corpusVersion: "c1",
    corpusItemIds: ["pr-1"],
    minN: 1,
  });
  assert.equal(grid.cells.some((c) => c.axis === "novelty" && c.arm === "coderabbit"), false);
  assert.equal(grid.cells.some((c) => c.axis === "window" && c.arm === "panel"), false);
  const notApplicable = grid.census.filter((c) => c.status === "not-applicable").map((c) => `${c.axis}/${c.arm}`);
  assert.deepEqual(notApplicable.sort(), ["novelty/coderabbit", "window/panel"]);
  for (const row of grid.census.filter((c) => c.status === "not-applicable")) assert.match(row.reason, /no counterpart/);
});

test("a cross-arm segment is comparable only when BOTH arms cleared the threshold", () => {
  // S4: CodeRabbit's findings bind every cross-arm denominator, so a segment where
  // our arm reports and theirs is withheld is not a comparison — and the report's
  // headline is how many segments survive both suppression tests.
  const rows = comparisonsOf([
    { metric: "m", axis: "a", bucket: "x", arm: "panel", suppressed: false, n: 90, value: 0.7 },
    { metric: "m", axis: "a", bucket: "x", arm: "coderabbit", suppressed: true, n: 3 },
    { metric: "m", axis: "a", bucket: "y", arm: "panel", suppressed: false, n: 90, value: 0.7 },
    { metric: "m", axis: "a", bucket: "y", arm: "coderabbit", suppressed: false, n: 13, value: 1 },
    { metric: "m", axis: "a", bucket: "z", arm: "panel", suppressed: false, n: 90, value: 0.7 },
  ]);
  assert.deepEqual(rows.map((r) => `${r.bucket}:${r.comparable}`), ["x:false", "y:true"]);
  assert.equal(rows.find((r) => r.bucket === "y").arms.coderabbit.n, 13, "each side carries its own arm's n");
  assert.equal(rows.some((r) => r.bucket === "z"), false, "a one-arm segment is not a cross-arm row at all");
  // No winner is declared: whether a high nit ratio is good is not this file's call.
  for (const row of rows) assert.equal(Object.hasOwn(row, "winner"), false);
});

// --- guards -----------------------------------------------------------------

test("mixed gate states are refused, because a gate-off replay is a different reviewer", () => {
  const on = panelRecord({ gate: "on" });
  const off = panelRecord({ gate: "off-no-base-sha", line: 11 });
  assert.equal(assertOneGateState([on, on]), "on");
  assert.equal(assertOneGateState([crRecord()]), null, "no panel arm is not an unrecorded gate state");
  assert.throws(() => assertOneGateState([on, off]), /span 2 gate states/);
  assert.throws(() => gridOf([on, off]), /span 2 gate states/);
});

test("a multi-window population must be segmented on window, or it is refused", () => {
  const inWindow = crRecord({ window: "in-window" });
  const after = crRecord({ window: "after-window", line: 11 });
  // Delegated verbatim to the sibling's refusal, which names this scorer as the fix —
  // and the assertion is on ITS wording, because this file's own fallback message
  // also contains the string "after-window" (it lists the values it found) and would
  // otherwise make the delegation untested.
  assert.throws(() => assertWindowSegmented([inWindow, after], ["severity"]), /they are about code our arm never reviewed/);
  assert.throws(() => assertWindowSegmented([inWindow, { coderabbit: { window: "no-window" } }], ["severity"]), /span 2 window values/);
  // With the axis selected the two land in different cells and nothing is pooled.
  assert.doesNotThrow(() => assertWindowSegmented([inWindow, after], ["window"]));
  const grid = gridOf([inWindow, after], { axisIds: ["window"], arm: "coderabbit", run: null, minN: 1 });
  assert.deepEqual(
    grid.cells.filter((c) => c.metric === "localization_rate" && !c.suppressed).map((c) => c.bucket).sort(),
    ["after-window", "in-window"],
  );
});

test("a repeated run id, an unlisted item and an unknown axis are all refused", () => {
  assert.throws(() => assertDistinctLegs("panel", [{ run_id: "k1" }, { run_id: "k1" }]), /same run id twice/);
  assert.throws(() => assertDistinctLegs("panel", []), /no replicate at all/);
  // A record on an item the caller did not list would make a per-PR denominator
  // wrong in the flattering direction: more findings over fewer items.
  assert.throws(() => gridOf([panelRecord({ item: "pr-99" })], { itemIds: ["pr-1"] }), /did not list as read/);
  assert.throws(() => gridOf([panelRecord()], { axisIds: ["diff_size"] }), /unknown axis/);
  assert.throws(() => gridOf([panelRecord()], { axisIds: ["defect_type"] }), /cannot be computed/);
  assert.throws(() => gridOf([panelRecord()], { axisIds: [] }), /no axis selected/);
});

test("the axes nobody can build are declared with a reason instead of being omitted", () => {
  // S5: defect type is the axis the report most wants and it needs labels that do
  // not exist. An omitted axis and an unbuildable one look identical in a table.
  const defectType = AXES.find((a) => a.id === "defect_type");
  assert.equal(defectType.status, "not-computed");
  assert.match(defectType.reason, /assigned at adjudication/);
  assert.equal(AXIS_IDS.includes("defect_type"), false);
  const grid = gridOf([panelRecord()]);
  assert.match(renderReport(grid).join("\n"), /axis defect_type: NOT COMPUTED/);
  assert.ok(grid.axes.find((a) => a.id === "defect_type").reason);
});

// --- the payload contract ---------------------------------------------------

test("the payload carries exactly what a report renderer reads, per cell and at the top", () => {
  const grid = gridOf([panelRecord({ severity: "minor" }), panelRecord({ severity: "minor", line: 11 }), panelRecord({ severity: "nit", line: 12 })], { minN: 2 });
  assert.equal(grid.scorer_id, SCORER_ID);
  assert.equal(grid.scope, SCOPE);
  assert.equal(grid.min_n, 2);
  assert.ok(Array.isArray(grid.cells) && grid.cells.length > 0);
  for (const cell of grid.cells) {
    assert.equal(typeof cell.segment, "string");
    assert.equal(typeof cell.suppressed, "boolean");
    assert.equal(Number.isInteger(cell.n), true, "every cell prints its n, always");
    assert.equal(cell.min_n, 2);
    if (!cell.suppressed) {
      assert.equal(Number.isFinite(cell.value), true);
      assert.ok(typeof cell.unit === "string" && cell.unit.trim() !== "", "a figure constructor refuses without a unit");
    }
  }
  // The grammar and the scale are IN the payload, not only in prose.
  assert.equal(grid.segment_grammar, "metric=<metric id>/<axis id>=<bucket>/arm=<arm>");
  assert.match(grid.diff_size_scale, /scopeSize/);
  assert.match(grid.diff_size_scale, /S ≤50/);
  assert.equal(grid.axes.find((a) => a.id === "diff_size:scopeSize").scale, grid.diff_size_scale);
  // And the count a report's own summary owes its reader.
  assert.equal(grid.grid.cells, grid.cells.length);
  assert.equal(grid.grid.suppressed + grid.grid.reported, grid.cells.length);
});

test("the segment label is flat, complete and refuses a missing component", () => {
  assert.equal(segmentLabel({ metric: "nit_ratio", axis: "severity", bucket: "minor", arm: "coderabbit" }), "metric=nit_ratio/severity=minor/arm=coderabbit");
  // Verbatim, ampersands and all: tidying a foreign vocabulary is how two of its
  // categories come to share one row.
  assert.match(segmentLabel({ metric: "m", axis: "coderabbit_category", bucket: "security & privacy", arm: "coderabbit" }), /=security & privacy\//);
  for (const missing of ["metric", "axis", "bucket", "arm"]) {
    const parts = { metric: "m", axis: "a", bucket: "b", arm: "panel", [missing]: "" };
    assert.throws(() => segmentLabel(parts), new RegExp(`needs its ${missing}`));
  }
  assert.ok(METRIC_IDS.length > 0 && AXIS_IDS.length > 0);
});

test("the console report prints EVERY cell, withheld ones included, with the numbers that decided them", () => {
  const grid = gridOf([panelRecord({ severity: "minor" }), panelRecord({ severity: "minor", line: 11 })], { minN: 2 });
  const text = renderReport(grid).join("\n");
  for (const cell of grid.cells) assert.ok(text.includes(cell.segment), `${cell.segment} is missing from the report`);
  assert.match(text, /WITHHELD n=0 < 2/, "a withheld cell prints the n and the min_n that decided it");
  assert.match(text, /cell\(s\):.*reported.*withheld/, "the suppressed count is the headline, per §4.1");
  assert.match(text, /CROSS-ARM/);
  // Nothing in the report is a bare blank.
  for (const line of renderReport(grid)) assert.equal(line.trim().endsWith(":"), false, `"${line}" ends in a colon with nothing after it`);
});
