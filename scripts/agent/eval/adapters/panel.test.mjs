// The fixture below carries a finding in EVERY lane state — `blocking`,
// `backlog`, `discarded` and absent — because the module it replaces read none
// of them, and three of the four are the cases that go wrong silently. It is
// hand-built rather than harvested: no replay with `lane: "backlog"` in it
// exists yet (every replay runs with the novelty gate off), and manufacturing
// one by hand would be a guess dressed as data. What is asserted here is the
// MAPPING, which is what this PR owns.
//
// The end-to-end test at the bottom drives a real `EvalStore`, so the shape the
// records are derived from is the shape the runner really writes rather than
// this file's idea of it. Nothing here calls a model or needs an API key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EvalStore } from "../store.mjs";
import { gatingCensus, validateFindingRecord } from "../finding-record.mjs";
import { panelRecords, runRecords } from "./panel.mjs";

const PANEL_SHA = "0".repeat(39) + "1";

/** A stored envelope, as `run.mjs` writes one. */
const envelope = (over = {}) => ({
  run_id: "2026-08-07T00-00-00-000Z__pilot",
  item_id: "pr-664",
  config_hash: "sha256:cafe",
  panel_sha: PANEL_SHA,
  panel_sha_source: "measured",
  corpus_version: "2026-08-07a",
  status: "ok",
  reason: null,
  transcript: { state: "absent" },
  payload_ref: "payload.json",
  gate: { state: "off-no-base-sha", line: "novelty gate: OFF (no --base-sha) — every finding routes as before" },
  base_sha_passed: false,
  duration_ms: 30000,
  duration_source: "review-timing.json",
  ...over,
});

/**
 * One finding in each lane state, as `verdict.json` carries them.
 *
 * `discarded` is included even though `keepUnrefuted` filters it out upstream of
 * `verdict.json` today: the mapping must not depend on that filter staying where
 * it is, and a lane the record cannot read would come back as `unknown` — the
 * one answer that looks like missing data when it is not.
 */
const FINDINGS = [
  { severity: "critical", file: "a.mjs", summary: "unbounded retry", lane: "blocking", novelty: { origin: "unknown" }, lens: "correctness", verification: "confirmed-high" },
  { severity: "critical", file: "b.mjs", summary: "same bug, older code", lane: "backlog", novelty: { origin: "relocated", alsoAt: "b.mjs:12" }, lens: "correctness", unsettled: true },
  { severity: "major", file: "c.mjs", summary: "refuted claim", lane: "discarded", lens: "security" },
  { severity: "nit", file: "d.mjs", summary: "stray import", lens: "design-fit" },
  { severity: "critical", file: "e.mjs", summary: "pre-668 capture, no lane recorded", lens: "correctness" },
];

const item = (over = {}) => ({ envelope: envelope(), payload: { adapter: "reviewer", findings: FINDINGS, stageDetail: {}, ...over } });

const byKey = (records) => Object.fromEntries(records.map((r) => [r.finding_key, r]));

test("the lane survives: each of the four states maps to its own answer", () => {
  const { records, population_state, dropped } = panelRecords(item());
  assert.equal(population_state, "present");
  assert.deepEqual(dropped, []);
  assert.equal(records.length, 5);
  const r = byKey(records);
  assert.equal(r["a.mjs::unbounded retry"].gating, "gates");
  // The defect. `blocking: BLOCKING.has(severity)` called this one blocking.
  assert.equal(r["b.mjs::same bug, older code"].gating, "does-not-gate");
  assert.equal(r["b.mjs::same bug, older code"].gating_basis, "lane-backlog");
  assert.equal(r["b.mjs::same bug, older code"].severity, "critical");
  assert.equal(r["c.mjs::refuted claim"].gating, "does-not-gate");
  assert.equal(r["d.mjs::stray import"].gating_basis, "non-blocking-severity");
  assert.equal(r["e.mjs::pre-668 capture, no lane recorded"].gating, "unknown");
  assert.equal(r["e.mjs::pre-668 capture, no lane recorded"].gating_basis, "lane-absent");
  // Exactly one of five gated. Under the rule this replaces it would have been
  // four — every critical/major, whatever the gate decided.
  assert.deepEqual(gatingCensus(records).gating, { gates: 1, "does-not-gate": 3, unknown: 1, "not-applicable": 0 });
});

