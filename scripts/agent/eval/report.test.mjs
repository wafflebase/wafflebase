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
  LABEL_CAUSE,
  PRODUCTION_LATENCY_PAIR,
  SELF_REVIEW_ITEMS,
  SCORER_IDS,
  SECTIONS,
  buildReport,
  comparisonIdFor,
  withPanelStamp,
  complementarityFigures,
  costLatencyFigures,
  figure,
  notComputed,
  notMeasurable,
  reliabilityFigures,
  renderCell,
  renderReport,
  renderValue,
  qualityFigures,
  reviewerFigures,
  segmentationFigures,
  suppressed,
  unitOf,
  validityFigures,
  volumeFigures,
} from "./report.mjs";
// 🔴 THE VALIDITY FIXTURES ARE BUILT BY THE SCORER, not typed out here — and that is the
// point rather than a convenience. §6's whole job is to render four cell shapes that this
// file does not own: `precisionCell` carries `value`, `relativeRecallBand` carries
// `low`/`high` and deliberately NO `value`, and `fpProfile` carries a count beside a
// `share_availability`. A hand-written fixture would encode this session's GUESS at those
// shapes, and a renderer tested against a guess passes while the real payload renders
// blank — a bug at both ends of a round trip is invisible to the round trip. Importing
// costs nothing and adds no skip: `validity.mjs` reaches the Agent SDK through no path at
// all, and it already imports this module's `AVAILABILITY` in the other direction.
import { fpProfile, precisionCell, relativeRecallBand, scoreValidity } from "./validity.mjs";

const CONFIG_HASH = "sha256:1c7853debf4edf92646d2299b0c924cb48cca89d6bb68b81648c57508a762f01";
const CORPUS_VERSION = "2026-08-10-pilot-reviewed";
const PANEL_SHA = "46da673dd46dd5576626ee6d1b4e2e40728345e0";
// The pilot's panel by CONTENT. A digest, not a commit: `panel_sha` separates panels
// that are byte-identical (#830 deleted the panel and #850 returned it), and the digest
// is the half of the reviewer a cross-run score's path is keyed by.
const PANEL_DIGEST = "sha256:0a694f26c5ba4226dce778e049706564f6a6737f2db5e0356d145fb4acd07ac5";
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

/**
 * A `cost-latency-v1` payload, cut to the fields §4 reads — and the numbers are the
 * pilot's REAL ones, printed by the scorer against the real store on 2026-08-13.
 *
 * The three denominators are why they are real rather than round. The same seven pull
 * requests produce `n=3` (replicates), `n=7` (items, on the other arm) and `n=21`
 * (observations), and a fixture with one invented `n` would let a cell quote a figure
 * at the wrong denominator without anything going red. The two latency medians — ours
 * 9.3 min, theirs 6.8 — are the pair this section exists to keep apart.
 */
const COST_LATENCY = {
  schema_version: 2,
  scorer_id: "cost-latency-v1",
  scope: "cross-run",
  reviewer: { config_hash: CONFIG_HASH, panel_sha: PANEL_SHA, panel_digest: PANEL_DIGEST },
  corpus_version: CORPUS_VERSION,
  run_ids: RUNS,
  completeness: { verdict: "complete", reasons: [], corpus_item_count: 7, items_priced_in_every_replicate: RELIABILITY.items, totals_caveat: "every total here is recomputed from the envelopes present" },
  panel: {
    unit: "usd_per_review_metered",
    latency_interval: "panel-process-elapsed-on-offline-replay",
    replicates: [
      { run_id: "pilot-01__k1", cost_vs_size: { n: 7, min_n: 3, intercept_usd: 2.1978, slope_usd_per_1000_lines: 5.1988, fixed_share: 0.4675, reason: null } },
      { run_id: "pilot-01__k2", cost_vs_size: { n: 7, min_n: 3, intercept_usd: 2.1039, slope_usd_per_1000_lines: 4.4133, fixed_share: 0.4988, reason: null } },
      { run_id: "pilot-01__k3", cost_vs_size: { n: 7, min_n: 3, intercept_usd: 1.7734, slope_usd_per_1000_lines: 5.3777, fixed_share: 0.4066, reason: null } },
    ],
    per_item: [],
    by_size_bucket: [],
    replicate_spend_usd: { n: 3, min: 29.5323875, median: 30.4926709, max: 32.9072012, mean: 30.9774198, range: 3.3748137, spread_over_min: 0.1142 },
    review_cost_usd: { n: 21, min: 1.8934, median: 4.1731795, max: 7.5711, mean: 4.4253, range: 5.6777, spread_over_min: 2.9986 },
    review_wall_ms: { n: 21, min: 243928, median: 557075, max: 1128782, mean: 609095, range: 884854, spread_over_min: 3.6275 },
    duration_source: { n: 21, counts: { "review-timing.json": 21, absent: 0, "not-run": 0 }, unrecognised: {} },
  },
  coderabbit: {
    unit: "amortised_usd_per_pr",
    cost: { basis: "flat-subscription", metered: false, comparable_to_panel_cost: false, amortised_usd_per_pr: null, inputs: null, reason: "a flat subscription has no per-review price; an amortised one needs BOTH a list price and the pull-request volume it is spread over, and neither is in the store" },
    latency: {
      requested: true,
      n_items: 7,
      self_timed: { interval: "coderabbit-start-marker-to-first-finding", ms: { n: 7, min: 154000, median: 409000, max: 864000, mean: 417714, range: 710000, spread_over_min: 4.6104 }, n: 7, n_items: 7, n_measured: 7 },
      push_proxy: { interval: "earliest-check-run-start-to-first-finding", ms: { n: 5, min: 167000, median: 402000, max: 891000, mean: 413600, range: 724000, spread_over_min: 4.3353 }, n: 5, n_items: 7, n_measured: 7 },
      triggers: { automatic: 5, "on-demand": 2, unknown: 0 },
      census: { n: 7, ended: 7, self_timed: { measured: 7, poolable: 7, absent: {} }, push_proxy: { measured: 7, poolable: 5, absent: {} } },
      reason: null,
    },
  },
  cost_per_real_finding: null,
  declared_gaps: [
    {
      metric: "cost_per_real_finding",
      value: null,
      reason: "it needs CONFIRMED-REAL findings and no adjudicated labels exist yet. The available substitute — cost divided by all findings — is the worst option on the table precisely because it looks like this metric and would be quoted as it, while a reviewer that raised twice as many false findings would score twice as cheap",
      unblocked_by: "adjudicated labels",
    },
  ],
};

/** The full report with a segmentation section attached, so §5's own rendering can be
 *  asserted without rebuilding the whole input at each call. */
const withSegmentation = (built) => {
  const r = FULL();
  return { ...r, sections: { ...r.sections, segmentation: built } };
};

const FULL = (extraScores = {}) =>
  buildReport({
    configHash: CONFIG_HASH,
    corpusVersion: CORPUS_VERSION,
    panelSha: PANEL_SHA,
    panelDigest: PANEL_DIGEST,
    runIds: RUNS,
    corpusItemIds: RELIABILITY.items,
    scores: { volume: VOLUME, complementarity: COMPLEMENTARITY, reliability: RELIABILITY, ...extraScores },
  });

/**
 * One numbered section of the rendered markdown, header to header.
 *
 * Asserting against the WHOLE document is what let §4's own text be satisfied by a
 * sentence in §7, and the two say opposite things about where the production pair
 * belongs — so the tests that police that boundary have to be able to see it.
 */
/** Every markdown table in a chunk, as text — a contiguous run of pipe-rows. The unit
 *  the cross-arm guard checks, because two rows of one table are as divisible as one
 *  row of two columns. */
function tables(markdown) {
  const out = [];
  let cur = [];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("|")) cur.push(line);
    else if (cur.length) { out.push(cur.join("\n")); cur = []; }
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

function section(markdown, n) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${n}. `));
  assert.notEqual(start, -1, `the report has no section ${n}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## \d+\. /.test(l));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

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
  const id = comparisonIdFor({ configHash: CONFIG_HASH, panelDigest: PANEL_DIGEST, corpusVersion: CORPUS_VERSION });
  assert.equal(id, `sha256-${CONFIG_HASH.slice(7)}__sha256-${PANEL_DIGEST.slice(7)}__${CORPUS_VERSION}`);
  // `(config_hash, panel_digest, corpus_version)` is the store's comparability key, so
  // a report cannot be named without naming what it may be pooled with — and the PANEL
  // is in that name, because `config_hash` cannot see the panel's code and two panels
  // previously produced one report filename, the second overwriting the first.
  assert.throws(() => comparisonIdFor({ configHash: "nope", panelDigest: PANEL_DIGEST, corpusVersion: CORPUS_VERSION }), /config hash must be sha256/);
  assert.throws(() => comparisonIdFor({ configHash: CONFIG_HASH, panelDigest: PANEL_DIGEST, corpusVersion: "../x" }), /corpus version must match/);
  assert.throws(() => comparisonIdFor({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION }), /panel digest must be sha256/);
  // Two panels, one config, one corpus: two names. This is the collision the third
  // segment removes, and asserting it here is what keeps it removed.
  assert.notEqual(id, comparisonIdFor({ configHash: CONFIG_HASH, panelDigest: `sha256:${"f".repeat(64)}`, corpusVersion: CORPUS_VERSION }));
});

test("a filed cross-run score carries the panel AND how well it is attributed", () => {
  // The path is not part of the file, so both travel in the payload — and `putScore`
  // refuses a cross-run write where the two disagree.
  const read = { digest: PANEL_DIGEST, source: "envelopes", mixed: false, tally: [] };
  assert.deepEqual(withPanelStamp({ jaccard: 0.4 }, read), {
    jaccard: 0.4,
    panel_digest: PANEL_DIGEST,
    panel_digest_source: "envelopes",
  });
  // 🔴 `reconstructed` MUST SURVIVE THE STAMP. The pilot's replays predate `panel_digest`,
  // so filing their scores under the panel that really produced them means computing that
  // digest out of git now and STATING it — correct, and not an observation. A stamp that
  // hardcoded `files` would assert one, and it is the caller's answer that has to arrive
  // here rather than this function's opinion.
  assert.equal(withPanelStamp({ jaccard: 0.4 }, { ...read, source: "reconstructed" }).panel_digest_source, "reconstructed");
  // A `mixed` write additionally lists what it pooled, so the number can never be read
  // afterwards as one reviewer's.
  const mixed = withPanelStamp({ jaccard: 0.4 }, {
    digest: "mixed",
    source: "envelopes",
    mixed: true,
    tally: [{ digest: PANEL_DIGEST, items: 15 }, { digest: `sha256:${"9".repeat(64)}`, items: 1 }],
  });
  assert.deepEqual(mixed.panel_digests, [PANEL_DIGEST, `sha256:${"9".repeat(64)}`]);
  // ...and an unmixed one does not, because an empty list would read as "pooled nothing".
  assert.equal("panel_digests" in withPanelStamp({ jaccard: 0.4 }, read), false);
  // A per-run score is keyed by a run id whose envelopes pin their own panel, so it is
  // passed no panel and comes back untouched — not stamped with a null.
  assert.deepEqual(withPanelStamp({ findings: 142 }, null), { findings: 142 });
});

