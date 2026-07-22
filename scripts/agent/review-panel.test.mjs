import { test } from "node:test";
import assert from "node:assert/strict";
import {
  globToRegExp,
  lensApplies,
  dedupeFindings,
  applyVerifications,
  coerceFindings,
  unionSamples,
  parsePriorFindings,
} from "./review-panel.mjs";
import { classify } from "./severity.mjs";

test("globToRegExp / lensApplies: ** always; path globs match & reject", () => {
  assert.ok(globToRegExp("**").test("packages/frontend/src/x.ts"));
  assert.ok(globToRegExp("packages/frontend/**").test("packages/frontend/src/a.ts"));
  assert.ok(!globToRegExp("packages/frontend/**").test("packages/backend/a.ts"));
  assert.equal(lensApplies({ appliesWhen: ["**"] }, []), true);
  assert.equal(lensApplies({ appliesWhen: [] }, []), true); // empty array = wildcard default
  assert.equal(lensApplies({ appliesWhen: ["packages/frontend/**"] }, ["packages/frontend/a.ts"]), true);
  // a lens that does NOT apply
  assert.equal(lensApplies({ appliesWhen: ["packages/frontend/**"] }, ["packages/backend/a.ts"]), false);
});

test("coerceFindings: malformed findings are KEPT and block (never silently dropped)", () => {
  // a critical finding with a non-string summary must still block, not vanish
  assert.equal(classify(coerceFindings([{ severity: "critical", summary: {} }])).conclusion, "failure");
  assert.equal(classify(coerceFindings([{ severity: "critical", summary: null }])).conclusion, "failure");
  // non-object entries → synthetic blocking findings
  assert.equal(classify(coerceFindings([null, 42, "x"])).conclusion, "failure");
  // a non-array lens output → one synthetic blocking finding (not an empty pass)
  const na = coerceFindings("not an array");
  assert.equal(na.length, 1);
  assert.equal(classify(na).conclusion, "failure");
  // well-formed non-blocking findings pass through untouched
  const clean = coerceFindings([{ severity: "nit", file: "a.ts", summary: "style" }]);
  assert.deepEqual(clean, [{ severity: "nit", file: "a.ts", summary: "style" }]);
  assert.equal(classify(clean).conclusion, "success");
});

test("dedupeFindings: by file + case-insensitive summary", () => {
  const out = dedupeFindings([
    { file: "a.ts", summary: "Bug X" },
    { file: "a.ts", summary: "bug x" },
    { file: "b.ts", summary: "Bug X" },
  ]);
  assert.equal(out.length, 2);
});

test("dedupeFindings: a collision keeps the HIGHEST severity, order-independent", () => {
  const nit = { severity: "nit", file: "a.ts", summary: "same text" };
  const crit = { severity: "critical", file: "a.ts", summary: "same text" };
  // whichever order they arrive in, the critical must survive the collision
  assert.equal(dedupeFindings([nit, crit])[0].severity, "critical");
  assert.equal(dedupeFindings([crit, nit])[0].severity, "critical");
  assert.equal(dedupeFindings([nit, crit]).length, 1);
});

// Regression: the fail-open the reviewer found — main() is the ONLY place
// coerceFindings and dedupeFindings compose, so test the composition, not the
// helpers in isolation. A colliding critical must not be masked by a nit.
test("coerceFindings + dedupeFindings (main pipeline): a critical is never masked", () => {
  const pipeline = (raw) => classify(dedupeFindings(coerceFindings(raw)));
  // malformed path: coercion rewrites both summaries to the same placeholder
  assert.equal(pipeline([{ severity: "nit", summary: {} }, { severity: "critical", summary: {} }]).conclusion, "failure");
  // well-formed path: same file+summary at two severities (ordinary model output)
  assert.equal(
    pipeline([
      { severity: "nit", file: "a.ts", summary: "Unvalidated input on the auth path" },
      { severity: "critical", file: "a.ts", summary: "Unvalidated input on the auth path" },
    ]).conclusion,
    "failure",
  );
});

