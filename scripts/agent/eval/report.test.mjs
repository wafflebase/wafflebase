// FIXTURES ONLY. No store, no filesystem, no network, no money.
//
// That is not frugality, it is the property under test. The renderer's whole reason
// for existing is that a comparison can be rendered from committed data with nothing
// live attached — two of the three merged scorers reach the CodeRabbit arm through
// `gh api`, and with no repository context that adapter yields zero records and a
// plausible empty result rather than an error. So a report built by invoking scorers
// could silently print a one-armed comparison. Every test below drives the pure
// functions with plain objects, which is what "renders offline" means when it is
// checked rather than claimed.
//
// The store's own new methods are tested in `store.test.mjs`, beside the write-once
// paths they deliberately differ from.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVAILABILITY,
  SELF_REVIEW_ITEMS,
  SCORER_IDS,
  SECTIONS,
  buildReport,
  comparisonIdFor,
  complementarityFigures,
  costLatencyFigures,
  figure,
  notComputed,
  notMeasurable,
  reliabilityFigures,
  renderCell,
  renderReport,
  renderValue,
  segmentationFigures,
  suppressed,
  unitOf,
  volumeFigures,
} from "./report.mjs";

const CONFIG_HASH = "sha256:1c7853debf4edf92646d2299b0c924cb48cca89d6bb68b81648c57508a762f01";
const CORPUS_VERSION = "2026-08-10-pilot-reviewed";
const PANEL_SHA = "46da673dd46dd5576626ee6d1b4e2e40728345e0";
const RUNS = ["pilot-01__k1", "pilot-01__k2", "pilot-01__k3"];

/**
 * A `volume-mix-v1` payload, cut down to the fields the renderer reads.
 *
 * The counts are the pilot's REAL ones, per replicate, because the numbers are the
 * point: the panel's totals are 142 · 147 · 139 against CodeRabbit's 30, and the
 * severity mixes are the different populations that make a pooled ratio misleading.
 * A fixture of round invented numbers would let a bias in the aggregation pass
 * unnoticed — which is exactly the defect the range test below caught.
 */
function volumePayload(runId, panel) {
  const block = (counts) => {
    const n = Object.values(counts).reduce((a, b) => a + b, 0);
    return { findings: n, severity: { stated: { n, counts }, unstated: { n: 0 } } };
  };
  return {
    schema_version: 1,
    run_id: runId,
    corpus_version: CORPUS_VERSION,
    completeness: { verdict: "complete", items_comparable: ["pr-415"] },
    segments: [
      { arm: "coderabbit", gate_state: "no-gate-in-arm", summary: block({ critical: 0, major: 3, minor: 13, nit: 14 }) },
      { arm: "panel", gate_state: "on", summary: block(panel) },
    ],
  };
}

const VOLUME = [
  volumePayload("pilot-01__k1", { critical: 0, major: 36, minor: 89, nit: 17 }),
  volumePayload("pilot-01__k2", { critical: 3, major: 32, minor: 93, nit: 19 }),
  volumePayload("pilot-01__k3", { critical: 1, major: 32, minor: 76, nit: 30 }),
];

/** A `complementarity-v1` payload: three replicates, each with a saturated ceiling. */
const COMPLEMENTARITY = {
  per_replicate: [
    { stats: { label: "pilot-01__k1" }, overlap: { classes: 166, both: 6, panel_only: 136, coderabbit_only: 24, jaccard: 0.036 }, unresolved: { jaccard_upper_bound: 0.211, saturated: true, maybe_links: 412, strong_maybe_links: 17, triage_threshold: 0.7, coderabbit_classes_with_a_panel_candidate: 24 }, severity: { shared_classes: 6, stated: { n: 6, panel_more_severe: 5, coderabbit_more_severe: 0 } } },
    { stats: { label: "pilot-01__k2" }, overlap: { classes: 173, both: 4, panel_only: 143, coderabbit_only: 26, jaccard: 0.023 }, unresolved: { jaccard_upper_bound: 0.204, saturated: true, maybe_links: 420, strong_maybe_links: 23, triage_threshold: 0.7, coderabbit_classes_with_a_panel_candidate: 26 }, severity: { shared_classes: 4, stated: { n: 4, panel_more_severe: 3, coderabbit_more_severe: 0 } } },
    { stats: { label: "pilot-01__k3" }, overlap: { classes: 164, both: 5, panel_only: 134, coderabbit_only: 25, jaccard: 0.030 }, unresolved: { jaccard_upper_bound: 0.216, saturated: true, maybe_links: 376, strong_maybe_links: 18, triage_threshold: 0.7, coderabbit_classes_with_a_panel_candidate: 25 }, severity: { shared_classes: 5, stated: { n: 5, panel_more_severe: 2, coderabbit_more_severe: 3 } } },
  ],
};

