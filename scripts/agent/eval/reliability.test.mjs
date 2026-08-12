// What these tests are FOR. A reliability scorer's output is a set of ratios
// between 0 and 1, and every one of them could be wrong by a plausible amount with
// nothing going red — the same trap `volume-mix.test.mjs` names. So the assertions
// concentrate on the places a WRONG number comes from rather than on arithmetic:
//
//   1. The three refusals, each mutation-tested. They are most of this PR's value:
//      pooling two reviewers, scoring a failed replay, or reporting agreement over
//      one run all produce believable figures out of unusable input.
//   2. Absent read as a verdict. A payload with no `panel[]` rows must not read as
//      "no lens failed", and a `null` verification must not read as verifier
//      agreement — both are lesson 6, and both would flatter us.
//   3. The denominators. `n` on every proportion, the three pairwise values beside
//      any mean, and the `maybe` count beside every Jaccard — because the ratio is a
//      lower bound and a reader cannot tell by how much without it.
//   4. The spec's own contract: §3.2's worked example, which fixes what "agreement"
//      means before any of our data is involved.
//
// FIXTURES ONLY, and they are built by the REAL `buildFindingRecord` rather than
// hand-shaped objects, so a schema change breaks these tests instead of passing
// them. Two fixtures are real: the `panel[]` rows of `pilot-01__k1`'s pr-415 and
// pr-471, verbatim, because the interesting shape (a `blocking`, INAPPLICABLE docs
// lens that concluded `skipped`) is not something an invented row would have.
//
// Nothing here writes to a store, calls a model, needs an API key or touches the
// network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupFindings } from "../finding-match.mjs";
import { buildFindingRecord } from "./finding-record.mjs";
import {
  BOUND,
  GATE_BASIS,
  KAPPA_CAVEAT,
  LANE_BASIS,
  VERIFIER_NON_VERDICTS,
  VERIFIER_VERDICTS,
  classSeverity,
  cohenKappa,
  duplicateLocationsOf,
  gateVerdictOf,
  jaccardOf,
  laneGateOf,
  matcherGateOf,
  recurrenceOf,
  reliabilityOf,
  renderReport,
  repeated,
  spread,
  verifierAgreementOf,
  assertEnoughRuns,
  assertItemsOk,
  assertOneReviewer,
  assertRequestedCorpus,
} from "./reliability.mjs";

// --- fixtures ---------------------------------------------------------------

const CONFIG = "sha256:1c7853debf4edf92646d2299b0c924cb48cca89d6bb68b81648c57508a762f01";
const SHA = "46da673dd46dd5576626ee6d1b4e2e40728345e0";

/**
 * Four defects with disjoint vocabularies and files, so the matcher's verdict on
 * any pair is unambiguous: same defect across runs → the summaries are identical
 * (location 1, token overlap 1); different defects → different file AND no shared
 * symbol, which L2 answers `no` to outright.
 *
 * Each summary carries well over `MIN_SHARED_TOKENS` significant tokens, because
 * `tokenOverlap` returns 0 below that floor however alike two strings look — a
 * three-word fixture would have measured the floor instead of the metric.
 */
const DEFECTS = {
  f1: {
    file: "packages/backend/src/datasource/timezone.service.ts",
    summary: "timezone offset is applied twice when the datasource parser rehydrates a timestamptz column",
    evidence: "`parseTimestamptz` shifts by the runtime offset and `toCell` shifts again, so every rendered cell is doubly offset",
  },
  f2: {
    file: "packages/core/src/sheet/formula-cache.ts",
    summary: "formula cache retains evicted sheet references so a deleted sheet keeps recomputing on every edit",
    evidence: "`evictSheet` clears the map entry but leaves the dependency edge, and `recompute` walks edges",
  },
  f3: {
    file: "packages/frontend/src/toolbar/undo-button.tsx",
    summary: "undo button stays enabled after the history stack empties because the disabled predicate reads a stale length",
    evidence: "`canUndo` closes over `history.length` captured at mount",
  },
  f4: {
    file: "packages/cli/src/commands/export-csv.ts",
    summary: "csv export writes a bare newline inside quoted fields so a spreadsheet reimport splits one row into two",
    evidence: "`writeRow` joins cell text without escaping the embedded newline",
  },
};

/** One finding record, built by the real builder. `lane` and `verification` go on
 *  the FINDING as well as the detail, because `gatingOf` reads the finding — which
 *  is what makes `gating: "gates"` in these fixtures the same fact it is in the
 *  store rather than a value this test asserts into place. */
function rec({ item = "pr-1", run, defect, severity = "major", lens = "correctness", lane = null, verification = null, population = "reported", line = 21, summary = null, file = null }) {
  const d = DEFECTS[defect] ?? { file: file ?? "a.ts", summary: summary ?? "", evidence: "" };
  const finding = {
    severity,
    file: file ?? d.file,
    line,
    summary: summary ?? d.summary,
    evidence: d.evidence,
    ...(lane === null ? {} : { lane }),
    ...(verification === null ? {} : { verification }),
  };
  return buildFindingRecord({
    arm: "panel",
    itemId: item,
    runId: run,
    population,
    finding,
    detail: { lens, lane, novelty: null, unsettled: false, verification, samples: null, gate_state: "on", config_hash: CONFIG, panel_sha: SHA, item_status: "ok", item_reason: null },
  });
}

const okItem = (item, panel = [{ id: "correctness", blocking: true, applicable: true, conclusion: "success", valid: true }]) => ({
  item_id: item,
  status: "ok",
  panel,
  config_hash: CONFIG,
  panel_sha: SHA,
  corpus_version: "2026-08-10-pilot-reviewed",
});

/** The three runs of §3.2's worked example: A = f1,f2,f3 · B = f1,f2 · C = f1,f2,f4. */
const WORKED = [
  { run_id: "k1", records: [rec({ run: "k1", defect: "f1" }), rec({ run: "k1", defect: "f2" }), rec({ run: "k1", defect: "f3" })], sampled: [], items: [okItem("pr-1")] },
  { run_id: "k2", records: [rec({ run: "k2", defect: "f1" }), rec({ run: "k2", defect: "f2" })], sampled: [], items: [okItem("pr-1")] },
  { run_id: "k3", records: [rec({ run: "k3", defect: "f1" }), rec({ run: "k3", defect: "f2" }), rec({ run: "k3", defect: "f4" })], sampled: [], items: [okItem("pr-1")] },
];