test("every annotation the orchestrator adds rides along, including ones this file does not name", () => {
  const extra = { severity: "major", file: "f.mjs", summary: "x", lane: "blocking", mergedFrom: [{ summary: "another wording" }], somethingLater: true };
  const { records } = panelRecords(item({ findings: [extra] }));
  assert.deepEqual(records[0].panel.raw, extra);
  assert.equal(records[0].panel.raw.somethingLater, true);
  assert.deepEqual(records[0].panel.raw.mergedFrom, [{ summary: "another wording" }]);
  assert.equal(records[0].panel.novelty, null, "a finding with no novelty gets null, not an invented one");
});

test("zero findings and no findings at all are different facts", () => {
  // A clean review genuinely produces `findings: []`. `adapters/reviewer.mjs`
  // writes `null` when the panel produced nothing usable, precisely so the two
  // do not share a shape — and in a precision metric a false clean review is not
  // noise, it is a perfect score.
  const clean = panelRecords(item({ findings: [] }));
  assert.equal(clean.population_state, "present");
  assert.equal(clean.records.length, 0);
  const broken = panelRecords(item({ findings: null }));
  assert.equal(broken.population_state, "absent");
  assert.equal(broken.records.length, 0);
});

test("a finding that is not an object is dropped, and the drop is reported", () => {
  const { records, dropped } = panelRecords(item({ findings: [FINDINGS[0], null, "a string", 7] }));
  assert.equal(records.length, 1);
  assert.equal(dropped.length, 3);
  assert.deepEqual(dropped.map((d) => d.index), [1, 2, 3]);
  assert.deepEqual(new Set(dropped.map((d) => d.reason)), new Set(["not-an-object"]));
});

test("run-level provenance rides on every record, so one record is enough to refuse a pool", () => {
  const { records } = panelRecords(item());
  for (const r of records) {
    assert.equal(r.panel.gate_state, "off-no-base-sha");
    assert.equal(r.panel.config_hash, "sha256:cafe");
    assert.equal(r.panel.panel_sha, PANEL_SHA);
    assert.equal(r.panel.item_status, "ok");
    assert.equal(r.run_id, "2026-08-07T00-00-00-000Z__pilot");
    assert.equal(r.item_id, "pr-664");
  }
});

test("a failed item still yields records, carrying the status that excludes them", () => {
  // Carried, not filtered. Dropping them here would hide how much of a run
  // failed; a scorer excludes anything that is not `ok`, and cannot do that if
  // the records never existed.
  const failed = { envelope: envelope({ status: "error", reason: "panel-exit", error: { message: "exit 1" } }), payload: { findings: [FINDINGS[0]] } };
  const { records } = panelRecords(failed);
  assert.equal(records.length, 1);
  assert.equal(records[0].panel.item_status, "error");
  assert.equal(records[0].panel.item_reason, "panel-exit");
});

test("the sampled population is a different question, and says so", () => {
  const payload = {
    findings: [],
    stageDetail: {
      correctness: {
        samples: [
          [{ severity: "minor", file: "a.mjs", summary: "unbounded retry" }, { severity: "nit", file: "z.mjs", summary: "one-off" }],
          [{ severity: "critical", file: "a.mjs", summary: "UNBOUNDED RETRY" }],
        ],
        verifications: [],
      },
    },
  };
  const { records, population_state } = panelRecords({ envelope: envelope(), payload }, { population: "sampled" });
  assert.equal(population_state, "present");
  assert.equal(records.length, 2, "the two wordings of one key are one finding; the one-off is the other");
  const r = byKey(records);
  // Both samples raised it — the reliability signal this population exists for.
  assert.deepEqual(r["a.mjs::unbounded retry"].panel.samples, { raised: 2, total: 2 });
  assert.deepEqual(r["z.mjs::one-off"].panel.samples, { raised: 1, total: 2 });
  // The representative is `dedupeFindings`' choice — highest severity — not the
  // first sample that said it. Composed, not re-implemented.
  assert.equal(r["a.mjs::unbounded retry"].severity, "critical");
  // Nothing here has a lane: `annotateFindings` runs after sampling. So the
  // honest answer is `unknown`, and the lane is NOT joined in from the
  // verifier's rows — that would put a post-gate fact on a pre-gate finding.
  assert.equal(r["a.mjs::unbounded retry"].gating, "unknown");
  assert.equal(r["a.mjs::unbounded retry"].gating_basis, "lane-absent");
  assert.equal(r["a.mjs::unbounded retry"].panel.lane, null);
  for (const rec of records) assert.equal(rec.population, "sampled");
});

