// What these tests are FOR. A precision figure is the number this project exists to
// produce and the easiest one to publish wrong, because it is a ratio over four levels
// that all sound like each other and nothing downstream can check it. So almost
// nothing here asserts arithmetic. The assertions sit on the five ways the ratio goes
// wrong instead:
//
//   1. A MISSING DENOMINATOR CALLED A THIN ONE. `critical` on the CodeRabbit arm has
//      no denominator at all and `major` has three, and the two must render
//      differently in the payload AND in the printed line — a reader told "n<5" waits
//      for labels that can never arrive.
//   2. A DENOMINATOR THAT QUIETLY SHRANK. A label that does not join its claim
//      population removes a judgement from the ratio and inflates nothing, which is
//      why nobody notices. Every way a join can fail is asserted to be COUNTED and
//      listed rather than filtered — including the stale CodeRabbit parse, which is
//      the one this repository has already been bitten by one level up.
//   3. A LEVEL THAT CROSSED AND KEPT ITS NAME. N labels written from ONE reading are
//      not N independent judgements, so a bundled set is asserted to report both
//      numbers and never to report the first as the second.
//   4. A REFUSAL THAT SOFTENED INTO A FIGURE. Absolute recall and the miss profile are
//      unmeasurable on this corpus permanently, and the test that matters is not that
//      they are absent today but that no argument makes them present.
//   5. A TAUTOLOGY. Relative recall over a union built from one arm's labels is 1.0 by
//      construction, and printing it would be true of the arithmetic and false about
//      the world.
//
// Every fixture is built through `buildFindingRecord` and `buildFindingLabel`, so a
// record or a label that could not exist cannot be tested against. Nothing here calls
// a model, needs an API key, reads a store or touches the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN } from "../severity.mjs";
import { buildFindingRecord } from "./finding-record.mjs";
import { buildFindingLabel } from "./labels.mjs";
import { MIN_N } from "./segmentation.mjs";
import { AVAILABILITY as RENDERER_AVAILABILITY, renderCell } from "./report.mjs";
import {
  AVAILABILITY,
  CLAIM_POPULATIONS,
  JOIN_STATUSES,
  METRICS,
  METRIC_IDS,
  PERMANENT_REFUSALS,
  SCOPE,
  SCORER_ID,
  SEVERITY_WEIGHTS,
  SEVERITY_WEIGHTS_SPEC,
  assertAvailabilityMatchesRenderer,
  assertOneTier,
  assertSeverityWeights,
  availabilityFor,
  cellLine,
  claimCensus,
  joinLabels,
  precisionCell,
  relativeRecallBand,
  renderReport,
  scoreValidity,
} from "./validity.mjs";

const CV = "2026-08-10-pilot-reviewed";
const DIFF_SHA = `sha256:${"a".repeat(64)}`;
const VINTAGE = "harvest.mjs@sha256:1111111111111111111111111111111111111111111111111111111111111111";
const OLD_VINTAGE = "harvest.mjs@sha256:2222222222222222222222222222222222222222222222222222222222222222";

const ADJUDICATION = Object.freeze({
  mode: "human",
  suggestion_outcome: "confirmed",
  presented_fields: ["item", "file", "line", "claim"],
  withheld_fields: ["panel-severity", "verifier-verdict", "gate-outcome", "other-arm-agreement", "arm", "run_id"],
});

/** One record per arm, built through the real builder so its `finding_key` is the one
 *  a label would have to join on. */
function record({ arm = "coderabbit", itemId = "pr-1", runId = null, severity = "minor", summary, file = "src/a.ts", detail = {} } = {}) {
  return buildFindingRecord({
    arm,
    itemId,
    runId,
    population: "reported",
    finding: { severity, file, summary, evidence: `${file}:1 because` },
    detail: arm === "coderabbit" ? { window: "in-window", ...detail } : detail,
  });
}

function label({ arm = "coderabbit", itemId = "pr-1", findingKey, isReal = true, severity = "minor", labelSource = "gold", confidence = "high", parserVintage = VINTAGE, classId = null, classMembers = null, annotators = ["alice"], adjudication = ADJUDICATION, corpusVersion = CV } = {}) {
  return buildFindingLabel({
    corpusVersion,
    itemId,
    arm,
    findingKey,
    parserVintage: arm === "coderabbit" ? parserVintage : null,
    isReal,
    severity,
    labelSource,
    annotators,
    adjudication,
    confidence,
    diffSha256: DIFF_SHA,
    classId,
    classMembers,
  });
}

/**
 * The pilot's CodeRabbit arm, to scale: 30 claims split 0 critical / 3 major /
 * 13 minor / 14 nit — the measured census — with every one of them labelled, so the
 * claim population is EXHAUSTED and a zero stratum is final rather than pending.
 *
 * `annotatorSeverity` is a function of the claim's index so a test can decide what the
 * adjudicator said independently of what CodeRabbit said, which is the whole point of
 * stratifying on the annotator's own severity.
 */
