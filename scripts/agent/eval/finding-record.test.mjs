// The record's job is to make one wrong answer unspellable: "this finding
// gated" said of a finding nobody recorded a gate decision for. So most of what
// is asserted here is about `gating` — that a demoted `critical` is not counted
// as blocking, that an absent lane is `unknown` rather than either answer, and
// that the value and the stated cause can never be written independently and
// disagree.
//
// Nothing here calls a model, spawns anything, or touches the filesystem.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeFindings } from "../vendor/pipeline/review-panel.mjs";
import { findingKey } from "../vendor/pipeline/finding-key.mjs";
import { KNOWN, classify } from "../vendor/pipeline/severity.mjs";
import {
  ARMS,
  ARM_ONLY_FIELDS,
  GATING,
  GATING_BASIS,
  POPULATIONS,
  SCHEMA_VERSION,
  buildFindingRecord,
  gatingCensus,
  gatingOf,
  validateFindingRecord,
} from "./finding-record.mjs";

/** A record over one finding, with the boilerplate filled in. */
const record = (finding, over = {}) =>
  buildFindingRecord({ arm: "panel", itemId: "pr-664", runId: "2026-08-07T00-00-00-000Z__t", population: "reported", finding, ...over });

test("a critical finding routed to backlog does NOT count as gating", () => {
  // The defect this module replaces, stated as a test. `signal-harvest.mjs:92`
  // answered this with `BLOCKING.has(severity)` — which is `true` here — so
  // every finding the novelty gate demoted was labelled a blocking one.
  const demoted = { severity: "critical", file: "a.mjs", summary: "unbounded retry", lane: "backlog", novelty: { origin: "relocated" } };
  const r = record(demoted);
  assert.equal(r.gating, "does-not-gate");
  assert.equal(r.gating_basis, "lane-backlog");
  assert.notEqual(r.gating, "gates");
  // And the severity is still `critical`. The lane demotes the GATE, not the
  // finding — a scorer segmenting by severity must still see it as critical.
  assert.equal(r.severity, "critical");
  assert.equal(r.panel.raw.lane, "backlog");
});

test("an absent lane is unknown — not gating, and not demoted", () => {
  // The reader's obligation `buildStageDetail`'s docstring states: a MISSING
  // lane is "unknown", never "blocking". Every capture written before #668 has
  // no lane at all, and so does every finding in the sampled population.
  const r = record({ severity: "critical", file: "a.mjs", summary: "unbounded retry" });
  assert.equal(r.gating, "unknown");
  assert.equal(r.gating_basis, "lane-absent");
  assert.notEqual(r.gating, "gates");
  assert.notEqual(r.gating, "does-not-gate");
  // The builder invents nothing. It carries the finding and derives the shared
  // fields; the arm namespace is the ADAPTER's to fill, which is what keeps this
  // module expressible for a reviewer that has no lenses and no gate.
  assert.deepEqual(Object.keys(r.panel), ["raw"]);
  assert.equal(Object.hasOwn(r.panel.raw, "lane"), false, "an absent lane must stay absent, never be filled in with a default");
});

test("a blocking lane gates, and an unrecognised one does not resolve to either answer", () => {
  assert.deepEqual(gatingOf({ severity: "major", lane: "blocking" }), { gating: "gates", gating_basis: "lane-blocking" });
  assert.deepEqual(gatingOf({ severity: "major", lane: "discarded" }), { gating: "does-not-gate", gating_basis: "lane-discarded" });
  // Not read as blocking and not read as demoted. A routing decision this file
  // has never heard of is exactly where guessing costs the most.
  assert.deepEqual(gatingOf({ severity: "major", lane: "quarantine" }), { gating: "unknown", gating_basis: "lane-unrecognized" });
  // A non-string lane is absence, not an unrecognised value.
  assert.deepEqual(gatingOf({ severity: "major", lane: null }), { gating: "unknown", gating_basis: "lane-absent" });
});

test("severity is read before the lane, because the real gate is the conjunction of both", () => {
  // `annotateFindings` stamps a lane only on critical/major, so for a nit the
  // absence of one is the design rather than missing data — and the answer is a
  // definite no. Filing it under `lane-backlog` would make "how many findings
  // did the gate demote?" disagree with `laneCounts`' own tally.
  assert.deepEqual(gatingOf({ severity: "nit" }), { gating: "does-not-gate", gating_basis: "non-blocking-severity" });
  assert.deepEqual(gatingOf({ severity: "minor" }), { gating: "does-not-gate", gating_basis: "non-blocking-severity" });
  // Even carrying a lane it should never have had, severity still decides: a
  // lens check fails on `classify(...)`, which reads severity.
  assert.equal(gatingOf({ severity: "nit", lane: "blocking" }).gating_basis, "non-blocking-severity");
});