/** `pilot-01__k1`'s real `panel[]` rows. pr-415 gated on four lenses with an
 *  inapplicable docs lens beside them; pr-471 is the corpus's one clean item. */
const REAL_ROWS_PR415 = [
  { id: "docs", title: "Docs", blocking: true, applicable: false, conclusion: "skipped", valid: true },
  { id: "correctness", title: "Correctness", blocking: true, applicable: true, conclusion: "failure", valid: true },
  { id: "blast-radius", title: "Blast-radius", blocking: true, applicable: true, conclusion: "success", valid: true },
  { id: "test-adequacy", title: "Test-adequacy", blocking: true, applicable: true, conclusion: "failure", valid: true },
  { id: "design-fit", title: "Design-fit", blocking: true, applicable: true, conclusion: "failure", valid: true },
  { id: "security", title: "Security", blocking: true, applicable: true, conclusion: "failure", valid: true },
];
const REAL_ROWS_PR471 = ["docs", "correctness", "test-adequacy", "design-fit", "security", "blast-radius"].map((id) => ({ id, title: id, blocking: true, applicable: true, conclusion: "success", valid: true }));

// --- (a) the spec's own contract --------------------------------------------

test("§3.2's worked example: A↔B 0.67, A↔C 0.50, B↔C 0.67", () => {
  const r = reliabilityOf(WORKED);
  const [ab, ac, bc] = r.jaccard.per_pair;
  assert.deepEqual(ab.runs, ["k1", "k2"]);
  assert.deepEqual([ab.overall.both, ab.overall.either], [2, 3]);
  assert.equal(ab.overall.ratio.toFixed(2), "0.67");
  assert.deepEqual([ac.overall.both, ac.overall.either], [2, 4]);
  assert.equal(ac.overall.ratio.toFixed(2), "0.50");
  assert.deepEqual([bc.overall.both, bc.overall.either], [2, 3]);
  assert.equal(bc.overall.ratio.toFixed(2), "0.67");
  // The spec quotes a mean of 0.61, and it is only ever reported beside the three
  // values it came from.
  assert.equal(r.jaccard.across_pairs.mean.toFixed(2), "0.61");
  assert.equal(r.jaccard.across_pairs.values.length, 3);
});

test("§3.2's worked example: recurrence is f1 3/3, f2 3/3, f3 1/3, f4 1/3", () => {
  const r = reliabilityOf(WORKED);
  assert.equal(r.recurrence.overall.n_classes, 4);
  assert.deepEqual(r.recurrence.overall.in_k, { 1: 2, 2: 0, 3: 2 });
  assert.deepEqual([r.recurrence.overall.in_all.k, r.recurrence.overall.in_all.n], [2, 4]);
  assert.deepEqual([r.recurrence.overall.in_one.k, r.recurrence.overall.in_one.n], [2, 4]);
});

test("every agreement figure is labelled a LOWER bound, in the data and not only in a comment", () => {
  const r = reliabilityOf(WORKED);
  assert.equal(BOUND, "lower");
  assert.equal(r.bound, "lower");
  assert.equal(r.jaccard.per_pair[0].overall.bound, "lower");
  assert.equal(r.recurrence.overall.bound, "lower");
  assert.match(renderReport(r).join("\n"), /LOWER BOUND/);
});

test("jaccardOf counts a class as shared only when BOTH runs reached it", () => {
  const classes = [
    { item: "pr-1", severity: "major", severities: ["major"], runs: ["k1", "k2"], members: [] },
    { item: "pr-1", severity: "major", severities: ["major"], runs: ["k1"], members: [] },
    { item: "pr-1", severity: "major", severities: ["major"], runs: ["k3"], members: [] },
  ];
  // The k3-only class is outside this pair entirely: it is in neither numerator nor
  // denominator, or a third replicate would deflate a pair it never took part in.
  assert.deepEqual({ both: 1, either: 2 }, { both: jaccardOf(classes, "k1", "k2").both, either: jaccardOf(classes, "k1", "k2").either });
  assert.equal(jaccardOf(classes, "k1", "k2").ratio, 0.5);
  assert.equal(jaccardOf([], "k1", "k2").ratio, null, "n=0 is null, never 0.000");
});

test("a maybe never merges, and is counted beside the ratio it deflated", () => {
  // Same file and line, summaries that share fewer tokens than the 0.3 bar: L2
  // answers `maybe`, so one defect stays two classes and Jaccard reads 0/2.
  const a = rec({ run: "k1", defect: "f1", summary: "two review sections exist and the second one is a leftover template placeholder heading" });
  const b = rec({ run: "k2", defect: "f1", summary: "remove the duplicate empty review block from this checklist document" });
  const r = reliabilityOf([
    { run_id: "k1", records: [a], sampled: [], items: [okItem("pr-1")] },
    { run_id: "k2", records: [b], sampled: [], items: [okItem("pr-1")] },
  ]);
  const pair = r.jaccard.per_pair[0];
  assert.equal(pair.overall.both, 0, "a maybe must not merge");
  assert.equal(pair.overall.either, 2);
  assert.equal(pair.unmerged.maybe_cross_run, 1, "the unmerged pair is REPORTED, not implied by the absence of a merge");
  assert.equal(r.jaccard.unmerged_total.maybe_cross_run, 1);
  assert.match(renderReport(r).join("\n"), /cross-run maybe\(s\) never merged/);
});

test("a within-run restatement is counted apart from a cross-run maybe", () => {
  // Two lenses, one location, one run: the confound that makes a run's own class
  // count carry its restatements. It must never be filed as cross-run disagreement.
  const r = reliabilityOf([
    {
      run_id: "k1",
      records: [rec({ run: "k1", defect: "f1", lens: "correctness" }), rec({ run: "k1", defect: "f1", lens: "design-fit", summary: "the same location raised again by a second lens with quite different wording here" })],
      sampled: [],
      items: [okItem("pr-1")],
    },
    { run_id: "k2", records: [rec({ run: "k2", defect: "f2" })], sampled: [], items: [okItem("pr-1")] },
  ]);
  const dup = r.jaccard.within_run_duplicate_locations.find((d) => d.run_id === "k1");
  assert.equal(dup.locations, 1);
  assert.equal(dup.cross_lens, 1, "two lenses on one location is the measured case, and it is reported as such");
  assert.equal(r.jaccard.per_pair[0].unmerged.maybe_cross_run, 0);
});