function pilotCodeRabbitArm({ annotatorSeverity = (stated) => stated, isReal = () => true, labelSource = () => "gold", parserVintage = () => VINTAGE } = {}) {
  const stated = [...Array(3).fill("major"), ...Array(13).fill("minor"), ...Array(14).fill("nit")];
  const records = stated.map((sev, i) => record({ severity: sev, summary: `claim number ${i}`, itemId: `pr-${(i % 7) + 1}` }));
  const labels = records.map((r, i) => label({ itemId: r.item_id, findingKey: r.finding_key, isReal: isReal(i), severity: annotatorSeverity(stated[i], i), labelSource: labelSource(i), parserVintage: parserVintage(i) }));
  return { records, labels };
}

// --- the vocabularies and the weight vector ----------------------------------

test("the scorer names itself, and its scope is the one a cross-arm figure needs", () => {
  assert.equal(SCORER_ID, "validity-v1");
  assert.equal(SCOPE, "cross-run");
});

test("the severity weights are DERIVED from KNOWN's ordering and still equal spec §3.3's 4/3/2/1", () => {
  assert.deepEqual({ ...SEVERITY_WEIGHTS }, { ...SEVERITY_WEIGHTS_SPEC });
  // Derived, not typed: the vector must follow KNOWN's order rather than happen to
  // agree with it.
  assert.deepEqual(
    KNOWN.map((s) => SEVERITY_WEIGHTS[s]),
    [4, 3, 2, 1],
  );
});

test("assertSeverityWeights refuses a vector that disagrees with the spec, misses a severity, or names one off the scale", () => {
  assert.throws(() => assertSeverityWeights({ critical: 1, major: 2, minor: 3, nit: 4 }, { spec: SEVERITY_WEIGHTS_SPEC }), /spec §3.3 says 4/);
  assert.throws(() => assertSeverityWeights({ critical: 4, major: 3, minor: 2 }), /nit/);
  assert.throws(() => assertSeverityWeights({ critical: 4, major: 3, minor: 2, nit: 1, blocker: 9 }), /blocker/);
  assert.throws(() => assertSeverityWeights({ critical: 4, major: 3, minor: 2, nit: 0 }), /positive number/);
});

test("the availability vocabulary IS the renderer's, and every cell survives renderCell", () => {
  // The bug this replaces: this file said `reported` where report.mjs says `present`, so
  // three of four states coincided and `renderCell` refused the fourth. A near-miss
  // synonym is worse than a different word, because the payload looks renderable.
  assert.deepEqual([...AVAILABILITY].sort(), [...RENDERER_AVAILABILITY].sort());
  assert.throws(() => assertAvailabilityMatchesRenderer(["present", "suppressed", "not-computed"]), /the renderer's is/);
  assert.throws(() => assertAvailabilityMatchesRenderer(["reported", "suppressed", "not-computed", "not-measurable"]), /forces a translation layer/);

  // Not just the vocabulary — an actual cell of each state, handed to the renderer that
  // refuses an unknown one. This is the assertion that would have caught the rename.
  const { records, labels } = pilotCodeRabbitArm();
  const arms = [{ arm: "coderabbit", legs: [{ run_id: null, records }] }];
  // Two payloads, because ALL FOUR states have to be exercised and one payload cannot
  // hold them: `not-computed` needs an unlabelled claim left over, which is exactly what
  // stops any cell being `not-measurable`.
  const full = scoreValidity({ arms, labels, corpusVersion: CV, parserVintage: VINTAGE });
  const partial = scoreValidity({ arms, labels: labels.slice(0, 29), corpusVersion: CV, parserVintage: VINTAGE });
  const states = new Set();
  for (const cell of [...full.cells, ...partial.cells]) {
    states.add(cell.availability);
    assert.doesNotThrow(() => renderCell({ ...cell, n: cell.labelled_findings, unit: "labelled findings" }), `renderCell refused ${cell.segment}`);
  }
  // Measured, not assumed: the full payload gives present / suppressed / not-measurable
  // and the partial one gives not-computed.
  assert.deepEqual([...states].sort(), [...AVAILABILITY].sort(), "every availability state must be exercised against the renderer");
});

// --- the four availability states --------------------------------------------

test("availabilityFor tells a missing denominator from a thin one from a pending one", () => {
  // The distinction the whole vocabulary exists for. Same zero, three meanings.
  assert.equal(availabilityFor({ labelledFindings: 0, minN: 5, claimPopulation: "exhausted" }), "not-measurable");
  assert.equal(availabilityFor({ labelledFindings: 0, minN: 5, claimPopulation: "pending" }), "not-computed");
  assert.equal(availabilityFor({ labelledFindings: 0, minN: 5, claimPopulation: "unknown" }), "not-computed");
  // Both sides of the threshold.
  assert.equal(availabilityFor({ labelledFindings: 4, minN: 5, claimPopulation: "exhausted" }), "suppressed");
  assert.equal(availabilityFor({ labelledFindings: 5, minN: 5, claimPopulation: "exhausted" }), "present");
  for (const v of ["not-measurable", "not-computed", "suppressed", "present"]) assert.ok(AVAILABILITY.includes(v));
});

test("availabilityFor refuses an impossible denominator, a threshold of zero and an unknown claim population", () => {
  assert.throws(() => availabilityFor({ labelledFindings: -1 }), /non-negative integer/);
  assert.throws(() => availabilityFor({ labelledFindings: 1, minN: 0 }), /positive integer/);
  assert.throws(() => availabilityFor({ labelledFindings: 1, claimPopulation: "maybe" }), new RegExp(CLAIM_POPULATIONS.join(" \\| ")));
});

// --- 🔴 the cell this scorer exists to get right -------------------------------

test("critical is NOT MEASURABLE and major is SUPPRESSED, and the two cells differ in the payload and on the page", () => {
  // The measured pilot arm: CodeRabbit raised 0 criticals and 3 majors, every claim is
  // labelled, and the adjudicator agreed with their severity.
  const { records, labels } = pilotCodeRabbitArm();
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });

  const cellFor = (stratum) => result.cells.find((c) => c.metric === "precision" && c.stratum_basis === "annotator-severity" && c.stratum === stratum && c.arm === "coderabbit");
  const critical = cellFor("critical");
  const major = cellFor("major");

  assert.equal(critical.availability, "not-measurable");
  assert.equal(major.availability, "suppressed");
  assert.notEqual(critical.availability, major.availability);

  // A missing denominator is not a small one: the critical cell says the corpus can
  // never answer, the major cell says the answer is withheld at n=3.
  assert.equal(critical.labelled_findings, 0);
  assert.match(critical.reason, /no denominator for this stratum exists on this corpus/);
  assert.match(critical.reason, /raised no finding it called critical/);
  assert.equal(major.labelled_findings, 3);
  assert.match(major.reason, /below min_n 5/);
  // The cell is per TIER and the claim population is per ARM, so the reason has to name
  // the tier. It used to read "none was judged critical", a sentence about the whole arm
  // printed on a cell about one tier of it — false the moment another tier judged one.
  assert.match(critical.reason, /no gold label judges a finding critical/);

  // Neither carries a figure, and neither carries a numerator a reader could divide.
  for (const cell of [critical, major]) {
    assert.ok(!("value" in cell), `${cell.segment} must carry no value`);
    assert.ok(!("real_findings" in cell), `${cell.segment} must carry no numerator`);
    assert.ok(!("interval" in cell), `${cell.segment} must carry no interval`);
  }

  // And they must not read the same on the page either — "n=0 < 5" would describe an
  // unanswerable question as a small sample.
  const criticalLine = cellLine(critical);
  const majorLine = cellLine(major);
  assert.match(criticalLine, /NOT MEASURABLE/);
  assert.doesNotMatch(criticalLine, /min_n/);
  assert.match(majorLine, /WITHHELD 3 < min_n 5/);
});

