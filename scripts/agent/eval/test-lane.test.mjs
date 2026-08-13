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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
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
function laneCmd() {
  const src = readFileSync(VERIFY_SELF, "utf8");
  const lane = /name:\s*"agent:tests",\s*cmd:\s*"([^"]+)"/.exec(src);
  assert.ok(lane, "no agent:tests lane in verify-self.mjs — if it was renamed, re-point this test rather than deleting it");
  const cmd = lane[1];
  assert.match(cmd, /^cd scripts\/agent && /, `the lane no longer runs from scripts/agent: ${cmd}`);
  return cmd;
}

/**
 * The files each `node --test` invocation in the lane will actually run.
 *
 * The lane invokes node TWICE — `eval/run.test.mjs` is isolated, for the reason
 * given above the lane. So the question this file has always asked ("does every
 * suite run in CI?") is now a question about the UNION of two invocations, and a
 * pattern-matching check could no longer answer it: the first invocation gets its
 * files from a `find` command substitution, not a glob.
 *
 * So the substitution is EXECUTED, in the directory the lane runs from, and its
 * real output is what gets checked. That is strictly stronger than matching globs
 * by hand — it tests the command rather than a reading of it.
 */
/**
 * The `node --test` calls in the lane, in order.
 *
 * Split on `;` as well as `&&`: the two invocations are SEQUENCED rather than
 * chained, so that a failure in the first still runs the second.
 */
function laneNodeCalls(cmd) {
  return cmd.split(/&&|;/).map((p) => p.trim()).filter((p) => p.startsWith("node "));
}

function laneInvocations() {
  const cmd = laneCmd();
  const parts = laneNodeCalls(cmd);
  assert.equal(parts.length, 2, `expected two node invocations in the lane, got ${parts.length}: ${cmd}`);
  return parts.map((part) => {
    const args = /--test\s+(.+)$/.exec(part);
    assert.ok(args, `no --test arguments in: ${part}`);
    // DECODED, because the lane is read out of SOURCE TEXT: any backslash in the
    // command arrives here still escaped for JavaScript, so handing the raw
    // capture to `sh` would run a DIFFERENT command than CI runs, and this test
    // would then be checking something that does not ship. Not hypothetical —
    // the first version of this lane stripped its `./` prefix with a `sed` whose
    // backslash doubled on the way through, and these assertions failed until it
    // was decoded.
    const argv = JSON.parse(`"${args[1]}"`);
    // `sh`, not `bash`: the lane is run by `spawn("sh", ["-c", cmd])`, and a
    // `$(find …)` that only works under bash would pass here and fail in CI.
    const expanded = execFileSync("sh", ["-c", `printf '%s\\n' ${argv}`], {
      cwd: AGENT_DIR,
      encoding: "utf8",
    });
    return expanded.split("\n").map((f) => f.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  });
}

/** Every `*.test.mjs` under `scripts/agent`, at any depth, relative to it. */
function agentTestFiles(dir = AGENT_DIR, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) agentTestFiles(abs, out);
    else if (e.isFile() && e.name.endsWith(".test.mjs")) out.push(path.relative(AGENT_DIR, abs));
  }
  return out;
}

test("the two invocations together run every test file under scripts/agent, at every depth", () => {
  // Widened from `eval/` only: the lane's first invocation now enumerates the
  // whole package with `find`, so a file dropped ANYWHERE — not just under
  // `eval/` — is the silent skip this file exists to prevent.
  const [rest, isolated] = laneInvocations();
  const covered = new Set([...rest, ...isolated]);
  const files = agentTestFiles();
  assert.ok(files.length >= 20, `expected the agent test files to be found, got ${files.length}`);
  for (const file of files) {
    assert.ok(covered.has(file), `${file} is run by NEITHER invocation of the agent:tests lane — it would never run in CI`);
  }
});

test("the two invocations PARTITION the suite — nothing is dropped, nothing runs twice", () => {
  // The fail direction that matters is a file in neither list, which is the
  // silent-skip this file has always guarded. The other direction is worth
  // pinning too: a file in BOTH would be counted twice, and the lane's test count
  // is the number every baseline in this repo is measured against.
  const [rest, isolated] = laneInvocations();
  const both = rest.filter((f) => isolated.includes(f));
  assert.deepEqual(both, [], `these files run in both invocations and would be double-counted: ${both.join(", ")}`);
  assert.deepEqual(isolated, ["eval/run.test.mjs"], "the second invocation exists to isolate exactly one file");
  assert.equal(rest.includes("eval/run.test.mjs"), false, "the isolated file is still in the first invocation, so isolating it bought nothing");
});