test("duplicateLocationsOf needs a file AND a line, and never counts one record as a duplicate", () => {
  const one = rec({ run: "k1", defect: "f1" });
  assert.deepEqual({ l: 0, c: 0 }, { l: duplicateLocationsOf([one]).locations, c: duplicateLocationsOf([one]).cross_lens });
  const noLine = rec({ run: "k1", defect: "f1", line: null });
  assert.equal(duplicateLocationsOf([noLine, noLine]).locations, 0, "an unplaceable finding is not a duplicate location");
});

// --- severity stratification ------------------------------------------------

test("a class the runs graded differently is filed under its MOST severe member, and the disagreement is counted", () => {
  const r = reliabilityOf([
    { run_id: "k1", records: [rec({ run: "k1", defect: "f1", severity: "major" })], sampled: [], items: [okItem("pr-1")] },
    { run_id: "k2", records: [rec({ run: "k2", defect: "f1", severity: "minor" })], sampled: [], items: [okItem("pr-1")] },
  ]);
  assert.equal(r.recurrence.by_severity.major.n_classes, 1);
  assert.equal(r.recurrence.by_severity.minor.n_classes, 0, "the class is filed once, under major");
  assert.deepEqual([r.recurrence.overall.severity_disagreement.k, r.recurrence.overall.severity_disagreement.n], [1, 1]);
  assert.equal(classSeverity([{ finding: { severity: "nit" } }, { finding: { severity: "critical" } }]), "critical");
});

test("every metric is stratified over all four severities, including the empty ones", () => {
  const r = reliabilityOf(WORKED);
  for (const s of ["critical", "major", "minor", "nit"]) {
    assert.ok(r.recurrence.by_severity[s], `recurrence must report ${s}`);
    assert.ok(r.jaccard.per_pair[0].by_severity[s], `jaccard must report ${s}`);
    assert.ok(r.stages.detection.available === false || r.stages.detection.jaccard.per_pair[0].by_severity[s]);
  }
  // A stratum with nothing in it reports n=0 and a null ratio — "no critical class
  // in either run" and "we did not stratify" are different facts.
  assert.equal(r.jaccard.per_pair[0].by_severity.critical.n, 0);
  assert.equal(r.jaccard.per_pair[0].by_severity.critical.ratio, null);
});

// --- (b) recurrence ---------------------------------------------------------

test("recurrenceOf reports the whole distribution, not just the share in all K", () => {
  // ASYMMETRIC on purpose: two classes in 3/3 and one in 1/3, so `in_all` and
  // `in_one` are different numbers. The first version of this fixture had one class
  // in each bucket, and a mutation that made `in_all` read the 1/K bucket survived
  // it — the two counts were equal, so the test could not tell the buckets apart.
  const classes = [
    { severity: "major", severities: ["major"], runs: ["k1", "k2", "k3"], members: [] },
    { severity: "major", severities: ["major"], runs: ["k1", "k2", "k3"], members: [] },
    { severity: "nit", severities: ["nit"], runs: ["k3"], members: [] },
  ];
  const r = recurrenceOf(classes, 3);
  assert.deepEqual(r.in_k, { 1: 1, 2: 0, 3: 2 });
  assert.deepEqual([r.in_all.k, r.in_all.n], [2, 3]);
  assert.deepEqual([r.in_one.k, r.in_one.n], [1, 3]);
  // A class present in more runs than K were passed cannot exceed the top bucket.
  assert.deepEqual(recurrenceOf([{ severities: [], runs: ["k1", "k2", "k3"], members: [] }], 2).in_k, { 1: 0, 2: 1 });
  assert.equal(recurrenceOf([], 3).in_all.ratio, null);
});

test("a per-item figure quotes the K it actually had, not the run count", () => {
  // pr-2 exists in two of the three runs — the shape the first K=3 attempt produced
  // when a session limit killed two items. Its agreement is over 2, and says so.
  const runs = [
    { run_id: "k1", records: [rec({ run: "k1", defect: "f1" }), rec({ item: "pr-2", run: "k1", defect: "f2" })], sampled: [], items: [okItem("pr-1"), okItem("pr-2")] },
    { run_id: "k2", records: [rec({ run: "k2", defect: "f1" }), rec({ item: "pr-2", run: "k2", defect: "f2" })], sampled: [], items: [okItem("pr-1"), okItem("pr-2")] },
    { run_id: "k3", records: [rec({ run: "k3", defect: "f1" })], sampled: [], items: [okItem("pr-1")] },
  ];
  const r = reliabilityOf(runs);
  assert.equal(r.recurrence.per_item.find((it) => it.item_id === "pr-2").k_runs, 2);
  assert.equal(r.recurrence.per_item.find((it) => it.item_id === "pr-1").k_runs, 3);
  // And the shortfall is a stated reason rather than a silence.
  assert.equal(r.completeness.verdict, "partial");
  assert.ok(r.completeness.reasons.some((x) => /pr-2 is present in 2 of 3/.test(x)));
  // The k1↔k3 pair compares only the item both hold.
  assert.deepEqual(r.jaccard.per_pair.find((p) => p.runs[1] === "k3").items_compared, ["pr-1"]);
});

// --- (c) the verifier -------------------------------------------------------

test("a null verification is EXCLUDED from (c), never counted as agreement", () => {
  const classes = [
    { runs: ["k1", "k2"], members: [{ run: "k1", finding: { panel: { verification: null } } }, { run: "k2", finding: { panel: { verification: null } } }] },
    { runs: ["k1", "k2"], members: [{ run: "k1", finding: { panel: { verification: "confirmed-high" } } }, { run: "k2", finding: { panel: { verification: "confirmed-high" } } }] },
  ];
  const v = verifierAgreementOf(classes, "k1", "k2");
  assert.equal(v.classes_in_both, 2);
  assert.equal(v.agreement.n, 1, "only the pair where both sides carry a real verdict is comparable");
  assert.equal(v.excluded["not-run"], 2, "both sides of the excluded class are counted");
  assert.deepEqual([v.agreement.raw_agreement.k, v.agreement.raw_agreement.n], [1, 1]);
});