test("a claim population still being labelled makes a zero stratum NOT COMPUTED, not not-measurable", () => {
  // The same arm, one claim left unlabelled: `critical` could still fill, so the same
  // zero means something different and says so.
  const { records, labels } = pilotCodeRabbitArm();
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels: labels.slice(0, 29), corpusVersion: CV, parserVintage: VINTAGE });
  const critical = result.cells.find((c) => c.stratum === "critical" && c.metric === "precision");
  assert.equal(critical.availability, "not-computed");
  assert.match(critical.reason, /1 claim\(s\) remain unlabelled and one may still land here/);
  assert.equal(result.arms[0].claim_population, "pending");
});

// --- 🔴 the join, and every way it fails ---------------------------------------

test("a coderabbit label whose parser_vintage is not the current parse is REPORTED as not joined, and never dropped", () => {
  const { records, labels } = pilotCodeRabbitArm({ parserVintage: (i) => (i === 0 ? OLD_VINTAGE : VINTAGE) });
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });
  const arm = result.arms[0];

  assert.equal(arm.join.counts["stale-parse"], 1);
  assert.equal(arm.join.counts.joined, 29);
  // Nothing is dropped: every label is still accounted for, in the census and in the
  // arm's own count.
  assert.equal(arm.labels, 30);
  assert.equal(result.labels.total, 30);
  assert.equal(Object.values(arm.join.counts).reduce((a, b) => a + b, 0), 30);
  // And it is NAMED, not merely counted — an investigation starts from the key.
  assert.equal(arm.join.stale_parse_keys.length, 1);
  assert.equal(arm.join.stale_parse_keys[0].parser_vintage, OLD_VINTAGE);
  // Out of the denominator, because a stale key cannot be told from a current one.
  const overall = result.cells.find((c) => c.metric === "precision" && c.stratum === "all");
  assert.equal(overall.labelled_findings, 29);
  assert.ok(result.completeness.reasons.some((r) => /parser vintage that is not the current parse/.test(r)));
  assert.equal(result.completeness.verdict, "partial");
});

test("a label carrying a parser vintage with no current vintage to compare against is refused, not assumed current", () => {
  // Lesson 7: ask what happens when the check's INPUT never arrives. `harvestVintage`
  // returns null when it cannot read the module, and the write path refuses; the read
  // path has to fail the same way round or a stale label enters the denominator.
  const { records, labels } = pilotCodeRabbitArm();
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: null });
  assert.equal(result.arms[0].join.counts["parse-vintage-unknown"], 30);
  assert.equal(result.arms[0].join.counts.joined, 0);
  assert.equal(result.cells.find((c) => c.metric === "precision" && c.stratum === "all").labelled_findings, 0);
  assert.match(result.parse_vintage.basis, /refused rather than assumed current/);
});

