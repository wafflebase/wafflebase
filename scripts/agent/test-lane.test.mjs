// Do the tests in this directory actually RUN in CI?
//
// They once did not. `verify-self.mjs`'s `agent:tests` lane was
// `cd scripts/agent && node --test *.test.mjs` — a FLAT shell glob, which matches
// nothing in a subdirectory. A test file added there would have been written,
// passed locally, and then never run again: green CI, an untested module, and no
// symptom anywhere. So the lane's own command is read out of `verify-self.mjs`
// and checked against the test files that exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VERIFY_SELF = path.join(AGENT_DIR, "..", "verify-self.mjs");

function laneCmd() {
  const src = readFileSync(VERIFY_SELF, "utf8");
  const lane = /name:\s*"agent:tests",\s*cmd:\s*"([^"]+)"/.exec(src);
  assert.ok(lane, "no agent:tests lane in verify-self.mjs — if it was renamed, re-point this test rather than deleting it");
  return lane[1];
}

/** Every `*.test.mjs` under `scripts/agent`, at any depth, skipping `node_modules`. */
function agentTestFiles(dir = AGENT_DIR, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) agentTestFiles(abs, out);
    else if (e.isFile() && e.name.endsWith(".test.mjs")) out.push(path.relative(AGENT_DIR, abs));
  }
  return out;
}

test("the agent:tests lane runs every test file under scripts/agent, at every depth", () => {
  const cmd = laneCmd();
  assert.match(cmd, /^cd scripts\/agent && /, `the lane no longer runs from scripts/agent: ${cmd}`);
  const invocations = cmd.split(/&&|;/).map((p) => p.trim()).filter((p) => p.startsWith("node "));
  assert.equal(invocations.length, 1, `expected one node invocation in the lane: ${cmd}`);
  // SINGLE-QUOTED and recursive, so NODE expands it: node's globber matches every
  // depth and skips `node_modules`, where the `deps` job runs `npm ci`. An
  // unquoted `**` would be expanded by `sh`, which does neither.
  const glob = /--test\s+'([^']+)'\s*$/.exec(invocations[0]);
  assert.ok(glob, `the lane must hand node one single-quoted glob: ${invocations[0]}`);
  const files = agentTestFiles();
  assert.ok(files.length >= 20, `expected the agent test files to be found, got ${files.length}`);
  for (const file of files) {
    assert.ok(path.matchesGlob(file, glob[1]), `${file} is not matched by the lane glob ${glob[1]} — it would never run in CI`);
  }
});

test("the timeout flag comes before --test", () => {
  const cmd = laneCmd();
  assert.match(cmd, /--test-timeout=\d+/, "the lane needs a per-test timeout");
  // After `--test`, node reads it as a file to run.
  assert.ok(cmd.indexOf("--test-timeout=") < cmd.indexOf("--test "), `the timeout flag comes after --test: ${cmd}`);
});

test("the agent:tests lane does NOT force-exit the runner", () => {
  // `--test-force-exit` exits once the tests are known to have finished, without
  // waiting for the per-file child results to finish arriving — so whole files'
  // results were dropped and the lane still printed `# fail 0`. See the comment
  // above the lane in verify-self.mjs.
  assert.doesNotMatch(laneCmd(), /--test-force-exit/, "--test-force-exit silently truncates this lane's report");
});

// --- every github-script step must retry transient GitHub errors -------------

test("every agent workflow's github-script steps set retries", () => {
  // `actions/github-script` defaults to ZERO retries, so one transient 5xx
  // anywhere in the loop is fatal. On 2026-08-17 a ~4-minute GitHub outage
  // (`503 No server is currently available`) killed three review-panel runs
  // inside "Post per-lens check runs", discarding reviews already paid for —
  // $60.94 of agent effort on #863 alone.
  //
  // It also failed the `stalled` job's "Page a human" on #867, so that PR got no
  // page, no paged latch and no label change: it stopped silently in
  // `agent:reviewing` with nothing to re-trigger it. The safety net shares the
  // dependency it guards, which is exactly why the retry has to be everywhere
  // rather than only on the step that happened to fail.
  //
  // Asserted rather than documented because the DEFAULT is the dangerous value:
  // a newly added step inherits zero retries and nothing complains.
  const dir = path.join(AGENT_DIR, "..", "..", ".github", "workflows");
  const files = readdirSync(dir).filter((f) => f.startsWith("agent-") && f.endsWith(".yml"));
  assert.ok(files.length > 0, "no agent-*.yml workflows found — re-point this test rather than deleting it");

  const missing = [];
  let checked = 0;
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), "utf8");
    // Walk line-wise: find each github-script `uses:`, then require a `retries:`
    // before the step ends (the next line at or above the `uses:` indentation
    // that starts a new key or a new list item).
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*uses:\s*actions\/github-script@/.test(lines[i])) continue;
      checked++;
      const indent = lines[i].search(/\S/);
      let hasRetries = false;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === "" || /^\s*#/.test(l)) continue;
        const ind = l.search(/\S/);
        if (ind <= indent && /^\s*-\s/.test(l)) break; // next step
        if (ind < indent) break; // dedented out of the step
        // `retries: 0` is the DEFAULT and the dangerous value, so a bare digit is
        // not enough — it has to be at least one. Verified by mutation.
        const m = /^\s*retries:\s*(\d+)\s*$/.exec(l);
        if (m) { hasRetries = Number(m[1]) >= 1; break; }
      }
      if (!hasRetries) missing.push(`${f}:${i + 1}`);
    }
  }
  assert.equal(
    missing.length,
    0,
    `github-script steps without \`retries\` (one transient 5xx kills the loop): ${missing.join(", ")}`,
  );
  assert.ok(checked >= 30, `expected to inspect the whole fleet, only saw ${checked} steps`);
});