test("errored is its own outcome and is never a refutation", () => {
  const classes = [{ runs: ["k1", "k2"], members: [{ run: "k1", finding: { panel: { verification: "errored" } } }, { run: "k2", finding: { panel: { verification: "confirmed-high" } } }] }];
  const v = verifierAgreementOf(classes, "k1", "k2");
  assert.equal(v.agreement.n, 1, "errored is a verdict for the purpose of the denominator");
  assert.deepEqual([v.agreement.raw_agreement.k, v.agreement.raw_agreement.n], [0, 1], "and it DISAGREES with a confirmation");
  assert.ok(VERIFIER_VERDICTS.includes("errored"));
  assert.ok(!VERIFIER_VERDICTS.includes("refuted"), "the real vocabulary has no refutation; do not invent one");
});

test("a run whose own members disagree is `split`, and excluded rather than picked from", () => {
  const classes = [
    {
      runs: ["k1", "k2"],
      members: [
        { run: "k1", finding: { panel: { verification: "confirmed-high" } } },
        { run: "k1", finding: { panel: { verification: "confirmed-low" } } },
        { run: "k2", finding: { panel: { verification: "confirmed-high" } } },
      ],
    },
  ];
  const v = verifierAgreementOf(classes, "k1", "k2");
  assert.equal(v.agreement.n, 0);
  assert.equal(v.excluded.split, 1);
  assert.ok(VERIFIER_NON_VERDICTS.includes("split") && VERIFIER_NON_VERDICTS.includes("not-run"));
});

test("a verification value outside the vocabulary is reported, not silently scored", () => {
  const classes = [{ runs: ["k1", "k2"], members: [{ run: "k1", finding: { panel: { verification: "refuted" } } }, { run: "k2", finding: { panel: { verification: "confirmed-high" } } }] }];
  const v = verifierAgreementOf(classes, "k1", "k2");
  assert.deepEqual(v.outside_vocabulary, ["refuted"]);
  assert.equal(v.agreement.n, 0, "an unknown outcome is not treated as a verdict");
});

test("κ is undefined — never 0 — when one outcome holds every rating", () => {
  const k = cohenKappa([["confirmed-high", "confirmed-high"], ["confirmed-high", "confirmed-high"]]);
  assert.equal(k.expected, 1);
  assert.equal(k.kappa, null, "0 would read as 'no better than chance' for a rater that never disagreed");
  assert.match(k.kappa_undefined_reason, /NOT 0/);
  assert.deepEqual([k.raw_agreement.k, k.raw_agreement.n], [2, 2]);
});

test("κ never travels without its marginals and its caveat", () => {
  const k = cohenKappa([["confirmed-high", "confirmed-high"], ["confirmed-high", "confirmed-low"], ["confirmed-low", "confirmed-low"]]);
  assert.ok(Number.isFinite(k.kappa));
  assert.deepEqual(k.marginals.a, { "confirmed-high": 2, "confirmed-low": 1 });
  assert.deepEqual(k.marginals.b, { "confirmed-high": 1, "confirmed-low": 2 });
  assert.equal(k.caveat, KAPPA_CAVEAT);
  assert.equal(cohenKappa([]).n, 0);
  assert.equal(cohenKappa([]).kappa, null);
  // Whatever the renderer does, a printed κ is on a line that also carries the
  // marginals — the failure this test exists to prevent is a κ quoted alone.
  const line = renderReport(reliabilityOf(WORKED)).find((l) => l.includes("κ ") && !l.startsWith("  κ CAVEAT"));
  assert.match(line, /marginals/);
});

test("(c) has no pooled figure, and says why", () => {
  const r = reliabilityOf(WORKED);
  assert.equal(r.verifier.pooled, undefined);
  assert.match(r.verifier.no_pooled_figure, /triple-count/);
  assert.equal(r.verifier.per_pair.length, 3);
});

// --- (d) the gate -----------------------------------------------------------

test("the gate rule is the workflow's: blocking AND applicable, conclusion not success", () => {
  // Real rows. The docs lens is `blocking: true` and INAPPLICABLE, and the workflow
  // drops it from required_checks — reading `blocking` alone would make a skipped
  // lens a failing gate on every item.
  assert.equal(gateVerdictOf(REAL_ROWS_PR415).gate, "gated");
  assert.equal(gateVerdictOf(REAL_ROWS_PR415).gate_basis, "lens-check-failed");
  assert.equal(gateVerdictOf(REAL_ROWS_PR415).gating_rows, 5);
  assert.equal(gateVerdictOf(REAL_ROWS_PR471).gate, "clean");
  assert.equal(gateVerdictOf(REAL_ROWS_PR471).gating_rows, 6);
  // An applicable lens that skipped DOES gate: neutral is not success.
  assert.equal(gateVerdictOf([{ id: "docs", blocking: true, applicable: true, conclusion: "skipped" }]).gate, "gated");
  // A row that is not blocking is not part of the decision.
  assert.equal(gateVerdictOf([{ id: "x", blocking: false, applicable: true, conclusion: "failure" }]).gate, "unknown");
  assert.equal(gateVerdictOf([{ id: "x", blocking: false, applicable: true, conclusion: "failure" }]).gate_basis, "no-gating-rows");
});

test("no panel rows reads UNKNOWN, never clean", () => {
  for (const rows of [[], null, undefined, "nonsense"]) {
    assert.equal(gateVerdictOf(rows).gate, "unknown", `${JSON.stringify(rows)} must not read as a decision`);
    assert.equal(gateVerdictOf(rows).gate_basis, "no-panel-rows");
  }
  assert.equal(GATE_BASIS["no-panel-rows"], "unknown");
  assert.equal(Object.values(GATE_BASIS).includes("gated"), true);
});