test("a label matching no claim is listed as unmatched rather than quietly leaving the denominator", () => {
  const { records, labels } = pilotCodeRabbitArm();
  // One claim's wording moved, so its label's key no longer names anything.
  const drifted = records.slice(1);
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records: drifted }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });
  const arm = result.arms[0];
  assert.equal(arm.join.counts.unmatched, 1);
  assert.equal(arm.join.unmatched_keys.length, 1);
  assert.equal(arm.join.unmatched_keys[0].finding_key, labels[0].finding_key);
  assert.ok(result.completeness.reasons.some((r) => /match no claim in the population supplied/.test(r)));
});

test("an arm whose claim population was not supplied does not report 30 orphans — its labels are placed nowhere and said so", () => {
  // The failure the pair-label store shipped one level up: joining against a
  // population nobody supplied reported "0 of 349" as though every judgement were
  // wrong, rather than as though the question had not been asked.
  const { labels } = pilotCodeRabbitArm();
  const result = scoreValidity({ arms: [], labels, corpusVersion: CV, parserVintage: VINTAGE });
  const arm = result.arms.find((a) => a.arm === "coderabbit");
  assert.equal(arm.claims_supplied, false);
  assert.equal(arm.join.counts["claims-not-supplied"], 30);
  assert.equal(arm.join.counts.unmatched, 0);
  assert.equal(arm.claim_population, "unknown");
  assert.ok(result.completeness.reasons.some((r) => /no claim population supplied/.test(r)));
});

test("joinLabels counts every status and JOIN_STATUSES is the whole vocabulary", () => {
  const { records, labels } = pilotCodeRabbitArm();
  const claims = claimCensus("coderabbit", [{ run_id: null, records }]).keys;
  const join = joinLabels({ labels, claims, arm: "coderabbit", parserVintage: VINTAGE });
  assert.deepEqual(Object.keys(join.counts).sort(), [...JOIN_STATUSES].sort());
  assert.equal(join.counts.joined, 30);
});

// --- 🔴 the levels ------------------------------------------------------------

test("N labels written from ONE reading report N labels and ONE reading, and the precision denominator is the labels", () => {
  // The bundling `adjudicate.mjs` does: one defect class, one human decision, five
  // records. A dataset of 5 independent judgements and a dataset of 1 are different
  // objects and only one of them supports a claim about agreement.
  const records = Array.from({ length: 5 }, (_, i) => record({ severity: "minor", summary: `bundled claim ${i}` }));
  const members = records.map((r) => r.finding_key);
  const labels = records.map((r) => label({ findingKey: r.finding_key, severity: "minor", isReal: true, classId: "class-1", classMembers: members }));
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });
  const overall = result.cells.find((c) => c.metric === "precision" && c.stratum === "all");

  assert.equal(overall.labelled_findings, 5);
  assert.equal(overall.readings, 1, "5 labels from one class_id are ONE reading");
  assert.equal(overall.bundled_labels, 5);
  assert.notEqual(overall.labelled_findings, overall.readings);
  // The denominator is the label level, and the payload says so rather than leaving a
  // reader to infer it.
  assert.equal(overall.value, 1);
  assert.match(overall.denominator_level, /one judgement written to disk about one claim/);
  // The whole-set census agrees with the per-cell one.
  assert.equal(result.labels.census.n, 5);
  assert.equal(result.labels.census.readings, 1);
});

test("unbundled labels report as many readings as labels, so `readings` is not a constant", () => {
  const records = Array.from({ length: 5 }, (_, i) => record({ severity: "minor", summary: `separate claim ${i}` }));
  const labels = records.map((r) => label({ findingKey: r.finding_key, severity: "minor" }));
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });
  const overall = result.cells.find((c) => c.metric === "precision" && c.stratum === "all");
  assert.equal(overall.labelled_findings, 5);
  assert.equal(overall.readings, 5);
  assert.equal(overall.bundled_labels, 0);
});

// --- 🔴 the two permanent refusals --------------------------------------------

test("absolute recall and the miss profile are not-measurable with a corpus reason, and NO argument turns either into a figure", () => {
  const { records, labels } = pilotCodeRabbitArm();
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });

  for (const id of ["absolute_recall", "miss_profile"]) {
    const refusal = result.refusals.find((r) => r.metric === id);
    assert.equal(refusal.availability, "not-measurable");
    assert.equal(refusal.permanent, true);
    // The reason has to name the corpus property, not a missing feature.
    assert.match(refusal.reason, /true_defects\[\]/);
    assert.match(refusal.reason, /corpus/);
    assert.ok(!("value" in refusal));
    assert.ok(!("labelled_findings" in refusal));

    // Declared not computable, filtered out of the ids cells are built from, and
    // absent from every cell in a fully-labelled payload.
    assert.equal(METRICS.find((m) => m.id === id).computable, false);
    assert.ok(!METRIC_IDS.includes(id));
    assert.equal(result.cells.filter((c) => c.metric === id).length, 0);

    // And the door is bolted rather than merely unused: asking for the cell directly
    // is a refusal, so no future caller can produce one by passing the id.
    assert.throws(
      () => precisionCell({ metric: id, arm: "coderabbit", tier: "gold", stratumBasis: "stratum", stratum: "all", labels }),
      new RegExp(`no cell may be built for "${id}"`),
    );
  }
  assert.deepEqual(PERMANENT_REFUSALS.map((r) => r.metric).sort(), ["absolute_recall", "miss_profile"]);
});

// --- suppression and the shape of a withheld cell ------------------------------

