import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSeverity, classify, renderSummaryMd, normalizeFindings } from "./severity.mjs";

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

test("normalizeFindings: preserves orchestrator-added fields, not just the four it names", () => {
  // Regression. This used to rebuild each finding as exactly
  // {severity,file,summary,evidence}, which silently dropped everything the
  // orchestrator annotates AFTER the lens produced it. renderSummaryMd renders
  // from classify()'s output, so the "verifier could not settle this" marker
  // shipped in the absence-claims change never appeared in a single check body —
  // the field was gone before the renderer looked for it.
  const [out] = normalizeFindings([
    { severity: "weird", file: "a.mjs", summary: "s", evidence: "e",
      unsettled: true, lane: "blocking", claimType: "absence",
      novelty: { origin: "introduced" }, mergedFrom: [{ severity: "major", summary: "other wording" }] },
  ]);
  assert.equal(out.severity, "major"); // still coerced
  assert.equal(out.unsettled, true);
  assert.equal(out.lane, "blocking");
  assert.equal(out.claimType, "absence");
  assert.deepEqual(out.novelty, { origin: "introduced" });
  assert.equal(out.mergedFrom.length, 1);
  // Junk entries still normalize to a blocking placeholder rather than throwing.
  assert.equal(normalizeFindings([null, 42])[0].severity, "major");
});

test("renderSummaryMd: an unsettled finding is marked, and merged wordings are shown", () => {
  // The end-to-end version of the above: both annotations must survive
  // classify() and reach the rendered body.
  const md = renderSummaryMd("R", [
    { severity: "major", file: "a.mjs", summary: "unsettled one", unsettled: true },
    { severity: "major", file: "b.mjs", summary: "kept wording",
      mergedFrom: [{ severity: "major", summary: "folded wording" }] },
  ], "");
  assert.match(md, /verifier could not settle this/);
  assert.match(md, /also reported as \(1\)/);
  assert.match(md, /folded wording/);
});

test("renderSummaryMd: a verifier outage is stated above the findings", () => {
  // On #592 a 429 session limit made every verifier session throw. Findings are
  // kept when verification fails, so the body read as a full 40-finding review
  // with nothing indicating the filter never ran. The note goes ABOVE the
  // findings because it changes how all of them should be read.
  const findings = [{ severity: "critical", file: "a.mjs", summary: "looks real" }];
  const md = renderSummaryMd("R", findings, "body text", { unverified: { errored: 40, sent: 40 } });
  assert.match(md, /verifier did not run on 40 of 40/);
  assert.match(md, /UNFILTERED rather than confirmed/);
  // Ordering: the warning precedes the summary text and the first finding.
  assert.ok(md.indexOf("verifier did not run") < md.indexOf("body text"));
  assert.ok(md.indexOf("verifier did not run") < md.indexOf("looks real"));
  // The conclusion is untouched — an outage keeps findings, so it still blocks.
  assert.match(md, /changes requested/);
});

test("renderSummaryMd: no note when verification ran, or when the count is zero", () => {
  const findings = [{ severity: "major", file: "a.mjs", summary: "s" }];
  for (const unverified of [null, undefined, { errored: 0, sent: 12 }]) {
    const md = renderSummaryMd("R", findings, "b", { unverified });
    assert.doesNotMatch(md, /verifier did not run/, JSON.stringify(unverified));
  }
  // Byte-identical to the no-option call, so the common path is unchanged.
  assert.equal(renderSummaryMd("R", findings, "b", { unverified: null }), renderSummaryMd("R", findings, "b"));
});

// --- the fixer-prompt cut contract -----------------------------------------
//
// agent-review-panel.yml's "Gather failing lens findings" step hands each lens
// body to the fixer as <panel-findings>, cut at the FIRST "\n### " so the fixer
// gets the verdict and the narration but NO findings — its work list is the
// separately-filtered checklist. That cut lives in YAML and cannot be unit
// tested, so the invariant it rests on is pinned here, in the module that
// renders the thing being cut: nothing above the first "\n### " may be a
// finding, and every finding section must begin with exactly that marker.

test("renderSummaryMd: the fixer cuts this body at the first '### ' — nothing above it may be a finding", () => {
  const md = renderSummaryMd(
    "R",
    [
      { severity: "critical", file: "a.mjs", summary: "CRIT_MARKER" },
      { severity: "major", file: "b.mjs", summary: "MAJOR_MARKER" },
      { severity: "minor", file: "c.mjs", summary: "MINOR_MARKER" },
      { severity: "nit", file: "d.mjs", summary: "NIT_MARKER" },
    ],
    "lens narration",
    { demoted: [{ summary: "DEMOTED_MARKER", novelty: {} }], unverified: { errored: 1, sent: 2 } },
  );
  const prose = md.split("\n### ")[0];
  // Kept: the verdict header, the verifier-outage warning, the lens's narration.
  assert.match(prose, /changes requested/);
  assert.match(prose, /verifier did not run on 1 of 2/);
  assert.match(prose, /lens narration/);
  // Dropped: every finding at every severity, and the demoted section. The
  // blocking ones go too — they reach the fixer through the checklist instead,
  // already filtered to critical/major and non-backlog.
  for (const marker of ["CRIT_MARKER", "MAJOR_MARKER", "MINOR_MARKER", "NIT_MARKER", "DEMOTED_MARKER"]) {
    assert.ok(!prose.includes(marker), `${marker} survived the cut`);
  }
});

test("renderSummaryMd: every '###' it emits is a section marker the cut can find", () => {
  const md = renderSummaryMd(
    "R",
    [
      { severity: "critical", summary: "c" },
      { severity: "major", summary: "m" },
      { severity: "minor", summary: "n" },
      { severity: "nit", summary: "t" },
    ],
    "prose",
    { demoted: [{ summary: "d", novelty: {} }] },
  );
  // Four severity sections + the demoted one, each introduced by "\n### ".
  assert.equal(md.split("\n### ").length, 6);
  // And NO other "###" anywhere — one not at a line start, or written as "####",
  // would sit above the split point and carry a finding across it.
  assert.equal((md.match(/###/g) || []).length, 5);
});

test("renderSummaryMd: a '### ' inside the lens's own prose cuts early but still leaks no finding", () => {
  // `summaryText` is the lens's own narration, so it can contain anything —
  // including a markdown heading. That cuts the body earlier than intended,
  // which costs context but never leaks a finding, because every finding is
  // rendered strictly after `summaryText`. Pinned so the failure direction
  // stays the safe one.
  const md = renderSummaryMd("R", [{ severity: "critical", summary: "CRIT_MARKER" }], "intro\n### Notes\nmore");
  const prose = md.split("\n### ")[0];
  assert.match(prose, /intro/);
  assert.ok(!prose.includes("CRIT_MARKER"));
});