/** A `reliability-v1` payload. `coderabbit_retest_pairs.one_armed` is the field that
 *  makes the second arm structurally unmeasurable rather than merely missing. */
const RELIABILITY = {
  schema_version: 1,
  bound: "lower",
  k_runs: 3,
  run_ids: RUNS,
  corpus_version: CORPUS_VERSION,
  items: ["pr-415", "pr-429", "pr-465", "pr-471", "pr-524", "pr-549", "pr-605"],
  coderabbit_retest_pairs: { n: 0, one_armed: true, reason: "every corpus item has exactly one finding-bearing CodeRabbit review, so no retest pair exists; CodeRabbit cannot be re-run" },
  jaccard: {
    across_pairs: { values: [0.438, 0.434, 0.43], n: 3, min: 0.43, max: 0.438, range: 0.008, mean: 0.434 },
    across_pairs_by_severity: {},
    unmerged_total: { maybe_cross_run: 5565, maybe_within_run: 148, match_held_apart: 244 },
  },
  recurrence: {
    overall: { n_classes: 245, k_runs: 3, in_all: { k: 56, n: 245, ratio: 56 / 245 }, in_one: { k: 118, n: 245, ratio: 118 / 245 } },
    by_severity: {
      critical: { n_classes: 4, in_all: { k: 0, n: 4, ratio: 0 }, in_one: { k: 4, n: 4, ratio: 1 } },
      major: { n_classes: 58, in_all: { k: 23, n: 58, ratio: 23 / 58 }, in_one: { k: 21, n: 58, ratio: 21 / 58 } },
      minor: { n_classes: 148, in_all: { k: 31, n: 148, ratio: 31 / 148 }, in_one: { k: 65, n: 148, ratio: 65 / 148 } },
      nit: { n_classes: 35, in_all: { k: 2, n: 35, ratio: 2 / 35 }, in_one: { k: 28, n: 35, ratio: 28 / 35 } },
    },
  },
  gate: { agreement: { k: 7, n: 7, ratio: 1 }, per_item: [], lane_census: [] },
  completeness: { verdict: "complete", reasons: [], corpus_item_count: 7 },
};

const FULL = () =>
  buildReport({
    configHash: CONFIG_HASH,
    corpusVersion: CORPUS_VERSION,
    panelSha: PANEL_SHA,
    runIds: RUNS,
    corpusItemIds: RELIABILITY.items,
    scores: { volume: VOLUME, complementarity: COMPLEMENTARITY, reliability: RELIABILITY },
  });

// --- the four availability states -------------------------------------------

test("a figure cannot be spelled without its n and its unit", () => {
  assert.deepEqual(figure(0.434, 3, "run pairs"), { availability: "present", value: 0.434, n: 3, unit: "run pairs" });
  // Decision 33: a summary statistic is not a distribution. A figure with no `n` is
  // the shape this project has published and had to correct more than once.
  for (const bad of [undefined, null, "3", NaN, -1]) {
    assert.throws(() => figure(0.434, bad, "run pairs"), /needs its n/, `n=${JSON.stringify(bad)} should be refused`);
  }
  // Decision 28: file-level and finding-level reproducibility reverse each other on
  // this data, so a unitless figure is ambiguous between two true answers.
  for (const bad of [undefined, null, "", "  ", 7]) {
    assert.throws(() => figure(0.434, 3, bad), /needs its unit/, `unit=${JSON.stringify(bad)} should be refused`);
  }
  // ZERO IS A MEASUREMENT, and must remain spellable.
  assert.equal(figure(0, 30, "findings").value, 0);
  assert.equal(figure(0, 0, "findings").n, 0);
});

test("the three absent flavours render as three different sentences, and none is blank", () => {
  const cells = {
    "not-computed": notComputed("the cost/latency scorer is not merged"),
    "not-measurable": notMeasurable("CodeRabbit cannot be re-run"),
    suppressed: suppressed(2, 5),
  };
  const rendered = Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, renderCell(c)]));
  assert.match(rendered["not-computed"], /\*\*not computed\*\* — the cost\/latency scorer is not merged/);
  assert.match(rendered["not-measurable"], /\*\*not measurable\*\* — CodeRabbit cannot be re-run/);
  assert.match(rendered.suppressed, /\*\*suppressed\*\*: n=2 < 5/);
  // All three distinct, and a real measured zero is a FOURTH thing that is none of
  // them. A blank cell that could mean any of the four is a scoring bug in
  // presentation form.
  const all = [...Object.values(rendered), renderCell(figure(0, 30, "findings"))];
  assert.equal(new Set(all).size, 4);
  for (const text of all) assert.notEqual(text.trim(), "");
  assert.equal(renderCell(figure(0, 30, "findings")), "0 (n=30 findings)");
  assert.deepEqual(AVAILABILITY, ["present", "not-computed", "not-measurable", "suppressed"]);
});