test("a suppressed cell carries its denominator and nothing a reader could quote", () => {
  const records = Array.from({ length: 3 }, (_, i) => record({ severity: "minor", summary: `thin claim ${i}` }));
  const labels = records.map((r, i) => label({ findingKey: r.finding_key, severity: "minor", isReal: i === 0 }));
  const cell = precisionCell({ arm: "coderabbit", tier: "gold", stratumBasis: "stratum", stratum: "all", labels, minN: MIN_N, claimPopulation: "exhausted" });
  assert.equal(cell.availability, "suppressed");
  assert.equal(cell.labelled_findings, 3);
  assert.equal(cell.readings, 3);
  assert.ok(!("value" in cell));
  assert.ok(!("real_findings" in cell));
  assert.ok(!("interval" in cell));
  // One more label and the same cell reports, so the boundary is the threshold rather
  // than an accident of the fixture.
  const fifth = [...records, record({ severity: "minor", summary: "thin claim 3" }), record({ severity: "minor", summary: "thin claim 4" })];
  const five = fifth.map((r, i) => label({ findingKey: r.finding_key, severity: "minor", isReal: i === 0 }));
  const reported = precisionCell({ arm: "coderabbit", tier: "gold", stratumBasis: "stratum", stratum: "all", labels: five, minN: MIN_N, claimPopulation: "exhausted" });
  assert.equal(reported.availability, "present");
  assert.equal(reported.value, 1 / 5);
  assert.equal(reported.real_findings, 1);
  assert.equal(reported.interval.method, "wilson-score");
});

test("precisionCell refuses a numerator and a denominator that do not add up", () => {
  // `is_real` is a boolean and `labels.mjs` refuses anything else, so this can only
  // happen if the two came from different sets — which is how `0.833 (25/17)` reached
  // a payload once already.
  const r = record({ summary: "impossible" });
  const broken = { ...label({ findingKey: r.finding_key }), is_real: "probably" };
  assert.throws(() => precisionCell({ arm: "coderabbit", tier: "gold", stratumBasis: "stratum", stratum: "all", labels: [broken] }), /does not add up/);
});

// --- tiers --------------------------------------------------------------------

test("a gold precision and a silver precision are two cells, and a mixed set is refused", () => {
  const records = Array.from({ length: 10 }, (_, i) => record({ severity: "minor", summary: `tiered claim ${i}` }));
  const labels = records.map((r, i) =>
    label({
      findingKey: r.finding_key,
      severity: "minor",
      isReal: i < 6,
      labelSource: i < 5 ? "gold" : "silver",
      annotators: i < 5 ? ["alice"] : ["claude-opus-5"],
      adjudication: i < 5 ? ADJUDICATION : { ...ADJUDICATION, mode: "model" },
    }),
  );
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });
  const overall = result.cells.filter((c) => c.metric === "precision" && c.stratum === "all");
  assert.deepEqual(overall.map((c) => c.label_source), ["gold", "silver"]);
  // Two measurements of different things: 5 gold judgements, 5 silver ones, neither
  // pooled into one figure over 10.
  assert.deepEqual(overall.map((c) => c.labelled_findings), [5, 5]);
  assert.ok(overall.every((c) => c.segment.includes(`tier=${c.label_source}`)));
  assert.throws(() => assertOneTier(labels, { arm: "coderabbit", tier: "gold" }), /pooling them produces one that describes neither/);
});

// --- severity-weighted precision ----------------------------------------------

test("severity-weighted precision weights by the ANNOTATOR's severity and reports weight sums, not counts", () => {
  // Five claims CodeRabbit called `nit`; the adjudicator judged one of them critical
  // and it is real, the other four nits and wrong. Counting would give 1/5 = 0.2;
  // weighting by the annotator gives 4/(4+4) = 0.5, and weighting by the REVIEWER's
  // word would give 1/5 again — so the two are distinguishable by construction.
  const records = Array.from({ length: 5 }, (_, i) => record({ severity: "nit", summary: `weighted claim ${i}` }));
  const labels = records.map((r, i) => label({ findingKey: r.finding_key, severity: i === 0 ? "critical" : "nit", isReal: i === 0 }));
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });
  const plain = result.cells.find((c) => c.metric === "precision" && c.stratum === "all");
  const weighted = result.cells.find((c) => c.metric === "severity_weighted_precision" && c.stratum === "all");

  assert.equal(plain.value, 1 / 5);
  assert.equal(weighted.real_weight_sum, 4);
  assert.equal(weighted.labelled_weight_sum, 4 + 4 * 1);
  assert.equal(weighted.value, 0.5);
  assert.notEqual(weighted.value, plain.value);
  assert.match(weighted.weight_basis, /ANNOTATOR's own severity/);
  // A weight sum is not a k, so there is no Wilson interval and the cell says why
  // rather than leaving the field absent.
  assert.equal(weighted.interval.low, null);
  assert.match(weighted.interval.undefined_reason, /not k successes in n trials/);
});