test("what counts as blocking is severity.mjs's answer, asserted rather than re-typed", () => {
  // The module this replaces kept its own `new Set(["critical","major"])` under
  // a comment saying it mirrored `severity.mjs`. It did match. Nothing enforced
  // that it would keep matching, and the same re-typing pattern has already cost
  // this project a paid harvest — so the agreement is a test, not a comment. A
  // local copy that drifts from `classify` fails here; one that still matches
  // passes, which is the honest limit of what any test can catch.
  for (const severity of [...KNOWN, "trivial", "TRIVIAL", "", null, undefined]) {
    const blocksThePr = !classify([{ severity }]).approved;
    const reachesTheGate = gatingOf({ severity, lane: "blocking" }).gating_basis === "lane-blocking";
    assert.equal(reachesTheGate, blocksThePr, `severity ${JSON.stringify(severity)}: the record and classify disagree about whether it blocks`);
  }
});

test("an unknown severity is read as blocking, and what the reviewer said survives", () => {
  // `normalizeSeverity`'s fail-safe: unknown → major. The record must apply the
  // same rule `classify` does, or it would disagree with the check run — and it
  // must keep the raw string, or the coercion is unrecoverable. CodeRabbit's
  // `trivial` is the case this exists for.
  const r = record({ severity: "trivial", file: "a.mjs", summary: "x" });
  assert.equal(r.severity, "major");
  assert.equal(r.severity_raw, "trivial");
  assert.equal(r.gating_basis, "lane-absent", "a coerced-to-major finding is a blocking one, so its missing lane is unknown");
  const none = record({ file: "a.mjs", summary: "x" });
  assert.equal(none.severity, "major");
  assert.equal(none.severity_raw, null);
});

test("an arm with no merge gate is not-applicable, never unknown", () => {
  // CodeRabbit does not gate anything. That is not uncertainty, and pooling it
  // with our genuinely-unrecorded cases would make "how much of our data has an
  // unrecorded gate decision?" grow with the size of the other arm.
  const r = buildFindingRecord({ arm: "coderabbit", itemId: "pr-664", population: "reported", finding: { severity: "major", file: "a.mjs", summary: "x" } });
  assert.equal(r.gating, "not-applicable");
  assert.equal(r.gating_basis, "no-gate-in-arm");
  assert.ok(r.coderabbit, "the arm namespace is keyed by the arm");
  assert.equal(Object.hasOwn(r, "panel"), false, "a coderabbit record must not carry a panel namespace");
});

test("the record WIDENS — a field this schema has never heard of survives verbatim", () => {
  // The convention the four lane-discard sites all broke, and the one upstream
  // published a postmortem for in `normalizeFindings`. A record built by copying
  // named fields would drop everything a future round annotates.
  const finding = {
    severity: "major",
    file: "a.mjs",
    summary: "x",
    lane: "blocking",
    novelty: { origin: "unknown", alsoAt: null },
    unsettled: true,
    verification: "confirmed-low",
    mergedFrom: [{ severity: "minor", summary: "another wording" }],
    adjudication: { verdict: "upheld", reason: "still present" },
    somethingRoundSevenAdds: 42,
  };
  const r = record(finding);
  assert.deepEqual(r.panel.raw, finding, "the whole finding must ride along, byte for byte");
  assert.equal(r.panel.raw.somethingRoundSevenAdds, 42);
  assert.deepEqual(r.panel.raw.novelty, { origin: "unknown", alsoAt: null });
  assert.equal(r.panel.raw.unsettled, true);
  assert.equal(r.panel.raw.verification, "confirmed-low");
  assert.deepEqual(r.panel.raw.mergedFrom, [{ severity: "minor", summary: "another wording" }]);
});

test("a caller cannot shadow the verbatim copy with a detail field of its own", () => {
  const r = record({ severity: "nit", file: "a.mjs", summary: "x" }, { detail: { raw: "not the finding", lens: "correctness" } });
  assert.equal(typeof r.panel.raw, "object");
  assert.equal(r.panel.raw.summary, "x");
  assert.equal(r.panel.lens, "correctness");
});