test("an unknown gate verdict makes the item UNDECIDABLE, not agreed", () => {
  const r = reliabilityOf([
    { run_id: "k1", records: [rec({ run: "k1", defect: "f1" })], sampled: [], items: [{ ...okItem("pr-1"), panel: null }] },
    { run_id: "k2", records: [rec({ run: "k2", defect: "f1" })], sampled: [], items: [okItem("pr-1")] },
  ]);
  const item = r.gate.per_item[0];
  assert.equal(item.agrees, null, "'we could not tell' must never read as 'it agreed'");
  assert.deepEqual([r.gate.agreement.k, r.gate.agreement.n], [0, 0]);
  assert.equal(r.gate.agreement.ratio, null);
  assert.equal(r.gate.items_undecidable.length, 1);
  assert.ok(r.completeness.reasons.some((x) => /gate verdict unknown/.test(x)));
});

test("the two routes to the gate decision are cross-checked, and a disagreement ABORTS", () => {
  const gatedRows = [{ id: "correctness", blocking: true, applicable: true, conclusion: "failure", valid: true }];
  // The rows say a blocking lens failed; no record carries the blocking lane. One of
  // the two is wrong and this scorer will not choose.
  assert.throws(
    () =>
      reliabilityOf([
        { run_id: "k1", records: [rec({ run: "k1", defect: "f1", lane: null })], sampled: [], items: [{ ...okItem("pr-1"), panel: gatedRows }] },
        { run_id: "k2", records: [rec({ run: "k2", defect: "f1", lane: null })], sampled: [], items: [okItem("pr-1")] },
      ]),
    /routes to the gate decision disagree/,
  );
  // With the lane present the two routes agree and the count is reported.
  const ok = reliabilityOf([
    { run_id: "k1", records: [rec({ run: "k1", defect: "f1", lane: "blocking" })], sampled: [], items: [{ ...okItem("pr-1"), panel: gatedRows }] },
    { run_id: "k2", records: [rec({ run: "k2", defect: "f1", lane: "blocking" })], sampled: [], items: [{ ...okItem("pr-1"), panel: gatedRows }] },
  ]);
  assert.deepEqual([ok.gate.route_cross_check.agreed, ok.gate.route_cross_check.item_runs_compared], [2, 2]);
  assert.deepEqual([ok.gate.lens_cross_check.agreed, ok.gate.lens_cross_check.compared], [2, 2]);
  assert.deepEqual([ok.gate.agreement.k, ok.gate.agreement.n], [1, 1]);
});

test("the lane route reads the record's own `gating`, so a demoted blocker does not gate", () => {
  // `lane: "backlog"` is the novelty gate saying the code predates the base. It is a
  // real finding that does not block, and 5 of the pilot's 428 records are in it.
  const demoted = rec({ run: "k1", defect: "f1", lane: "backlog" });
  assert.equal(demoted.gating, "does-not-gate");
  assert.equal(laneGateOf([demoted]).lane_gate, "clean");
  assert.equal(laneGateOf([rec({ run: "k1", defect: "f1", lane: "blocking" })]).lane_gate, "gated");
  // No records at all is not a clean review — that question belongs to the envelope
  // status, which the second refusal reads.
  assert.equal(laneGateOf([]).lane_gate, "unknown");
  assert.equal(LANE_BASIS["no-records"], "unknown");
});

test("the gate's INPUT is reported beside its output, per run", () => {
  const r = reliabilityOf(WORKED);
  assert.equal(r.gate.lane_census.length, 3);
  assert.deepEqual(r.gate.lane_census[0], { run_id: "k1", findings: 3, lanes: { "(none)": 3 }, gating_records: 0 });
  assert.match(renderReport(r).join("\n"), /gating finding\(s\) of/);
});

// --- (e) per stage ----------------------------------------------------------

test("(e) attributes the detection→reported delta per item, and never invents a 0", () => {
  const runs = [
    {
      run_id: "k1",
      records: [rec({ run: "k1", defect: "f1" })],
      sampled: [rec({ run: "k1", defect: "f1", population: "sampled" }), rec({ run: "k1", defect: "f2", population: "sampled" })],
      items: [okItem("pr-1")],
    },
    {
      run_id: "k2",
      records: [rec({ run: "k2", defect: "f1" })],
      sampled: [rec({ run: "k2", defect: "f1", population: "sampled" })],
      items: [okItem("pr-1")],
    },
  ];
  const r = reliabilityOf(runs);
  assert.deepEqual(r.stages.attribution[0].per_item[0], { item_id: "pr-1", sampled: 2, reported: 1, delta: -1 });
  assert.equal(r.stages.detection.available, true);
  assert.equal(r.stages.detection.lane_figures, null, "the sampled population has no lane, so no lane figure may be computed on it");
  // Without a sampled population the delta is ABSENT, not zero: "the samples raised
  // nothing extra" and "we were not given the samples" are different facts.
  const none = reliabilityOf(WORKED);
  assert.equal(none.stages.detection.available, false);
  assert.equal(none.stages.attribution[0].delta, null);
  // Per ITEM as well as per run. Only the run-level null was asserted at first, and
  // a mutation that computed `reported - sampled` per item survived: it reported
  // "+3 findings appeared after detection" for a run whose samples we never had.
  assert.equal(none.stages.attribution[0].per_item[0].delta, null);
  assert.equal(none.stages.attribution[0].per_item[0].sampled, 0);
  assert.ok(none.completeness.reasons.some((x) => /detection stage was not scored/.test(x)));
});