test("an operator weight vector overrides the derived one, is validated, and is named in the payload", () => {
  // Spec §3.3 puts the weights in one place so anyone who disagrees can re-run with their
  // own. That path existed and nothing exercised it, so neither the validation nor the
  // provenance string was ever proved.
  const records = Array.from({ length: 5 }, (_, i) => record({ severity: "nit", summary: `override claim ${i}` }));
  const labels = records.map((r, i) => label({ findingKey: r.finding_key, severity: i === 0 ? "critical" : "nit", isReal: i === 0 }));
  const arms = [{ arm: "coderabbit", legs: [{ run_id: null, records }] }];

  const dflt = scoreValidity({ arms, labels, corpusVersion: CV, parserVintage: VINTAGE });
  assert.match(dflt.severity_weights_source, /derived from severity.mjs KNOWN's ordering/);
  assert.equal(dflt.cells.find((c) => c.metric === "severity_weighted_precision" && c.stratum === "all").value, 0.5);

  // A flat vector must move the figure, or the override is not reaching the arithmetic.
  const flat = scoreValidity({ arms, labels, corpusVersion: CV, parserVintage: VINTAGE, weights: { critical: 1, major: 1, minor: 1, nit: 1 } });
  assert.deepEqual(flat.severity_weights, { critical: 1, major: 1, minor: 1, nit: 1 });
  assert.equal(flat.severity_weights_source, "operator override");
  const flatCell = flat.cells.find((c) => c.metric === "severity_weighted_precision" && c.stratum === "all");
  assert.equal(flatCell.value, 1 / 5, "with flat weights the weighted figure collapses onto plain precision");
  assert.equal(flatCell.labelled_weight_sum, 5);

  // And an override still has to be a legal vector — the spec check is only skipped for
  // the operator's numbers, not the shape check.
  assert.throws(() => scoreValidity({ arms, labels, corpusVersion: CV, parserVintage: VINTAGE, weights: { critical: 4, major: 3, minor: 2 } }), /nit/);
  assert.throws(() => scoreValidity({ arms, labels, corpusVersion: CV, parserVintage: VINTAGE, weights: { critical: 4, major: 3, minor: 2, nit: -1 } }), /positive number/);
});

// --- relative recall -----------------------------------------------------------

test("relative recall is a BAND with both bounds and no point value", () => {
  const band = relativeRecallBand({ arm: "panel", tier: "gold", real: 10, labelled: 12, otherArm: "coderabbit", otherReal: 4, otherLabelled: 6, minN: 5 });
  assert.equal(band.availability, "present");
  assert.equal(band.union_low, 10);
  assert.equal(band.union_high, 14);
  assert.equal(band.low, 10 / 14);
  assert.equal(band.high, 1);
  assert.ok(!("value" in band), "a point is exactly what this metric may not publish");
  assert.equal(band.overlap_resolved, false);
  // The other arm's own band is the mirror image, and the two are not complements.
  const theirs = relativeRecallBand({ arm: "coderabbit", tier: "gold", real: 4, labelled: 6, otherArm: "panel", otherReal: 10, otherLabelled: 12, minN: 5 });
  assert.equal(theirs.low, 4 / 14);
  assert.equal(theirs.high, 4 / 10);
});

test("relative recall over one arm's labels alone is 1.0 by construction, and is refused rather than printed", () => {
  const band = relativeRecallBand({ arm: "coderabbit", tier: "gold", real: 18, labelled: 20, otherArm: "panel", otherReal: 0, otherLabelled: 0, minN: 5 });
  assert.equal(band.availability, "not-computed");
  assert.ok(!("low" in band));
  assert.match(band.reason, /collapses to \[1, 1\]/);
  assert.match(band.reason, /Label the panel arm/);
});

test("an arm with nothing labelled gets no recall band, because 0.0 would be a fact about the labelling", () => {
  // The mirror of the one-armed 1.0, and the one missed on the first pass: the guard
  // checked the OTHER arm's denominator and never this arm's own numerator's support.
  const none = relativeRecallBand({ arm: "panel", tier: "gold", real: 0, labelled: 0, otherArm: "coderabbit", otherReal: 9, otherLabelled: 9, minN: 5 });
  assert.equal(none.availability, "not-computed");
  assert.ok(!("low" in none));
  assert.match(none.reason, /0 by construction/);
  // And one labelled finding out of hundreds of claims is not support for a share either.
  const thin = relativeRecallBand({ arm: "panel", tier: "gold", real: 1, labelled: 1, otherArm: "coderabbit", otherReal: 9, otherLabelled: 9, minN: 5 });
  assert.equal(thin.availability, "suppressed");
  assert.ok(!("low" in thin));
  assert.match(thin.reason, /too little support/);
});

test("a union whose lower bound is thin is withheld, because the weakest supported end decides", () => {
  const band = relativeRecallBand({ arm: "panel", tier: "gold", real: 2, labelled: 8, otherArm: "coderabbit", otherReal: 4, otherLabelled: 6, minN: 5 });
  assert.equal(band.availability, "suppressed");
  assert.equal(band.union_low, 4);
  assert.equal(band.union_high, 6);
  assert.ok(!("low" in band));
});

test("the whole score emits a relative-recall band per arm once both arms carry labels", () => {
  const cr = pilotCodeRabbitArm();
  const panelRecords = Array.from({ length: 8 }, (_, i) => record({ arm: "panel", runId: "run-1", severity: "major", summary: `panel claim ${i}` }));
  const panelLabels = panelRecords.map((r, i) => label({ arm: "panel", findingKey: r.finding_key, severity: "major", isReal: i < 6 }));
  const result = scoreValidity({
    arms: [
      { arm: "coderabbit", legs: [{ run_id: null, records: cr.records }] },
      { arm: "panel", legs: [{ run_id: "run-1", records: panelRecords }] },
    ],
    labels: [...cr.labels, ...panelLabels],
    corpusVersion: CV,
    parserVintage: VINTAGE,
  });
  const bands = result.relative_recall.filter((r) => r.availability === "present");
  assert.equal(bands.length, 2);
  const panel = bands.find((b) => b.arm === "panel");
  assert.equal(panel.real_findings, 6);
  assert.equal(panel.other_arm_real_findings, 30);
  assert.equal(panel.union_low, 30);
  assert.equal(panel.union_high, 36);
});

// --- the false-positive profile ------------------------------------------------

test("the FP profile prints every count and suppresses only the shares", () => {
  // 8 claims: 6 nits (4 wrong) and 2 majors (both wrong). The `nit` bucket clears
  // min_n and reports a share; the `major` bucket does not and withholds one — but
  // both still say how many wrong claims are in them, which is the profile's content.
  const stated = [...Array(6).fill("nit"), ...Array(2).fill("major")];
  const records = stated.map((sev, i) => record({ severity: sev, summary: `fp claim ${i}` }));
  const labels = records.map((r, i) => label({ findingKey: r.finding_key, severity: stated[i], isReal: i < 2 }));
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });
  const bySeverity = result.fp_profile.filter((g) => g.axis === "annotator_severity");
  const nit = bySeverity.find((g) => g.bucket === "nit");
  const major = bySeverity.find((g) => g.bucket === "major");

  assert.equal(nit.labelled_findings, 6);
  assert.equal(nit.false_findings, 4);
  assert.equal(nit.share_availability, "present");
  assert.equal(nit.false_share, 4 / 6);

  assert.equal(major.labelled_findings, 2);
  assert.equal(major.false_findings, 2, "the count is the qualitative content and is printed at any size");
  assert.equal(major.share_availability, "suppressed");
  assert.ok(!("false_share" in major));

  assert.match(bySeverity[0].axis_note, /adjudicator's own severity/);
});