test("finding_key is the panel's own key, and stays derivable from the record's fields", () => {
  const finding = { severity: "major", file: "a/b.mjs", summary: "  The Retry Loop  " };
  const r = record(finding);
  assert.equal(r.finding_key, findingKey(finding));
  // `file` and `summary` are carried VERBATIM so this identity holds. Trimming
  // either would leave a reader recomputing the key and silently getting a
  // different one.
  assert.equal(r.finding_key, `${r.file ?? ""}::${String(r.summary ?? "").toLowerCase().trim()}`);
  assert.equal(r.file, "a/b.mjs");
  assert.equal(r.summary, "  The Retry Loop  ");
});

test("records key findings the same way dedupeFindings does", () => {
  // The extraction guard, one level up: whatever the panel's merge calls one
  // finding, the record set calls one key.
  const findings = [
    { severity: "major", file: "a.mjs", summary: "the retry loop can spin forever" },
    { severity: "critical", file: "a.mjs", summary: "THE RETRY LOOP CAN SPIN FOREVER" },
    { severity: "minor", file: "b.mjs", summary: "unused import" },
  ];
  const keys = new Set(findings.map((f) => record(f).finding_key));
  assert.equal(keys.size, dedupeFindings(findings).length);
  assert.equal(keys.size, 2);
});

test("line is read by upstream's rule, including out of an evidence citation", () => {
  assert.equal(record({ severity: "nit", file: "a.mjs", summary: "x", line: 41 }).line, 41);
  assert.equal(record({ severity: "nit", file: "a.mjs", summary: "x", evidence: "a.mjs:41 has no ceiling" }).line, 41);
  assert.equal(record({ severity: "nit", file: "a.mjs", summary: "x" }).line, null);
  // And it is NOT part of the key — the panel's key has never had one, so two
  // findings differing only in line are one finding to the merge and must be one
  // key here.
  const a = record({ severity: "nit", file: "a.mjs", summary: "x", line: 41 });
  const b = record({ severity: "nit", file: "a.mjs", summary: "x", line: 99 });
  assert.equal(a.finding_key, b.finding_key);
});

test("the builder refuses what a scorer could not interpret", () => {
  const ok = { severity: "major", file: "a.mjs", summary: "x" };
  assert.throws(() => buildFindingRecord({ arm: "nobody", itemId: "pr-1", population: "reported", finding: ok }), /arm must be one of/);
  assert.throws(() => buildFindingRecord({ itemId: "", population: "reported", finding: ok }), /itemId must be a non-empty string/);
  assert.throws(() => buildFindingRecord({ itemId: "pr-1", population: "everything", finding: ok }), /population must be one of/);
  // No default population. A record that does not say which set it came from is
  // one a scorer can pool with the other.
  assert.throws(() => buildFindingRecord({ itemId: "pr-1", finding: ok }), /population must be one of/);
  for (const bad of [null, undefined, 42, "a finding", []]) {
    assert.throws(() => buildFindingRecord({ itemId: "pr-1", population: "reported", finding: bad }), /finding must be an object/);
  }
});

test("the validator refuses a gating value that contradicts its own stated cause", () => {
  // The check worth the most in the file. Two ways of saying one thing can only
  // be safe if they are checked against each other.
  const r = record({ severity: "critical", file: "a.mjs", summary: "x", lane: "backlog" });
  assert.equal(validateFindingRecord(r), r);
  assert.throws(() => validateFindingRecord({ ...r, gating: "gates" }), /contradicts gating_basis/);
  assert.throws(() => validateFindingRecord({ ...r, gating_basis: "lane-blocking" }), /contradicts gating_basis/);
  assert.throws(() => validateFindingRecord({ ...r, gating_basis: "made-up" }), /gating_basis must be one of/);
  assert.throws(() => validateFindingRecord({ ...r, gating: "true" }), /gating must be one of/);
});

test("the validator refuses a record that lost the whole finding, or claims two arms", () => {
  const r = record({ severity: "major", file: "a.mjs", summary: "x", lane: "blocking" });
  const { raw, ...withoutRaw } = r.panel;
  assert.ok(raw);
  assert.throws(() => validateFindingRecord({ ...r, panel: withoutRaw }), /panel\.raw is missing/);
  assert.throws(() => validateFindingRecord({ ...r, panel: undefined }), /must carry a panel sub-object/);
  assert.throws(() => validateFindingRecord({ ...r, coderabbit: { raw: {} } }), /must not carry a coderabbit namespace/);
});

