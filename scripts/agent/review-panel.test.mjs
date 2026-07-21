import { test } from "node:test";
import assert from "node:assert/strict";
import {
  globToRegExp,
  lensApplies,
  dedupeFindings,
  applyVerifications,
} from "./review-panel.mjs";

test("globToRegExp / lensApplies: ** always; path globs match & reject", () => {
  assert.ok(globToRegExp("**").test("packages/frontend/src/x.ts"));
  assert.ok(globToRegExp("packages/frontend/**").test("packages/frontend/src/a.ts"));
  assert.ok(!globToRegExp("packages/frontend/**").test("packages/backend/a.ts"));
  assert.equal(lensApplies({ appliesWhen: ["**"] }, []), true);
  assert.equal(lensApplies({ appliesWhen: ["packages/frontend/**"] }, ["packages/frontend/a.ts"]), true);
  // a lens that does NOT apply
  assert.equal(lensApplies({ appliesWhen: ["packages/frontend/**"] }, ["packages/backend/a.ts"]), false);
});

test("dedupeFindings: by file + case-insensitive summary", () => {
  const out = dedupeFindings([
    { file: "a.ts", summary: "Bug X" },
    { file: "a.ts", summary: "bug x" },
    { file: "b.ts", summary: "Bug X" },
  ]);
  assert.equal(out.length, 2);
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