test("the FP profile's two severity axes read DIFFERENT fields, and a fixture where they disagree proves it", () => {
  // The previous fixture gave every label the reviewer's own severity, so reading the
  // wrong field would have passed. Here the reviewer called all 6 claims `nit` and the
  // adjudicator called all 6 `major` — so the two axes cannot both be right, and swapping
  // the accessor moves both buckets.
  const records = Array.from({ length: 6 }, (_, i) => record({ severity: "nit", summary: `disagreed claim ${i}` }));
  const labels = records.map((r, i) => label({ findingKey: r.finding_key, severity: "major", isReal: i < 2 }));
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });

  const annotator = result.fp_profile.filter((g) => g.axis === "annotator_severity");
  const stated = result.fp_profile.filter((g) => g.axis === "stated_severity");
  // One bucket each, and they are different words.
  assert.deepEqual(annotator.map((g) => g.bucket), ["major"]);
  assert.deepEqual(stated.map((g) => g.bucket), ["nit"]);
  // Same 6 labels, same 4 wrong claims, cut two ways.
  for (const g of [...annotator, ...stated]) {
    assert.equal(g.labelled_findings, 6);
    assert.equal(g.false_findings, 4);
  }
  assert.match(stated[0].axis_note, /severity the REVIEWER put on the claim/);
});

// --- the claim census ----------------------------------------------------------

test("a claim whose stated severity differs between replicates lands in its own bucket, not in either", () => {
  // The panel is replayed K times and a lens may not repeat itself. Filing such a key
  // under one of the two would produce a census no single replicate produced.
  const k1 = record({ arm: "panel", runId: "run-1", severity: "major", summary: "the same claim" });
  const k2 = record({ arm: "panel", runId: "run-2", severity: "minor", summary: "the same claim" });
  const steady = record({ arm: "panel", runId: "run-1", severity: "nit", summary: "a steady claim" });
  const census = claimCensus("panel", [
    { run_id: "run-1", records: [k1, steady] },
    { run_id: "run-2", records: [k2] },
  ]);
  assert.equal(census.records, 3);
  assert.equal(census.distinct_finding_keys, 2);
  assert.equal(census.distinct_keys_by_stated_severity["stated-severity-varies"], 1);
  assert.equal(census.distinct_keys_by_stated_severity.major, 0);
  assert.equal(census.distinct_keys_by_stated_severity.minor, 0);
  assert.equal(census.distinct_keys_by_stated_severity.nit, 1);
});

test("a claim whose severity the reviewer never stated is NOT counted as one they called major", () => {
  // `normalizeSeverity` floors an unrecognised severity to `major`, which is blocking. The
  // census read that floored value and called it "the reviewer's own word", so a finding
  // nobody called blocking was counted as a `major` claim — and a not-measurable reason
  // was then built on the count.
  const stated = record({ arm: "panel", runId: "run-1", severity: "minor", summary: "a stated claim" });
  const floored = record({ arm: "panel", runId: "run-1", severity: "kinda bad", summary: "a floored claim" });
  assert.equal(floored.severity, "major", "normalizeSeverity floors an unknown severity to major");
  assert.equal(floored.severity_raw, "kinda bad", "and the record keeps what was actually said");

  const census = claimCensus("panel", [{ run_id: "run-1", records: [stated, floored] }]);
  assert.equal(census.distinct_finding_keys, 2);
  assert.equal(census.distinct_keys_by_stated_severity.major, 0, "the floored claim must NOT be counted as a stated major");
  assert.equal(census.distinct_keys_by_stated_severity["severity-unstated"], 1);
  assert.equal(census.distinct_keys_by_stated_severity.minor, 1);
});