test("an absence with no reason is refused, because it is the blank cell under another name", () => {
  for (const bad of ["", "   ", null, undefined, 5]) {
    assert.throws(() => notComputed(bad), /needs a reason/, `${JSON.stringify(bad)} should be refused`);
    assert.throws(() => notMeasurable(bad), /needs a reason/, `${JSON.stringify(bad)} should be refused`);
  }
  // A suppressed cell must say what it failed. The threshold belongs to the
  // segmentation scorer, so a default here would caption its grid with a stale number.
  assert.throws(() => suppressed(2, undefined), /must carry both its n/);
  assert.throws(() => suppressed(undefined, 5), /must carry both its n/);
  assert.throws(() => suppressed("2", "5"), /must carry both its n/);
});

test("an unlabelled cell is refused rather than rendered as empty", () => {
  for (const bad of [null, undefined, {}, { availability: "maybe" }, { value: 3 }]) {
    assert.throws(() => renderCell(bad), /must carry one of/, `${JSON.stringify(bad)} should be refused`);
    assert.throws(() => renderValue(bad), /must carry one of/, `${JSON.stringify(bad)} should be refused`);
  }
});

test("renderValue drops the n/unit suffix only because unitOf supplies it elsewhere", () => {
  const f = figure(0.229, 245, "defect classes");
  assert.equal(renderCell(f), "0.229 (n=245 defect classes)");
  assert.equal(renderValue(f), "0.229");
  assert.equal(unitOf(f), "defect classes");
  // An absence has no unit, and printing one would imply a measurement behind it.
  assert.equal(unitOf(notComputed("unbuilt")), "—");
  // Absences still render as words through renderValue — that part is never optional.
  assert.match(renderValue(notComputed("unbuilt")), /\*\*not computed\*\*/);
});

// --- identity ---------------------------------------------------------------

test("the comparison id is DERIVED from the comparability key, not invented", () => {
  const id = comparisonIdFor({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION });
  assert.equal(id, `sha256-${CONFIG_HASH.slice(7)}__${CORPUS_VERSION}`);
  // `(config_hash, corpus_version)` is the store's comparability key, so a report
  // cannot be named without naming what it may be pooled with.
  assert.throws(() => comparisonIdFor({ configHash: "nope", corpusVersion: CORPUS_VERSION }), /config hash must be sha256/);
  assert.throws(() => comparisonIdFor({ configHash: CONFIG_HASH, corpusVersion: "../x" }), /corpus version must match/);
});

test("a report that cannot name its reviewer is refused", () => {
  // Decision 13: results from a different reviewer are unpoolable, and the reviewer
  // is the PAIR — `config_hash` cannot see the panel's own code, so a changed gate
  // leaves it identical. A report naming only half of it cannot be checked.
  for (const bad of [undefined, null, "", "   "]) {
    assert.throws(
      () => buildReport({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION, panelSha: bad }),
      /panel_sha is required/,
      `panel_sha=${JSON.stringify(bad)} should be refused`,
    );
  }
  assert.equal(FULL().reviewer.panel_sha, PANEL_SHA);
  assert.equal(FULL().reviewer.config_hash, CONFIG_HASH);
});

// --- volume, severity-stratified --------------------------------------------

test("the arm ratio is a RANGE over replicates, never one aggregate that picks a draw", () => {
  const v = volumeFigures(VOLUME);
  // 139/30 … 147/30. THE REGRESSION THIS TEST EXISTS FOR: the first draft divided by
  // `Math.max(...panelValues)` and published 4.9× where the project's own figure is
  // 4.7× (k1's 142), because the maximum is k2's 147. A small number, and it flattered
  // our arm through a choice of aggregator no reader could see.
  assert.equal(v.pooled_ratio.availability, "present");
  assert.equal(v.pooled_ratio.n, 3);
  assert.deepEqual(v.pooled_ratio.value.values.map((x) => Number(x.toFixed(3))), [4.733, 4.9, 4.633]);
  assert.equal(Number(v.pooled_ratio.value.min.toFixed(3)), 4.633);
  assert.equal(Number(v.pooled_ratio.value.max.toFixed(3)), 4.9);
  // The published 4.7× is INSIDE the range this renders, which is the property that
  // makes the range honest where any single aggregate is a choice.
  assert.ok(v.pooled_ratio.value.min <= 142 / 30 && 142 / 30 <= v.pooled_ratio.value.max);
  const rendered = renderReport(FULL());
  assert.match(rendered, /\*\*4\.6×–4\.9×\*\*/);
  assert.doesNotMatch(rendered, /\*\*4\.9×\*\*[^–]/);
});

