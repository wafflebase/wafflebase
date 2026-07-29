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

// --- demoted (novelty-gate) rendering ----------------------------------------

test("renderSummaryMd: demoted findings are reported but do not affect the header", () => {
  // The header must count what GATES. Counting demoted findings would print
  // "❌ 1 blocking" above a check the panel concluded green — the same
  // contradiction the `advisory` flag exists to prevent, one level down.
  const md = renderSummaryMd("Correctness review", [{ severity: "minor", file: "a.mjs", summary: "small" }], "", {
    demoted: [{ severity: "critical", file: "moved.mjs", summary: "old bug in moved code" }],
  });
  assert.match(md, /approved/);
  assert.doesNotMatch(md, /changes requested/);
  assert.match(md, /Relocated code — not written by this change \(1, not blocking\)/);
  assert.match(md, /old bug in moved code/); // still reported, not vanished
});

test("renderSummaryMd: a demotion prints the evidence that makes it auditable", () => {
  const md = renderSummaryMd("R", [], "", {
    demoted: [
      { summary: "a", novelty: { alsoAt: "abc123:old.mjs:42" } },
      { summary: "b", novelty: { contentSha: "fd374623f5aa", alsoAt: null } },
    ],
  });
  assert.match(md, /this line already exists at `abc123:old\.mjs:42`/);
  assert.match(md, /content dates to `fd374623f`/);
});

test("renderSummaryMd: a demotion with no established proof asserts nothing", () => {
  // An audit line that can be false is worse than none — its whole job is to let
  // a reader check the demotion.
  const md = renderSummaryMd("R", [], "", { demoted: [{ summary: "unproven", novelty: {} }] });
  // The bullet is rendered with NO proof clause appended after it.
  assert.match(md, /^- unproven$/m);
  assert.doesNotMatch(md, /content dates to/);
  assert.doesNotMatch(md, /already exists at/);
});

test("renderSummaryMd: no demoted findings renders no demoted section at all", () => {
  const plain = renderSummaryMd("R", [{ severity: "minor", summary: "x" }], "");
  assert.doesNotMatch(plain, /Relocated code/);
  assert.doesNotMatch(renderSummaryMd("R", [], "", { demoted: [] }), /Relocated code/);
  // Junk entries are ignored rather than rendered as empty bullets.
  assert.doesNotMatch(renderSummaryMd("R", [], "", { demoted: [null, 42] }), /Relocated code/);
});
