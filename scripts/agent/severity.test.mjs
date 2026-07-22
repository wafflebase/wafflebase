import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSeverity, classify, renderSummaryMd } from "./severity.mjs";

test("normalizeSeverity: known values pass through, unknown → major (fail-safe)", () => {
  for (const s of ["critical", "major", "minor", "nit"]) assert.equal(normalizeSeverity(s), s);
  assert.equal(normalizeSeverity("MAJOR"), "major");
  assert.equal(normalizeSeverity("bogus"), "major");
  assert.equal(normalizeSeverity(undefined), "major");
});

test("classify: blocks iff a critical/major survives", () => {
  assert.equal(classify([]).conclusion, "success");
  assert.equal(classify([{ severity: "minor" }, { severity: "nit" }]).conclusion, "success");
  assert.equal(classify([{ severity: "major" }]).conclusion, "failure");
  assert.equal(classify([{ severity: "critical" }]).conclusion, "failure");
  // boundary: exactly zero blockers = approved
  const r = classify([{ severity: "minor" }]);
  assert.equal(r.blockingCount, 0);
  assert.equal(r.approved, true);
  // unknown severity is treated as major → blocks
  assert.equal(classify([{ severity: "weird" }]).conclusion, "failure");
});

test("renderSummaryMd: unknown severity is normalized to major and shown (not omitted)", () => {
  const md = renderSummaryMd("Test", [{ severity: "weird", file: "a.ts", summary: "sneaky bug" }], "");
  assert.match(md, /changes requested/); // blocks
  assert.match(md, /1 major/); // counted as major, not zero
  assert.match(md, /### Major \(1\)/); // rendered under Major, not dropped
  assert.match(md, /sneaky bug/); // the finding text appears
});

test("renderSummaryMd: advisory lens with a critical finding does NOT say 'changes requested'", () => {
  const findings = [{ severity: "critical", file: "a.ts", summary: "big issue" }];
  // Non-advisory: a critical finding blocks.
  const gating = renderSummaryMd("Design fit review", findings, "");
  assert.match(gating, /changes requested/);
  // Advisory: check reports success, so the body must not contradict it with ❌.
  const advisory = renderSummaryMd("Design fit review", findings, "", { advisory: true });
  assert.doesNotMatch(advisory, /changes requested/);
  assert.match(advisory, /advisory — not gating/);
  assert.match(advisory, /### Critical \(1\)/); // still lists the finding
  assert.match(advisory, /big issue/);
});
