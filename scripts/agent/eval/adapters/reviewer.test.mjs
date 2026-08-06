// `adapters/reviewer.mjs` has never had a test file, and it owns the subprocess
// contract with the review panel. This is that file.
//
// EVERY TEST HERE DRIVES A REAL SUBPROCESS and none of them costs anything, because
// `panelScript` is injected: `stub-panel.mjs` writes canned output and exits with a
// code the test chose. That is what makes the five defects directly assertable
// rather than reasoned about — each one is a property of what the panel wrote and
// what it exited with.
//
// The five, one test each, named for what they prevent:
//   1. the lane survives   — the whole finding is copied, never rebuilt
//   2. the exit code       — a non-zero exit cannot be dropped
//   3. the gate self-report— the panel's own state is read, not logged
//   4. missing output      — no `panel.json` is not "found nothing"
//   5. latency             — wall-clock comes from review-timing.json
// Plus the flags the stub ACTUALLY received, which is how "6/6 flags match
// upstream" stops being a point-in-time audit result.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIFF_CONTENT_STATES,
  GATE_STATES,
  PANEL_FLAGS,
  PANEL_OUTPUT_FILES,
  parseGateState,
  reviewerAdapter,
} from "./reviewer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(HERE, "stub-panel.mjs");
const REAL_PANEL = path.join(HERE, "..", "..", "review-panel.mjs");

const DIFF = [
  "diff --git a/scripts/agent/x.mjs b/scripts/agent/x.mjs",
  "--- a/scripts/agent/x.mjs",
  "+++ b/scripts/agent/x.mjs",
  "@@ -1,2 +1,2 @@",
  "-const a = 1;",
  "+const a = 2;",
  "",
].join("\n");

const ITEM = { diff: DIFF, changedFiles: ["scripts/agent/x.mjs"], issueSpec: null };

/** Run the stub panel through the real adapter, with `spec` driving the stub. */
async function replay(spec = {}, { item = ITEM, env = {}, baseSha = null } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "reviewer-adapter-test-"));
  const specPath = path.join(work, "spec.json");
  writeFileSync(specPath, JSON.stringify(spec));
  const adapter = reviewerAdapter({ panelScript: STUB });
  const inputs = adapter.prepareInput(item, work);
  const ran = await adapter.runAgent(inputs, {
    lensesDir: path.join(work, "lenses"),
    outDir: path.join(work, "out"),
    repoDir: path.join(work, "repo"),
    env: { ...process.env, STUB_PANEL_SPEC: specPath, ...env },
    baseSha,
  });
  return { work, inputs, ran, cap: adapter.captureArtifacts(ran), cleanup: () => rmSync(work, { recursive: true, force: true }) };
}

const argvOf = (work) => JSON.parse(readFileSync(path.join(work, "out", "stub-argv.json"), "utf8"));

test("an adapter with no panel script is refused — the panel is injected so tests are free", () => {
  for (const bad of [undefined, null, "", "  ", 42]) {
    assert.throws(() => reviewerAdapter(typeof bad === "object" ? bad : { panelScript: bad }), /panelScript is required/);
  }
});

test("the six flags upstream accepts are the six flags the panel receives", async () => {
  const r = await replay({}, { baseSha: "a".repeat(40) });
  try {
    const argv = argvOf(r.work);
    // Asserted against what the CHILD saw, not against the array the adapter built:
    // an audit can re-derive the second, only a subprocess proves the first.
    for (const flag of Object.values(PANEL_FLAGS)) {
      if (flag === PANEL_FLAGS.issueFile) continue; // this item closes no issue
      assert.ok(argv.includes(flag), `the panel was not passed ${flag}: ${argv.join(" ")}`);
    }
    assert.equal(argv[argv.indexOf(PANEL_FLAGS.diffFile) + 1], r.inputs.diffFile);
    assert.equal(argv[argv.indexOf(PANEL_FLAGS.baseSha) + 1], "a".repeat(40));
    // Every flag upstream's usage block lists is one this adapter knows. If the
    // panel grows a behaviour-determining flag, this is the reminder.
    const usage = readFileSync(REAL_PANEL, "utf8").slice(0, 4000);
    for (const flag of Object.values(PANEL_FLAGS)) {
      assert.ok(usage.includes(flag), `${flag} is no longer in review-panel.mjs's usage block`);
    }
  } finally {
    r.cleanup();
  }
});