test("a report that cannot name its reviewer is refused", () => {
  // Decision 13: results from a different reviewer are unpoolable, and the reviewer
  // is the PAIR — `config_hash` cannot see the panel's own code, so a changed gate
  // leaves it identical. A report naming only half of it cannot be checked.
  for (const bad of [undefined, null, "", "   "]) {
    assert.throws(
      () => buildReport({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION, panelDigest: PANEL_DIGEST, panelSha: bad }),
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
  // its ceiling. Checked structurally: a `band` column is present on every data row of
  // section 2.
  //
  // ⟳ SIX ROWS SINCE §2 GAINED ITS DIRECTIONAL-RATE TABLE, and this assertion is why
  // that table's last column holds a band rather than a point. Its first draft printed
  // a bare `3.5%` under a `Jaccard` header — demoted beneath the two rates, but still
  // the lower bound of an interval, printed alone, in the first table of the section.
  // The bold is only on the band table's copy; the invariant is the ceiling, not the
  // emphasis.
  const rows = rendered.split("\n").filter((l) => /^\| `pilot-01__k\d` \|/.test(l));
  assert.equal(rows.length, 6);
  for (const row of rows) assert.match(row, /\[\d+\.\d%, \d+\.\d%\]/);
  assert.equal(rows.filter((r) => /\*\*\[\d+\.\d%, \d+\.\d%\]\*\*/.test(r)).length, 3);
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
    panelDigest: PANEL_DIGEST,
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

// --- §4, cost and latency ----------------------------------------------------

test("cost and latency with no score file is 'not computed', and its cross-arm cell is 'not measurable'", () => {
  const cl = costLatencyFigures(null);
  // TWO FLAVOURS IN ONE SECTION, and they mean different things: nobody ran the
  // scorer against this store, AND there is no cross-arm ratio even when they do,
  // because CodeRabbit is a flat subscription with no per-review price.
  assert.equal(cl.availability, "not-computed");
  assert.match(cl.reason, /nobody ran the cost\/latency scorer/);
  assert.equal(cl.cross_arm.availability, "not-measurable");
  assert.match(cl.cross_arm.reason, /flat subscription/);
  const rendered = renderReport(FULL());
  assert.match(rendered, /absence of the first kind — nobody computed it — and it is not a zero/);
  // The store DOES hold each replay's cost, and the report says why it does not read
  // it rather than quietly not reading it.
  assert.match(rendered, /recomputed from the envelopes\n\*present\*/);
});

test("§4 unpacks the payload: the panel's money and minutes, each with its own n and unit", () => {
  const cl = costLatencyFigures(COST_LATENCY);
  assert.equal(cl.availability, "present");
  // THREE DENOMINATORS OVER ONE CORPUS, and each cell says which it is. The same
  // seven pull requests are 3 replicates, 7 items or 21 observations depending on the
  // question, and decision 33 is that the figure carries the one it was measured at.
  assert.equal(cl.panel.spend.n, 3);
  assert.match(cl.panel.spend.unit, /replicates/);
  assert.equal(cl.panel.cost_per_review.n, 21);
  assert.match(cl.panel.cost_per_review.unit, /observations/);
  assert.equal(cl.panel.wall.n, 21);
  // Our minutes name OUR interval, in the unit, so the figure cannot travel without it.
  assert.match(cl.panel.wall.unit, /panel-process-elapsed-on-offline-replay/);
  const md = section(renderReport(FULL({ cost_latency: COST_LATENCY })), "4");
  assert.match(md, /\| spend per replicate \| \*\*\$30\.49 \(\$29\.53–\$32\.91\)\*\* \| replicates/);
  assert.match(md, /\| wall clock per review \| \*\*9\.3 min\*\* \(4\.1 min–18\.8 min\) \| observations, interval `panel-process-elapsed-on-offline-replay` \|/);
});

test("🔴 §4 CANNOT PRODUCE A CROSS-ARM LATENCY RATIO, with both arms' figures present", () => {
  // The state this test exists for: both arms have minutes, in the same section, on
  // the same page. 9.3 against 6.8 looks like a fair fight and is not one — ours times
  // a replay PROCESS, theirs a production reviewer end to end — so the division must
  // not be on the page, and it must not be one a reader can read off a shared row.
  const cl = costLatencyFigures(COST_LATENCY);
  assert.equal(cl.panel.wall.availability, "present");
  assert.equal(cl.coderabbit.latency.availability, "present");
  const ourMs = cl.panel.wall.value.median;
  const theirMs = cl.coderabbit.latency.value.median;
  const md = section(renderReport(FULL({ cost_latency: COST_LATENCY })), "4");

  // 1. NO QUOTIENT, in any of the ways one would be written. Computed from the
  //    fixture rather than hard-coded, so the guard follows the data if it moves.
  const quotients = [ourMs / theirMs, theirMs / ourMs];
  for (const q of quotients) {
    for (const s of [`${q.toFixed(1)}×`, `${q.toFixed(1)}x`, `${q.toFixed(2)}×`, `${q.toFixed(2)}x`, `${q.toFixed(1)} times`]) {
      assert.equal(md.includes(s), false, `§4 contains ${s}, which is one arm's minutes divided by the other's`);
    }
  }
  // 2. NO SHARED TABLE. A ratio a reader computes themselves is the one this section
  //    is shaped to prevent, and ADJACENCY is what invites it — so the unit of this
  //    check is the table, not the line.
  //
  //    🔴 Found by mutation: a per-line check passes happily when the two figures sit
  //    in two ROWS of one table, which is precisely the layout the recorded decision
  //    forbids ("separate keys, separate units, separate blocks, no ratio"). A reader
  //    divides what is next to each other; they do not need it on one line.
  const ours = cl.panel.interval;
  const theirs = cl.coderabbit.self_timed.interval;
  const ourMinutes = `${(ourMs / 60000).toFixed(1)} min`;
  const theirMinutes = `${(theirMs / 60000).toFixed(1)} min`;
  for (const table of tables(md)) {
    assert.equal(table.includes(ours) && table.includes(theirs), false, `one table carries both intervals, which is a shared axis:\n${table}`);
    assert.equal(table.includes(ourMinutes) && table.includes(theirMinutes), false, `one table carries both arms' minutes (${ourMinutes} and ${theirMinutes}), which is the subtraction done for the reader:\n${table}`);
  }
  // 3. And they are under separate headings, so the two tables cannot be read as one.
  assert.match(md, /### Our panel/);
  assert.match(md, /### CodeRabbit/);
  assert.ok(md.indexOf("### CodeRabbit") > md.indexOf("### Our panel"));
  // 4. THE CROSS-ARM CELL SAYS PERMANENTLY. `not-measurable` rather than
  //    `not-computed` is the whole point: a re-run does not close it.
  assert.equal(cl.cross_arm.availability, "not-measurable");
  assert.match(md, /\*\*not measurable\*\* — PERMANENTLY, and this is a result rather than a gap/);
  assert.equal(md.includes("not computed** — PERMANENTLY"), false);
});

test("§4 shows all four availability states, and a measured ZERO renders as present", () => {
  const withThinFit = {
    ...COST_LATENCY,
    panel: {
      ...COST_LATENCY.panel,
      // One replicate priced only two items, which is fewer than the scorer's own
      // `MIN_FIT_ITEMS`. That is MEASURED AND WITHHELD — the fourth state — and it
      // carries both the n it had and the n it wanted.
      replicates: [
        COST_LATENCY.panel.replicates[0],
        { run_id: "pilot-01__k2", cost_vs_size: { n: 2, min_n: 3, intercept_usd: null, slope_usd_per_1000_lines: null, fixed_share: null, reason: "a floor-plus-slope fit needs at least 3 items, got 2" } },
      ],
    },
  };
  const cl = costLatencyFigures(withThinFit);
  const states = new Set([
    cl.panel.wall.availability,
    cl.panel.untimed.availability,
    cl.coderabbit.cost.availability,
    cl.cost_per_real_finding.availability,
    cl.panel.fits[1].cell.availability,
  ]);
  assert.deepEqual([...states].sort(), [...AVAILABILITY].sort(), "§4 must exercise every one of the four states, or one of them is a shape nothing produces");
  // 🔴 A MEASURED ZERO IS `present`, NOT AN ABSENCE. 0 of 21 replays lacked a wall
  // clock; the cell must say so with its denominator, because `0` and a blank are the
  // same width on the page and opposite in meaning.
  assert.equal(cl.panel.untimed.availability, "present");
  assert.equal(cl.panel.untimed.value, 0);
  assert.equal(cl.panel.untimed.n, 21);
  const md = section(renderReport(FULL({ cost_latency: withThinFit })), "4");
  assert.match(md, /\| replays with no wall clock \| \*\*0\*\* of 21 \| envelopes \|/);
  assert.match(md, /\*\*suppressed\*\*: n=2 < 3/);
  // 🔴 THE THRESHOLD IS THE SCORER'S AND IS READ, not defaulted to today's value.
  // Found by mutation: hard-coding `3` here passes every assertion above, and would
  // keep captioning the grid with `< 3` after the scorer moved its own minimum —
  // a caption that contradicts the refusal it captions. So it is asserted against a
  // payload whose threshold is NOT 3.
  const moved = { ...withThinFit, panel: { ...withThinFit.panel, replicates: [withThinFit.panel.replicates[0], { run_id: "pilot-01__k2", cost_vs_size: { n: 4, min_n: 6, intercept_usd: null, slope_usd_per_1000_lines: null, fixed_share: null, reason: "a floor-plus-slope fit needs at least 6 items, got 4" } }] } };
  assert.match(section(renderReport(FULL({ cost_latency: moved })), "4"), /\*\*suppressed\*\*: n=4 < 6/);
  // And a NON-zero untimed count is a different number, so the zero above is read
  // rather than printed.
  const untimed = costLatencyFigures({ ...COST_LATENCY, panel: { ...COST_LATENCY.panel, duration_source: { n: 21, counts: { "review-timing.json": 19, absent: 1, "not-run": 1 }, unrecognised: {} } } });
  assert.equal(untimed.panel.untimed.value, 2);
});

test("cost per real finding stays a declared gap after the latency lands, with its reason", () => {
  const cl = costLatencyFigures(COST_LATENCY);
  // The scorer measured CodeRabbit's latency and still cannot price a real finding —
  // two absences with different causes, and only one of them closed.
  assert.equal(cl.coderabbit.latency.availability, "present");
  assert.equal(cl.cost_per_real_finding.availability, "not-computed");
  // THE SCORER'S OWN WORDS, not a second copy of them here: a reason the renderer
  // authored would drift from what the scorer actually refused to compute.
  assert.equal(cl.cost_per_real_finding.reason, COST_LATENCY.declared_gaps[0].reason);
  assert.equal(cl.cost_per_real_finding_unblocked_by, "adjudicated labels");
  const md = section(renderReport(FULL({ cost_latency: COST_LATENCY })), "4");
  assert.match(md, /Cost per real finding: \*\*not computed\*\* — it needs CONFIRMED-REAL findings/);
  assert.match(md, /Unblocked by: adjudicated labels\./);
});

test("a schema-1 payload with no latency block renders the gap, it does not throw", () => {
  // A store may hold a score written before the arm's timing read was wired in. The
  // renderer must degrade to the payload's own reason rather than crash, because a
  // renderer that cannot re-render last week's score file cannot be diffed against it
  // — which is what this module's purity is for.
  const old = {
    ...COST_LATENCY,
    schema_version: 1,
    coderabbit: { unit: "amortised_usd_per_pr", cost: COST_LATENCY.coderabbit.cost, latency: { wall_ms: null, reason: "MEASURABLE, and not from anything this scorer reads" } },
    declared_gaps: [...COST_LATENCY.declared_gaps, { metric: "coderabbit_latency_ms", value: null, reason: "MEASURABLE, and not from anything this scorer reads", unblocked_by: "a timing read in the arm's adapter" }],
  };
  const cl = costLatencyFigures(old);
  assert.equal(cl.availability, "present");
  assert.equal(cl.coderabbit.latency.availability, "not-computed");
  assert.match(cl.coderabbit.latency.reason, /MEASURABLE, and not from anything this scorer reads/);
  assert.equal(cl.coderabbit.latency_secondary, null);
  const md = section(renderReport(FULL({ cost_latency: old })), "4");
  assert.match(md, /\| latency \| \*\*not computed\*\* — MEASURABLE/);
  // The panel's own figures still render — one arm's absence is not the section's.
  assert.match(md, /wall clock per review \| \*\*9\.3 min\*\*/);
  // And no interval is captioned onto a figure that does not exist.
  assert.equal(md.includes("coderabbit-start-marker-to-first-finding"), false);
});

test("a latency figure with no interval name is REFUSED, not captioned 'unnamed'", () => {
  // The caption and the number must fail together. A renderer that fell back to a
  // constant of its own would keep printing the old interval after the scorer changed
  // which instant it starts from, and nothing would go red.
  const noInterval = {
    ...COST_LATENCY,
    coderabbit: { ...COST_LATENCY.coderabbit, latency: { ...COST_LATENCY.coderabbit.latency, self_timed: { ...COST_LATENCY.coderabbit.latency.self_timed, interval: "" } } },
  };
  assert.throws(() => costLatencyFigures(noInterval), /carries no interval name/);
});

test("§7 bounds §4's minutes with the n=2 production pair, and §4 does not print it", () => {
  const rendered = renderReport(FULL({ cost_latency: COST_LATENCY }));
  // S2: the honest comparison does not flatter us, and it belongs in the limits with
  // its `n` rather than as a headline over two data points.
  const limits = section(rendered, "7");
  assert.match(limits, /§4's latency understates our panel, and here is the measurement that says so — n=2/);
  assert.match(limits, /ours \*\*18\.7 and 19\.0 min\*\*, theirs \*\*8\.0 and 8\.6 min\*\*/);
  // 🔴 THE RATIO MUST AGREE WITH THE MINUTES ON ITS OWN LINE, and it is checked by
  // recomputing it from the constant rather than by pinning a literal. Found in
  // review: the first version printed a hard-coded `2.2x` beside four numbers whose
  // mean ratio is 2.3, so the sentence contradicted its own inputs and a literal
  // assertion happily agreed with it. Recomputing here means the test cannot bless a
  // number the pair does not support.
  const pairs = Object.values(PRODUCTION_LATENCY_PAIR);
  const expected = (pairs.reduce((a, p) => a + p.panel_min / p.coderabbit_min, 0) / pairs.length).toFixed(1);
  assert.match(limits, new RegExp(`about \\*\\*${expected}x longer\\*\\*`));
  assert.equal(expected, "2.3", "the pilot pair's mean ratio, recorded so a change to the constants is visible here");
  // NOT in §4, which is the half that keeps it from becoming the headline.
  const four = section(rendered, "4");
  assert.equal(four.includes(`${expected}x`), false, "the production pair in §4 is a headline ratio over two data points");
  assert.equal(four.includes("18.7"), false);
});

test("a fit refused for too few points is RE-RUNNABLE, never 'not measurable'", () => {
  // Found in review. A scorer that states no threshold used to land in
  // `notMeasurable`, which means "no such quantity exists however long anyone runs
  // anything" — and a third priced item disproves that outright. The label decides
  // what a reader does next: stop, or score more replicates.
  const refused = { n: 2, intercept_usd: null, slope_usd_per_1000_lines: null, fixed_share: null, reason: "a floor-plus-slope fit needs at least 3 items, got 2" };
  const noThreshold = { ...COST_LATENCY, panel: { ...COST_LATENCY.panel, replicates: [{ run_id: "pilot-01__k1", cost_vs_size: refused }] } };
  const cell = costLatencyFigures(noThreshold).panel.fits[0].cell;
  assert.equal(cell.availability, "not-computed", "a refusal a third item would lift is not structural");
  assert.match(cell.reason, /needs at least 3 items, got 2/);
  assert.match(section(renderReport(FULL({ cost_latency: noThreshold })), "4"), /\*\*not computed\*\* — a floor-plus-slope fit needs at least 3 items/);
  // The no-spread-in-x refusal is the same species — more items with different sizes
  // would fit it — so it is not structural either.
  const flat = { ...refused, n: 3, reason: "every item is the same size, so there is no slope to fit" };
  assert.equal(costLatencyFigures({ ...COST_LATENCY, panel: { ...COST_LATENCY.panel, replicates: [{ run_id: "k", cost_vs_size: flat }] } }).panel.fits[0].cell.availability, "not-computed");
  // And WITH a stated threshold it is still the fourth state, carrying both numbers.
  assert.equal(costLatencyFigures({ ...COST_LATENCY, panel: { ...COST_LATENCY.panel, replicates: [{ run_id: "k", cost_vs_size: { ...refused, min_n: 3 } }] } }).panel.fits[0].cell.availability, "suppressed");
});

test("a latency cell's n follows the SERIES that was validated, not its parent", () => {
  // Found in review, and it needs a fixture where the two disagree: in today's producer
  // `self_timed.n` and `self_timed.ms.n` are equal by construction, so reading the
  // wrong one is invisible. `series()` validates `ms.n`; printing a sibling count is a
  // denominator nobody checked.
  const drifted = {
    ...COST_LATENCY,
    coderabbit: {
      ...COST_LATENCY.coderabbit,
      latency: {
        ...COST_LATENCY.coderabbit.latency,
        self_timed: { ...COST_LATENCY.coderabbit.latency.self_timed, n: 99 },
        // No sibling count at all — `figure` refuses a non-finite `n`, so reading the
        // parent here aborted the whole render rather than printing one bad cell.
        push_proxy: { interval: "earliest-check-run-start-to-first-finding", ms: { n: 5, min: 167000, median: 402000, max: 891000, mean: 413600 } },
      },
    },
  };
  const cl = costLatencyFigures(drifted);
  assert.equal(cl.coderabbit.latency.n, 7, "the series says 7; the parent says 99");
  assert.equal(cl.coderabbit.latency_secondary.n, 5, "and a parent with no count at all must not reach `figure`");
  assert.match(section(renderReport(FULL({ cost_latency: drifted })), "4"), /\*\*6\.8 min\*\* \(2\.6 min–14\.4 min\) \| items, interval/);
});

test("§7's latency limit survives a payload with OUR minutes and not CodeRabbit's", () => {
  // Found in review. The gate required CodeRabbit's latency to be `present`, so on a
  // score file carrying our wall clock and not theirs — the shape every scorer run
  // produces until the arm's timing read is wired in — the caveat vanished entirely,
  // fallback included. That is the payload where it matters most: §4 prints OUR
  // minutes and nothing bounds how they may be read against a number a reader already
  // has. Absence of a caveat is indistinguishable from "there is nothing to caveat".
  const ourMinutesOnly = {
    ...COST_LATENCY,
    coderabbit: { ...COST_LATENCY.coderabbit, latency: { wall_ms: null, reason: "the arm's timing read was not supplied" } },
    declared_gaps: [...COST_LATENCY.declared_gaps, { metric: "coderabbit_latency_ms", value: null, reason: "the arm's timing read was not supplied", unblocked_by: "passing the records" }],
  };
  const cl = costLatencyFigures(ourMinutesOnly);
  assert.equal(cl.panel.wall.availability, "present");
  assert.equal(cl.coderabbit.latency.availability, "not-computed");
  assert.match(section(renderReport(FULL({ cost_latency: ourMinutesOnly })), "7"), /§4's latency understates our panel/);
  // And with NEITHER arm's minutes there is genuinely nothing to bound, so it is silent.
  const noMinutes = { ...ourMinutesOnly, panel: { ...ourMinutesOnly.panel, review_wall_ms: { n: 0, min: null, median: null, max: null, mean: null } } };
  assert.equal(costLatencyFigures(noMinutes).panel.wall.availability, "not-computed");
  assert.equal(section(renderReport(FULL({ cost_latency: noMinutes })), "7").includes("§4's latency understates"), false);
});

test("OUR minutes refuse an unnamed interval too, symmetrically with CodeRabbit's", () => {
  // Found in review: this side fell back to the literal `unnamed` while the other arm
  // refused. Ours is the figure a reader is likeliest to quote against theirs, so an
  // unnamed interval here is exactly how the two come to look commensurable.
  const noInterval = { ...COST_LATENCY, panel: { ...COST_LATENCY.panel, latency_interval: null } };
  assert.throws(() => costLatencyFigures(noInterval), /carries no interval name/);
  assert.equal(renderReport(FULL({ cost_latency: COST_LATENCY })).includes("interval `unnamed`"), false);
});

test("the CodeRabbit block renders its second anchor and says why it pools fewer items", () => {
  // Both were rendered by new code that no test read. The second anchor is the row a
  // reader is most likely to mistake for a disagreement, and the paragraph is the only
  // thing on the page that explains why its `n` is smaller.
  const md = section(renderReport(FULL({ cost_latency: COST_LATENCY })), "4");
  assert.match(md, /\| latency, second anchor \| 6\.7 min \(2\.8 min–14\.8 min\) \| items, interval `earliest-check-run-start-to-first-finding` \|/);
  assert.match(md, /The two anchors agree on the 5 automatically-triggered item\(s\)/);
  assert.match(md, /2 on-demand one\(s\): where a human asked for the review, the second anchor times the human's delay in/);
  // The secondary ROW is absent, not "n/a", when the payload has no push proxy — the
  // row, not the phrase: the paragraph above explains what the second anchor is and
  // says so whether or not there is a figure, which is why this checks the table.
  const noProxy = { ...COST_LATENCY, coderabbit: { ...COST_LATENCY.coderabbit, latency: { ...COST_LATENCY.coderabbit.latency, push_proxy: null } } };
  assert.equal(costLatencyFigures(noProxy).coderabbit.latency_secondary, null);
  assert.equal(section(renderReport(FULL({ cost_latency: noProxy })), "4").includes("| latency, second anchor |"), false);
});

test("a PRESENT cost-vs-size fit renders its money and its percentage, not just the withheld case", () => {
  // Only the suppressed row was asserted, so the formatting of the row that actually
  // renders on every real payload was uncovered — including `fixed_share`, which is a
  // fraction and reads as 0.4675 rather than 46.8% if it misses the percent formatter.
  const md = section(renderReport(FULL({ cost_latency: COST_LATENCY })), "4");
  assert.match(md, /\| `pilot-01__k1` \| \$2\.20 per item \+ \$5\.20 per 1000 lines — 46\.8% of the replicate is the per-item floor \|/);
  assert.equal(md.includes("0.4675"), false, "a raw fraction where a percentage belongs");
});

test("a PRESENT CodeRabbit price renders as a figure, and only when both inputs exist", () => {
  // The `present` branch of this cell had never been exercised: every payload so far
  // carries a null price, because nobody has stated the subscription terms.
  const priced = {
    ...COST_LATENCY,
    coderabbit: { ...COST_LATENCY.coderabbit, cost: { basis: "flat-subscription", metered: false, comparable_to_panel_cost: false, amortised_usd_per_pr: 3, inputs: { list_price_usd_per_month: 30, prs_per_month: 10 }, reason: null } },
  };
  const cl = costLatencyFigures(priced);
  assert.equal(cl.coderabbit.cost.availability, "present");
  assert.equal(cl.coderabbit.cost.value, 3);
  assert.match(cl.coderabbit.cost.unit, /amortised USD per pull request/);
  const md = section(renderReport(FULL({ cost_latency: priced })), "4");
  assert.match(md, /\| cost per review \| 3 \(n=1 amortised USD per pull request/);
  // 🔴 EVEN PRICED, IT IS NOT COMPARABLE. An amortised subscription share opposite a
  // metered per-review cost is the cross-arm division this section exists to prevent,
  // and the permanent cell must not soften because a number appeared.
  assert.equal(cl.cross_arm.availability, "not-measurable");
  for (const table of tables(md)) {
    assert.equal(table.includes("$4.17") && table.includes("amortised"), false, "the two arms' prices share a table");
  }
});

test("the production-latency pair is intersected with the corpus, never asserted over it", () => {
  // Same rule as the self-review caveat: it is a fact about two specific commits, so a
  // report over a corpus without them must not claim it — and must still say that it
  // could not bound the figure, because "unmeasured" and "not thought of" are the
  // distinction this module is built around.
  const other = buildReport({
    configHash: CONFIG_HASH,
    corpusVersion: "some-other-corpus",
    panelSha: PANEL_SHA,
    panelDigest: PANEL_DIGEST,
    runIds: RUNS,
    corpusItemIds: ["pr-101", "pr-102"],
    scores: { volume: VOLUME, complementarity: COMPLEMENTARITY, reliability: RELIABILITY, cost_latency: COST_LATENCY },
  });
  const limits = section(renderReport(other), "7");
  assert.match(limits, /no production pair to bound them on this corpus/);
  assert.equal(limits.includes("18.7"), false, "a corpus without pr-549 must not be told about pr-549's timings");
});

// --- §2's adjudication budget ------------------------------------------------

test("§2 distinguishes the FLOOR's budget from the CEILING's, and does not call it tens of pairs", () => {
  const md = section(renderReport(FULL()), "2");
  const k1 = COMPLEMENTARITY.per_replicate[0].unresolved;
  // 🔴 THE DEFECT THIS REPLACES. The old sentence read the ≥ threshold head as the
  // whole cost — "so adjudicating this costs tens of pairs rather than hundreds" —
  // which conflates the two bounds. The head moves the FLOOR; the ceiling does not
  // move until a CodeRabbit finding has every one of its pairs decided, and that is a
  // budget in the hundreds.
  assert.equal(md.includes("costs tens of"), false, "the old sentence understates the ceiling's budget by an order of magnitude");
  assert.match(md, /hundreds of decisions, not tens/);
  assert.match(md, /\*\*The floor\*\* rises when a pair is labelled `same`/);
  assert.match(md, /\*\*The ceiling\*\* only falls when a CodeRabbit finding has EVERY one of its pairs decided/);
  // Both numbers come from the payload and are labelled with which bound they buy.
  assert.match(md, new RegExp(`The queue is ${k1.maybe_links} undecided pairs`));
  assert.match(md, new RegExp(`\\*\\*${k1.strong_maybe_links} score ≥ ${k1.triage_threshold}\\*\\*`));
  assert.match(md, new RegExp(`${k1.coderabbit_classes_with_a_panel_candidate} of this replicate's findings carry an undecided panel candidate`));
  // AND IT SAYS WHICH REPLICATE. The figures are k1's; the table three lines above
  // lists three, and an unlabelled queue size reads as all of them.
  assert.match(md, /on `pilot-01__k1`/);
  // The one deduction that is real and not derivable here is NAMED as not stated,
  // rather than approximated into the sentence.
  assert.match(md, /needs a per-finding pair count this\nscorer does not emit, so it is not stated here as a number/);
});

test("a segmentation value is formatted, not stringified — the fmt parameter is passed", () => {
  // 🔴 §5 is the FIRST table whose values pass through `renderCell` rather than being
  // formatted by its caller, so it is the first place the raw `String(v)` default
  // shows. Plan PR 14 round-tripped 149 real cells and found this one printing
  // `0.6944444444444444`. The fixtures could not have caught it: the only two values
  // they fed `renderCell` were `0.229` and `0`, both of which `String()` renders
  // correctly. This one is `25/36`, which is what a real `k/n` looks like.
  const built = segmentationFigures({
    min_n: 5,
    axes: [{ id: "severity", status: "computed", arms: ["panel", "coderabbit"] }],
    metrics: [{ id: "in_diff_rate", spec: "§3.1 — scope discipline: share of findings anchored inside a changed region" }],
    cells: [{ segment: "metric=in_diff_rate/severity=major/arm=panel", metric: "in_diff_rate", axis: "severity", bucket: "major", arm: "panel", suppressed: false, value: 25 / 36, n: 36, unit: "findings" }],
  });
  // The cell itself still holds the full-precision value — formatting is the renderer's
  // job, not the extractor's.
  assert.equal(built.cells[0].cell.value, 25 / 36);
  assert.match(renderReport(withSegmentation(built)), /\| `severity=major` \| 0\.694 · n=36 \|/);
  assert.doesNotMatch(renderReport(withSegmentation(built)), /0\.6944444/);

  // 🔴 AND THE DEFAULT IS UNCHANGED, which is the other half of the instruction: a
  // measured zero stays a bare `0` rather than becoming `0.000`, which would read as a
  // precision this data does not have.
  assert.equal(renderCell(figure(0, 30, "findings")), "0 (n=30 findings)");
});

test("an axis nobody can build is rendered, not silently dropped", () => {
  // 🔴 THIS INVERTED THIS MODULE'S OWN ARGUMENT. The four availability states existed
  // per CELL and not per AXIS, so an axis with no cells at all — `defect_type` needs
  // adjudicated labels that do not exist — vanished from the published report while the
  // scorer's console output named it. That is the silent drop the design argues against.
  const built = segmentationFigures({
    min_n: 5,
    axes: [
      { id: "severity", status: "computed" },
      { id: "defect_type", status: "not-computed", reason: "defect type is assigned at adjudication and no adjudicated labels exist, so there is nothing to cut by" },
      { id: "window", status: "not-selected", reason: "not requested for this run" },
    ],
    cells: [{ segment: "metric=nit_ratio/severity=major/arm=panel", suppressed: false, value: 0.5, n: 36, unit: "findings" }],
  });
  // A computed axis has no absence cell — it is in the grid.
  assert.equal(built.axes.find((a) => a.id === "severity").cell, null);
  assert.equal(built.axes.find((a) => a.id === "defect_type").cell.availability, "not-computed");
  const markdown = renderReport(withSegmentation(built));
  assert.match(markdown, /Axes declared but absent from the grid:/);
  assert.match(markdown, /\| `defect_type` \| \*\*not computed\*\* — defect type is assigned at adjudication/);
  assert.match(markdown, /\| `window` \| \*\*not computed\*\* — not requested for this run \|/);
  assert.doesNotMatch(markdown, /\| `severity` \| \*\*not computed/);
  // An axis the scorer declared without a reason still renders, naming that gap.
  const noReason = segmentationFigures({ axes: [{ id: "mystery", status: "not-computed" }], cells: [] });
  assert.match(renderCell(noReason.axes[0].cell), /gave no reason/);
});

test("§5 states the split the grid actually produced, not the one decision 12 predicted", () => {
  // 🔴 The caption said "every cell is expected to be suppressed". Plan PR 14 measured
  // 76 of 149 reporting — 51%. True per PULL REQUEST, false per FINDING; decision 38.
  const built = segmentationFigures({
    min_n: 5,
    min_n_source: "spec §4.1 default",
    axes: [],
    cells: [
      { segment: "a", suppressed: false, value: 0.5, n: 36, unit: "findings" },
      { segment: "b", suppressed: true, n: 4, min_n: 5 },
      { segment: "c", suppressed: true, n: 0, min_n: 5 },
    ],
  });
  assert.equal(built.reported, 1);
  assert.equal(built.withheld, 2);
  const markdown = renderReport(withSegmentation(built));
  assert.match(markdown, /\*\*1 of 3 cells report; 2 are withheld\*\* for a denominator below min-n = 5 \(spec §4\.1 default\)/);
  assert.match(markdown, /cannot be read as a measured zero/);

  // And the unbuilt-scorer caption now names its unit rather than predicting a blank
  // grid outright.
  const absent = renderReport(FULL());
  assert.match(absent, /every PER-PULL-REQUEST cell is expected to be suppressed/);
  assert.match(absent, /PER-FINDING cells are not/);
  assert.doesNotMatch(absent, /every cell is expected to be suppressed/);
});

test("§7 says which cross-arm rows measure GitHub rather than a reviewer", () => {
  // 🔴 Decision 40. CodeRabbit's localisation and in-diff rates are exactly 1.000 in
  // all 22 reporting cells because an inline comment is anchored to a diff line by
  // construction — a fact about the comment API, not about reviewer discipline.
  const markdown = renderReport(FULL());
  assert.match(markdown, /measure GitHub, not a reviewer/);
  assert.match(markdown, /anchored to a diff line by\nconstruction/);
  assert.match(markdown, /only the nit ratio compares the reviewers/);
  // It sits with the radar refusal, which is the same species of argument.
  const radar = markdown.indexOf("asked for a radar chart");
  const github = markdown.indexOf("measure GitHub, not a reviewer");
  assert.ok(radar > 0 && github > radar, "the GitHub caveat belongs beside the radar refusal in §7");
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

// --- §5's grid ---------------------------------------------------------------
//
// A `segmentation-v1` payload shaped like the real one: the cube's three coordinates
// travel beside the flat label, so the renderer can rebuild the grid instead of
// printing the label. The numbers are the pilot's own, off
// `scores/by-config/…__2026-08-10-pilot-reviewed/segmentation-v1.json`, because the
// thing under test is a LAYOUT over real proportions — CodeRabbit's cells are exactly
// 1.000 and the panel's are not, and a fixture of round invented numbers would hide
// that the two arms now sit on one line where that is finally visible.

/**
 * The document with its line folds removed, for asserting a SENTENCE the renderer
 * wraps to the report's prose width. Where the fold lands is a property of how long
 * a payload's bucket names happen to be, not of anything under test, so pinning it
 * would make an unrelated fixture edit redden a layout test. Table rows are asserted
 * against the raw document, where the line break is structural.
 */
const unwrapped = (md) => md.replace(/\n/g, " ");

/** One cell in the scorer's own shape, label included, so a test asserting the grid
 *  cannot pass on a payload the scorer would never emit. */
const segCell = (metric, axis, bucket, arm, rest) => ({
  segment: `metric=${metric}/${axis}=${bucket}/arm=${arm}`,
  metric,
  axis,
  bucket,
  arm,
  min_n: 5,
  ...rest,
});

const PANEL_UNIT = "findings; median of 3 replicates";
const CODERABBIT_UNIT = "findings; single observation";

const SEGMENTATION = () => ({
  min_n: 5,
  min_n_source: "spec §4.1 default",
  axes: [
    { id: "severity", unit: "finding", status: "computed", arms: ["panel", "coderabbit"] },
    { id: "novelty", unit: "finding", status: "computed", arms: ["panel"] },
    { id: "defect_type", unit: "finding", status: "not-computed", arms: [], reason: "defect type is assigned at adjudication and no adjudicated labels exist" },
  ],
  metrics: [
    { id: "localization_rate", currency: "finding", spec: "§3.1 — share of findings citing a file and line that resolves against the frozen diff" },
    { id: "findings_per_pr", currency: "item", spec: "§3.1 — findings per pull request" },
  ],
  pairs_not_computed: [
    // Refused for what the pair MEANS — rendered, with the scorer's reason.
    { metric: "localization_rate", axis: "novelty", reason: "the novelty annotation is stamped ONLY on critical/major findings" },
    // Refused for a unit mismatch — one fact repeated across the per-PR metrics.
    { metric: "findings_per_pr", axis: "novelty", reason: "findings_per_pr is counted in PRs and novelty cuts findings, so every bucket would share one denominator" },
  ],
  cells: [
    // severity: one bucket both arms report, one where only the panel does, one
    // withheld on both.
    segCell("localization_rate", "severity", "minor", "panel", { suppressed: false, value: 70 / 89, n: 89, unit: PANEL_UNIT }),
    segCell("localization_rate", "severity", "minor", "coderabbit", { suppressed: false, value: 1, n: 13, unit: CODERABBIT_UNIT }),
    segCell("localization_rate", "severity", "major", "panel", { suppressed: false, value: 25 / 32, n: 32, unit: PANEL_UNIT }),
    segCell("localization_rate", "severity", "major", "coderabbit", { suppressed: true, n: 3 }),
    segCell("localization_rate", "severity", "critical", "panel", { suppressed: true, n: 0 }),
    segCell("localization_rate", "severity", "critical", "coderabbit", { suppressed: true, n: 0 }),
    // A one-armed axis: `novelty` reads a field only the panel's records carry.
    segCell("localization_rate", "novelty", "pre-existing", "panel", { suppressed: false, value: 5 / 13, n: 13, unit: PANEL_UNIT }),
    // A metric counted in PRs, withheld everywhere on a 7-item corpus.
    segCell("findings_per_pr", "severity", "minor", "panel", { suppressed: true, n: 4 }),
    segCell("findings_per_pr", "severity", "minor", "coderabbit", { suppressed: true, n: 4 }),
  ],
});

test("🔴 §5 is a grid per metric with the ARMS AS COLUMNS, not a list of composite keys", () => {
  // 🔴 THE DEFECT. `renderSegmentation` did `for (const c of sg.cells)` over a flat
  // array and emitted the cube — metric × bucket × arm — as 149 one-dimensional
  // `metric=…/…=…/arm=…` keys, two columns, 163 lines, 34% of the report. The grouping
  // was in the payload the whole time: `segmentLabel`'s own comment says the three
  // components travel beside the flat label precisely so a consumer can regroup them.
  const md = renderReport(withSegmentation(segmentationFigures(SEGMENTATION())));
  assert.match(unwrapped(md), /### `localization_rate` — §3\.1 — share of findings citing a file and line/);
  // The arms are COLUMNS. This is the assertion a future reflattening has to break.
  assert.match(md, /\| segment \| panel · findings; median of 3 replicates \| coderabbit · findings; single observation \|/);
  // …and therefore both arms sit on ONE line, which is the entire purpose of §5 and
  // was impossible when they were dozens of rows apart.
  assert.match(md, /\| `severity=minor` \| 0\.787 · n=89 \| 1\.000 · n=13 \|/);
  // The composite key is GONE from the page. A renderer that fell back to the flat
  // list would still satisfy every assertion above about content; only this one says
  // the shape changed.
  assert.doesNotMatch(md, /metric=localization_rate\/severity=minor\/arm=panel/);
});

test("🔴 §5's withheld cells still publish no value — in place beside a reported arm, or as a named count", () => {
  // 🔴 The honesty invariant survives the reshape, and it is the one thing that must.
  // A withheld cell carries the `n` that failed and NO value, so it cannot be read as
  // a measured zero; the change is that it no longer costs a row of its own.
  const md = renderReport(withSegmentation(segmentationFigures(SEGMENTATION())));
  // ONE arm withheld: the row survives for the arm that reported, and the withheld
  // arm says so in place — no number, and nothing that could be mistaken for one.
  assert.match(md, /\| `severity=major` \| 0\.781 · n=32 \| \*\*suppressed\*\*: n=3 < 5 \|/);
  // EVERY arm withheld: no row at all, and the segment is still named.
  assert.doesNotMatch(md, /\| `severity=critical` \|/);
  assert.match(unwrapped(md), /Withheld on every arm and not given rows — 1 segment\(s\): `severity=critical`\./);
  // The count in the caption is the payload's, not a literal: 5 of 9 cells here.
  assert.match(unwrapped(md), /\*\*4 of 9 cells report; 5 are withheld\*\* for a denominator below min-n = 5 \(spec §4\.1 default\)/);
  assert.match(unwrapped(md), /5 rows saying nothing is what made this section unread/);
});

test("a metric with no reporting cell gets a sentence naming its segments, not an empty table", () => {
  // `findings_per_pr` is counted in PULL REQUESTS, and the fattest per-PR denominator
  // on a 7-item corpus is 4 — so it withholds everywhere while the per-finding metrics
  // beside it report. An empty table with a header would be the blank grid decision 12
  // warned about; the sentence says which segments and why nothing is there.
  const md = renderReport(withSegmentation(segmentationFigures(SEGMENTATION())));
  assert.match(unwrapped(md), /### `findings_per_pr` — §3\.1 — findings per pull request {2}\*\*No cell cleared min-n\.\*\* All 1 segment\(s\) are withheld on every arm: `severity=minor`\./);
  // No table header for a metric with no rows.
  const grid = md.slice(md.indexOf("### `findings_per_pr`"));
  assert.doesNotMatch(grid.slice(0, grid.indexOf("\n### ") === -1 ? undefined : grid.indexOf("\n### ")), /\| segment \|/);
});

test("a one-armed axis renders as `—`, which is not the same symbol as a withheld cell", () => {
  // 🔴 Three of the pilot's seven axes are one-armed BY CONSTRUCTION: `novelty` reads
  // a field only the panel's records carry, `coderabbit_category` and `window` only
  // CodeRabbit's. "No measurement exists to make" and "the denominator was too thin"
  // are different facts, and a bigger corpus closes exactly one of them — so they must
  // not share a symbol. The axis's own declared `arms` is what says which is which.
  const md = renderReport(withSegmentation(segmentationFigures(SEGMENTATION())));
  assert.match(md, /\| `novelty=pre-existing` \| 0\.385 · n=13 \| — \|/);
  assert.match(unwrapped(md), /`—` marks an axis the scorer declares for one arm only — `novelty` \(panel\)/);
  assert.match(unwrapped(md), /It is not a withheld cell: there is no measurement to withhold/);
  // And the withheld cells in the same grid still say "suppressed", not "—".
  assert.doesNotMatch(md, /\| `severity=major` \| 0\.781 · n=32 \| — \|/);
});

test("the unit is hoisted into a column header only while that column agrees on it", () => {
  // 🔴 `renderValue` may drop the `(n= unit)` suffix ONLY where the unit is rendered
  // adjacently — that is its own docstring's condition, and the column header is what
  // discharges it here. A column whose reported cells disagree has no one unit to
  // hoist, so every cell keeps its own; a header that picked one of two would be the
  // unitless figure `figure()` refuses to construct in the first place.
  const payload = SEGMENTATION();
  payload.cells.push(segCell("localization_rate", "severity", "nit", "panel", { suppressed: false, value: 0.5, n: 8, unit: "defect classes; median of 3 replicates" }));
  const md = renderReport(withSegmentation(segmentationFigures(payload)));
  assert.doesNotMatch(md, /\| segment \| panel · findings; median of 3 replicates \|/);
  assert.match(md, /\| `severity=minor` \| 0\.787 \(n=89 findings; median of 3 replicates\) \|/);
  assert.match(md, /\| `severity=nit` \| 0\.500 \(n=8 defect classes; median of 3 replicates\) \|/);
});

test("the comparable count is of the rows in the grid below it, so the two cannot disagree", () => {
  // §4's deliverable is a COMPARISON, and with per-arm suppression a two-arm segment
  // with both arms reported is strictly rarer than either arm clearing alone. The
  // count leads the grid because a reader should not have to scan for it — and it is
  // counted over the rendered rows rather than read from the payload's `comparisons`,
  // so a row the renderer drops can never be counted as one a reader can see.
  const built = segmentationFigures(SEGMENTATION());
  const grid = built.grids.find((g) => g.metric === "localization_rate");
  assert.equal(grid.comparable, 1); // severity=minor
  assert.equal(grid.twoArm, 3); // minor, major, critical
  const md = renderReport(withSegmentation(built));
  assert.match(unwrapped(md), /Both arms report on \*\*1 of the 3\*\* segments this metric cuts on both arms/);
});

test("a cell the payload gave no coordinates for is still rendered, as the flat list it is", () => {
  // FAIL DIRECTION. The grouping fields are the scorer's, and a payload written before
  // them — or by a future scorer that omits one — cannot be placed in a grid. It is
  // listed and labelled rather than dropped: this whole module's argument is that a
  // silent omission is the one unrecoverable failure, and "the renderer could not
  // place these" is a fact a reader can act on.
  const md = renderReport(
    withSegmentation(
      segmentationFigures({
        min_n: 5,
        cells: [{ segment: "metric=in_diff_rate/severity=major/arm=panel", suppressed: false, value: 25 / 36, n: 36, unit: "findings" }],
      }),
    ),
  );
  assert.match(unwrapped(md), /\*\*1 cell\(s\) carry no metric\/axis\/bucket\/arm and cannot be placed in a grid\*\*/);
  assert.match(md, /\| `metric=in_diff_rate\/severity=major\/arm=panel` \| 0\.694 \(n=36 findings\) \|/);
});

test("a refused metric × axis pair is rendered with its reason; a unit mismatch is only counted", () => {
  // 🔴 A grid with no rows for an axis has THREE possible causes — thin, unbuildable,
  // or refused as posed — and §5 rendered only the first two, so a reader of
  // `nit_ratio` could not tell a refusal from an oversight. The pilot's twelve
  // refusals are two statements about a metric and ten repetitions of one unit
  // mismatch, and printing all twelve verbatim would re-import the noise this section
  // is being rescued from.
  //
  // The split is STRUCTURAL — the metric's `currency` against the axis's `unit`, both
  // stated in the payload — and not a match on the reason text, so a refusal with a
  // reason nobody has seen before lands in the rendered group rather than the counted
  // one. That is the safe direction: an unfamiliar refusal gets read.
  const built = segmentationFigures(SEGMENTATION());
  assert.deepEqual(built.pairsRefused.map((p) => `${p.metric}×${p.axis}`), ["localization_rate×novelty"]);
  assert.equal(built.pairsUnitMismatch, 1);
  const md = renderReport(withSegmentation(built));
  assert.match(md, /\| `localization_rate` × `novelty` \| \*\*not computed\*\* — the novelty annotation is stamped ONLY on critical\/major findings \|/);
  assert.doesNotMatch(md, /\| `findings_per_pr` × `novelty` \|/);
  assert.match(unwrapped(md), /A further 1 pair\(s\) are not listed because they are one fact repeated: a metric counted in pull requests/);
});

test("a wrapped list never breaks inside a code span, because bucket names contain spaces", () => {
  // 🔴 CodeRabbit's taxonomy is used VERBATIM — `data integrity & integration` — so a
  // withheld-segment list folded on spaces alone split a backticked identifier across
  // two lines, and markdown then rendered the backticks as literal characters. Every
  // line §5 emits carries an even number of backticks.
  const payload = SEGMENTATION();
  for (const bucket of ["data integrity & integration", "performance & scalability", "security & privacy", "stability & availability"]) {
    payload.cells.push(segCell("localization_rate", "coderabbit_category", bucket, "coderabbit", { suppressed: true, n: 1 }));
  }
  const md = renderReport(withSegmentation(segmentationFigures(payload)));
  for (const line of md.split("\n")) {
    assert.equal((line.match(/`/g) ?? []).length % 2, 0, `unbalanced backticks after wrapping: ${line}`);
  }
  // AND THE FOLD HAPPENS AT ALL. Five withheld segments named on one line is 300-odd
  // characters, which is the shape §5 is being rescued from; a wrap that never fires
  // is not a wrap. Table rows are excluded — a fold inside one would break the table,
  // so those are left long on purpose.
  const section = md.slice(md.indexOf("## 5."), md.indexOf("## 6."));
  const prose = section.split("\n").filter((l) => !l.startsWith("|"));
  const listStart = prose.findIndex((l) => l.startsWith("Withheld on every arm"));
  assert.ok(listStart >= 0, "the withheld list should be on the page");
  // The sentence ends in a full stop, so a list that fits on one line ends there. This
  // one does not: five segments named, three of them CodeRabbit's verbatim categories.
  assert.ok(!prose[listStart].endsWith("."), "the withheld list should be folded across more than one line, not left as one long line");
  // The overhang allowance is for a code span too long to break — `wrapProse` will not
  // split one — not for an unwrapped sentence.
  for (const line of prose) assert.ok(line.length <= 160, `§5 emitted an unwrapped prose line of ${line.length} chars: ${line}`);
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
    validity: "## 6. Is any of it true",
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
  assert.deepEqual(SCORER_IDS, ["volume-mix-v1", "complementarity-v1", "reliability-v1", "cost-latency-v1", "segmentation-v1", "validity-v1"]);
  // `cost-latency-v1` is #791's own constant, so this PR reads the id that PR chose
  // rather than inventing a second name for the same file.
  assert.ok(SCORER_IDS.includes("cost-latency-v1"));
  // `validity-v1` is `validity.mjs`'s own `SCORER_ID` for the same reason — the scorer
  // merged (#905) naming itself, and a second name here would file a payload under a key
  // the renderer never looks for and leave §6 reading "not computed" over a score that
  // is sitting there.
  assert.ok(SCORER_IDS.includes("validity-v1"));
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
    panelDigest: PANEL_DIGEST,
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
    panelDigest: PANEL_DIGEST,
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
    panelDigest: PANEL_DIGEST,
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
    panelDigest: PANEL_DIGEST,
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
    panelDigest: PANEL_DIGEST,
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

// --- §2's adjudicated band, from the `labels` block --------------------------
//
// THE NUMBERS BELOW ARE THE REAL ONES, read out of the eval store on 2026-08-13 with
// 357 pair records filed — 45 `gold` (a human read both texts) and 312 `silver` (a
// model did, pending human confirmation). They are real for the reason the volume
// fixture's are: the whole hazard in this section is a band that narrows more than the
// evidence justifies, and invented round numbers would let an arithmetic that leans one
// way pass unnoticed. Specifically, k2's floor moves 6/171 → 12/165 while its ceiling
// stays at 30/147, and the two unadjudicated replicates' bands are IDENTICAL before and
// after — which is the case that must not render like a measurement.

/** One band, from the four counts that make it — the same shape `pair-labels.mjs`
 *  produces, so a fixture cannot express a floor and a ceiling that disagree. */
const labelBand = (both, classes, ceilBoth, ceilClasses) => ({
  both,
  classes,
  jaccard: both / classes,
  both_upper_bound: ceilBoth,
  classes_at_ceiling: ceilClasses,
  jaccard_upper_bound: ceilBoth / ceilClasses,
});

/**
 * One tier's resolution of one replicate.
 *
 * `floorMoved` and `ceilingMoved` are passed rather than derived, deliberately: the
 * scorer emits them as fields precisely so a renderer cannot diff two percentages and
 * agree with itself, and a fixture that computed them could not tell the two apart.
 */
function tierBlock({ tier, availability, applied, inTier, via = {}, unmatched = 0, crossReplicate = 0, res = {}, before, after, floorMoved, ceilingMoved }) {
  return {
    tier,
    availability,
    labels: {
      supplied: 357,
      in_tier: inTier,
      applied,
      via,
      cross_replicate: crossReplicate,
      unmatched: Array.from({ length: unmatched }, (_, i) => ({ pair_key: `deadbeef000${i}`, reason: "no undecided cross-arm pair in this replicate carries any of the label's keys" })),
    },
    resolution: {
      coderabbit_only_resolved_same: res.same ?? 0,
      coderabbit_only_finished_apart: res.apart ?? 0,
      coderabbit_only_still_undecided: res.undecided ?? 0,
      panel_classes_newly_shared: res.newly ?? 0,
      labels_on_already_shared_class: res.onShared ?? 0,
      fanout: Array.from({ length: res.fanout ?? 0 }, (_, i) => ({ coderabbit_class: `D-fanout-${i}` })),
      resolved: [],
      finished_apart: [],
      // THE PER-FINDING PAIR COUNTS, one row per still-undecided CodeRabbit class —
      // k2's real 18. Their total is 263, and §2 must not print it.
      still_undecided: (res.pairsPerClass ?? []).map((pairs, i) => ({ coderabbit_class: `D-undecided-${i}`, pairs })),
    },
    band: { before, after, floor_moved: floorMoved, ceiling_moved: ceilingMoved },
  };
}

const CENSUS = {
  n: 357,
  by_source: { gold: 45, silver: 312 },
  // 🔴 SIX AND ZERO, and they are different facts. Six pair KEYS moved when a finding's
  // text was re-parsed; ZERO verdicts are flagged for re-adjudication.
  keys_moved: 6,
  needs_readjudication: 0,
  superseded: 12,
};

const UNADJUDICATED = (n) => ({ tier: "gold", availability: "none-for-replicate", applied: 0, inTier: n, unmatched: n, res: { undecided: 22 }, floorMoved: false, ceilingMoved: false });

function labelsFor({ availability, gold, silver, before }) {
  return {
    availability,
    tier: "gold",
    headline: gold,
    by_tier: { gold, silver },
    store: { present: true, dir: "labels/2026-08-10-pilot-reviewed/pairs", n: 357, unreadable: [], invalid: [] },
    census: CENSUS,
    unlabelled: before,
  };
}

const K1_BAND = labelBand(8, 164, 30, 142);
const K2_BAND = labelBand(6, 171, 30, 147);
const K3_BAND = labelBand(3, 166, 30, 139);

/** The pilot's three replicates with their real label blocks: k2 adjudicated, k1 and k3
 *  not — and k3's `silver` tier the one case of "labels applied, nothing moved". */
const LABELLED = {
  per_replicate: [
    {
      stats: { label: "pilot-01__k1" },
      overlap: { classes: 164, both: 8, panel_only: 134, coderabbit_only: 22, jaccard: 8 / 164 },
      unresolved: { jaccard_upper_bound: 30 / 142, saturated: true, maybe_links: 409, strong_maybe_links: 15, triage_threshold: 0.7, coderabbit_classes_with_a_panel_candidate: 22 },
      severity: { shared_classes: 8, stated: { n: 8, panel_more_severe: 6, coderabbit_more_severe: 0 } },
      labels: labelsFor({
        availability: "none-for-replicate",
        before: K1_BAND,
        gold: tierBlock({ ...UNADJUDICATED(45), before: K1_BAND, after: K1_BAND }),
        silver: tierBlock({ ...UNADJUDICATED(312), tier: "silver", before: K1_BAND, after: K1_BAND }),
      }),
    },
    {
      stats: { label: "pilot-01__k2" },
      overlap: { classes: 171, both: 6, panel_only: 141, coderabbit_only: 24, jaccard: 6 / 171 },
      unresolved: { jaccard_upper_bound: 30 / 147, saturated: true, maybe_links: 418, strong_maybe_links: 21, triage_threshold: 0.7, coderabbit_classes_with_a_panel_candidate: 24 },
      severity: { shared_classes: 6, stated: { n: 6, panel_more_severe: 4, coderabbit_more_severe: 0 } },
      labels: labelsFor({
        availability: "resolved",
        before: K2_BAND,
        gold: tierBlock({
          tier: "gold",
          availability: "resolved",
          applied: 43,
          inTier: 45,
          via: { pair_key: 38, pair_key_at_801: 5 },
          unmatched: 2,
          res: { same: 6, apart: 0, undecided: 18, newly: 6, onShared: 4, fanout: 3, pairsPerClass: [20, 19, 15, 8, 17, 18, 21, 3, 23, 19, 25, 19, 5, 8, 10, 20, 9, 4] },
          before: K2_BAND,
          after: labelBand(12, 165, 30, 147),
          floorMoved: true,
          ceilingMoved: false,
        }),
        // The silver tier's ceiling DOES move — 8 CodeRabbit classes had every pair
        // decided — so the provisional band is the tighter one. That is the row a
        // reader would quote, and the reason the tier is a column.
        silver: tierBlock({
          tier: "silver",
          availability: "resolved",
          applied: 312,
          inTier: 312,
          via: { pair_key: 312 },
          res: { same: 3, apart: 8, undecided: 13, newly: 3 },
          before: K2_BAND,
          after: labelBand(9, 168, 22, 155),
          floorMoved: true,
          ceilingMoved: true,
        }),
      }),
    },
    {
      stats: { label: "pilot-01__k3" },
      overlap: { classes: 166, both: 3, panel_only: 136, coderabbit_only: 27, jaccard: 3 / 166 },
      unresolved: { jaccard_upper_bound: 30 / 139, saturated: true, maybe_links: 378, strong_maybe_links: 19, triage_threshold: 0.7, coderabbit_classes_with_a_panel_candidate: 27 },
      severity: { shared_classes: 3, stated: { n: 3, panel_more_severe: 2, coderabbit_more_severe: 1 } },
      labels: labelsFor({
        availability: "none-for-replicate",
        before: K3_BAND,
        gold: tierBlock({ ...UNADJUDICATED(45), res: { undecided: 27 }, before: K3_BAND, after: K3_BAND }),
        // 🔴 THE CASE THE WHOLE SUBSECTION EXISTS FOR: labels applied, nothing moved.
        // Its band is identical to the unlabelled one, exactly like k1's — and it is a
        // measurement where k1's is an absence.
        silver: tierBlock({
          tier: "silver",
          availability: "resolved-nothing",
          applied: 4,
          inTier: 312,
          via: { pair_key: 4 },
          unmatched: 308,
          crossReplicate: 4,
          res: { undecided: 27 },
          before: K3_BAND,
          after: K3_BAND,
          floorMoved: false,
          ceilingMoved: false,
        }),
      }),
    },
  ],
};

const LABELLED_FULL = (payload = LABELLED) =>
  renderReport(
    buildReport({
      configHash: CONFIG_HASH,
      corpusVersion: CORPUS_VERSION,
      panelSha: PANEL_SHA,
    panelDigest: PANEL_DIGEST,
      runIds: RUNS,
      corpusItemIds: RELIABILITY.items,
      scores: { volume: VOLUME, complementarity: payload, reliability: RELIABILITY },
    }),
  );

const LABELLED_REPORT = (payload = LABELLED) => section(LABELLED_FULL(payload), "2");

/** The same payload with one field changed, without mutating the shared fixture. */
function withLabelField(runIndex, tier, mutate) {
  const reps = LABELLED.per_replicate.map((r, i) => {
    if (i !== runIndex) return r;
    const t = structuredClone(r.labels.by_tier[tier]);
    mutate(t);
    const by_tier = { ...r.labels.by_tier, [tier]: t };
    return { ...r, labels: { ...r.labels, by_tier, ...(tier === "gold" ? { headline: t, availability: t.availability } : {}) } };
  });
  return { per_replicate: reps };
}

test("every label-availability state is a figure or a stated cause, and none is blank", () => {
  // The vocabulary is `pair-labels.mjs`'s, checked at import time; this asserts the
  // consequence a reader sees. Five states are causes, two are figures, and the two
  // sets do not overlap.
  assert.deepEqual(Object.keys(LABEL_CAUSE).sort(), ["no-store", "none-for-replicate", "none-matched", "not-supplied", "store-empty"]);
  for (const [state, reason] of Object.entries(LABEL_CAUSE)) {
    assert.equal(renderCell(notComputed(reason)).startsWith("**not computed** — "), true, `${state} must render as words`);
    assert.equal(reason.trim().length > 30, true, `${state}'s cause must be a sentence, not a label`);
  }
  // No two states may share a sentence — a shared one is the pooled cell in prose form.
  assert.equal(new Set(Object.values(LABEL_CAUSE)).size, Object.keys(LABEL_CAUSE).length);
});

test("🔴 an unadjudicated replicate does not render like one whose labels moved nothing", () => {
  const md = LABELLED_REPORT();
  const k1 = md.split("\n").find((l) => l.startsWith("| `pilot-01__k1` | `gold`"));
  const k3silver = md.split("\n").find((l) => l.startsWith("| `pilot-01__k3` | `silver`"));
  // k1: NOBODY LOOKED. It has no band at all, and the cell says which of the five
  // causes applies.
  assert.match(k1, /\*\*not computed\*\* — labels exist for this corpus, but none names this replicate/);
  assert.match(k1, /nobody has looked here/);
  assert.equal(/\[\d+\.\d%, \d+\.\d%\] \(n=/.test(k1), false, "an unadjudicated replicate must not carry an adjudicated band");
  // k3 silver: LOOKED, AND NOTHING MOVED. It has a band — a measurement — and says so.
  assert.match(k3silver, /\[1\.8%, 21\.6%\] \(n=166 defect classes\)/);
  assert.match(k3silver, /4 of 312 `silver` label\(s\) applied.*\*\*no class changed state\*\*/);
  assert.match(k3silver, /measured rather than unlooked-at/);
  // And it says where those four verdicts were made: k3's own queue holds none of them,
  // and a reader counting adjudications here would otherwise credit k3 with k2's work.
  assert.match(k3silver, /4 of them adjudicated on another draw/);
  // And the two never share a sentence.
  assert.equal(k3silver.includes("nobody has looked here"), false);
  assert.match(md, /2 of the 3 replicate\(s\) above carry no adjudicated band at all/);
});

test("the adjudicated band is rendered BESIDE the unlabelled one, never instead of it", () => {
  const md = LABELLED_REPORT();
  const k2 = md.split("\n").find((l) => l.startsWith("| `pilot-01__k2` | `gold`"));
  // 6/171 = 3.5% unlabelled, 12/165 = 7.3% adjudicated, and the ceiling is 30/147 =
  // 20.4% in both. All three on one row, so the movement is visible without a diff.
  assert.match(k2, /\| \[3\.5%, 20\.4%\] \| \*\*\[7\.3%, 20\.4%\]\*\* \(n=165 defect classes\)/);
  // The unlabelled table above is untouched by labels: its k2 row still reads 3.5%.
  assert.match(md, /\| `pilot-01__k2` \| 171 \| 6 \| 141 \| 24 \| 3\.5% \| 20\.4% \| \*\*\[3\.5%, 20\.4%\]\*\* \|/);
  // What it rests on, with BOTH denominators, in the same subsection.
  assert.match(md, /\*\*43 of 45 `gold` label\(s\)\*\* applied against an undecided queue of\n {2}\*\*418 pair\(s\)\*\*, on \*\*1 replicate of 3\*\*/);
  assert.match(md, /5 matched only through the alternate key vintage/);
  assert.match(md, /4 sit on a class both arms already claim/);
  assert.match(md, /3 resolved class\(es\) name more than one panel partner/);
  // The table above stops claiming that no labels exist, and counts the replicates it
  // has rather than implying all three.
  assert.match(md, /\*\*Labels now exist for 1 of 3 replicate\(s\) — the adjudicated band is below/);
  assert.equal(md.includes("Until those labels exist"), false);
});

test("the label store's own dropped-file counts and superseded verdicts are stated, including at zero", () => {
  const md = LABELLED_REPORT();
  // A dropped label can only WIDEN a band, so a measured zero here is worth the line:
  // "we read every record" and "nobody counted" are the same blank otherwise.
  assert.match(md, /\*\*0 unreadable file\(s\)\*\* and \*\*0 refused by the record validator\*\*/);
  assert.match(md, /12 record\(s\) carry a superseded earlier verdict/);
  const broken = {
    per_replicate: LABELLED.per_replicate.map((r) => ({
      ...r,
      labels: { ...r.labels, store: { ...r.labels.store, unreadable: [{ file: "a.json", reason: "unexpected end of JSON input" }], invalid: [{ file: "b.json", reason: "verdict must be one of same | different | insufficient-basis" }] } },
    })),
  };
  assert.match(LABELLED_REPORT(broken), /\*\*1 unreadable file\(s\)\*\* and \*\*1 refused by the record validator\*\*/);
});

test("a score assembled from two reads of the label store says so rather than quoting the first", () => {
  // Impossible through the CLI, which reads the store once per run — and that is the
  // claim, so it is checked rather than commented. The census is taken from the first
  // replicate that has one; a disagreement means that shortcut is no longer sound.
  const mixed = {
    per_replicate: LABELLED.per_replicate.map((r, i) => (i === 2 ? { ...r, labels: { ...r.labels, census: { ...CENSUS, n: 400, keys_moved: 9 } } } : r)),
  };
  const rendered = LABELLED_REPORT(mixed);
  assert.match(rendered, /🔴 \*\*The replicates report different label censuses\*\*/);
  // And the counts printed are the FIRST read's, which is what the warning says they
  // are — a renderer quoting the last would contradict its own caveat.
  assert.match(rendered, /\*\*6 of 357 record\(s\) carry a pair key that MOVED\.\*\*/);
  assert.equal(rendered.includes("9 of 400"), false);
  assert.equal(LABELLED_REPORT().includes("different label censuses"), false);
  // 🔴 EVERY FIELD THIS SUMMARY HANDS THE RENDERER IS FINGERPRINTED, not the three the
  // guard started with. `by_source` and `superseded` are printed from the first block
  // too — `by_source` in §2's tier sentence AND in §7's limit — so a disagreement in
  // either has to raise the same warning. It did not, which left the warning's own
  // words ("the counts above describe only the first") true of four fields and silent
  // about three.
  const only = (i, census) => ({ per_replicate: LABELLED.per_replicate.map((r, j) => (j === i ? { ...r, labels: { ...r.labels, census } } : r)) });
  assert.match(LABELLED_REPORT(only(1, { ...CENSUS, by_source: { gold: 44, silver: 313 } })), /different label censuses/);
  assert.match(LABELLED_REPORT(only(1, { ...CENSUS, superseded: 11 })), /different label censuses/);
  // A different KEY ORDER in `by_source` is the same census, and must not trip it.
  assert.equal(LABELLED_REPORT(only(1, { ...CENSUS, by_source: { silver: 312, gold: 45 } })).includes("different label censuses"), false);
  // And the store-level counts printed from the same first block are covered too.
  const store2 = { per_replicate: LABELLED.per_replicate.map((r, j) => (j === 1 ? { ...r, labels: { ...r.labels, store: { ...r.labels.store, invalid: [{ file: "x.json", reason: "bad verdict" }] } } } : r)) };
  assert.match(LABELLED_REPORT(store2), /different label censuses/);
});

test("🔴 ceiling_moved is READ, and rendered as a fact with its reason in both directions", () => {
  const unmoved = LABELLED_REPORT();
  assert.match(unmoved, /On `pilot-01__k2` the floor moved and the ceiling did not, and that is the arithmetic rather than a shortfall/);
  assert.match(unmoved, /0 of `pilot-01__k2`'s 24 have that\ntoday, with 18 still undecided/);
  assert.match(unmoved, /`ceiling_moved` is a field of the score, not two percentages a reader is/);
  // THE FIELD, NOT A DIFF OF TWO PERCENTAGES. Flipping only the flag — with the two
  // bands left identical — must flip the sentence, which a renderer comparing
  // `before.jaccard_upper_bound` against `after`'s would not do.
  const flagged = LABELLED_REPORT(withLabelField(1, "gold", (t) => { t.band.ceiling_moved = true; t.resolution.coderabbit_only_finished_apart = 2; }));
  assert.match(flagged, /🔴 \*\*The ceiling MOVED on `pilot-01__k2` \(`gold`\): 2 CodeRabbit-only class\(es\) had every one of their pairs decided\.\*\*/);
  assert.match(flagged, /narrows the band in the direction that flatters this project/);
  assert.equal(flagged.includes("the floor moved and the ceiling did not"), false);
});

test("🔴 the trust tier is on the figure, and a silver-moved band is visibly provisional", () => {
  const md = LABELLED_REPORT();
  // The tier is a COLUMN of the band table, not a footnote.
  assert.match(md, /\| replicate \| tier \| unlabelled band \| adjudicated band \| what the labels did \|/);
  assert.match(md, /The store holds 357 pair record\(s\) — 45 `gold` · 312 `silver`\./);
  assert.match(md, /Each tier is resolved separately and \*\*never pooled\*\*/);
  // Silver is rendered, unbold, under a heading that refuses it as the band — and its
  // moved ceiling is flagged, because the provisional row is the TIGHTER one.
  assert.match(md, /No row below is this report's band/);
  assert.match(md, /\| `pilot-01__k2` \| `silver` \| \[5\.4%, 14\.2%\] \(n=168 defect classes\) \| 🔴 yes — 8 class\(es\) finished apart \|/);
  assert.match(md, /A weaker tier can produce a TIGHTER band, and tightness is not confidence/);
  assert.equal(md.includes("**[5.4%, 14.2%]**"), false, "a provisional band must never be bolded like the headline one");
  // The tightness warning is about a weaker tier that FINISHED classes the headline
  // tier did not. With no such tier it is not said, because then it is not true.
  assert.equal(LABELLED_REPORT(withLabelField(1, "silver", (t) => { t.band.ceiling_moved = false; })).includes("tightness is not confidence"), false);
  // And the headline band is NOT called provisional when the headline tier is `gold`.
  assert.equal(md.includes("so it is PROVISIONAL"), false);
  // A row with no band gets an em-dash rather than a "no": "the ceiling did not move"
  // and "there is no band here to move" are different facts.
  assert.match(md, /\| `pilot-01__k1` \| `silver` \| \*\*not computed\*\* — .* \| — \|/);
  // AND WHEN THE HEADLINE TIER ITSELF IS NOT GOLD, the band above is provisional too.
  const noGold = {
    per_replicate: LABELLED.per_replicate.map((r) => {
      const silver = r.labels.by_tier.silver;
      return { ...r, labels: { ...r.labels, tier: "silver", headline: silver, availability: silver.availability, by_tier: { silver } } };
    }),
  };
  const silverHeadline = LABELLED_REPORT(noGold);
  assert.match(silverHeadline, /🔴 \*\*The band above is `silver`'s, not `gold`'s — so it is PROVISIONAL\.\*\*/);
  assert.match(silverHeadline, /do not treat as the ceiling/);
});

test("🔴 keys_moved and needs_readjudication are two sentences, and neither caption may carry the other's count", () => {
  const md = LABELLED_REPORT();
  // 6 keys MOVED (an address changed); 0 verdicts are DOUBTED. An earlier draft
  // attached the second caption to the first count, which tells a reader that six
  // judgements are doubted when none are.
  assert.match(md, /\*\*6 of 357 record\(s\) carry a pair key that MOVED\.\*\*/);
  assert.match(md, /\*\*0 of 357 record\(s\) are flagged for re-adjudication\.\*\*/);
  assert.equal(/6 of 357 record\(s\) are flagged for re-adjudication/.test(md), false, "the re-adjudication caption must never carry the moved-key count");
  // SWAPPING THE TWO PAYLOAD FIELDS SWAPS THE TWO SENTENCES. A renderer reading one
  // field for both captions passes the assertions above and fails here.
  const swapped = {
    per_replicate: LABELLED.per_replicate.map((r) => ({ ...r, labels: { ...r.labels, census: { ...CENSUS, keys_moved: 0, needs_readjudication: 6 } } })),
  };
  const other = LABELLED_REPORT(swapped);
  assert.match(other, /\*\*0 of 357 record\(s\) carry a pair key that MOVED\.\*\*/);
  assert.match(other, /\*\*6 of 357 record\(s\) are flagged for re-adjudication\.\*\*/);
  // The captions themselves never move: each names what its own count is about.
  assert.match(md, /the pair's\n {2}\*address\* changed\. The verdict is untouched/);
  assert.match(md, /That is a doubt about a VERDICT/);
});

test("🔴 no labelled figure spans two replicates, and the aggregate views carry none", () => {
  const c = complementarityFigures(LABELLED);
  // Every labelled band belongs to exactly one replicate's own payload block.
  assert.equal(c.bands.length, 3);
  assert.equal(c.replicates_adjudicated, 1);
  for (const [i, b] of c.bands.entries()) {
    const own = LABELLED.per_replicate[i].labels.headline.band.after;
    if (b.labels.band.availability !== "present") continue;
    assert.deepEqual(b.labels.band.value, { low: own.jaccard, high: own.jaccard_upper_bound });
  }
  // EVERY ROW CARRIES ITS OWN REPLICATE'S NUMBERS. The three differ in both columns —
  // 4.9/3.5/1.8 unlabelled and 0/43/0 labels applied — so a row rendered from another
  // replicate's block cannot coincide with the right answer.
  const md = LABELLED_REPORT();
  const rowOf = (label) => md.split("\n").find((l) => l.startsWith(`| \`${label}\` | \`gold\``));
  assert.match(rowOf("pilot-01__k1"), /\| \[4\.9%, 21\.1%\] \|.*\| 0 of 45 `gold` label\(s\) applied \|/);
  assert.match(rowOf("pilot-01__k2"), /\| \[3\.5%, 20\.4%\] \| \*\*\[7\.3%, 20\.4%\]\*\*.*\| 43 of 45 `gold` label\(s\) applied —/);
  assert.match(rowOf("pilot-01__k3"), /\| \[1\.8%, 21\.6%\] \|.*\| 0 of 45 `gold` label\(s\) applied \|/);
  // Moving ONE replicate's adjudicated band changes ONE row. If anything pooled the
  // three, k1's and k3's rows would move too.
  const before = LABELLED_REPORT().split("\n");
  const after = LABELLED_REPORT(withLabelField(1, "gold", (t) => { t.band.after = labelBand(30, 165, 30, 147); })).split("\n");
  const changed = before.filter((l, i) => l !== after[i]);
  assert.equal(changed.every((l) => l.includes("pilot-01__k2") || l.includes("18.2%")), true, `only k2's rows may move, got:\n${changed.join("\n")}`);
  assert.equal(changed.some((l) => l.includes("pilot-01__k1") || l.includes("pilot-01__k3")), false);
  // The scorer's `union` and `intersection` views live outside `per_replicate` and
  // carry no labels by construction; attaching them changes not one byte here.
  const withViews = { ...LABELLED, union: { overlap: { jaccard: 0.5 } }, intersection: { overlap: { jaccard: 0.9 } } };
  assert.equal(LABELLED_REPORT(withViews), LABELLED_REPORT());
});

test("§2 names the per-finding pair count and still refuses to total it", () => {
  const md = LABELLED_REPORT();
  // The count #829 added exists, so the sentence that called it underivable is gone.
  assert.match(md, /The per-finding pair counts that settle it are\nnow in the score/);
  assert.match(md, /their TOTAL\nis not, and this renderer computes no number it was not handed/);
  assert.equal(md.includes("scorer does not emit"), false, "the field exists now; the old sentence would be false on the page");
  // AND THE TOTAL IS NOT PRINTED. 263 is the sum of k2's 18 per-class counts, and a
  // renderer that reduced the array would put it on the page.
  const total = LABELLED.per_replicate[1].labels.headline.resolution.still_undecided.reduce((a, x) => a + x.pairs, 0);
  assert.equal(total, 263);
  assert.equal(md.includes(String(total)), false, "the renderer must not sum an array it was handed");
  // A payload with no such counts keeps the original wording, so a store filed before
  // the pair-label reader still renders a true sentence.
  assert.match(section(renderReport(FULL()), "2"), /needs a per-finding pair count this\nscorer does not emit/);
});

test("a score file that predates pair labels says so, rather than rendering a band", () => {
  const md = section(renderReport(FULL()), "2");
  assert.match(md, /### The adjudicated band/);
  assert.match(md, /\*\*not computed\*\* — this complementarity score carries no `labels` block/);
  assert.match(md, /cannot be told apart from this score file/);
  // No band table, no tier table, no census sentences — there is nothing to say them
  // about, and inventing a zero census would be the blank cell one level down.
  assert.equal(md.includes("carry a pair key that MOVED"), false);
  assert.equal(md.includes("| replicate | tier |"), false);
  // The unlabelled band is untouched: this section still renders exactly as it did.
  assert.match(md, /Until those labels exist, this row must not be read as a point estimate/);
});

test("the drift warning is raised only where it is an anomaly, not on every unadjudicated replicate", () => {
  const md = LABELLED_REPORT();
  // k2 resolved 43 labels and 2 matched nothing — a real drift signal, worth a line.
  assert.match(md, /⚠ \*\*2 `gold` label\(s\) match no undecided pair on `pilot-01__k2`\.\*\*/);
  // k1 and k3 have 45 unmatched EACH, and there it is the definition of
  // `none-for-replicate` rather than a finding about it. Three identical warnings would
  // bury the one that means something.
  assert.equal(md.includes("match no undecided pair on `pilot-01__k1`"), false);
  assert.equal(md.includes("match no undecided pair on `pilot-01__k3`"), false);
  assert.equal((md.match(/match no undecided pair on/g) ?? []).length, 1);
});

test("🔴 §2 leads with the two directional rates, and the Jaccard sits beneath them, labelled", () => {
  const md = LABELLED_REPORT();
  // ORDER IS THE ARGUMENT HERE. The rates table must come before the band table, or a
  // reader still meets the intersection-over-union figure first.
  assert.equal(md.indexOf("CodeRabbit classes the panel also raised") < md.indexOf("| replicate | classes | both |"), true);
  assert.match(md, /Read the two directional rates before the Jaccard/);
  assert.match(md, /Jaccard \(intersection ÷ union\)/);
  // k2, unadjudicated: 6 shared of CodeRabbit's 30 classes and of the panel's 147.
  assert.match(md, /\| `pilot-01__k2` \| unadjudicated \| 6 of 30 — \*\*20\.0%\*\* \| 6 of 147 — \*\*4\.1%\*\* \| \[3\.5%, 20\.4%\] \|/);
  assert.match(md, /\| `pilot-01__k1` \| unadjudicated \| 8 of 30 — \*\*26\.7%\*\* \| 8 of 142 — \*\*5\.6%\*\* \| \[4\.9%, 21\.1%\] \|/);
  assert.match(md, /\| `pilot-01__k3` \| unadjudicated \| 3 of 30 — \*\*10\.0%\*\* \| 3 of 139 — \*\*2\.2%\*\* \| \[1\.8%, 21\.6%\] \|/);
  // Each rate carries its n and its unit — `figure` refuses without both.
  const c = complementarityFigures(LABELLED);
  assert.equal(c.bands[1].rates.coderabbit.n, 30);
  assert.equal(c.bands[1].rates.coderabbit.unit, "CodeRabbit defect classes");
  assert.equal(c.bands[1].rates.panel.n, 147);
  assert.equal(c.bands[1].rates.panel.unit, "panel defect classes");
});

test("the adjudicated rates get their OWN row and never replace the unadjudicated one", () => {
  const md = LABELLED_REPORT();
  const rows = md.split("\n").filter((l) => /^\| `pilot-01__k\d` \| (unadjudicated|\d+ `)/.test(l));
  // Four rows for three replicates: k2 twice, once per basis.
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((l) => l.includes("pilot-01__k2")).length, 2);
  assert.match(md, /\| `pilot-01__k2` \| 43 `gold` label\(s\) applied \| 12 of 30 — \*\*40\.0%\*\* \| 12 of 147 — \*\*8\.2%\*\* \| \[7\.3%, 20\.4%\] \|/);
  // The unadjudicated row stays: the movement 6 → 12 is the thing adjudication bought,
  // and a single upgraded row would hide it.
  assert.match(md, /\| `pilot-01__k2` \| unadjudicated \| 6 of 30/);
  // A replicate nobody adjudicated gets exactly one row, so it cannot be read as one
  // whose labels did nothing.
  assert.equal(rows.filter((l) => l.includes("pilot-01__k1")).length, 1);
});

test("🔴 a directional rate divides by the arm it describes, so the other arm's volume cannot move it", () => {
  // THE WHOLE ARGUMENT FOR THE RATES, as a measurement. Double the panel-only classes —
  // our arm says twice as much and agrees on exactly as much — and the Jaccard falls
  // while the CodeRabbit-side rate does not move at all.
  const louder = {
    per_replicate: [{
      ...LABELLED.per_replicate[1],
      overlap: { classes: 171 + 141, both: 6, panel_only: 141 * 2, coderabbit_only: 24, jaccard: 6 / (171 + 141) },
      labels: undefined,
    }],
  };
  const c = complementarityFigures(louder);
  assert.deepEqual(c.bands[0].rates.coderabbit.value, { k: 6, n: 30, ratio: 6 / 30 });
  assert.equal(c.bands[0].rates.panel.value.n, 288);
  const md = LABELLED_REPORT(louder);
  assert.match(md, /\| `pilot-01__k2` \| unadjudicated \| 6 of 30 — \*\*20\.0%\*\* \| 6 of 288 — \*\*2\.1%\*\* \| \[1\.9%, 20\.4%\] \|/);
  // Same shared count, same CodeRabbit rate, a Jaccard nearly halved.
  assert.equal(complementarityFigures(LABELLED).bands[1].rates.coderabbit.value.ratio, c.bands[0].rates.coderabbit.value.ratio);
  // 🔴 AND THE CEILING IDENTITY IS OMITTED HERE, because on this payload it is false.
  // The fixture keeps k2's `unresolved` while doubling its panel-only classes, so the
  // saturation flag still says `true` while the counts imply 30/288 = 10.4% against a
  // stated ceiling of 20.4%. The sentence claims the quotient is *exactly* the ceiling,
  // so it renders only when it is: this used to print `leaves 30/288 = 20.4%`, a false
  // identity built from a fraction and a percentage that were never compared.
  assert.equal(md.includes("the ceiling is a property of the two counts"), false);
  assert.equal(md.includes("30/288"), false);
  // The saturation block it lives in is still rendered — only the identity is dropped.
  assert.match(md, /The ceiling is SATURATED on all 1 replicates/);
});

test("🔴 the ceiling is stated as a property of the two arms' counts, not of the matcher", () => {
  const md = LABELLED_REPORT();
  // 30 CodeRabbit classes over the panel's 142 IS k1's ceiling, exactly — the identity
  // holds on any saturated replicate, and it retires a figure this project read as a
  // matcher limitation.
  assert.match(md, /the ceiling is a property of the two counts rather than of the matcher/);
  assert.match(md, /`pilot-01__k1` has\n30 CodeRabbit class\(es\) against the panel's 142/);
  assert.match(md, /leaves 30\/142 = 21\.1% — which is exactly the ceiling on that row/);
  assert.match(md, /no amount of adjudication moves it/);
  // 🔴 THE CHECK IS AT PRINT PRECISION, and this is the case that says why. A stored
  // ceiling of `0.211` and a quotient of `30/142 = 0.21126…` are different floats and
  // the same printed figure — so a full-precision comparison would drop a sentence
  // whose own two numbers agree on the page. A score file that has been through a
  // rounding serialiser is exactly that payload, and the identity is still true of it.
  const rounded = {
    per_replicate: [{
      ...LABELLED.per_replicate[0],
      unresolved: { ...LABELLED.per_replicate[0].unresolved, jaccard_upper_bound: 0.211 },
      labels: undefined,
    }],
  };
  const md2 = LABELLED_REPORT(rounded);
  assert.match(md2, /leaves 30\/142 = 21\.1% — which is exactly the ceiling on that row/);
});

test("an arm that raised nothing has no rate, rather than a rate of zero", () => {
  const silent = {
    per_replicate: [{
      ...LABELLED.per_replicate[1],
      overlap: { classes: 141, both: 0, panel_only: 141, coderabbit_only: 0, jaccard: 0 },
      unresolved: { ...LABELLED.per_replicate[1].unresolved, saturated: false },
      labels: undefined,
    }],
  };
  const c = complementarityFigures(silent);
  // 0/0 is not 0.000. A rate with no denominator is `null`, and the cell prints the
  // counts without a percentage rather than a confident zero-agreement figure.
  assert.equal(c.bands[0].rates.coderabbit.value.ratio, null);
  assert.equal(c.bands[0].rates.coderabbit.n, 0);
  const md = LABELLED_REPORT(silent);
  assert.match(md, /\| `pilot-01__k2` \| unadjudicated \| 0 of 0 \| 0 of 141 — \*\*0\.0%\*\* \| \[0\.0%, 20\.4%\] \|/);
  assert.equal(md.includes("0 of 0 — **0.0%**"), false, "an arm that raised nothing must not be given a rate");
});

test("the adjudicated denominators hold when two CodeRabbit classes resolve into one panel class", () => {
  // The case the derivation is least obviously right for. Before: both 6, panel-only
  // 10, CodeRabbit-only 4 — so 16 panel classes and 10 CodeRabbit ones. Two CodeRabbit
  // classes then resolve into ONE panel class: `resolveClasses` adds one to `both`
  // (distinct newly-shared PANEL classes) and removes two from the union.
  const merged = {
    per_replicate: [{
      stats: { label: "merge" },
      overlap: { classes: 20, both: 6, panel_only: 10, coderabbit_only: 4, jaccard: 6 / 20 },
      unresolved: { jaccard_upper_bound: 8 / 18, saturated: false, maybe_links: 9, strong_maybe_links: 2, triage_threshold: 0.7, coderabbit_classes_with_a_panel_candidate: 2 },
      severity: { shared_classes: 6, stated: { n: 6, panel_more_severe: 1, coderabbit_more_severe: 0 } },
      labels: labelsFor({
        availability: "resolved",
        before: labelBand(6, 20, 8, 18),
        gold: tierBlock({ tier: "gold", availability: "resolved", applied: 2, inTier: 2, res: { same: 2, undecided: 2, newly: 1 }, before: labelBand(6, 20, 8, 18), after: labelBand(7, 18, 9, 16), floorMoved: true, ceilingMoved: true }),
        silver: tierBlock({ tier: "silver", availability: "none-for-replicate", applied: 0, inTier: 0, before: labelBand(6, 20, 8, 18), after: labelBand(6, 20, 8, 18), floorMoved: false, ceilingMoved: false }),
      }),
    }],
  };
  const b = complementarityFigures(merged).bands[0];
  // CodeRabbit had 10 classes and now has 9 — two of them became one shared class. The
  // panel still has 16. Both are one subtraction from fields the payload states.
  assert.deepEqual(b.rates.coderabbit.value, { k: 6, n: 10, ratio: 6 / 10 });
  assert.deepEqual(b.rates.panel.value, { k: 6, n: 16, ratio: 6 / 16 });
  assert.deepEqual(b.rates_adjudicated.coderabbit.value, { k: 7, n: 9, ratio: 7 / 9 });
  assert.deepEqual(b.rates_adjudicated.panel.value, { k: 7, n: 16, ratio: 7 / 16 });
});

test("the tier table follows the frozen trust order, not the payload's key order", () => {
  // Two non-headline tiers, DECLARED WORST-FIRST in the payload. A renderer iterating
  // `by_tier`'s keys would print `distant` above `silver` — the reverse of their trust
  // — and, worse, would reorder itself whenever the scorer's own key order changed,
  // which is the byte-identical re-render property going quietly.
  const rep = LABELLED.per_replicate[1];
  const distant = { ...rep.labels.by_tier.silver, tier: "distant", availability: "resolved-nothing", labels: { ...rep.labels.by_tier.silver.labels, applied: 1, in_tier: 9 }, band: { before: K2_BAND, after: K2_BAND, floor_moved: false, ceiling_moved: false } };
  const reordered = {
    per_replicate: [{ ...rep, labels: { ...rep.labels, by_tier: { distant, silver: rep.labels.by_tier.silver, gold: rep.labels.by_tier.gold } } }],
  };
  const md = LABELLED_REPORT(reordered);
  const rows = md.split("\n").filter((l) => /^\| `pilot-01__k2` \| `(silver|distant)`/.test(l));
  assert.deepEqual(rows.map((l) => l.split("|")[2].trim()), ["`silver`", "`distant`"]);
  assert.equal(LABELLED_REPORT(reordered), md);
});

test("🔴 §7's first limit is DERIVED, so its premise cannot go false while its conclusion stays true", () => {
  // THE DEFECT THIS REPLACES was a hardcoded "No adjudicated labels exist." — an
  // assertion with no input, which could not go red when 357 pair labels landed. The
  // conclusion it drew is still correct, and for a reason the old sentence could not
  // state: a PAIR label and a VALIDITY label answer different questions.
  const limits = section(LABELLED_FULL(), "7");
  assert.match(limits, /\*\*357 adjudicated PAIR label\(s\) exist \(45 `gold` · 312 `silver`\), and no validity label does\.\*\*/);
  assert.match(limits, /are these two findings the\nsame defect\?/);
  assert.match(limits, /is this finding real\?/);
  // 🔴 WHICH KIND OF LABEL BOUNDS THE REPORT, and it is the one that does not exist.
  // Reverse this clause and the section says the labels it HAS are what precision
  // needs — the exact false conclusion the old hardcoded sentence protected against by
  // accident, and the reason this limit is worth deriving rather than deleting.
  assert.match(limits, /only the second bounds this report/);
  assert.equal(limits.includes("only the FIRST bounds this report"), false);
  assert.match(limits, /\*\*So there is still no\nprecision, recall or correctness figure anywhere above\*\*/);
  assert.match(limits, /adjudicating pairs does\nnot shrink it/);
  // The old unconditioned sentence is gone from a report whose store holds labels.
  assert.equal(limits.includes("**No adjudicated labels exist.**"), false);
  // AND IT STILL SAYS THE OLD THING WHEN THE OLD THING IS TRUE. A store with no pair
  // label renders the original sentence, so this is a derivation and not a rewrite.
  const none = section(renderReport(FULL()), "7");
  assert.match(none, /\*\*No adjudicated labels exist\.\*\* No precision, recall or correctness figure appears anywhere above/);
  assert.equal(none.includes("adjudicated PAIR label(s) exist"), false);
});

test("a labelled report still re-renders byte-identically", () => {
  // The property #828's own test asserts, re-checked with the label block attached:
  // every new line is derived from payload fields, and the tier tables iterate a frozen
  // trust order rather than object-key order.
  assert.equal(LABELLED_REPORT(), LABELLED_REPORT());
  const twice = [LABELLED, LABELLED].map((p) => LABELLED_REPORT(p));
  assert.equal(twice[0], twice[1]);
});

// --- §6, and the reviewer's own identity ------------------------------------
//
// Appended as a block rather than interleaved above, because `prompts/report-rewrite-section5.md`
// is rewriting §5 in a parallel branch and a clean append rebases where a merge inside a
// describe block conflicts.

/** The zero-label payload the scorer really produces, from the scorer. On the live store
 *  this is what `validity.mjs` printed on 2026-08-20: 0 labels, 4 computable metrics with
 *  no cell, 2 refused permanently, `partial`. */
const ZERO_LABEL_VALIDITY = () => scoreValidity({ arms: [], labels: [], corpusVersion: CORPUS_VERSION });

/** One finding label, and `class_id` is the parameter that matters: a bundled label makes
 *  `readings` smaller than `labelled_findings`, which is the pair of numbers a precision
 *  denominator can be taken from the wrong one of. */
const findingLabel = (key, isReal, severity, classId = null) => ({
  schema: "finding-label",
  finding_key: key,
  arm: "panel",
  label_source: "gold",
  is_real: isReal,
  severity,
  confidence: "high",
  item_id: "pr-415",
  class_id: classId,
  corpus_version: CORPUS_VERSION,
});

/**
 * SIX labels over FIVE readings, so the two levels differ by exactly one. `min_n` is 5, so
 * six clears it and the cell reports.
 */
const LABELS_SIX = [
  findingLabel("a.ts::x", true, "major", "cls-1"),
  findingLabel("b.ts::y", false, "major", "cls-1"),
  findingLabel("c.ts::z", true, "minor"),
  findingLabel("d.ts::w", true, "minor"),
  findingLabel("e.ts::v", false, "nit"),
  findingLabel("f.ts::u", true, "nit"),
];

/** The zero-label payload with real cells spliced in, so the `present` branch of every
 *  shape is exercised against the constructor that owns it. */
function labelledValidity() {
  const base = ZERO_LABEL_VALIDITY();
  const cell = (metric) => precisionCell({ metric, arm: "panel", tier: "gold", stratumBasis: "stratum", stratum: "all", labels: LABELS_SIX });
  return {
    ...base,
    labels: { ...base.labels, total: LABELS_SIX.length, census: { ...base.labels.census, n: LABELS_SIX.length, readings: 5 } },
    arms: [
      { arm: "panel", labels: 6, claims_supplied: true, claims: { distinct_finding_keys: 426 }, unlabelled_claims: 420, claim_population: "pending", join: { counts: { joined: 6, unmatched: 0 } } },
      { arm: "coderabbit", labels: 0, claims_supplied: false, claims: null, unlabelled_claims: null, claim_population: "unknown", join: { counts: { joined: 0, unmatched: 0 } } },
    ],
    cells: [cell("precision"), cell("severity_weighted_precision")],
    relative_recall: [relativeRecallBand({ arm: "panel", tier: "gold", real: 4, labelled: 6, otherArm: "coderabbit", otherReal: 5, otherLabelled: 7 })],
    fp_profile: fpProfile({ arm: "panel", tier: "gold", joined: LABELS_SIX.map((l) => ({ label: l, claim: { severity: "major" } })) }),
    // The base payload's completeness describes a store with NO labels, so it is replaced
    // rather than carried: a fixture whose prose contradicts its own cells would let an
    // assertion pass against a sentence no real payload could produce.
    completeness: { verdict: "partial", reasons: ["coderabbit: no claim population supplied, so its 0 label(s) could not be placed and no precision is computed for it"] },
  };
}

/** The pilot's REAL config snapshots, one per replicate — six lenses, five on
 *  `claude-opus-5` and `docs` on `claude-sonnet-5`, read off each replicate's
 *  `config.snapshot.json` under `runs/` on 2026-08-20. `captured_at` differs across the
 *  three by 19 hours and is deliberately not an axis: they describe one reviewer. */
const PILOT_LENSES = [
  { id: "correctness", title: "Correctness", gating: "blocking", model: "claude-opus-5", samples: 1, effort: "medium" },
  { id: "security", title: "Security", gating: "blocking", model: "claude-opus-5", samples: 1 },
  { id: "design-fit", title: "Design fit", gating: "blocking", model: "claude-opus-5", samples: 1, effort: "medium" },
  { id: "test-adequacy", title: "Test adequacy", gating: "blocking", model: "claude-opus-5", samples: 1, effort: "medium" },
  { id: "blast-radius", title: "Blast radius", gating: "blocking", model: "claude-opus-5", samples: 1, effort: "medium" },
  { id: "docs", title: "Docs", gating: "blocking", model: "claude-sonnet-5", samples: 1, effort: "medium" },
];

/** `configHash` is a PARAMETER, because a lens whose model changed does not keep its
 *  hash: `config_hash` covers every behaviour-determining lens field. A fixture that
 *  moved a model and left the hash alone would be testing an input the store cannot
 *  produce — and it did, until the demotion rule below made the difference matter. */
const pilotRun = (runId, { capturedAt, lenses = PILOT_LENSES, sdk = "0.3.217", panelSha = PANEL_SHA, panelDigest = PANEL_DIGEST, configHash = CONFIG_HASH } = {}) => ({
  run_id: runId,
  runJson: { run_id: runId, panel_sha: panelSha, panel_sha_source: "git", panel_digest: panelDigest, panel_digest_source: "files", config_hash: configHash, sdk_version: sdk },
  configSnapshot: {
    config_hash: configHash,
    config_hash_version: "wafflebase/config-hash@2",
    captured_at: capturedAt,
    schema_version: 1,
    config_id: "baseline",
    target: "reviewer",
    sdk_version: sdk,
    lenses,
  },
});

const PILOT_RUNS = [
  pilotRun("pilot-01__k1", { capturedAt: "2026-08-10T08:27:03.778Z" }),
  pilotRun("pilot-01__k2", { capturedAt: "2026-08-11T02:21:10.393Z" }),
  pilotRun("pilot-01__k3", { capturedAt: "2026-08-11T03:32:42.285Z" }),
];

const WITH_REVIEWER = (extra = {}, runs = PILOT_RUNS) =>
  buildReport({
    configHash: CONFIG_HASH,
    corpusVersion: CORPUS_VERSION,
    panelSha: PANEL_SHA,
    panelDigest: PANEL_DIGEST,
    runIds: RUNS,
    corpusItemIds: RELIABILITY.items,
    runs,
    scores: { volume: VOLUME, complementarity: COMPLEMENTARITY, reliability: RELIABILITY, ...extra },
  });

test("§6 declares every metric the scorer names, and with no label NONE of them is a figure", () => {
  // 🔴 THE STATE THIS SECTION EXISTS TO PRODUCE. `validity.mjs` merged (#905) wired into
  // nothing, so precision appeared on the page only as prose in the limits — and a reader
  // cannot tell a footnote from a metric nobody thought of. Declared as cells, each one
  // says "measured here, and the judgement has not been made".
  const v = validityFigures(ZERO_LABEL_VALIDITY());
  assert.equal(v.availability, "present");
  assert.deepEqual(
    v.metrics.map((m) => m.id),
    ["precision", "severity_weighted_precision", "relative_recall", "fp_profile", "absolute_recall", "miss_profile"],
  );
  // EVERY row carries a cell, and not one of them is `present`. That is the assertion
  // the checklist calls "it cannot render a figure with no labels": a precision figure
  // over zero labels would have to divide by zero, and the four states make the absence
  // spellable instead.
  for (const m of v.metrics) {
    assert.ok(m.cell, `${m.id} has no cell`);
    assert.ok(AVAILABILITY.includes(m.cell.availability), `${m.id} carries ${m.cell.availability}`);
    assert.notEqual(m.cell.availability, "present", `${m.id} rendered a figure over zero labels`);
    assert.match(m.cell.reason, /\S/, `${m.id} gives no reason`);
  }
  assert.deepEqual([v.cells.length, v.bands.length, v.profile.length], [0, 0, 0]);
  // And on the page: the reason is there, and no `(n= …)` figure is, because `renderCell`
  // spells an `n` only for a present cell.
  const md = section(renderReport(WITH_REVIEWER({ validity: ZERO_LABEL_VALIDITY() })), "6");
  assert.match(md, /\| `precision` \| \*\*not computed\*\* — no precision cell exists: 0 finding label\(s\) exist on this corpus version/);
  assert.match(md, /The store holds \*\*0 finding label\(s\)\*\* for this corpus version\./);
  assert.doesNotMatch(md, /\(n=\d/, "§6 printed a figure's n over a store with no labels");
  // The claim populations are what make the zeroes readable: `pending` says a judgement
  // can still land, and the scorer's own reasons follow.
  assert.match(md, /\*\*The scorer reports itself `partial`\*\*/);
  assert.match(md, /no finding label exists for this corpus version/);
});

test("🔴 absolute_recall and miss_profile are not-measurable, and a payload calling either not-computed is REFUSED", () => {
  const v = validityFigures(ZERO_LABEL_VALIDITY());
  for (const id of ["absolute_recall", "miss_profile"]) {
    const row = v.metrics.find((m) => m.id === id);
    assert.equal(row.computable, false);
    assert.equal(row.cell.availability, "not-measurable", `${id} must never be merely uncomputed`);
    assert.match(row.cell.reason, /true_defects\[\]/, `${id}'s reason must name what is missing`);
  }
  // 🔴 THE GUARD, AND IT IS A REFUSAL RATHER THAN A COERCION. `not-computed` tells a
  // reader to wait for a judgement; these two can never be judged, because a corpus built
  // from what two reviewers said cannot contain what they both missed. A renderer that
  // translated one state into the other would print "not computed" over a permanent
  // refusal and nothing downstream could tell.
  const bend = (id, patch) => {
    const p = ZERO_LABEL_VALIDITY();
    return { ...p, metrics: p.metrics.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
  };
  assert.throws(() => validityFigures(bend("absolute_recall", { availability: "not-computed" })), /must render `not-measurable`/);
  assert.throws(() => validityFigures(bend("miss_profile", { availability: "suppressed" })), /must render `not-measurable`/);
  assert.throws(() => validityFigures(bend("absolute_recall", { availability: null })), /must render `not-measurable`/);
  // An unexplained permanent refusal cannot be told from a scorer nobody ran, so it is
  // refused too.
  assert.throws(() => validityFigures(bend("miss_profile", { reason: "" })), /gives no reason/);
  // On the page, both rows say `not measurable` and the follow-up names them rather than
  // pointing at a position in the table — a caption that said "the last two rows" would
  // quietly point elsewhere the day the scorer reordered `METRICS`.
  const md = section(renderReport(WITH_REVIEWER({ validity: ZERO_LABEL_VALIDITY() })), "6");
  assert.match(md, /\| `absolute_recall` \| \*\*not measurable\*\* —/);
  assert.match(md, /\| `miss_profile` \| \*\*not measurable\*\* —/);
  assert.match(md, /🔴 \*\*`absolute_recall` and `miss_profile` are `not measurable` PERMANENTLY/);
  assert.match(md, /what would change it: item labels carrying a non-empty true_defects\[\]/);
});

test("a validity payload WITH labels renders figures, and the n is labelled_findings and never readings", () => {
  // 🔴 SIX LABELS OVER FIVE READINGS, and the precision denominator is the six. The
  // scorer prints both levels on every cell precisely because 428 labels written from 245
  // readings and 428 written from 428 are different datasets — and only one of the two
  // belongs under the ratio.
  const v = validityFigures(labelledValidity());
  const precision = v.metrics.find((m) => m.id === "precision");
  assert.equal(precision.cell, null, "a metric with cells points at the grid rather than pooling four states into one");
  assert.equal(precision.cells.n, 1);
  assert.deepEqual(v.cells[0].cell, { availability: "present", value: 4 / 6, n: 6, unit: "labelled findings" });
  assert.notEqual(v.cells[0].cell.n, 5, "the figure's n must be the label count, not the reading count");
  // The severity-weighted cell divides weight sums and takes its unit from the payload's
  // own declaration rather than a literal here.
  assert.equal(v.cells[1].cell.unit, "summed severity weight over labelled findings");
  // BOTH BOUNDS OR NEITHER: a relative-recall cell has no `value`, so a renderer reaching
  // for one would print `undefined` where a band belongs.
  assert.equal(v.bands.length, 1);
  assert.deepEqual([v.bands[0].band.low, v.bands[0].band.high], [4 / 9, 4 / 5]);
  // A false-finding COUNT is printed at any size; the SHARE beside it follows min-n.
  const major = v.profile.find((g) => g.axis === "annotator_severity" && g.bucket === "major");
  assert.equal(major.false_findings, 1);
  assert.equal(major.share.availability, "suppressed");

  const md = section(renderReport(WITH_REVIEWER({ validity: labelledValidity() })), "6");
  // ONE cell for `precision` and one for `severity_weighted_precision` — the two share a
  // payload list and are separated by the metric each cell names, which is why the census
  // is per metric rather than per list.
  assert.match(md, /\| `precision` \| 1 cell\(s\) below — 1 present, 0 not-computed, 0 not-measurable, 0 suppressed \| labelled findings \|/);
  assert.match(md, /\| `fp_profile` \| 6 cell\(s\) below — 3 present, 0 not-computed, 0 not-measurable, 3 suppressed \| false findings, grouped \|/);
  assert.match(md, /metric=precision\/arm=panel\/tier=gold\/stratum=all` \| 0\.667 \(n=6 labelled findings\)/);
  assert.match(md, /\*\*\[44\.4%, 80\.0%\]\*\* \(n=6 labelled findings\) \| 5–9 confirmed/);
  assert.match(md, /written from 5 reading\(s\) — a judgement count and a reading count are not the same denominator/);
  assert.match(md, /\| `panel` \| 6 \| 426 \| 420 \| `pending` \|/);
  // An arm whose claim population was never supplied says so rather than reporting zero
  // claims, which would read as a reviewer that raised nothing.
  assert.match(md, /\| `coderabbit` \| 0 \| claim population not supplied \|/);
});

test("§6 renders when no validity score is filed at all, and says which kind of absence that is", () => {
  const md = section(renderReport(WITH_REVIEWER()), "6");
  assert.match(md, /\*\*not computed\*\* — no validity-v1 score is filed for this comparability key/);
  assert.match(md, /the first kind — nobody computed it/);
  // A score file that exists and declares no metric is a DIFFERENT absence: the refusals
  // are half of what this section carries, and a payload that names none cannot say which
  // it refused.
  const v = validityFigures({ completeness: { verdict: "complete", reasons: [] } });
  assert.equal(v.availability, "not-computed");
  assert.match(v.reason, /carries no `metrics` block/);
});

test("the header names every lens and the model it runs, and keeps the full hashes once", () => {
  // 🔴 THE DEFECT THIS FIXES, in the human's words: the report should say which panel
  // version it ran on "including which models etc, not just the incomprehensible hash
  // number". Two digests cannot be compared against the panel in front of a reader — a
  // hash has no ordering, so it says "different" and never "older, in this respect".
  const d = reviewerFigures(PILOT_RUNS);
  assert.equal(d.availability, "present");
  assert.deepEqual(d.disagreements, []);
  assert.equal(d.lenses.length, 6);
  assert.equal(d.panel_sha.short, "46da673");
  assert.equal(d.panel_sha.full, PANEL_SHA);
  // 🔴 THE DIGEST IS ITS OWN AXIS, compared across the legs the same way and reported the
  // same way. It is not derivable from `panel_sha`: two legs can agree on the digest and
  // differ on the sha (a panel deleted and restored, #830 and #850), and only the digest
  // decides which file a cross-run score lands in. The short form drops the constant
  // `sha256:` prefix rather than truncating something a reader needs.
  assert.equal(d.panel_digest.full, PANEL_DIGEST);
  assert.equal(d.panel_digest.short, PANEL_DIGEST.slice(7, 19));
  assert.equal(d.panel_digest.source, "files");

  const md = renderReport(WITH_REVIEWER({ validity: ZERO_LABEL_VALIDITY() }));
  for (const lens of PILOT_LENSES) {
    assert.match(md, new RegExp(`\\| \`${lens.id}\` \\| \`${lens.model}\``), `the header does not name ${lens.id} with its model`);
  }
  // Five lenses on one model and one on another — the fact a single "claude-opus-5" line
  // would have hidden.
  assert.match(md, /\| `docs` \| `claude-sonnet-5` \| 1 \| `medium` \| blocking \|/);
  assert.match(md, /\| config \| `baseline` — 6 lenses, hashed by `wafflebase\/config-hash@2` \|/);
  assert.match(md, /\| Agent SDK \| `0\.3\.217` \|/);
  // THE SHORT SHA IS A PREFIX AND NOT A SUBSTITUTE: the full one stays on the page,
  // because it is the join key and somebody will need it.
  assert.match(md, new RegExp(`\\| panel code \\| \`46da673\` \\(full \`${PANEL_SHA}\`, recorded from \`git\`\\) \\|`));
  assert.match(md, new RegExp(`\\| panel contents \\| \`${PANEL_DIGEST.slice(7, 19)}\` \\(full \`${PANEL_DIGEST}\`, recorded from \`files\`\\) \\|`));
  assert.match(md, /All 3 replicates name the same lens set, the same model on every lens/);
  // A lens field that the snapshot does not state renders as words. `security` carries no
  // `effort`, and the panel's default for it lives in `review-panel.mjs` — inferring it
  // here would print a value the snapshot never recorded.
  assert.match(md, /\| `security` \| `claude-opus-5` \| 1 \| `not stated` \| blocking \|/);
  // The two hashes in the header table above are untouched: this block adds to the
  // identity, it does not replace it.
  assert.match(md, new RegExp(`\\| reviewer \\| \`panel_sha ${PANEL_SHA}\` · \`panel_digest ${PANEL_DIGEST}\` · \`${CONFIG_HASH}\``));
});

test("🔴 a reviewer axis that DISAGREES across replicates is REPORTED, never resolved to the first", () => {
  // Three replicates carry three snapshots and nothing in the store forces them to
  // match. A config edited between two legs leaves one lens on a different model, and
  // printing replicate 1's answer would describe a reviewer that produced a third of the
  // data.
  const movedModel = PILOT_LENSES.map((l) => (l.id === "docs" ? { ...l, model: "claude-opus-5" } : l));
  // 🔴 THE HASH MOVES WITH THE MODEL. A lens's model is inside `config_hash`, so a leg
  // that ran `docs` on another model carries another hash — and a fixture that moved one
  // without the other would be exercising an input the store cannot produce, which is
  // exactly how the demotion rule below could have been "tested" into hiding a real
  // reviewer change.
  const OTHER_HASH = `sha256:${"b".repeat(64)}`;
  const runs = [PILOT_RUNS[0], PILOT_RUNS[1], pilotRun("pilot-01__k3", { capturedAt: "2026-08-11T03:32:42.285Z", lenses: movedModel, configHash: OTHER_HASH })];
  const d = reviewerFigures(runs);
  assert.deepEqual(d.disagreements.map((x) => x.field), ["config_hash", "lens set"]);
  assert.deepEqual(d.cosmetic_differences, [], "a lens change under a MOVED hash is a reviewer change, never cosmetic");
  // 🔴 THE LENS TABLE IS EMPTY RATHER THAN SHOWING ONE LEG'S. This is the assertion that
  // makes "reported, never resolved" load-bearing: a renderer that fell back to
  // `runs[0]` would print a six-row table that two thirds of the data does not support.
  assert.deepEqual(d.lenses, []);
  assert.equal(d.agreed["lens set"], undefined);

  const md = renderReport(
    buildReport({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION, panelSha: PANEL_SHA,
    panelDigest: PANEL_DIGEST, runIds: RUNS, corpusItemIds: RELIABILITY.items, runs, scores: { volume: VOLUME, complementarity: COMPLEMENTARITY, reliability: RELIABILITY } }),
  );
  assert.match(md, /🔴 \*\*2 axis\(es\) of the reviewer's identity DISAGREE across the replicates below\*\*/);
  assert.match(md, /\| `lens set` \| `pilot-01__k1` → .*`pilot-01__k3` → /);
  assert.match(md, /\| `config_hash` \| `pilot-01__k1` → /);
  assert.match(md, /docs=claude-opus-5/, "the disagreeing value must be quoted, not summarised away");
  // And the agreement sentence is GONE — "we checked and they match" must not be printable
  // over legs that do not.
  assert.equal(md.includes("name the same lens set, the same model on every lens"), false);

  // The same guard on a scalar axis, because a lens-set signature and an SDK version fail
  // differently and only one of them is a composite.
  const otherSdk = reviewerFigures([PILOT_RUNS[0], pilotRun("pilot-01__k2", { capturedAt: "x", sdk: "0.3.218" })]);
  assert.deepEqual(otherSdk.disagreements.map((x) => x.field), ["sdk_version"]);
  assert.equal(otherSdk.agreed.sdk_version, undefined);
  assert.equal(otherSdk.lenses.length, 6, "a disagreement on one axis must not blank an axis that agrees");
  // A panel_sha that disagrees leaves the short-sha row unprintable rather than picking one.
  const otherSha = reviewerFigures([PILOT_RUNS[0], pilotRun("pilot-01__k2", { capturedAt: "x", panelSha: "0000000000000000000000000000000000000000" })]);
  assert.equal(otherSha.panel_sha, null);
  assert.deepEqual(otherSha.disagreements.map((x) => x.field), ["panel_sha"]);
  // 🔴 AND THE DIGEST, which is the axis a cross-run score's PATH is keyed by — so two
  // legs disagreeing on it means the figures on the page were pooled from two reviewers.
  // Reported, never resolved: no leg's answer is printed for it.
  const disagreeingRuns = [PILOT_RUNS[0], pilotRun("pilot-01__k2", { capturedAt: "x", panelDigest: `sha256:${"9".repeat(64)}` })];
  const otherDigest = reviewerFigures(disagreeingRuns);
  assert.equal(otherDigest.panel_digest, null);
  assert.deepEqual(otherDigest.disagreements.map((x) => x.field), ["panel_digest"]);
  assert.match(renderReport(WITH_REVIEWER({ validity: ZERO_LABEL_VALIDITY() }, disagreeingRuns)), /\| panel contents \| \*\*disagrees across replicates/);
  // The two are INDEPENDENT: a panel deleted and restored (#830, #850) agrees on the
  // digest and differs on the sha, and a digest read off a stated flag rather than the
  // files differs in `panel_digest_source` alone. Neither is derivable from the other.
  assert.equal(otherSha.panel_digest.full, PANEL_DIGEST);
  assert.equal(otherDigest.panel_sha.full, PANEL_SHA);
});

test("🔴 a lens difference under an IDENTICAL config_hash is cosmetic, not a second reviewer", () => {
  // 🔴 THE DEFECT. `lensSignature` compares the snapshot's RAW fields; `config_hash`
  // compares their CANONICAL form — `config-hash.mjs` normalises an omitted `effort` to
  // the panel's default before hashing. So a snapshot that omits the field and one that
  // states the default explicitly hash IDENTICALLY and signature DIFFERENTLY, and the
  // first version of this block then printed "these are not replicates of one reviewer"
  // and blanked the lens table over legs whose hash is identical — which is the
  // definition of one reviewer on the configuration axis, and which the render path has
  // already refused to proceed without. A guard that fires on data the same file calls
  // fine teaches a reader to discount it.
  //
  // The pilot has exactly this shape: `security` omits `effort` where the others state
  // one, so a snapshot regenerated by a `config-build.mjs` that inlines defaults trips it.
  const inlined = PILOT_LENSES.map((l) => (l.id === "security" ? { ...l, effort: "high" } : l));
  const runs = [PILOT_RUNS[0], pilotRun("pilot-01__k2", { capturedAt: "2026-08-11T02:21:10.393Z", lenses: inlined })];
  const d = reviewerFigures(runs);
  assert.deepEqual(d.disagreements, [], "an identical config_hash means these are one reviewer");
  assert.deepEqual(d.cosmetic_differences.map((x) => x.field), ["lens set"]);
  // 🔴 THE TABLE STILL RENDERS. Blanking it was the visible half of the defect.
  assert.equal(d.lenses.length, 6);

  const md = renderReport(
    buildReport({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION, panelSha: PANEL_SHA,
    panelDigest: PANEL_DIGEST, runIds: RUNS, corpusItemIds: RELIABILITY.items, runs, scores: { volume: VOLUME, complementarity: COMPLEMENTARITY, reliability: RELIABILITY } }),
  );
  assert.match(md, /⚠ \*\*The replicates record this configuration differently in 1 place\(s\), and `config_hash` is identical\*\*/);
  assert.match(md, /\| `security` \| `claude-opus-5` \|/, "the lens table must still be on the page");
  // ⚠ AND NOT 🔴: the reviewer-change refusal must not fire on a configuration the hash
  // says is one configuration.
  assert.equal(md.includes("of the reviewer's identity DISAGREE"), false);
  // A hash that is NOT stated cannot outrank anything, so the refusal stands — the
  // demotion is earned by an agreeing hash, never assumed.
  const noHash = reviewerFigures([
    { ...PILOT_RUNS[0], configSnapshot: { ...PILOT_RUNS[0].configSnapshot, config_hash: undefined } },
    { ...runs[1], configSnapshot: { ...runs[1].configSnapshot, config_hash: undefined } },
  ]);
  assert.deepEqual(noHash.disagreements.map((x) => x.field), ["lens set"]);
  assert.deepEqual(noHash.cosmetic_differences, []);
  assert.deepEqual(noHash.lenses, []);
});

test("🔴 the frame and §7's limit are DERIVED from §6, so neither can claim there is no precision figure while §6 prints one", () => {
  // 🔴 TWO HARDCODED CLAIMS THAT §6 CAN FALSIFY, and one of them sits above every number
  // in the report. `renderWhatThisIsNot` asserted "There is no precision figure … anywhere
  // in this document" and `labelsLimit` concluded "no validity label does" plus "there is
  // still no precision … figure anywhere above" — both from inputs that cannot see §6.
  // This is the identical defect `labelsLimit` was written to fix for the PAIR census, one
  // metric later: a sentence that cannot go red when its premise moves is a falsehood
  // waiting to publish.
  const withFigures = renderReport(WITH_REVIEWER({ validity: labelledValidity() }));
  // The premise: §6 really does print a figure in this render.
  assert.match(section(withFigures, "6"), /0\.667 \(n=6 labelled findings\)/);
  // So neither claim is on the page.
  assert.equal(withFigures.includes("There is no precision figure"), false);
  assert.equal(withFigures.includes("No precision, recall or correctness figure appears anywhere above"), false);
  assert.equal(withFigures.includes("still no\nprecision, recall or correctness figure anywhere above"), false);
  assert.equal(withFigures.includes("and no validity label does"), false);
  // And what IS on the page names the figures and their denominator.
  assert.match(withFigures, /The exception is §6, which carries 6 quality figure\(s\) over 6 adjudicated finding label\(s\)/);
  // The count is per LIST and named, so a band is never counted as a precision cell:
  // 2 precision cells + 1 relative-recall band + 3 reporting profile shares.
  assert.deepEqual(qualityFigures(validityFigures(labelledValidity())), { any: true, n: 6, cells: 2, bands: 1, shares: 3, labels: 6 });
  assert.match(section(withFigures, "7"), /\*\*6 quality figure\(s\) appear in §6\*\*, over 6 finding label\(s\) an adjudicator has written/);
  assert.match(section(withFigures, "7"), /is\nno longer true and is not printed/);

  // 🔴 AND BOTH REVERT WHEN THE PREMISE DOES. A store with no validity label renders the
  // original sentences, so this is a derivation and not a rewrite — the same property
  // §7's pair-label limit is already tested for.
  const none = renderReport(WITH_REVIEWER({ validity: ZERO_LABEL_VALIDITY() }));
  assert.match(none, /There is no precision figure, no/);
  assert.match(section(none, "7"), /\*\*No adjudicated labels exist\.\*\* No precision, recall or correctness figure appears anywhere above/);
  assert.equal(none.includes("quality figure(s) appear in §6"), false);
  // A SUPPRESSED cell is not a figure a reader can quote, so it must not flip either
  // claim — the distinction the four states exist for, applied to this predicate.
  const p = labelledValidity();
  const withheldOnly = { ...p, cells: [], relative_recall: [], fp_profile: p.fp_profile.filter((g) => g.share_availability === "suppressed") };
  assert.equal(qualityFigures(validityFigures(withheldOnly)).any, false);
  assert.match(renderReport(WITH_REVIEWER({ validity: withheldOnly })), /There is no precision figure, no/);
});

test("captured_at is NOT a reviewer axis, so three snapshots frozen hours apart still agree", () => {
  // ⚠ The pilot's three snapshots differ in `captured_at` by 19 hours and describe one
  // reviewer, which is exactly why `config-hash.mjs` calls it cosmetic. A comparison over
  // whole snapshot bytes would report a disagreement on every real store — the guard
  // firing on every honest input is the same as not having it.
  const stamps = PILOT_RUNS.map((r) => r.configSnapshot.captured_at);
  assert.equal(new Set(stamps).size, 3, "the fixture must actually differ, or this asserts nothing");
  assert.deepEqual(reviewerFigures(PILOT_RUNS).disagreements, []);
});

test("a render with no run envelope, and one with no config snapshot, both SAY so", () => {
  // `runs` is provenance rather than identity, so it is optional — and an optional input
  // that renders as silence is the blank cell this module exists to prevent.
  const none = reviewerFigures([]);
  assert.equal(none.availability, "not-computed");
  assert.match(none.reason, /no run envelope was supplied/);
  assert.match(renderReport(FULL()), /\*\*not computed\*\* — no run envelope was supplied to this render/);

  // `store.getRun` degrades a missing `config.snapshot.json` to `null` — a run written
  // before its snapshot landed. Such a leg is NAMED, because a replicate silently dropped
  // here would leave the header describing a lens set two of three legs never confirmed.
  const partial = reviewerFigures([PILOT_RUNS[0], { run_id: "pilot-01__k2", runJson: { panel_sha: PANEL_SHA, panel_sha_source: "git" }, configSnapshot: null }]);
  assert.equal(partial.availability, "present");
  assert.deepEqual(partial.snapshots_missing, ["pilot-01__k2"]);
  assert.equal(partial.replicates.length, 1, "a leg with no snapshot cannot confirm an axis");
  const md = renderReport(
    buildReport({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION, panelSha: PANEL_SHA,
    panelDigest: PANEL_DIGEST, runIds: RUNS, corpusItemIds: RELIABILITY.items, runs: [PILOT_RUNS[0], { run_id: "pilot-01__k2", runJson: {}, configSnapshot: null }], scores: { volume: VOLUME, complementarity: COMPLEMENTARITY, reliability: RELIABILITY } }),
  );
  assert.match(md, /⚠ \*\*1 replicate carries no config snapshot\*\* \(pilot-01__k2\)/);
  // Every leg missing its snapshot is a stated absence too, not an empty table.
  const allMissing = reviewerFigures([{ run_id: "a", runJson: {}, configSnapshot: null }]);
  assert.equal(allMissing.availability, "not-computed");
  assert.match(allMissing.reason, /none of the 1 replicate\(s\) carries a config snapshot \(a\)/);
});

test("the reviewer block and §6 add no clock, so a report carrying both re-renders byte-identically", () => {
  // The property every addition to this file has to preserve: a `generated_at` anywhere
  // would make two renders of one dataset differ, and a re-render could then not be
  // diffed against its predecessor to show that nothing moved.
  const twice = [0, 1].map(() => renderReport(WITH_REVIEWER({ validity: ZERO_LABEL_VALIDITY() })));
  assert.equal(twice[0], twice[1]);
  const labelled = [0, 1].map(() => renderReport(WITH_REVIEWER({ validity: labelledValidity() })));
  assert.equal(labelled[0], labelled[1]);
  assert.doesNotMatch(labelled[0], /\d{4}-\d\d-\d\dT\d\d:/);
  // And no table cell anywhere in the enlarged document is blank.
  for (const line of labelled[0].split("\n").filter((l) => l.startsWith("|"))) {
    assert.doesNotMatch(line, /\|\s*\|\s*\|/, `empty cell in: ${line}`);
  }
  // ⟳ BACKTICKS BALANCE, over a POPULATED §6 — added while rebasing onto #909, which
  // introduced this check for §5's wrapped prose and runs it over the whole document.
  // Its fixture leaves §6 in the no-score-filed branch, so #909's version never sees a
  // rendered metric grid, a lens table or a band. An unclosed code span silently
  // swallows the rest of a markdown line, and §6 emits more of them than any other
  // section: every metric id, every arm, every claim population.
  for (const md of [labelled[0], twice[0]]) {
    for (const line of md.split("\n")) {
      assert.equal((line.match(/`/g) ?? []).length % 2, 0, `unbalanced backticks: ${line}`);
    }
  }
});

test("§1 and §3 explain their metric BEFORE their numbers, and no stated limit is softened", () => {
  // §2 and §4 already carry their reasoning inline and it works — "read the two
  // directional rates before the Jaccard", "the two figures time different things". §1 and
  // §3 stated figures and trusted a reader to know why they mattered, which is how "4.7x
  // more findings" comes to be quoted as a result.
  const md = renderReport(WITH_REVIEWER({ cost_latency: COST_LATENCY, validity: ZERO_LABEL_VALIDITY() }));
  const one = section(md, "1");
  const three = section(md, "3");
  assert.match(one, /\*\*This section counts findings and nothing else\.\*\*/);
  assert.match(one, /never when it is more often right, which no figure in this section can see/);
  assert.match(three, /\*\*This section asks whether the same reviewer, run again on the same diff, says the same thing\.\*\*/);
  assert.match(three, /it is silent on\ncorrectness/);
  // BEFORE the numbers, which is the half that makes it an explanation rather than a
  // footnote: a reader who meets it after the table has already formed the impression it
  // corrects.
  assert.ok(one.indexOf("counts findings and nothing else") < one.indexOf("| severity |"), "§1's explanation must precede its table");
  assert.ok(three.indexOf("says the same thing") < three.indexOf("| gate verdict agreement |"), "§3's explanation must precede its table");

  // 🔴 TWO THINGS THE FRIENDLINESS PASS MUST NOT HAVE DONE.
  // ① Every figure still carries its `n` and its unit — `figure` refuses without both, so
  // this checks the report still SPELLS them where it did.
  assert.match(one, /\| \*\*total\*\* \| \*\*142 · 147 · 139 \(range 8\)\*\* \| \*\*30\*\* \|/);
  assert.match(three, /\*\*1\.000\*\* \(7\/7\) \| items, each over all replicates/);
  // ② A stated limit is still stated as a RESULT and not as an apology. The report's habit
  // of saying "not measurable — permanently" is one of its best properties.
  assert.match(section(md, "4"), /\*\*not measurable\*\* — PERMANENTLY, and this is a result rather than a gap/);
  for (const hedge of [/unfortunately/i, /we were unable/i, /we could not measure/i, /sadly/i, /regrettably/i]) {
    assert.doesNotMatch(md, hedge, `the report must not apologise for a limit it states as a result (${hedge})`);
  }
});

test("a validity cell whose availability the renderer does not know is refused, not rendered blank", () => {
  // The same refusal `renderCell` makes, one level up: the scorer's four states are
  // checked against this module's on import (`assertAvailabilityMatchesRenderer`), and a
  // near-miss synonym reaching a cell must stop the render rather than produce a row with
  // nothing in it.
  const p = labelledValidity();
  const bent = { ...p, cells: [{ ...p.cells[0], availability: "reported" }, p.cells[1]] };
  assert.throws(() => validityFigures(bent), /a validity cell must carry one of/);
  // And a metric whose unit the payload does not declare cannot be captioned at all.
  const noUnit = { ...p, metrics: p.metrics.map((m) => (m.id === "precision" ? { ...m, unit: "" } : m)) };
  assert.throws(() => validityFigures(noUnit), /declares no unit for "precision"/);
});
