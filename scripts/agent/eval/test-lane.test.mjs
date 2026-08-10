// Do the tests in this directory actually RUN in CI?
//
// They did not. `verify-self.mjs`'s `agent:tests` lane was
// `cd scripts/agent && node --test *.test.mjs` — a FLAT shell glob, which matches
// nothing inside `eval/`. Every test file added here would have been written,
// passed locally, and then never run again: green CI, an untested subsystem, and
// no symptom anywhere. That is this project's signature failure (something looks
// covered and is not), and it is worth one file to make it impossible.
//
// So the lane's own glob is read out of `verify-self.mjs` and matched against the
// test files that exist. The check is deliberately not "the lane contains the
// string `eval/`": PR 5 adds `eval/adapters/reviewer.test.mjs`, and a lane that
// covers `eval/*.test.mjs` but not `eval/adapters/` would pass a string check and
// still skip a suite. Matching real paths against the real pattern covers every
// depth without anyone having to remember to update this file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.join(HERE, "..");
const VERIFY_SELF = path.join(AGENT_DIR, "..", "verify-self.mjs");

/**
 * The glob patterns the `agent:tests` lane hands to `node --test`.
 *
 * The lane is the ONLY thing that runs these suites in CI: `scripts/agent` is a
 * standalone npm package outside the pnpm workspace, so `pnpm verify:fast` never
 * reaches it (the comment above the lane says so).
 */
function lanePatterns() {
  const src = readFileSync(VERIFY_SELF, "utf8");
  const lane = /name:\s*"agent:tests",\s*cmd:\s*"([^"]+)"/.exec(src);
  assert.ok(lane, "no agent:tests lane in verify-self.mjs — if it was renamed, re-point this test rather than deleting it");
  const cmd = lane[1];
  assert.match(cmd, /^cd scripts\/agent && /, `the lane no longer runs from scripts/agent: ${cmd}`);
  const args = /--test\s+(.+)$/.exec(cmd);
  assert.ok(args, `no --test patterns in the lane: ${cmd}`);
  // The patterns are single-quoted in the lane so `sh` passes them through
  // untouched and NODE expands them. That matters: node's own glob skips
  // `node_modules`, and the `deps` job does an `npm ci` right here.
  return args[1].split(/\s+/).map((p) => p.replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

/** Every `*.test.mjs` under `eval/`, at any depth, relative to `scripts/agent`. */
function evalTestFiles(dir = HERE, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) evalTestFiles(abs, out);
    else if (e.isFile() && e.name.endsWith(".test.mjs")) out.push(path.relative(AGENT_DIR, abs));
  }
  return out;
}

test("the agent:tests lane runs every test file under eval/, at every depth", () => {
  const patterns = lanePatterns();
  const files = evalTestFiles();
  assert.ok(files.length >= 3, `expected the eval test files to be found, got ${JSON.stringify(files)}`);
  for (const file of files) {
    assert.ok(
      patterns.some((p) => path.matchesGlob(file, p)),
      `${file} is not matched by the agent:tests lane (${patterns.join(" ")}) — it would never run in CI`,
    );
  }
});

test("and the lane still runs the flat suites it always ran", () => {
  // The panel's safety-critical suites live directly in `scripts/agent`. Widening
  // the glob to reach `eval/` must not narrow it away from them.
  const patterns = lanePatterns();
  for (const file of ["review-panel.test.mjs", "severity.test.mjs", "capture-store.test.mjs"]) {
    assert.ok(
      patterns.some((p) => path.matchesGlob(file, p)),
      `${file} is no longer matched by the agent:tests lane (${patterns.join(" ")})`,
    );
  }
});

test("the agent:tests lane does NOT force-exit the runner", () => {
  // `--test-force-exit` exits once the tests are known to have finished, without
  // waiting for the per-file child results to finish arriving — so whole files'
  // results were dropped and the lane still printed `# fail 0`, because a result
  // that never arrives cannot fail. Six consecutive Node 22 runs reported 1468 /
  // 1410 / 1427 / 1460 / 1411 / 1434 tests; the 58 missing from the shortest were
  // all of `harvest.test.mjs`. The same truncation landing mid-message is the
  // "Unable to deserialize cloned data" failure seen on #736 and twice on #742.
  //
  // The hang the flag was added for is bounded by `--test-timeout` (a test that
  // hangs while running) and ci.yml's `timeout-minutes` (everything else), which
  // is what bounded the one case the flag never covered anyway.
  const src = readFileSync(VERIFY_SELF, "utf8");
  const lane = /name:\s*"agent:tests",\s*cmd:\s*"([^"]+)"/.exec(src);
  assert.ok(lane, "no agent:tests lane in verify-self.mjs");
  assert.doesNotMatch(
    lane[1],
    /--test-force-exit/,
    "--test-force-exit silently truncates this lane's report; see the comment above it",
  );
  // The timeout must stay — it is now the only in-runner bound on a hung test.
  assert.match(lane[1], /--test-timeout=\d+/, "the lane still needs a per-test timeout");
});