test("a detection pair needs the population on BOTH sides — one run's absence is not disagreement", () => {
  // The shape a caller reaches by passing `sampled` for some runs and not others.
  // Scoring it would print Jaccard 0.000 for a pair where one side was never
  // supplied, which reads as two runs agreeing on nothing.
  const runs = [
    { run_id: "k1", records: [rec({ run: "k1", defect: "f1" })], sampled: [rec({ run: "k1", defect: "f1", population: "sampled" })], items: [okItem("pr-1")] },
    { run_id: "k2", records: [rec({ run: "k2", defect: "f1" })], sampled: [], items: [okItem("pr-1")] },
  ];
  const r = reliabilityOf(runs);
  const pair = r.stages.detection.jaccard === undefined ? null : r.stages.detection.jaccard.per_pair[0];
  // No pair is scorable here, so the stage itself is unavailable and says why.
  assert.equal(r.stages.detection.available, false);
  assert.equal(pair, null);
  assert.match(r.stages.detection.pairs_unscorable[0].reason, /no sampled records for k2/);
  assert.match(r.stages.detection.reason, /both sides/);
  // With three runs, the two that HAVE the population are still compared, and the
  // pairs that cannot be are reported rather than scored as 0.
  const three = reliabilityOf([
    ...runs.map((run) => ({ ...run, items: [okItem("pr-1")] })),
    { run_id: "k3", records: [rec({ run: "k3", defect: "f1" })], sampled: [rec({ run: "k3", defect: "f1", population: "sampled" })], items: [okItem("pr-1")] },
  ]);
  const scored = three.stages.detection.jaccard.per_pair.filter((p) => p.available);
  const unscored = three.stages.detection.jaccard.per_pair.filter((p) => !p.available);
  assert.deepEqual(scored.map((p) => p.runs), [["k1", "k3"]]);
  assert.equal(scored[0].overall.ratio, 1, "k1 and k3 both raised the same defect: perfect agreement, not 0");
  assert.equal(unscored.length, 2, "the two pairs involving k2 are unscorable");
  for (const p of unscored) {
    assert.notEqual(p.overall?.ratio, 0, "an unsupplied population must never read as a ratio of 0");
    assert.equal(p.overall, null);
  }
  // And the across-pairs figure is over the scorable pairs only.
  assert.equal(three.stages.detection.jaccard.across_pairs.n, 1);
  // The renderer prints the reason rather than a number.
  const text = renderReport(three).join("\n");
  assert.match(text, /k1 ↔ k2: not scored — no sampled records for k2/);
  assert.doesNotMatch(text, /k1 ↔ k2: 0\/\d+=0\.000/);
});

test("a detection pair is restricted to the items BOTH runs sampled, like the reported arm", () => {
  // pr-2 is sampled by k1 only. Counting it would inflate the detection union and
  // make (e) compare the two stages over different denominators.
  const runs = [
    {
      run_id: "k1",
      records: [rec({ run: "k1", defect: "f1" }), rec({ item: "pr-2", run: "k1", defect: "f2" })],
      sampled: [rec({ run: "k1", defect: "f1", population: "sampled" }), rec({ item: "pr-2", run: "k1", defect: "f2", population: "sampled" })],
      items: [okItem("pr-1"), okItem("pr-2")],
    },
    {
      run_id: "k2",
      records: [rec({ run: "k2", defect: "f1" }), rec({ item: "pr-2", run: "k2", defect: "f2" })],
      sampled: [rec({ run: "k2", defect: "f1", population: "sampled" })],
      items: [okItem("pr-1"), okItem("pr-2")],
    },
  ];
  const pair = reliabilityOf(runs).stages.detection.jaccard.per_pair[0];
  assert.deepEqual(pair.items_compared, ["pr-1"]);
  assert.deepEqual([pair.overall.both, pair.overall.either], [1, 1], "only the shared item is in either side of the ratio");
  assert.equal(pair.overall.ratio, 1);
});

test("the corpus asked for must be the corpus the runs replayed", () => {
  const stated = "2026-08-10-pilot-reviewed";
  const runs = WORKED.map((run) => ({ ...run, corpus_version: stated }));
  // Matching, and unrequested, both pass.
  assert.equal(reliabilityOf(runs, { corpusVersion: stated }).corpus_version, stated);
  assert.equal(reliabilityOf(runs).completeness.verdict, "partial");
  // A different corpus would take the item ids and the coverage figure from one
  // corpus and every agreement figure from another, under one label.
  assert.throws(() => reliabilityOf(runs, { corpusVersion: "2026-08-07-pilot" }), /the runs replayed/);
  assert.equal(assertRequestedCorpus(stated, stated), stated);
  assert.equal(assertRequestedCorpus(null, null), null, "requesting nothing claims nothing");
  // A label nobody can check is refused too — lesson 7 asked of the guard's input.
  assert.throws(() => assertRequestedCorpus(null, stated), /cannot be checked/);
  assert.throws(() => assertRequestedCorpus("", stated), /cannot be checked/);
});

test("the partition separator cannot occur inside a field it separates", () => {
  // WHY THIS SHAPE. The separator's whole job is `finding-match.mjs`'s: "a character
  // no finding can contain, so ['a','b'] and ['a b'] can never digest alike". The
  // source briefly carried `"\\u0000"` — a literal backslash and five more characters
  // — after a pass that removed a raw NUL byte over-escaped it. Six printable
  // characters ARE spellable in a path, so the guarantee quietly lapsed.
  //
  // A test that merely separates line 1 from line 11 does not notice: those differ
  // under any separator. The only assertion that does is a pair whose parts differ
  // ONLY in where the boundary falls, so it is the one written here.
  const boundary = String.fromCharCode(92) + "u0000"; // the six characters, as text
  const a = { item_id: "pr-1", file: `a.ts${boundary}b.ts`, line: 5, panel: { lens: "correctness" } };
  const b = { item_id: `pr-1${boundary}a.ts`, file: "b.ts", line: 5, panel: { lens: "correctness" } };
  // Under a real U+0000 these are two locations. Under the six-character version they
  // build the identical key and read as one location carrying two findings.
  assert.equal(duplicateLocationsOf([a, b]).locations, 0, "two different (item, file, line) triples must not collide into one location");
  assert.equal(duplicateLocationsOf([a, b]).records_involved, 0);
  // And the ordinary case still works, so the assertion above is not vacuous.
  const c = { item_id: "pr-1", file: "a.ts", line: 5, panel: { lens: "correctness" } };
  const d = { item_id: "pr-1", file: "a.ts", line: 5, panel: { lens: "design-fit" } };
  assert.equal(duplicateLocationsOf([c, d]).locations, 1);
});

test("a population may not be passed as the other one", () => {
  const sampled = rec({ run: "k1", defect: "f1", population: "sampled" });
  assert.throws(
    () => reliabilityOf([{ run_id: "k1", records: [sampled], sampled: [], items: [okItem("pr-1")] }, { run_id: "k2", records: [], sampled: [], items: [okItem("pr-1")] }]),
    /must all be population "reported"/,
  );
  assert.throws(
    () => reliabilityOf([{ run_id: "k1", records: [], sampled: [rec({ run: "k1", defect: "f1" })], items: [okItem("pr-1")] }, { run_id: "k2", records: [], sampled: [], items: [okItem("pr-1")] }]),
    /must all be population "sampled"/,
  );
});