test("--issue-file is passed only when the item closes an issue, and an empty spec is not one", async () => {
  const withIssue = await replay({}, { item: { ...ITEM, issueSpec: "# Fix the thing\n" } });
  try {
    assert.ok(argvOf(withIssue.work).includes(PANEL_FLAGS.issueFile));
    assert.ok(existsSync(path.join(withIssue.work, "issue-spec.md")));
  } finally {
    withIssue.cleanup();
  }
  // `null` and `""` and whitespace all mean "this PR closed no issue". Writing an
  // empty file would make a `needsIssueSpec` lens unable to tell that from an issue
  // whose body was blank, which is the distinction the store keeps as `null`.
  for (const spec of [null, "", "   \n"]) {
    const r = await replay({}, { item: { ...ITEM, issueSpec: spec } });
    try {
      assert.ok(!argvOf(r.work).includes(PANEL_FLAGS.issueFile), `an issueSpec of ${JSON.stringify(spec)} produced --issue-file`);
      assert.equal(existsSync(path.join(r.work, "issue-spec.md")), false);
    } finally {
      r.cleanup();
    }
  }
});

test("an empty diff is refused before the panel is spawned — the panel fails closed on one anyway", () => {
  const adapter = reviewerAdapter({ panelScript: STUB });
  const work = mkdtempSync(path.join(tmpdir(), "reviewer-adapter-test-"));
  try {
    for (const diff of [undefined, null, "", "   \n"]) {
      assert.throws(() => adapter.prepareInput({ ...ITEM, diff }, work), /empty diff/);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// --- defect 1: the lane is computed and then thrown away ---------------------

test("DEFECT 1: a finding's lane and novelty survive the adapter — it widens, never narrows", async () => {
  const r = await replay({
    lenses: [
      {
        id: "correctness",
        findings: [
          {
            severity: "major",
            file: "scripts/agent/x.mjs",
            summary: "the retry loop can spin forever",
            evidence: "x.mjs:41 has no ceiling",
            // The two fields the old four-field rebuild deleted. `lane` rests on a
            // `git blame` of the tree under review, so it CANNOT be recovered
            // later — that tree is gone after merge.
            lane: "backlog",
            novelty: { origin: "relocated", basis: "blame", line: 41 },
            unsettled: true,
            // And a field nothing in this repository has heard of yet, because the
            // rule is "copy the whole finding", not "copy the fields we know".
            future_annotation: { added_by: "a PR that does not exist yet" },
          },
        ],
      },
    ],
  });
  try {
    assert.equal(r.cap.payload.findings.length, 1);
    const f = r.cap.payload.findings[0];
    assert.equal(f.lane, "backlog", "the lane was dropped — this is audit site A2, and PR 6 cannot compensate for it");
    assert.deepEqual(f.novelty, { origin: "relocated", basis: "blame", line: 41 });
    assert.equal(f.unsettled, true);
    assert.deepEqual(f.future_annotation, { added_by: "a PR that does not exist yet" });
    assert.equal(f.lens, "correctness");
  } finally {
    r.cleanup();
  }
});

test("the lens that raised a finding comes from the verdict directory, not from the finding", async () => {
  // `stampLens` documents why: a finding is model output, nothing rejects an extra
  // key, "so a fill-the-blank rule would let a finding declare which lens raised
  // it." The directory the verdict was read from is the authority.
  const r = await replay({
    lenses: [{ id: "security", findings: [{ severity: "critical", file: "a.mjs", summary: "spoofed", lens: "correctness" }] }],
  });
  try {
    assert.equal(r.cap.payload.findings[0].lens, "security");
  } finally {
    r.cleanup();
  }
});

// --- defect 2: the exit code is discarded ------------------------------------

test("DEFECT 2: a panel that exits non-zero after writing valid output reports its exit code", async () => {
  const r = await replay({ exitCode: 1 });
  try {
    assert.equal(r.ran.code, 1);
    assert.equal(r.cap.exitCode, 1, "the exit code did not reach the capture — a crashed panel would be stored as a real verdict");
    // The output really was valid, which is the point: nothing else about this run
    // says it failed.
    assert.equal(r.cap.panelState, "present");
    assert.equal(r.cap.payload.findings.length, 1);
  } finally {
    r.cleanup();
  }
});

test("captureArtifacts refuses an out directory, so the exit code cannot be dropped again", async () => {
  const r = await replay({ exitCode: 1 });
  try {
    const adapter = reviewerAdapter({ panelScript: STUB });
    // The OLD signature. It has to fail loudly rather than work-but-lose-three-fields,
    // because "the caller assigned none of it" is how defect 2 survived review.
    assert.throws(() => adapter.captureArtifacts(path.join(r.work, "out")), /takes the result of runAgent/);
    assert.throws(() => adapter.captureArtifacts(undefined), /takes the result of runAgent/);
  } finally {
    r.cleanup();
  }
});

test("a panel that cannot be spawned at all is an exit code, not a rejection", async () => {
  const adapter = reviewerAdapter({ panelScript: path.join(HERE, "no-such-panel.mjs") });
  const work = mkdtempSync(path.join(tmpdir(), "reviewer-adapter-test-"));
  try {
    const inputs = adapter.prepareInput(ITEM, work);
    const ran = await adapter.runAgent(inputs, { lensesDir: work, outDir: path.join(work, "out"), repoDir: path.join(work, "repo") });
    const cap = adapter.captureArtifacts(ran);
    assert.notEqual(cap.exitCode, 0);
    assert.equal(cap.panelState, "absent");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// --- defect 3: the gate's own self-report is dropped -------------------------

test("DEFECT 3: the panel's novelty-gate line is parsed into a state, not logged", async () => {
  // No --base-sha: the expected state today, and it must be RECORDED rather than
  // failed on. Without the record a scorer cannot tell a run that had the gate from
  // one that did not, and pooling those two is the error this lane exists to prevent.
  const off = await replay({});
  try {
    assert.equal(off.cap.gate.state, "off-no-base-sha");
    assert.match(off.cap.gate.line, /novelty gate: OFF \(no --base-sha\)/);
    assert.equal(off.cap.baseShaPassed, false);
  } finally {
    off.cleanup();
  }
  // --base-sha passed and the panel still says OFF: the silent-degradation case.
  // The adapter reports it; `run.mjs` is what makes it a hard error.
  const degraded = await replay({ baseResolves: false }, { baseSha: "b".repeat(40) });
  try {
    assert.equal(degraded.cap.gate.state, "off-base-sha-unresolved");
    assert.match(degraded.cap.gate.line, /does not resolve/);
    assert.equal(degraded.cap.baseShaPassed, true);
  } finally {
    degraded.cleanup();
  }
  const on = await replay({}, { baseSha: "c".repeat(40) });
  try {
    assert.equal(on.cap.gate.state, "on");
    assert.equal(on.cap.gate.baseSha, "c".repeat(40));
  } finally {
    on.cleanup();
  }
  // And a panel that says nothing about the gate is `unreported`, never `on`.
  const silent = await replay({ gate: "none" });
  try {
    assert.equal(silent.cap.gate.state, "unreported");
    assert.equal(silent.cap.gate.line, null);
  } finally {
    silent.cleanup();
  }
});

test("parseGateState reads the distinction, not the punctuation", () => {
  assert.equal(parseGateState("novelty gate: OFF (no --base-sha) — every finding routes as before").state, "off-no-base-sha");
  assert.equal(parseGateState("novelty gate: OFF - --base-sha abc1234 does not resolve in /tmp/x").state, "off-base-sha-unresolved");
  assert.equal(parseGateState("novelty gate: on, base abc1234").state, "on");
  // The unresolved line also contains OFF, so the narrower phrase must win.
  assert.equal(parseGateState("novelty gate: OFF — --base-sha deadbeef does not resolve in /r").state, "off-base-sha-unresolved");
  // Surrounding panel chatter does not hide it, and the LAST line wins.
  assert.equal(parseGateState("review scope: incremental\nnovelty gate: on, base abc1234\ncorrectness: success").state, "on");
  for (const nothing of ["", null, undefined, "correctness: success"]) {
    assert.equal(parseGateState(nothing).state, "unreported");
  }
  // A gate line that matches none of the three is `unreported` — claiming the gate
  // ran on an unparseable line is the one answer nothing downstream can recover from.
  assert.equal(parseGateState("novelty gate: something new").state, "unreported");
  for (const s of GATE_STATES) assert.equal(typeof s, "string");
});

// --- defect 4: missing panel output becomes "found nothing" ------------------

test("DEFECT 4: a panel that exits 0 having written no panel.json is not 'found nothing'", async () => {
  const r = await replay({ omit: [PANEL_OUTPUT_FILES.panel] });
  try {
    assert.equal(r.cap.exitCode, 0);
    assert.equal(r.cap.panelState, "absent");
    // `null`, NOT `[]` and NOT `{}`. A clean review really does produce
    // `findings: []`, so failure must not share its shape.
    assert.equal(r.cap.payload.panel, null);
    assert.equal(r.cap.payload.findings, null, "missing panel output read back as zero findings — a free perfect-precision data point");
    assert.equal(r.cap.payload.stageDetail, null);
  } finally {
    r.cleanup();
  }
});

test("a panel.json that is present but not a list is unreadable, not empty", async () => {
  const r = await replay({ omit: [PANEL_OUTPUT_FILES.panel] });
  try {
    const p = path.join(r.work, "out", PANEL_OUTPUT_FILES.panel);
    for (const [bytes, expected] of [["{ not: a list", "unreadable"], ['{"lenses":[]}', "unreadable"], ["[]", "present"]]) {
      writeFileSync(p, bytes);
      const adapter = reviewerAdapter({ panelScript: STUB });
      assert.equal(adapter.captureArtifacts(r.ran).panelState, expected, `panel.json ${bytes} read as ${expected}`);
    }
  } finally {
    r.cleanup();
  }
});

test("a genuinely clean review is [] and says so — the true negative must survive", async () => {
  const r = await replay({ lenses: [{ id: "correctness", findings: [], conclusion: "success" }] });
  try {
    assert.equal(r.cap.panelState, "present");
    assert.deepEqual(r.cap.payload.findings, [], "an empty finding list is a real result, not a failure");
  } finally {
    r.cleanup();
  }
});

// --- defect 5: latency is read from the wrong field --------------------------

test("DEFECT 5: wall-clock comes from review-timing.json, and disagrees with the execution sum", async () => {
  // The stub's execution log sums to 90s of SDK call time; the panel's own timing
  // file says the round took 30s of wall-clock. The panel runs its lenses, samples
  // and verifier calls concurrently, so the sum overcounts by the concurrency
  // factor — #669 measured a ~12-minute panel reported as 36–63.
  const r = await replay({ wallMs: 30000, execution: [{ type: "result", num_turns: 1, duration_ms: 45000, total_cost_usd: 0.1, usage: {} }, { type: "result", num_turns: 1, duration_ms: 45000, total_cost_usd: 0.1, usage: {} }] });
  try {
    assert.equal(r.cap.wallMs, 30000);
    const summed = r.cap.executionMessages.reduce((n, m) => n + m.duration_ms, 0);
    assert.equal(summed, 90000);
    assert.notEqual(r.cap.wallMs, summed, "the capture took the summed value — our own arm's latency would report 3x high");
  } finally {
    r.cleanup();
  }
});

test("an absent review-timing.json is null, never the summed value", async () => {
  const r = await replay({ wallMs: null });
  try {
    assert.equal(existsSync(path.join(r.work, "out", PANEL_OUTPUT_FILES.timing)), false);
    assert.equal(r.cap.wallMs, null, "a missing timing file must not fall back to the sum, which is 3-5x high");
    assert.equal(r.cap.payload.files[PANEL_OUTPUT_FILES.timing], "absent");
  } finally {
    r.cleanup();
  }
});

// --- the routed diff each lens read -----------------------------------------

test("STAGE_DETAIL_DIFF_CONTENT reaches the panel, and the capture is asserted rather than the flag trusted", async () => {
  const lenses = [
    { id: "correctness", lensDiff: "--- a/x.mjs\n+++ b/x.mjs\n", stageDetail: { samples: [[]] } },
    { id: "security", lensDiff: "", stageDetail: { samples: [[]] } },
  ];
  const on = await replay({ lenses }, { env: { STAGE_DETAIL_DIFF_CONTENT: "1" } });
  try {
    // `lensDiff: ""` is a real value — a lens whose file-class slice is empty — so
    // the KEY is what is counted, never the bytes.
    assert.equal(on.cap.payload.stageDetail.security.lensDiff, "");
    assert.deepEqual(on.cap.diffContent, { state: "complete", lensesWithDetail: 2, lensesWithDiff: 2 });
  } finally {
    on.cleanup();
  }
  const off = await replay({ lenses }, { env: { STAGE_DETAIL_DIFF_CONTENT: "" } });
  try {
    assert.equal("lensDiff" in off.cap.payload.stageDetail.correctness, false);
    assert.deepEqual(off.cap.diffContent, { state: "absent", lensesWithDetail: 2, lensesWithDiff: 0 });
  } finally {
    off.cleanup();
  }
  // No capture at all is not the same as a capture missing the diff: there is
  // nothing to over-read, so there is nothing to assert.
  const none = await replay({ lenses: [{ id: "correctness", stageDetail: null }] });
  try {
    assert.equal(none.cap.diffContent.state, "no-capture");
  } finally {
    none.cleanup();
  }
  for (const s of DIFF_CONTENT_STATES) assert.equal(typeof s, "string");
});

test("a lens with no stage detail is skipped rather than keyed empty", async () => {
  const r = await replay({
    lenses: [
      { id: "correctness", stageDetail: { samples: [[]] } },
      { id: "docs", stageDetail: null, applicable: false, conclusion: "skipped" },
    ],
  }, { env: { STAGE_DETAIL_DIFF_CONTENT: "1" } });
  try {
    assert.deepEqual(Object.keys(r.cap.payload.stageDetail), ["correctness"]);
    assert.equal(r.cap.diffContent.lensesWithDetail, 1);
  } finally {
    r.cleanup();
  }
});

test("every one of the panel's six outputs is accounted for by name", async () => {
  const r = await replay({});
  try {
    // Five were already read; `review-timing.json` is the sixth, and not knowing it
    // existed is how latency came to be read from the summed duration.
    for (const name of [PANEL_OUTPUT_FILES.panel, PANEL_OUTPUT_FILES.lensStats, PANEL_OUTPUT_FILES.execution, PANEL_OUTPUT_FILES.timing]) {
      assert.equal(r.cap.payload.files[name], "present", `${name} was not recorded as present`);
    }
    for (const name of Object.values(PANEL_OUTPUT_FILES)) {
      assert.ok(readFileSync(REAL_PANEL, "utf8").includes(name), `review-panel.mjs no longer writes ${name}`);
    }
  } finally {
    r.cleanup();
  }
});