test("unionSamples: union across N samples; recall gained, dups collapse fail-toward-blocking", () => {
  // Part 1: sample A finds X; sample B finds X (same) + Y (new) → union {X, Y}.
  const a = { findings: [{ severity: "major", file: "a.ts", summary: "X" }] };
  const b = { findings: [{ severity: "major", file: "a.ts", summary: "X" }, { severity: "critical", file: "b.ts", summary: "Y" }] };
  const u = unionSamples([a, b]);
  assert.equal(u.length, 2); // X deduped, Y added (recall from sampling)
  assert.ok(u.some((f) => f.summary === "Y" && f.severity === "critical"));
  // same finding at two severities across samples → highest wins (fail toward blocking)
  const s1 = { findings: [{ severity: "nit", file: "a.ts", summary: "Z" }] };
  const s2 = { findings: [{ severity: "critical", file: "a.ts", summary: "Z" }] };
  const uz = unionSamples([s1, s2]);
  assert.equal(uz.length, 1);
  assert.equal(uz[0].severity, "critical");
  // failed samples (null / {__error}) contribute nothing; a well-formed one still counts
  assert.equal(unionSamples([null, { __error: "boom" }, a]).length, 1);
  assert.equal(unionSamples([]).length, 0);
});

test("parsePriorFindings: tolerant — valid array round-trips, junk → []", () => {
  const recs = [{ lens: "correctness", severity: "major", file: "a.ts", summary: "prior" }];
  assert.deepEqual(parsePriorFindings(JSON.stringify(recs)), recs);
  assert.deepEqual(parsePriorFindings(""), []);
  assert.deepEqual(parsePriorFindings("not json"), []);
  assert.deepEqual(parsePriorFindings('{"not":"an array"}'), []);
  // non-object entries are dropped
  assert.deepEqual(parsePriorFindings('[null, 3, {"severity":"major","summary":"ok"}]'), [{ severity: "major", summary: "ok" }]);
});

// Part 2: a prior blocking finding that this round's fresh pass MISSED must
// still block after being re-checked (verifier didn't refute it) and merged.
// This is the #521 false-negative, guarded at the composition level.
test("cross-round merge: an unresolved prior finding the fresh pass missed still blocks", () => {
  const freshKept = []; // this round's lens returned nothing (missed it)
  const priorForLens = [{ lens: "correctness", severity: "major", file: "s.ts", summary: "MIN/MAX all-blank returns #NUM!" }];
  // re-check couldn't refute it (null verdict = kept, biased-to-block)
  const priorKept = applyVerifications(priorForLens, [null]);
  const merged = dedupeFindings([...freshKept, ...priorKept]);
  assert.equal(merged.length, 1);
  assert.equal(classify(merged).conclusion, "failure");
  // but if the re-check confidently refutes it (genuinely resolved) → dropped
  const resolved = applyVerifications(priorForLens, [{ verdict: "refuted", confidence: "high" }]);
  assert.equal(classify(dedupeFindings([...freshKept, ...resolved])).conclusion, "success");
});

test("applyVerifications: drops ONLY on high-confidence refuted; keeps on any doubt", () => {
  const F = [{ severity: "critical", summary: "c" }, { severity: "major", summary: "m" }, { severity: "minor", summary: "n" }];
  const keptSummaries = (verdicts) => applyVerifications(F, verdicts).map((f) => f.summary);
  // high-confidence refuted → dropped
  assert.ok(!keptSummaries([{ verdict: "refuted", confidence: "high" }, null, null]).includes("c"));
  // low-confidence refuted → KEPT (uncertainty)
  assert.ok(keptSummaries([{ verdict: "refuted", confidence: "low" }, null, null]).includes("c"));
  // confirmed → kept
  assert.ok(keptSummaries([{ verdict: "confirmed", confidence: "high" }, null, null]).includes("c"));
  // null (verifier error) → kept
  assert.ok(keptSummaries([null, null, null]).includes("c"));
  // malformed (no confidence) → kept
  assert.ok(keptSummaries([{ verdict: "refuted" }, null, null]).includes("c"));
  // non-blocking (minor) is never verified/dropped
  assert.ok(keptSummaries([null, null, { verdict: "refuted", confidence: "high" }]).includes("n"));
});