test("a stratum the other arm never used is not measurable, and never Infinity", () => {
  const v = volumeFigures(VOLUME);
  const critical = v.rows.find((r) => r.severity === "critical");
  // CodeRabbit raised no `critical` findings on this corpus, so `panel ÷ coderabbit`
  // has no denominator. Infinity, an em-dash or a dropped row would each read as a
  // ratio so large it proves something; it proves only that the arm did not use the
  // label.
  assert.equal(critical.ratio.availability, "not-measurable");
  assert.match(critical.ratio.reason, /no denominator/);
  assert.equal(critical.coderabbit.value, 0);
  // The panel's own critical counts are still a real measurement beside it.
  assert.deepEqual(critical.panel_spread.values, [0, 3, 1]);
  const rendered = renderReport(FULL());
  assert.doesNotMatch(rendered, /Infinity|NaN|undefined/);
});

test("volume is stratified by severity, so no ratio is quoted without its mix", () => {
  const v = volumeFigures(VOLUME);
  assert.deepEqual(v.rows.map((r) => r.severity), ["critical", "major", "minor", "nit"]);
  assert.deepEqual(v.rows.find((r) => r.severity === "major").panel_spread.values, [36, 32, 32]);
  assert.equal(v.rows.find((r) => r.severity === "major").coderabbit.value, 3);
  const rendered = renderReport(FULL());
  // Each stratum's own ratio is on the page beside the pooled one, and the pooled one
  // is labelled as the figure that is not like-for-like.
  assert.match(rendered, /10\.7×–12\.0×/);
  assert.match(rendered, /not like-for-like/);
  assert.equal(volumeFigures([]).availability, "not-computed");
  assert.equal(volumeFigures(null).availability, "not-computed");
});

// --- overlap as a band ------------------------------------------------------

test("overlap renders as a band with its ceiling and its saturation note", () => {
  const c = complementarityFigures(COMPLEMENTARITY);
  assert.equal(c.bands.length, 3);
  assert.deepEqual(c.bands[0].band.value, { low: 0.036, high: 0.211 });
  assert.equal(c.bands[0].band.unit, "defect classes");
  assert.equal(c.all_saturated, true);
  // The band ACROSS replicates takes the lowest bound and the highest ceiling, so it
  // contains every replicate's own band.
  assert.deepEqual(c.overall.value, { low: 0.023, high: 0.216 });
  const rendered = renderReport(FULL());
  assert.match(rendered, /\*\*\[2\.3%, 21\.6%\]\*\*/);
  assert.match(rendered, /\*\*\[3\.6%, 21\.1%\]\*\*/);
  // The saturation warning, the unresolved-pair reading and the triage size are one
  // block: "24 unique to CodeRabbit" must never appear without them.
  assert.match(rendered, /ceiling is SATURATED on all 3 replicates/);
  assert.match(rendered, /means \*\*24 unresolved pairs\*\*, not 24 established misses/);
  assert.match(rendered, /17 score ≥ 0\.7/);
  assert.match(rendered, /must not be read as a point estimate/);
});

test("there is no code path that prints the overlap point without its ceiling", () => {
  const c = complementarityFigures(COMPLEMENTARITY);
  // The band is the PAIR: the accessor holds both, so a caller cannot reach for a
  // point-valued figure and get one.
  for (const b of c.bands) {
    assert.deepEqual(Object.keys(b.band.value).sort(), ["high", "low"]);
  }
  const rendered = renderReport(FULL());
  // Every rendered percentage that is a lower bound appears on a row that also shows
  // its ceiling. Checked structurally: the table's `band` column is present on every
  // data row of section 2.
  const rows = rendered.split("\n").filter((l) => /^\| `pilot-01__k\d` \|/.test(l));
  assert.equal(rows.length, 3);
  for (const row of rows) assert.match(row, /\*\*\[\d+\.\d%, \d+\.\d%\]\*\*/);
  assert.equal(complementarityFigures(null).availability, "not-computed");
  assert.equal(complementarityFigures({ per_replicate: [] }).availability, "not-computed");
});

test("the severity flip on one replicate is rendered as a flip, with its n", () => {
  const rendered = renderReport(FULL());
  // Panel harsher 5 · 3 · 2 against CodeRabbit harsher 0 · 0 · 3, over 6 · 4 · 5
  // shared classes. n is far too small for a claim, and that is the finding.
  assert.match(rendered, /flips sign/);
  assert.match(rendered, /6 · 4 · 5 classes/);
  assert.match(rendered, /too small for a claim/);
});

// --- reliability, one-armed -------------------------------------------------

