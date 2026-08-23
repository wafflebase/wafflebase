import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  applyReplayOutcome,
  planVerification,
  renderVerification,
  synthesisePlan,
  verificationFor,
  recordOutcome,
} from "./report-verify.mjs";

const item = (over = {}) => ({
  id: "i1",
  note: "after I merge two cells, undo goes one step short",
  target: { kind: "canvas", surface: "sheet", address: "Sheet1!C7" },
  route: { destination: "verify" },
  ...over,
});

test("a plan is synthesised only when the report names a surface AND an address", () => {
  assert.equal(synthesisePlan(item()).ok, true);
  assert.equal(synthesisePlan(item({ target: { kind: "dom" } })).ok, false);
  assert.equal(
    synthesisePlan(item({ target: { kind: "canvas", surface: "sheet" } })).ok,
    false,
  );
});

test("no actions are invented", () => {
  // A plan whose steps came from a guess would be replayed faithfully and mean
  // nothing.
  const { plan } = synthesisePlan(item());
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.needsHumanSteps, true);
  // The sentence travels with it: the verifier rubric attacks the expectation
  // before the behaviour, and cannot do that without seeing it.
  assert.equal(plan.expectation, item().note);
});

test("a report that cannot become a plan falls to the appearance lane, with a reason", () => {
  const check = verificationFor(item({ target: { kind: "dom" } }));
  assert.equal(check.lane, "appearance");
  assert.match(check.reason, /replays against one/);
});

test("an appearance report skips replay and names the lens", () => {
  const check = verificationFor(item({ route: { destination: "appearance" } }));
  assert.equal(check.lane, "appearance");
  assert.equal(check.lens, "visual-intent");
  assert.match(check.reason, /no prediction and no plan/);
});

test("a duplicate and a thin report need no verification", () => {
  assert.equal(verificationFor(item({ route: { destination: "duplicate" } })).lane, "none");
  assert.equal(verificationFor(item({ route: { destination: "thin" } })).lane, "none");
});

test("a synthesised plan says its steps are missing, instead of claiming replay", () => {
  const check = verificationFor(item(), { reportDir: ".wb-reports/s1" });
  // `synthesisePlan` invents no actions and `hunt-ui` refuses an empty action
  // list, so calling this lane `replay` promised a verification that could not
  // run — and the plan file the command reads was never written by anything.
  assert.equal(check.lane, "replay-pending-steps");
  assert.match(check.reason, /fill in `actions`/);
  assert.ok(check.planFile, "the command must name the file it reads");
  assert.deepEqual(check.command.slice(0, 3), ["node", "./scripts/agent/hunt-ui.mjs", "replay"]);
});

test("a reproduced replay confirms the report", () => {
  const outcome = applyReplayOutcome(item(), { reproduced: true });
  assert.equal(outcome.verified, true);
  assert.equal(outcome.destination, "verify");
});

test("a failed replay LOWERS the destination and keeps both sides", () => {
  // "Not reproduced" is not proof the observation was wrong — the failure where
  // a reader's scope is wider than the action is documented and real.
  const outcome = applyReplayOutcome(item(), { reproduced: false, reason: "no change observed" });
  assert.equal(outcome.destination, "issue");
  assert.equal(outcome.verified, false);
  assert.equal(outcome.expectation, item().note);
  assert.deepEqual(outcome.replay, { reproduced: false, reason: "no change observed" });
});

test("an unevaluable replay is not a refutation", () => {
  const outcome = applyReplayOutcome(item(), { reproduced: null });
  assert.equal(outcome.verified, false);
  assert.match(outcome.note, /could not be evaluated/);
});

test("planVerification counts the lanes and renders them", () => {
  const plan = {
    sessionId: "s1",
    items: [
      item(),
      item({ id: "i2", route: { destination: "appearance" } }),
      item({ id: "i3", route: { destination: "duplicate" } }),
    ],
  };
  const verification = planVerification(plan);
  assert.deepEqual(verification.counts, { "replay-pending-steps": 1, appearance: 1, none: 1 });
  // Always present, because `report-back.mjs` reads it: absent, a failed replay
  // produced no `lowered` entry and the reporter was told it shipped clean.
  assert.deepEqual(verification.outcomes, []);
  const text = renderVerification(verification);
  assert.match(text, /i1 → replay-pending-steps/);
  assert.match(text, /hunt-ui\.mjs replay/);
});

// --- regressions from the PR ④ review ---------------------------------------

test("the plan file a replay command reads is actually written", () => {
  // The command pointed at `<dir>/<itemId>.plan.json` and nothing in the
  // pipeline wrote it, so running the printed command died on ENOENT.
  const dir = mkdtempSync(path.join(tmpdir(), "wb-verify-"));
  const plan = {
    sessionId: "s",
    items: [
      {
        id: "i1",
        note: "after I clicked undo the row came back wrong",
        target: { kind: "canvas", surface: "sheet", address: "Sheet1!C7" },
        route: { destination: "verify" },
      },
    ],
  };
  const planFile = path.join(dir, "plan.json");
  writeFileSync(planFile, JSON.stringify(plan));
  execFileSync(process.execPath, [
    path.join(import.meta.dirname, "report-verify.mjs"),
    "--plan", planFile,
    "--out", path.join(dir, "verified.json"),
    "--dry-run",
  ]);
  const written = JSON.parse(readFileSync(path.join(dir, "i1.plan.json"), "utf8"));
  assert.equal(written.address, "Sheet1!C7");
  assert.equal(written.needsHumanSteps, true);
  rmSync(dir, { recursive: true, force: true });
});

test("recordOutcome folds a replay result in, and a re-run replaces it", () => {
  // `applyReplayOutcome` was reachable only from its own test while the step it
  // implements — "record each result back into verified.json" — was a hand-edit.
  const item = { id: "i1", note: "the row came back wrong" };
  let verified = { sessionId: "s", checks: [], counts: {}, outcomes: [] };
  verified = recordOutcome(verified, item, { reproduced: false, reason: "no change observed" });
  assert.equal(verified.outcomes.length, 1);
  assert.equal(verified.outcomes[0].verified, false);
  verified = recordOutcome(verified, item, { reproduced: true });
  assert.equal(verified.outcomes.length, 1, "a re-run replaces rather than appends");
  assert.equal(verified.outcomes[0].verified, true);
});