// --- refusals on caller error --------------------------------------------------

test("a label from another corpus version is refused rather than scored against this diff", () => {
  const r = record({ summary: "foreign" });
  const foreign = label({ findingKey: r.finding_key, corpusVersion: "2026-07-28-pilot" });
  assert.throws(() => scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records: [r] }] }], labels: [foreign], corpusVersion: CV, parserVintage: VINTAGE }), /about different diffs/);
});

test("an item label is refused: a PR verdict is not a finding judgement", () => {
  const itemish = { schema: "item-label", arm: "coderabbit", label_source: "gold", corpus_version: CV, finding_key: "a::b" };
  assert.throws(() => scoreValidity({ labels: [itemish], corpusVersion: CV }), /finding labels only/);
});

test("a CodeRabbit finding about code our arm never reviewed is refused, never pooled", () => {
  const after = record({ summary: "after the window", detail: { window: "after-window" } });
  assert.throws(() => scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records: [after] }] }], labels: [], corpusVersion: CV }), /after-window/);
});

test("a non-array where a list belongs is refused by name rather than iterated character by character", () => {
  assert.throws(() => scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records: "abc" }] }], corpusVersion: CV }), /records must be an array/);
});

// --- the unreadable, and the honest empty result --------------------------------

test("an unreadable label is counted into the payload, because it is a judgement that cannot be re-asked", () => {
  const { records, labels } = pilotCodeRabbitArm();
  const result = scoreValidity({
    arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }],
    labels,
    unreadable: [{ path: "/labels/x.json", reason: "not JSON" }],
    corpusVersion: CV,
    parserVintage: VINTAGE,
  });
  assert.equal(result.labels.unreadable_count, 1);
  assert.equal(result.labels.unreadable[0].path, "/labels/x.json");
  assert.ok(result.completeness.reasons.some((r) => /cannot be recovered/.test(r)));
  assert.equal(result.completeness.verdict, "partial");
});

test("a store with no labels produces no figure, says so, and is PARTIAL", () => {
  const { records } = pilotCodeRabbitArm();
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels: [], corpusVersion: CV, parserVintage: VINTAGE });
  assert.equal(result.cells.length, 0);
  assert.equal(result.relative_recall.length, 0);
  assert.equal(result.completeness.verdict, "partial");
  assert.ok(result.completeness.reasons.some((r) => /no finding label exists/.test(r)));
  // The arm is still described — 30 claims exist and nobody has judged them.
  assert.equal(result.arms[0].claims.distinct_finding_keys, 30);
  assert.equal(result.arms[0].unlabelled_claims, 30);
  // And the two permanent refusals are stated even with nothing to score, because they
  // are facts about the corpus rather than about the labelling.
  assert.equal(result.refusals.length, 2);
});

test("a fully labelled arm with no shortfall is COMPLETE", () => {
  const { records, labels } = pilotCodeRabbitArm();
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });
  assert.equal(result.completeness.verdict, "complete");
  assert.deepEqual(result.completeness.reasons, []);
  assert.equal(result.arms[0].claim_population, "exhausted");
});

// --- the report ----------------------------------------------------------------

test("the report prints every cell, including the ones with no number, and names both levels", () => {
  const { records, labels } = pilotCodeRabbitArm();
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE });
  const lines = renderReport(result).join("\n");
  assert.match(lines, /validity · corpus 2026-08-10-pilot-reviewed · 30 label\(s\) · COMPLETE/);
  // Every cell reaches the page, in each of its states.
  for (const cell of result.cells) assert.ok(lines.includes(cell.segment), `${cell.segment} is missing from the report`);
  assert.match(lines, /labelled finding\(s\) · 30 reading\(s\)/);
  // The claim census names whose severity it is, so the two severities on the page
  // cannot be read as one.
  assert.match(lines, /claims by STATED severity \(the reviewer's own word\)/);
  // The permanent refusals are printed with the rest rather than left to a footnote.
  assert.match(lines, /absolute_recall: NOT MEASURABLE, permanently/);
  assert.match(lines, /miss_profile: NOT MEASURABLE, permanently/);
});

test("the min_n a cell was judged against is carried on the cell and named in the report", () => {
  const { records, labels } = pilotCodeRabbitArm();
  const result = scoreValidity({ arms: [{ arm: "coderabbit", legs: [{ run_id: null, records }] }], labels, corpusVersion: CV, parserVintage: VINTAGE, minN: 3 });
  assert.equal(result.min_n, 3);
  assert.equal(result.min_n_source, "operator override");
  // At min_n 3 the three majors clear, so the same data reports where it withheld.
  const major = result.cells.find((c) => c.stratum === "major" && c.metric === "precision");
  assert.equal(major.availability, "present");
  assert.equal(major.min_n, 3);
  assert.match(renderReport(result).join("\n"), /min_n 3 \(operator override\)/);
});