test("reliability's second arm is not measurable, which is not the same as not computed", () => {
  const rl = reliabilityFigures(RELIABILITY);
  assert.equal(rl.coderabbit.availability, "not-measurable");
  assert.match(rl.coderabbit.reason, /retest pairs n=0/);
  assert.match(rl.coderabbit.reason, /cannot be re-run/);
  // A payload that does not say whether the arm is measurable is `not-computed` — the
  // renderer must not decide structural impossibility on the scorer's behalf.
  assert.equal(reliabilityFigures({ ...RELIABILITY, coderabbit_retest_pairs: null }).coderabbit.availability, "not-computed");
  assert.equal(reliabilityFigures(null).availability, "not-computed");
});

test("both reliability headlines are on the page, and each names its unit", () => {
  const rendered = renderReport(FULL());
  // The gate verdict reproduces and the finding set does not. Quoting either alone is
  // a different report, so both are in one table with their units beside them.
  assert.match(rendered, /gate verdict agreement \| \*\*1\.000\*\* \(7\/7\) \| items, each over all replicates/);
  assert.match(rendered, /0\.438 · 0\.434 · 0\.430 \(range 0\.008\)/);
  assert.match(rendered, /run pairs, over defect classes/);
  assert.match(rendered, /reproduces on 7 of 7 items/);
  assert.match(rendered, /in exactly one replicate \| \*\*0\.482\*\* \(118\/245\)/);
  // Stratified, because one number for "the panel" averages a 7/7 verdict against a
  // nit — and `major` beats the overall average, which is the reversal decision 28
  // is about.
  assert.match(rendered, /\| `major` \| 58 \| 0\.397 \| 0\.362 \|/);
  assert.match(rendered, /\| `nit` \| 35 \| 0\.057 \| 0\.800 \|/);
  assert.match(rendered, /\*\*lower bound\*\*: 5565 cross-run pairs/);
});