test("a finding raised twice inside ONE sample counts as one try, not as agreement", () => {
  const payload = {
    stageDetail: { correctness: { samples: [[{ severity: "major", file: "a.mjs", summary: "x" }, { severity: "major", file: "a.mjs", summary: "X" }], []] } },
  };
  const { records } = panelRecords({ envelope: envelope(), payload }, { population: "sampled" });
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].panel.samples, { raised: 1, total: 2 });
});

test("a missing stage detail is absent, and an empty one is present", () => {
  assert.equal(panelRecords({ envelope: envelope(), payload: { stageDetail: null } }, { population: "sampled" }).population_state, "absent");
  const empty = panelRecords({ envelope: envelope(), payload: { stageDetail: {} } }, { population: "sampled" });
  assert.equal(empty.population_state, "present");
  assert.equal(empty.records.length, 0);
});

test("the two populations are never mixed, and an unnamed one is refused", () => {
  const both = { envelope: envelope(), payload: { findings: [FINDINGS[0]], stageDetail: { correctness: { samples: [[FINDINGS[3]]] } } } };
  assert.deepEqual(panelRecords(both).records.map((r) => r.population), ["reported"]);
  assert.deepEqual(panelRecords(both, { population: "sampled" }).records.map((r) => r.population), ["sampled"]);
  assert.throws(() => panelRecords(both, { population: "everything" }), /population must be one of/);
});

test("the adapter refuses a caller that gives it no envelope to attribute records to", () => {
  for (const bad of [undefined, null, "an envelope", []]) {
    assert.throws(() => panelRecords({ envelope: bad, payload: {} }), /an envelope object is required/);
  }
  assert.throws(() => panelRecords({ envelope: envelope({ item_id: "" }), payload: {} }), /item_id must be a non-empty string/);
});

test("every record the adapter emits satisfies the validator", () => {
  const both = { envelope: envelope(), payload: { findings: FINDINGS, stageDetail: { correctness: { samples: [[FINDINGS[0]]] } } } };
  for (const population of ["reported", "sampled"]) {
    for (const r of panelRecords(both, { population }).records) assert.equal(validateFindingRecord(r), r);
  }
});

test("end to end: a stored run envelope reads back as records", () => {
  const root = mkdtempSync(path.join(tmpdir(), "eval-panel-adapter-test-"));
  try {
    const store = new EvalStore(root);
    const runId = "2026-08-07T00-00-00-000Z__pilot";
    store.putRun(runId, { runJson: { run_id: runId, config_hash: "sha256:cafe", corpus_version: "2026-08-07a", panel_sha: PANEL_SHA } });
    store.putItem(runId, "pr-664", item());
    store.putItem(runId, "pr-673", { envelope: envelope({ item_id: "pr-673" }), payload: { adapter: "reviewer", findings: [], stageDetail: {} } });
    const perItem = runRecords(store, runId);
    assert.deepEqual(perItem.map((i) => i.item_id), ["pr-664", "pr-673"]);
    assert.equal(perItem[0].records.length, 5);
    // The clean item is a data point, not a gap: `present` with zero records.
    assert.equal(perItem[1].population_state, "present");
    assert.equal(perItem[1].records.length, 0);
    // Narrowing to one item reads the same records.
    assert.equal(runRecords(store, runId, { itemId: "pr-664" }).length, 1);
    // A record survives the round trip through JSON, which is what a scorer or a
    // report will actually be handed.
    const round = JSON.parse(JSON.stringify(perItem[0].records[1]));
    assert.equal(validateFindingRecord(round).gating, "does-not-gate");
    assert.equal(round.panel.novelty.alsoAt, "b.mjs:12");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