test("the validator refuses the rest of the shape, field by field", () => {
  const r = record({ severity: "major", file: "a.mjs", summary: "x", lane: "blocking" });
  assert.throws(() => validateFindingRecord(null), /must be a JSON object/);
  assert.throws(() => validateFindingRecord([r]), /must be a JSON object/);
  assert.throws(() => validateFindingRecord({ ...r, schema_version: 2 }), /schema_version must be 1/);
  assert.throws(() => validateFindingRecord({ ...r, item_id: "  " }), /item_id must be a non-empty string/);
  // `""` would read as a run whose id nobody wrote down; `null` says the arm has
  // no such notion. The two must not share a spelling.
  assert.throws(() => validateFindingRecord({ ...r, run_id: "" }), /run_id must be a non-empty string or null/);
  assert.equal(validateFindingRecord({ ...r, run_id: null }).run_id, null);
  assert.throws(() => validateFindingRecord({ ...r, population: "sampledish" }), /population must be one of/);
  assert.throws(() => validateFindingRecord({ ...r, finding_key: "" }), /finding_key must be a non-empty string/);
  assert.throws(() => validateFindingRecord({ ...r, file: 7 }), /file must be a string or null/);
  assert.throws(() => validateFindingRecord({ ...r, line: 0 }), /line must be a positive integer or null/);
  assert.throws(() => validateFindingRecord({ ...r, line: 1.5 }), /line must be a positive integer or null/);
  // A foreign severity vocabulary is translated at the arm boundary, never
  // carried into the record — `trivial` reaching here is PR 8 leaking.
  assert.throws(() => validateFindingRecord({ ...r, severity: "trivial" }), /severity must be one of/);
});

test("the vocabularies are closed, and every basis resolves to a real gating value", () => {
  assert.deepEqual(ARMS, ["panel", "coderabbit"]);
  assert.deepEqual(POPULATIONS, ["reported", "sampled"]);
  assert.deepEqual(GATING, ["gates", "does-not-gate", "unknown", "not-applicable"]);
  for (const [basis, value] of Object.entries(GATING_BASIS)) {
    assert.ok(GATING.includes(value), `${basis} resolves to ${value}, which is not a gating value`);
  }
  // Every gating value is reachable, so none of them is decoration.
  assert.deepEqual(new Set(Object.values(GATING_BASIS)), new Set(GATING));
  // The severities the record accepts are the panel's own, not a second list.
  assert.deepEqual(KNOWN, ["critical", "major", "minor", "nit"]);
  assert.equal(SCHEMA_VERSION, 1);
  // Neither arm's own fields appear at the top level, so the top level stays
  // meaningful for a reviewer with no lenses — and, the other way round, for one
  // with no gate, no replicates and no severity scale of ours.
  const cr = (over = {}) => buildFindingRecord({ arm: "coderabbit", itemId: "pr-471", population: "reported", finding: { severity: "nit", file: "a.mjs", summary: "x" }, ...over });
  for (const [arm, fields] of Object.entries(ARM_ONLY_FIELDS)) {
    const r = arm === "panel" ? record({ severity: "nit", file: "a.mjs", summary: "x" }) : cr();
    for (const field of fields) {
      assert.equal(Object.hasOwn(r, field), false, `${arm}.${field} must not be a top-level record field`);
    }
    // Both lists are non-empty. `coderabbit`'s was deliberately `[]` until its
    // adapter existed, and an empty list is indistinguishable from "this arm has
    // no fields of its own" — which was never true of it.
    assert.ok(fields.length > 0, `ARM_ONLY_FIELDS.${arm} is empty`);
  }
});

test("gatingCensus counts every value and carries its n", () => {
  const rs = [
    record({ severity: "critical", file: "a.mjs", summary: "1", lane: "blocking" }),
    record({ severity: "critical", file: "a.mjs", summary: "2", lane: "backlog" }),
    record({ severity: "critical", file: "a.mjs", summary: "3" }),
    record({ severity: "nit", file: "a.mjs", summary: "4" }),
  ];
  const c = gatingCensus(rs);
  assert.equal(c.n, 4);
  assert.deepEqual(c.gating, { gates: 1, "does-not-gate": 2, unknown: 1, "not-applicable": 0 });
  assert.deepEqual(c.basis, { "lane-blocking": 1, "lane-backlog": 1, "lane-absent": 1, "non-blocking-severity": 1 });
  assert.deepEqual(gatingCensus([]).gating, { gates: 0, "does-not-gate": 0, unknown: 0, "not-applicable": 0 });
  assert.equal(gatingCensus(null).n, 0);
});