test("a missing reliability figure prints why rather than 'undefined'", () => {
  // The first draft reached into a cell's value without asking whether it held one and
  // rendered "reproduces on undefined of undefined items".
  const render = (reliability) =>
    renderReport(
      buildReport({
        configHash: CONFIG_HASH,
        corpusVersion: CORPUS_VERSION,
        panelSha: PANEL_SHA,
        runIds: RUNS,
        corpusItemIds: RELIABILITY.items,
        scores: { volume: VOLUME, complementarity: COMPLEMENTARITY, reliability },
      }),
    );
  const absent = render({ ...RELIABILITY, gate: {} });
  assert.doesNotMatch(absent, /undefined/);
  assert.match(absent, /\*\*not computed\*\* — gate agreement is null/);

  // 🔴 A HOLLOW FIGURE, NOT AN ABSENT ONE, and this is the case the test used to miss.
  // It only exercised `gate: {}`, which takes the absent-object path — so both bugs
  // below were live behind a green test. `renderValue` guards a cell that is ABSENT; by
  // the time a formatter runs on a cell that is PRESENT and hollow it is too late.
  //
  // (a) a proportion carrying `ratio` and `n` but no `k` reached the page as
  //     "**1.000** (undefined/7)" — a figure that looks entirely correct.
  const noK = structuredClone(RELIABILITY);
  delete noK.gate.agreement.k;
  const hollowGate = render(noK);
  assert.doesNotMatch(hollowGate, /undefined/);
  assert.match(hollowGate, /gate agreement is missing k/);

  // (b) a recurrence missing `in_all` threw a TypeError that aborted the WHOLE render,
  //     so the CLI exited 1 with no report at all rather than a report with one gap.
  const noInAll = structuredClone(RELIABILITY);
  delete noInAll.recurrence.overall.in_all;
  const hollowRecurrence = render(noInAll);
  assert.doesNotMatch(hollowRecurrence, /undefined/);
  assert.match(hollowRecurrence, /no usable recurrence figure \(in_all is null/);
  // The rest of the document still renders — one hollow field is not a failed report.
  assert.match(hollowRecurrence, /## 1\. Volume and severity mix/);
  assert.match(hollowRecurrence, /gate verdict agreement \| \*\*1\.000\*\* \(7\/7\)/);
});

// --- the two unbuilt sections ----------------------------------------------

test("cost and latency is 'not computed', and its cross-arm cell is 'not measurable'", () => {
  const cl = costLatencyFigures(null);
  // TWO FLAVOURS IN ONE SECTION, and they mean different things: nobody has run the
  // scorer (#791 is open), AND there is no cross-arm ratio even once it lands, because
  // CodeRabbit is a flat subscription with no per-review price.
  assert.equal(cl.availability, "not-computed");
  assert.match(cl.reason, /not merged/);
  assert.equal(cl.cross_arm.availability, "not-measurable");
  assert.match(cl.cross_arm.reason, /flat subscription/);
  const rendered = renderReport(FULL());
  assert.match(rendered, /absence of the first kind — nobody computed it — and it is not a zero/);
  // The store DOES hold each replay's cost, and the report says why it does not read
  // it rather than quietly not reading it.
  assert.match(rendered, /recomputed from the envelopes\n\*present\*/);
});

test("a suppressed segmentation cell says what it failed, and an unbuilt one says nobody built it", () => {
  // Today: unbuilt. The section exists so that it can say so — a report that omitted
  // it would overstate its own coverage.
  const absent = segmentationFigures(null);
  assert.equal(absent.availability, "not-computed");
  assert.match(renderReport(FULL()), /segmentation scorer is not built/);
  assert.match(renderReport(FULL()), /blank grid and an unbuilt grid look identical/);
  // When PR 14 lands: a thin cell is suppressed WITH its numbers, and a measured zero
  // stays a measured zero. Decision 12 predicted the whole grid would be suppressed on
  // a 7-item corpus and called that the correct output.
  const built = segmentationFigures({
    min_n: 5,
    cells: [
      { segment: "size=S", suppressed: true, n: 2, min_n: 5 },
      { segment: "size=L", value: 0, n: 6, unit: "findings" },
    ],
  });
  assert.equal(built.availability, "present");
  assert.equal(renderCell(built.cells[0].cell), "**suppressed**: n=2 < 5");
  assert.equal(renderCell(built.cells[1].cell), "0 (n=6 findings)");
  // "We measured nothing here" and "we measured zero here" are two different cells.
  assert.notEqual(renderCell(built.cells[0].cell), renderCell(built.cells[1].cell));
});

// --- the whole document -----------------------------------------------------

test("the report renders with no store, no filesystem and no network", () => {
  // Everything above this line is plain objects, and this is the assertion that says
  // so on purpose: the render path takes no root, opens nothing and calls nothing out.
  const markdown = renderReport(FULL());
  assert.equal(typeof markdown, "string");
  assert.ok(markdown.endsWith("\n"), "a document written to a file must end with a newline");
  assert.ok(markdown.length > 2000, "the report is a document, not a summary line");
  for (const section of SECTIONS) {
    // EVERY section appears in EVERY report, built or not.
    assert.ok(markdown.includes(sectionHeading(section.key)), `section ${section.key} is missing`);
  }
});

/** The heading text each section renders under, so the test names what it asserts
 *  rather than matching a regex nobody can read. */
function sectionHeading(key) {
  return {
    volume: "## 1. Volume and severity mix",
    complementarity: "## 2. Overlap between the arms",
    reliability: "## 3. Reliability — our panel only",
    cost_latency: "## 4. Cost and latency",
    segmentation: "## 5. Where each arm wins, by segment",
  }[key];
}

test("all three absent flavours appear in one rendered report, distinctly", () => {
  const markdown = renderReport(FULL());
  // On today's data the pilot report carries all three at once, which is why this is
  // checked on the real shape rather than only on constructed cells:
  //   not-computed    the cost/latency and segmentation scorers
  //   not-measurable  CodeRabbit retest pairs, and the critical-severity ratio
  //   a measured zero CodeRabbit's own critical count
  assert.match(markdown, /\*\*not computed\*\* — no cost-latency-v1 score is filed/);
  assert.match(markdown, /\*\*not computed\*\* — no segmentation-v1 score is filed/);
  assert.match(markdown, /\*\*not measurable\*\* — CodeRabbit retest pairs n=0/);
  assert.match(markdown, /\*\*not measurable\*\* — CodeRabbit raised none in this stratum/);
  assert.match(markdown, /\| `critical` \| 0 · 3 · 1 \(range 3\) \| 0 \|/);
  // And nothing anywhere is a bare empty table cell.
  for (const line of markdown.split("\n").filter((l) => l.startsWith("|"))) {
    assert.doesNotMatch(line, /\|\s*\|\s*\|/, `empty cell in: ${line}`);
  }
});

test("both caveats are on the page ABOVE the first number, not in a footer", () => {
  const markdown = renderReport(FULL());
  const caveats = markdown.indexOf("## Two things that qualify every number below");
  const firstTable = markdown.indexOf("## 1. Volume and severity mix");
  assert.ok(caveats > 0 && firstTable > caveats, "the caveats must precede the first section");
  // ① the self-review confound — one of the seven items is our panel reviewing its
  // own workflow files.
  assert.match(markdown, /pr-524.*agent-review-panel\.yml/s);
  assert.match(markdown, /it is a self-review/);
  // ② a single replicate is a sample, and the figure comes from the payload rather
  // than from a literal in this file.
  assert.match(markdown, /\*\*② 48\.2% of defect classes appear in exactly one replicate of 3\*\* \(118\/245\)/);
  // The frame goes above both: no human has judged whether a finding is real.
  assert.ok(markdown.indexOf("No human has judged whether a single finding") < caveats);
});

test("the report has no clock, so re-rendering one dataset is byte-identical", () => {
  // A `generated_at` would make two renders of one dataset differ, and a re-render
  // could then not be diffed against its predecessor to show that nothing moved.
  assert.equal(renderReport(FULL()), renderReport(FULL()));
  assert.doesNotMatch(renderReport(FULL()), /\d{4}-\d\d-\d\dT\d\d:/);
});

test("the spec's radar is refused on the page, with the reason", () => {
  const markdown = renderReport(FULL());
  assert.match(markdown, /asked for a radar chart and there is not one/);
  assert.match(markdown, /Reliability is one-armed/);
  assert.match(markdown, /no per-review\nprice for CodeRabbit/);
  assert.match(markdown, /the bias runs in our favour/);
});

test("the store's understated spend total is a stated limit, not a printed number", () => {
  const markdown = renderReport(FULL());
  // `putRun` recomputes totals from the envelopes PRESENT, and one failed attempt's
  // envelope was deleted during the K=3 repair. The caveat is on the page; the number
  // is not, because no scorer has published one.
  assert.match(markdown, /understates true spend/);
  assert.match(markdown, /envelopes \*present\*/);
  assert.doesNotMatch(markdown, /\$\d/);
});

test("SECTIONS is the contract, and a scorer id outside it cannot be filed", () => {
  assert.deepEqual(SCORER_IDS, ["volume-mix-v1", "complementarity-v1", "reliability-v1", "cost-latency-v1", "segmentation-v1"]);
  // `cost-latency-v1` is #791's own constant, so this PR reads the id that PR chose
  // rather than inventing a second name for the same file.
  assert.ok(SCORER_IDS.includes("cost-latency-v1"));
  for (const s of SECTIONS) {
    assert.ok(["per-run", "cross-run"].includes(s.scope), `${s.key} has scope ${s.scope}`);
    assert.match(s.scorer_id, /^[a-z0-9][a-z0-9-]*$/, `${s.scorer_id} must be a path segment`);
  }
  // One section per key, so a report cannot render the same scorer twice.
  assert.equal(new Set(SECTIONS.map((s) => s.key)).size, SECTIONS.length);
  assert.equal(new Set(SCORER_IDS).size, SCORER_IDS.length);
});

// --- the four defects found in review ---------------------------------------

test("a replicate with no score file is stated, not silently dropped from the range", () => {
  // 🔴 The CLI passes one entry per DECLARED replicate, with `null` where no score file
  // exists. An earlier version filtered the nulls out, so 2 of 3 files present rendered
  // "panel — 2 replicates" and a 2-value range while the document's header table listed
  // all 3 — the range then described a different K than the page claimed, and the only
  // trace of the third was a line on stderr.
  const holed = [VOLUME[0], null, VOLUME[2]];
  const v = volumeFigures(holed);
  assert.equal(v.availability, "present");
  assert.equal(v.replicates_declared, 3);
  assert.equal(v.replicates_missing, 1);
  assert.equal(v.replicates.length, 2);
  assert.deepEqual(v.contributing_run_ids, ["pilot-01__k1", "pilot-01__k3"]);
  // The totals are over the two that exist — 142 and 139, not 142/147/139.
  assert.deepEqual(v.panel_total.value.values, [142, 139]);

  const markdown = renderReport(
    buildReport({
      configHash: CONFIG_HASH,
      corpusVersion: CORPUS_VERSION,
      panelSha: PANEL_SHA,
      runIds: RUNS,
      corpusItemIds: RELIABILITY.items,
      scores: { volume: holed, complementarity: COMPLEMENTARITY, reliability: RELIABILITY },
    }),
  );
  // The discrepancy is ON THE PAGE, above the table, and names what contributed.
  assert.match(markdown, /🔴 \*\*1 of 3 declared replicate\(s\) have no volume score filed\*\*/);
  assert.match(markdown, /every range in this\nsection is over 2 draw\(s\), not 3/);
  assert.match(markdown, /Contributing: `pilot-01__k1`, `pilot-01__k3`/);
  // And a complete set says nothing, so the warning cannot become wallpaper.
  assert.doesNotMatch(renderReport(FULL()), /declared replicate\(s\) have no volume score/);
});

test("when the CodeRabbit arm reads differently across replicates, the TOTAL refuses too", () => {
  // 🔴 The per-severity rows already guarded on this; the bold total row did not, and
  // printed a confident ratio over replicate 0's denominator — the one the same
  // function had just declared unreliable. The bold row is the one a reader quotes.
  const disagreeing = structuredClone(VOLUME);
  const cr = disagreeing[1].segments.find((seg) => seg.arm === "coderabbit");
  cr.summary.findings = 31;
  cr.summary.severity.stated.counts.nit = 15;
  cr.summary.severity.stated.n = 31;
  const v = volumeFigures(disagreeing);
  assert.equal(v.coderabbit_consistent, false);
  assert.equal(v.pooled_ratio.availability, "not-measurable");
  assert.equal(v.coderabbit_total.availability, "not-measurable");
  // One reason, said the same way in the rows and in the total: it is the same fact.
  assert.match(v.pooled_ratio.reason, /reads differently across replicates/);
  assert.equal(v.rows.find((r) => r.severity === "nit").ratio.reason, v.pooled_ratio.reason);
  const markdown = renderReport(
    buildReport({
      configHash: CONFIG_HASH,
      corpusVersion: CORPUS_VERSION,
      panelSha: PANEL_SHA,
      runIds: RUNS,
      corpusItemIds: RELIABILITY.items,
      scores: { volume: disagreeing, complementarity: COMPLEMENTARITY, reliability: RELIABILITY },
    }),
  );
  // No ratio anywhere in the volume table — including the total row.
  const totalRow = markdown.split("\n").find((l) => l.startsWith("| **total**"));
  assert.match(totalRow, /not measurable/);
  assert.doesNotMatch(totalRow, /×/);
});

test("the caveats are derived from the corpus being rendered, not hard-coded", () => {
  // 🔴 An earlier version stated "one of the seven items … `pr-524`" and "three values"
  // unconditionally. The CLI renders any `--corpus-version` and any number of
  // `--run-id`, so on another corpus the page asserted a confound about an item it had
  // not measured — three lines under a header table printing the real item list.
  assert.ok(SELF_REVIEW_ITEMS["pr-524"], "pr-524 is the known self-review item");

  // The pilot corpus DOES contain it, so caveat ① fires with the real item count.
  const pilot = renderReport(FULL());
  assert.match(pilot, /\*\*① One of the 7 item\(s\) below is our panel reviewing its own plumbing\.\*\* `pr-524`/);
  assert.match(pilot, /column below carries 3 values rather than one/);

  // A corpus WITHOUT it says so, rather than claiming a confound it does not have.
  const other = renderReport(
    buildReport({
      configHash: CONFIG_HASH,
      corpusVersion: CORPUS_VERSION,
      panelSha: PANEL_SHA,
      runIds: [RUNS[0]],
      corpusItemIds: ["pr-999", "pr-1000"],
      scores: { volume: [VOLUME[0]], complementarity: COMPLEMENTARITY, reliability: RELIABILITY },
    }),
  );
  assert.match(other, /\*\*① No item in this corpus is one of the known self-review items\*\*/);
  assert.doesNotMatch(other, /pr-524 changes/);
  assert.doesNotMatch(other, /seven items/);
  // K=1: the panel column carries one value, and the page says not to read it as a
  // property of the panel rather than claiming "three values".
  assert.match(other, /carries a single value and must not be read as a property of the panel/);
  assert.doesNotMatch(other, /carries 3 values/);

  // K=2, which is the case that catches a hard-coded "3": K=1 takes the other branch
  // entirely and K=3 makes the literal and the derived value identical, so neither
  // would have failed on it. Mutation testing surfaced exactly this gap.
  const two = renderReport(
    buildReport({
      configHash: CONFIG_HASH,
      corpusVersion: CORPUS_VERSION,
      panelSha: PANEL_SHA,
      runIds: RUNS.slice(0, 2),
      corpusItemIds: RELIABILITY.items,
      scores: { volume: VOLUME.slice(0, 2), complementarity: COMPLEMENTARITY, reliability: RELIABILITY },
    }),
  );
  assert.match(two, /column below carries 2 values rather than one/);
  assert.doesNotMatch(two, /carries 3 values/);
});

test("the overlap band's wording follows the number of bands it actually has", () => {
  // The hard-coded "contains all three" was correct only at K=3. It is derived now, so a
  // single-replicate payload does not claim to contain three of anything.
  const one = { per_replicate: [COMPLEMENTARITY.per_replicate[0]] };
  const markdown = renderReport(
    buildReport({
      configHash: CONFIG_HASH,
      corpusVersion: CORPUS_VERSION,
      panelSha: PANEL_SHA,
      runIds: [RUNS[0]],
      corpusItemIds: RELIABILITY.items,
      scores: { volume: [VOLUME[0]], complementarity: one, reliability: RELIABILITY },
    }),
  );
  assert.match(markdown, /Across 1 replicate\(s\) the band is \*\*\[3\.6%, 21\.1%\]\*\*/);
  assert.match(markdown, /contains the single replicate's own band/);
  assert.doesNotMatch(markdown, /contains all 3/);
  // At K=3 it still says all three.
  assert.match(renderReport(FULL()), /contains all 3\./);
});