test("the other arm has no replicates, so a CodeRabbit record is refused", () => {
  const cr = buildFindingRecord({ arm: "coderabbit", itemId: "pr-1", population: "reported", finding: { severity: "nit", file: "a.ts", summary: "x" }, detail: {} });
  assert.throws(
    () => reliabilityOf([{ run_id: "k1", records: [cr], sampled: [], items: [okItem("pr-1")] }, { run_id: "k2", records: [], sampled: [], items: [okItem("pr-1")] }]),
    /cannot be replayed, so it has no replicates/,
  );
});

test("the CodeRabbit half of §3.2 is reported as n=0 rather than left out", () => {
  const r = reliabilityOf(WORKED);
  assert.equal(r.coderabbit_retest_pairs.n, 0);
  assert.equal(r.coderabbit_retest_pairs.one_armed, true);
  assert.match(renderReport(r)[1], /ONE ARM ONLY/);
});

// --- the three refusals -----------------------------------------------------

test("REFUSAL: two reviewers are not two replicates", () => {
  const other = "0000000000000000000000000000000000000000";
  const runs = [
    { run_id: "k1", records: [rec({ run: "k1", defect: "f1" })], sampled: [], items: [okItem("pr-1")] },
    { run_id: "k2", records: [rec({ run: "k2", defect: "f1" })], sampled: [], items: [{ ...okItem("pr-1"), panel_sha: other }] },
  ];
  assert.throws(() => reliabilityOf(runs), /not replicates of one reviewer/);
  assert.throws(() => assertOneReviewer(runs), /decision 13/);
  // config_hash and corpus_version are the other two thirds of the key.
  assert.throws(
    () => assertOneReviewer([{ run_id: "k1", items: [okItem("pr-1")] }, { run_id: "k2", items: [{ ...okItem("pr-1"), config_hash: "sha256:deadbeef" }] }]),
    /not replicates of one reviewer/,
  );
  // Two corpora get their own message: the reviewer is one, the SUBJECT is two, and
  // conflating those two failures would send a reader to the wrong fix.
  assert.throws(
    () => assertOneReviewer([{ run_id: "k1", items: [okItem("pr-1")] }, { run_id: "k2", items: [{ ...okItem("pr-1"), corpus_version: "2026-08-07-pilot" }] }]),
    /not replicates over one subject/,
  );
  // A corpus nobody stated is null, not a third identity — the placeholder that made
  // the first version of this guard fire on a poolable input.
  assert.equal(assertOneReviewer([{ run_id: "k1", items: [{ item_id: "pr-1", status: "ok", config_hash: CONFIG, panel_sha: SHA }] }, { run_id: "k2", records: [rec({ run: "k2", defect: "f1" })] }]).corpus_version, null);
  assert.deepEqual(assertOneReviewer([{ run_id: "k1", items: [okItem("pr-1")] }, { run_id: "k2", items: [okItem("pr-1")] }]), {
    config_hash: CONFIG,
    panel_sha: SHA,
    corpus_version: "2026-08-10-pilot-reviewed",
  });
});

test("REFUSAL: an input that cannot PROVE one reviewer is refused too", () => {
  assert.throws(() => assertOneReviewer([]), /nothing here can be shown to be a replicate/);
  assert.throws(() => assertOneReviewer([{ run_id: "k1" }, { run_id: "k2" }]), /nothing here can be shown to be a replicate/);
});

test("REFUSAL: a failed replay is not a clean review", () => {
  const bad = [
    { run_id: "k1", records: [rec({ run: "k1", defect: "f1" })], sampled: [], items: [{ ...okItem("pr-1"), status: "error", reason: "infra" }] },
    { run_id: "k2", records: [rec({ run: "k2", defect: "f1" })], sampled: [], items: [okItem("pr-1")] },
  ];
  assert.throws(() => reliabilityOf(bad), /not a poolable verdict/);
  assert.throws(() => assertItemsOk(bad), /infra/);
});

test("REFUSAL: a status nobody supplied is refused, not defaulted to ok", () => {
  // The panel adapter's per-item read does not return `envelope.status`, so this is
  // the case a caller reaches by forgetting — and defaulting it to `ok` would pool
  // exactly the items the refusal above exists to keep out.
  const runs = [
    { run_id: "k1", records: [rec({ run: "k1", defect: "f1" })], sampled: [], items: [{ item_id: "pr-1", panel: [], config_hash: CONFIG, panel_sha: SHA, corpus_version: "2026-08-10-pilot-reviewed" }] },
    { run_id: "k2", records: [rec({ run: "k2", defect: "f1" })], sampled: [], items: [okItem("pr-1")] },
  ];
  assert.throws(() => reliabilityOf(runs), /status not supplied/);
  // An item that produced records but was never declared is the same failure.
  assert.throws(
    () => assertItemsOk([{ run_id: "k1", records: [rec({ run: "k1", defect: "f1" })], items: [] }]),
    /status not supplied/,
  );
});

test("REFUSAL: reliability over fewer than two runs is undefined, not degraded", () => {
  assert.throws(() => reliabilityOf([WORKED[0]]), /needs ≥2 replicate runs and got 1/);
  assert.throws(() => reliabilityOf([]), /got 0/);
  assert.throws(() => assertEnoughRuns([{ run_id: "k1" }, { run_id: "k1" }]), /appears twice/);
  assert.equal(assertEnoughRuns([{ run_id: "k1" }, { run_id: "k2" }]).length, 2);
});

// --- denominators, and the shape of the output -------------------------------