test("the first invocation still runs the flat suites it always ran, and skips node_modules", () => {
  // Measurement's own suites live directly in `scripts/agent`. Isolating one eval
  // file must not narrow the lane away from them. And `find` — unlike node's own
  // globber — descends into `node_modules`, where the `deps` job does an `npm ci`:
  // without the prune, the lane would start running third-party tests.
  //
  // These sentinels used to be `review-panel.test.mjs` and `severity.test.mjs`. Both
  // moved to wafflebase/agent-pipeline, where that repo's own CI runs them; what is
  // left here is measurement, so the sentinels are measurement files now. The
  // property under test is unchanged: flat suites are still in the first invocation.
  const [rest] = laneInvocations();
  for (const file of ["capture-store.test.mjs", "harvest.test.mjs", "classify.test.mjs"]) {
    assert.ok(rest.includes(file), `${file} is no longer run by the agent:tests lane`);
  }
  const vendored = rest.filter((f) => f.split("/").includes("node_modules"));
  assert.deepEqual(vendored, [], `the lane would run vendored tests: ${vendored.slice(0, 3).join(", ")}`);
});

test("EVERY invocation carries the timeout flag, not just one of them", () => {
  // The lane is now two `node --test` calls, and `--test-timeout` is the only
  // in-runner bound on a test that hangs while running. A flag on the first call
  // does nothing for the second, and the whole-command check below would still
  // pass — so it is asserted per invocation.
  const cmd = laneCmd();
  const invocations = laneNodeCalls(cmd);
  for (const invocation of invocations) {
    assert.match(invocation, /--test-timeout=\d+/, `no per-test timeout in: ${invocation}`);
    // Before `--test`, or node reads it as a file to run.
    assert.ok(
      invocation.indexOf("--test-timeout=") < invocation.indexOf("--test "),
      `the timeout flag comes after --test, so node will treat it as a path: ${invocation}`,
    );
  }
});

test("the lane does not run vendored tests, proven against a real node_modules", () => {
  // `find` descends into `node_modules`; node's own globber does not. The `deps`
  // job runs `npm ci` inside `scripts/agent`, so without the prune this lane
  // would start running third-party suites. Asserting "no node_modules path came
  // back" is VACUOUS on a checkout that has not installed there — which is most
  // developer machines — so a file is planted to make the check real.
  // Two probes, and the NESTED one is the one that matters: a filter written as
  // `! -path './node_modules/*'` excludes only the top-level install, so a probe
  // planted there alone passes against a lane that would still run every vendored
  // suite under `eval/node_modules`. That was this test's first version.
  const probeDirs = [
    path.join(AGENT_DIR, "node_modules", "__lane_probe__"),
    path.join(AGENT_DIR, "eval", "node_modules", "__lane_probe__"),
  ];
  for (const dir of probeDirs) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "planted.test.mjs"), "// planted by test-lane.test.mjs; removed in the same test\n");
  }
  try {
    const [rest, isolated] = laneInvocations();
    const vendored = [...rest, ...isolated].filter((f) => f.split("/").includes("node_modules"));
    assert.deepEqual(vendored, [], `the lane would run vendored tests: ${vendored.join(", ")}`);
  } finally {
    rmSync(probeDirs[0], { recursive: true, force: true });
    rmSync(path.join(AGENT_DIR, "eval", "node_modules"), { recursive: true, force: true });
  }
});

test("a failure in the FIRST invocation still runs the second, and the lane still fails", () => {
  // `&&` between the invocations would skip `eval/run.test.mjs` whenever anything
  // in the first list failed — the lane reporting less than it ran, on exactly the
  // path where a second failure is most worth seeing. Driven through the REAL
  // command with a fake `node` on PATH, so it tests the shell the lane ships
  // rather than a reading of it.
  const bin = mkdtempSync(path.join(tmpdir(), "lane-fake-node-"));
  const log = path.join(bin, "calls.log");
  const fake = path.join(bin, "node");
  // Exits with the Nth code in $FAKE_CODES, so both orders can be driven.
  writeFileSync(fake, [
    "#!/bin/sh",
    `echo call >> ${JSON.stringify(log)}`,
    `n=$(wc -l < ${JSON.stringify(log)} | tr -d ' ')`,
    'code=$(echo "$FAKE_CODES" | cut -d" " -f"$n")',
    'exit "${code:-0}"',
    "",
  ].join("\n"));
  chmodSync(fake, 0o755);
  const repoRoot = path.join(AGENT_DIR, "..", "..");
  const run = (codes) => {
    writeFileSync(log, "");
    const r = spawnSync("sh", ["-c", laneCmd()], {
      cwd: repoRoot,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_CODES: codes },
    });
    return { status: r.status, calls: readFileSync(log, "utf8").split("\n").filter(Boolean).length };
  };
  try {
    const first = run("7 0");
    assert.equal(first.calls, 2, "the second invocation was skipped after the first failed");
    assert.equal(first.status, 7, "the lane did not report the first invocation's failure");

    // The other direction, so the test cannot pass by always running both and
    // always returning 0.
    const second = run("0 9");
    assert.equal(second.calls, 2);
    assert.equal(second.status, 9, "a failure in the isolated invocation must fail the lane");

    const clean = run("0 0");
    assert.equal(clean.calls, 2);
    assert.equal(clean.status, 0, "an all-green lane must exit 0");
  } finally {
    rmSync(bin, { recursive: true, force: true });
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