test("every proportion carries its n, and n=0 is null rather than 0.000", () => {
  const r = reliabilityOf(WORKED);
  const carries = (p, where) => {
    assert.equal(typeof p.k, "number", `${where} must carry its numerator`);
    assert.equal(typeof p.n, "number", `${where} must carry its denominator`);
    if (p.n === 0) assert.equal(p.ratio, null, `${where} must be null at n=0`);
  };
  carries(r.gate.agreement, "gate agreement");
  carries(r.recurrence.overall.in_all, "recurrence in all K");
  carries(r.recurrence.overall.in_one, "recurrence in one");
  carries(r.recurrence.overall.severity_disagreement, "severity disagreement");
  for (const p of r.jaccard.per_pair) {
    carries(p.overall, `jaccard ${p.runs.join("↔")}`);
    for (const s of ["critical", "major", "minor", "nit"]) carries(p.by_severity[s], `jaccard ${s}`);
    for (const it of p.per_item) carries(it, `jaccard ${it.item_id}`);
  }
  for (const v of r.verifier.per_pair) carries(v.agreement.raw_agreement, "verifier raw agreement");
});

test("a mean never travels alone: the three pairwise values and their range come with it", () => {
  const s = spread([0.4, 0.5, 0.6]);
  assert.deepEqual(s.values, [0.4, 0.5, 0.6]);
  assert.equal(s.n, 3);
  assert.equal(s.range.toFixed(3), "0.200");
  assert.equal(s.mean.toFixed(3), "0.500");
  assert.deepEqual(spread([]), { values: [], n: 0, min: null, max: null, range: null, mean: null });
  // And the rendered line carries all three values plus the range.
  const line = renderReport(reliabilityOf(WORKED)).find((l) => l.includes("FINDING-SET AGREEMENT"));
  assert.match(line, /0\.667 · 0\.500 · 0\.667 \(range 0\.167, mean 0\.611, n=3\)/);
});

test("which gate the within-run pairs got is PROBED against this grouper, not inferred from the record shape", () => {
  // THIS TEST MUST NOT ASSERT A CONSTANT. Whether the same-run gate reads a lens is a
  // property of `groupFindings`, not of this file, and it is actively changing: a
  // record keeps its lens at `panel.lens`, so a matcher that reads only the top level
  // gates on file alone while one that falls back to the arm namespace does not.
  // Pinning "file-only" here would make this test a merge-order dependency and — worse
  // — would keep passing while the printed qualifier went stale, which is exactly the
  // defect the probe replaced. So the assertion is SELF-CONSISTENCY: whatever the
  // grouper does with two same-run cross-lens records, the probe must say so.
  const r = reliabilityOf(WORKED);
  const gate = r.recurrence.matcher_gate;
  assert.ok(["file-only", "lens-and-file"].includes(gate.within_run_gate));
  assert.equal(gate.probed, true);
  const twoLenses = [rec({ run: "k1", defect: "f1", lens: "correctness" }), rec({ run: "k1", defect: "f1", lens: "design-fit" })];
  const { groups } = groupFindings(twoLenses);
  assert.equal(groups.length, gate.within_run_gate === "file-only" ? 1 : 2, "the probe must agree with what the grouper actually did to two same-run cross-lens records");
  assert.equal(gate.probe_classes, groups.length);
  // The verdict is a property of the GROUPER, so it must not depend on the records
  // handed in — that independence IS the difference between a probe and an inference,
  // and it is what the previous version got wrong. Both directions are asserted:
  // passing none, and passing records that DO carry a top-level lens (which is what
  // the old inference read, so a regression to it flips this).
  assert.equal(matcherGateOf([]).within_run_gate, gate.within_run_gate);
  assert.equal(
    matcherGateOf([{ lens: "correctness" }, { lens: "design-fit" }]).within_run_gate,
    gate.within_run_gate,
    "the gate verdict must come from the grouper, not from the shape of the records passed in",
  );
  // The record census IS a fact about records, and is asserted as one.
  assert.equal(gate.records_with_top_level_lens, 0, "a record keeps its lens in the arm namespace, never at the top level");
  assert.equal(gate.records_with_namespaced_lens, 8);
  // Read by key, never `deepEqual`d: the census legitimately grows a key when the
  // matcher learns to report a new one, and a whole-object comparison would redden
  // this lane for an upstream improvement.
  assert.ok(r.recurrence.gate_census["cross-source"] > 0, "cross-run pairs must take the cross-source gate");
  assert.equal(r.recurrence.gate_census.defaulted, 0, "every pair's gate is DERIVED from provenance, never guessed");
});

test("--run-id and --item accumulate, because parseArgs keeps only the last", () => {
  const argv = ["node", "reliability.mjs", "--root", "/x", "--run-id", "k1", "--run-id", "k2", "--run-id", "k3", "--item", "pr-1", "--json"];
  assert.deepEqual(repeated(argv, "run-id"), ["k1", "k2", "k3"]);
  assert.deepEqual(repeated(argv, "item"), ["pr-1"]);
  assert.deepEqual(repeated(argv, "nothing"), []);
  // A flag with no value is not a value.
  assert.deepEqual(repeated(["node", "x", "--run-id", "--json"], "run-id"), []);
});

test("renderReport is pure and states the two halves of the result", () => {
  const lines = renderReport(reliabilityOf(WORKED));
  const text = lines.join("\n");
  assert.match(text, /\(d\) GATE AGREEMENT/);
  assert.match(text, /\(a\) FINDING-SET AGREEMENT/);
  assert.match(text, /\(b\) RECURRENCE/);
  assert.match(text, /\(c\) VERIFIER-VERDICT AGREEMENT/);
  assert.match(text, /\(e\) PER STAGE/);
  // The gate half comes before the finding half: a reader who stops early must not
  // leave with only one of the two true statements.
  assert.ok(text.indexOf("(d) GATE AGREEMENT") < text.indexOf("(a) FINDING-SET AGREEMENT"));
  assert.equal(lines.every((l) => typeof l === "string"), true);
});

test("nothing in reliabilityOf reads a store, a clock or the network", async () => {
  // The property that makes every number above reproducible from a fixture: the
  // module's own source names no filesystem or network import outside the CLI's
  // dynamic ones, which run only under `main()`.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./reliability.mjs", import.meta.url), "utf8");
  const staticImports = [...src.matchAll(/^import .*from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(staticImports.filter((s) => s.startsWith("node:")), ["node:path", "node:url"]);
  assert.ok(!/new Date\(|Date\.now\(/.test(src), "a reliability figure must not depend on when it was computed");
  assert.ok(!/writeFile|mkdir|putScore/.test(src), "this scorer writes nothing");
});
