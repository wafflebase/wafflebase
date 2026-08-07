import { spawn } from "node:child_process";
import { readHeadSha } from "./agent/git-env.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const reportDir = path.resolve(repoRoot, ".harness-reports");

const LANES = [
  // Agent-harness unit tests. `scripts/agent` is a standalone npm package
  // OUTSIDE the pnpm workspace, so `pnpm verify:fast` never reaches it — without
  // this lane the panel's safety-critical suites (severity/checks/verifier) would
  // never run in CI. No build or SDK install needed (the SDK is lazy-imported),
  // so it runs first and fails fast on a regression in the gate itself.
  //
  // RECURSIVE, and single-quoted so NODE expands the pattern rather than `sh`.
  // Both halves are load-bearing. The glob used to be a flat `*.test.mjs`, which
  // silently matched nothing in any subdirectory — `scripts/agent/eval/`'s suites
  // would have been written, passed locally and then never run again, with green
  // CI as the only evidence. And node's own globber skips `node_modules`, which
  // `sh` does not: the `deps` job runs `npm ci` inside `scripts/agent`, so an
  // sh-expanded `**` would start running third-party test files.
  // `eval/test-lane.test.mjs` reads this line back and asserts every suite under
  // `eval/` is matched by it, at every depth.
  //
  // WHY TWO FLAGS. On 2026-08-06 run 31073290840 printed `ok 1` .. `ok 305`,
  // went silent 2.3s in, and sat there for 31.5 minutes until a human with write
  // access cancelled it by hand; teardown then reported six orphan processes
  // (node, sh, node, sh, node, node). It never printed a `# tests` summary, and
  // the same lane at that same commit prints 1180 of them locally — so the
  // suite did NOT complete: 875 tests never reported. The offending change is
  // reverted, and the log does not say which of two mechanisms stalled it:
  // a test that hung while running, or a test FILE whose tests all finished
  // while a child process it spawned kept its process alive. Reproducing both
  // shapes together shows neither flag alone is enough — `--test-timeout` names
  // the hung test and then hangs on the leaked child; `--test-force-exit` never
  // fires, because a hung test never "finishes". Together they end the run.
  //
  //   --test-timeout=60000  cancels a test that hangs WHILE RUNNING and NAMES it
  //     with its file and line, so the next one diagnoses itself. 60s is ~8x the
  //     slowest single test measured here (7.7s, a CLI-spawning test, macOS) and
  //     ~17x the lane's whole CI duration (3.5s). Deliberately loose: a flaky
  //     timeout on a loaded runner would be worse than the hang it guards.
  //
  //   --test-force-exit  exits once every known test has finished, even with a
  //     live handle or child holding the loop open. Note what this does NOT buy.
  //     The run ends, it does not go red. And it only fires when the runner
  //     learns the tests finished, which a child spawned `stdio: "inherit"`
  //     prevents — it holds the test file's stdout open, so the runner never
  //     exits at all and the lane hangs exactly as it does today (measured:
  //     `ignore` returns in 0.8s, `inherit` still blocked at 25s). Only
  //     `ci.yml`'s `timeout-minutes` bounds that one. The orphan the `ignore`
  //     case leaves behind is what `reapLaneGroup` below cleans up.
  //
  // BOTH FLAGS GO BEFORE `--test`. `eval/test-lane.test.mjs` captures everything
  // after `--test ` and treats each whitespace-separated token as a glob pattern;
  // put them after and it reads `--test-timeout=60000` back as a pattern. It
  // does not currently FAIL on that — its assertions are one-directional (every
  // eval suite must match some pattern) — so this is a latent corruption a green
  // test would not catch. Node does not care about the order; that extractor does.
  {
    name: "agent:tests",
    cmd: "cd scripts/agent && node --test-timeout=60000 --test-force-exit --test '**/*.test.mjs'",
  },
  // core must build first — sheets/docs/slides/frontend all import
  // `@wafflebase/core` (geometry, tokens) from its gitignored `dist/`.
  { name: "core:build", cmd: "pnpm core build" },
  { name: "sheets:build", cmd: "pnpm sheets build" },
  { name: "docs:build", cmd: "pnpm --filter @wafflebase/docs build" },
  { name: "slides:build", cmd: "pnpm slides build" },
  { name: "verify:fast", cmd: "pnpm verify:fast" },
  { name: "frontend:build", cmd: "pnpm frontend build" },
  { name: "verify:frontend:chunks", cmd: "pnpm verify:frontend:chunks" },
  { name: "backend:build", cmd: "pnpm backend build" },
  { name: "cli:build", cmd: "pnpm cli build" },
  { name: "verify:entropy", cmd: "pnpm verify:entropy" },
];

const IS_POSIX = process.platform !== "win32";

/**
 * SIGKILL everything still in `pid`'s process group.
 *
 * Called once a lane has already exited, so the only members left are things it
 * leaked. `agent:tests` leaks by construction: `--test-force-exit` ends the test
 * runner while a child a test spawned is still alive, and without this that child
 * outlives the lane and runs alongside every later lane and the coverage steps
 * after them. The 2026-08-06 incident's job teardown reported six such orphans.
 *
 * Negative pid means "the group", which is why `runCommand` spawns detached: a
 * detached child is its own group LEADER, so its pid doubles as the group id.
 * Attached, it inherits this runner's group instead, its pid is not a group id
 * at all, and the signal lands on nothing (or on an unrelated group that
 * happens to hold that number). Verified by mutation — dropping `detached`
 * leaves the orphan running.
 *
 * Best-effort on purpose. ESRCH — the whole group already gone — is the normal
 * case and must not fail a lane that passed.
 */
function reapLaneGroup(pid) {
  if (!IS_POSIX || !pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone. Nothing to report and nothing to do.
  }
}

/**
 * Lane process groups that have not been reaped yet.
 *
 * `detached` also detaches the lane from the terminal's foreground group, so a
 * Ctrl-C that reaches this runner no longer reaches the lane. Forwarding it by
 * hand keeps the old behaviour: interrupting `pnpm verify:self` (this file is
 * the `pre-push` hook's entry point) still stops the build it started.
 */
const liveLaneGroups = new Set();
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.on(signal, () => {
    for (const pid of liveLaneGroups) reapLaneGroup(pid);
    process.exit(code);
  });
}

function runCommand(cmd, cwd) {
  return new Promise((resolve) => {
    const chunks = [];
    const proc = spawn("sh", ["-c", cmd], {
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
      // See reapLaneGroup: its own process group is what makes the lane
      // reapable as a unit.
      detached: IS_POSIX,
    });
    const { pid } = proc;
    if (pid) liveLaneGroups.add(pid);

    proc.stdout.on("data", (data) => {
      process.stdout.write(data);
      chunks.push(data);
    });

    proc.stderr.on("data", (data) => {
      process.stderr.write(data);
      chunks.push(data);
    });

    // `close`, not `exit`, so the lane's tail output is captured before the
    // report is written. Note what this does NOT cover: a leaked grandchild
    // that inherited the lane's stdout pipe holds `close` open forever, and in
    // that case the test runner never exits either, so `--test-force-exit`
    // never fires. Nothing in this file bounds that — `ci.yml`'s
    // `timeout-minutes` is the only thing that does.
    proc.on("close", (exitCode) => {
      liveLaneGroups.delete(pid);
      reapLaneGroup(pid);
      resolve({ exitCode: exitCode ?? 1, output: Buffer.concat(chunks).toString() });
    });
  });
}

function extractFailureSummary(output) {
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  for (const line of lines) {
    if (
      /\b(FAIL|ERROR|error|Error|✗|✘|FAILED)\b/.test(line) &&
      line.trim().length > 5
    ) {
      return line.trim().slice(0, 500);
    }
  }
  return lines.length > 0 ? lines[lines.length - 1].trim().slice(0, 500) : null;
}

function laneFileName(lane) {
  return lane.replaceAll(":", "-");
}

function writeLaneReport(report) {
  const filePath = path.resolve(reportDir, `${laneFileName(report.lane)}.json`);
  writeFileSync(filePath, JSON.stringify(report, null, 2) + "\n");
}

function writeSummary(results, totalStart) {
  const totalDurationMs = Date.now() - totalStart;
  const overall = results.every((r) => r.status === "pass") ? "pass" : "fail";
  const summary = {
    timestamp: new Date().toISOString(),
    overall,
    totalDurationMs,
    lanesRun: results.filter((r) => r.status !== "skip").length,
    lanesTotal: LANES.length,
    lanes: results.map(({ lane, status, durationMs }) => ({
      lane,
      status,
      durationMs,
    })),
  };
  writeFileSync(
    path.resolve(reportDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  return summary;
}

/**
 * The commit HEAD points at, or `null` when that cannot be read (a vendored
 * copy or exported tarball, where the guard below does not apply).
 *
 * Read once before the lanes and again after each one. No lane may move the
 * developer's branch: a test that shells out to git and escapes its fixture
 * commits into THIS repository instead, on whatever branch is checked out,
 * replacing the branch tip. That happened — ten commits left a branch and the
 * resulting push read as deleting every file — and the only symptom was the
 * diff stat.
 *
 * Scoped via `readHeadSha` rather than trusting `cwd`, because this runner IS
 * the `pre-push` hook's entry point, and a hook is exactly where git exports
 * `GIT_DIR`. Reading `HEAD` with an inherited environment would let the guard
 * watch a different repository than the lanes can damage.
 *
 * Detects *net* movement of `HEAD` only. A lane that commits and resets back,
 * rewrites another ref, or mutates the index or stash is NOT covered; claiming
 * otherwise would be worse than the narrow guarantee, because it invites
 * trusting a green run.
 */
function readHead() {
  return readHeadSha(repoRoot);
}

// --- main ---

mkdirSync(reportDir, { recursive: true });

const results = [];
const totalStart = Date.now();
const headBefore = readHead();
let failed = false;

for (const { name, cmd } of LANES) {
  if (failed) {
    const skipReport = {
      lane: name,
      status: "skip",
      durationMs: 0,
      exitCode: null,
      failureSummary: null,
    };
    results.push(skipReport);
    writeLaneReport(skipReport);
    continue;
  }

  const start = Date.now();
  console.log(`\n▸ ${name}`);

  const { exitCode, output } = await runCommand(cmd, repoRoot);
  const durationMs = Date.now() - start;

  // Checked after the exitCode split so a lane that genuinely failed keeps its
  // own diagnosis; a moved HEAD is then reported on top of it rather than
  // instead of it. `headAfter == null` while `headBefore` was readable means
  // the repository stopped answering during the lane, which is a worse outcome
  // than movement and must not pass as "unchanged".
  const headAfter = readHead();
  const headLost = Boolean(headBefore) && headAfter === null;
  const headMoved = Boolean(headBefore) && Boolean(headAfter) && headAfter !== headBefore;

  if (headMoved || headLost) {
    const detail = headMoved
      ? `moved HEAD ${headBefore.slice(0, 9)} -> ${headAfter.slice(0, 9)}`
      : "left HEAD unreadable";
    const report = {
      lane: name,
      status: "fail",
      durationMs,
      // Deliberately not the lane's own exit code: a lane can corrupt the
      // repository and still exit 0, and a report saying `fail` alongside
      // `exitCode: 0` reads as a contradiction to downstream consumers.
      exitCode: exitCode === 0 ? 1 : exitCode,
      failureSummary: `lane ${detail}${exitCode === 0 ? "" : ` (lane also exited ${exitCode})`}`,
    };
    results.push(report);
    writeLaneReport(report);
    console.error(`\n\u2717 ${name} ${detail}`);
    console.error("  This lane wrote to the repository. Inspect before doing anything else:");
    console.error("    git status && git reflog -n 20");
    if (headMoved) {
      console.error(`  The prior tip was ${headBefore}. Resetting to it DISCARDS uncommitted work,`);
      console.error("  so tag the current state first:  git tag rescue/$(date +%s) HEAD");
    }
    failed = true;
    continue;
  }

  if (exitCode === 0) {
    const report = {
      lane: name,
      status: "pass",
      durationMs,
      exitCode: 0,
      failureSummary: null,
    };
    results.push(report);
    writeLaneReport(report);
  } else {
    const report = {
      lane: name,
      status: "fail",
      durationMs,
      exitCode,
      failureSummary: extractFailureSummary(output),
    };
    results.push(report);
    writeLaneReport(report);
    failed = true;
  }
}

const summary = writeSummary(results, totalStart);

console.log("\n─── verify:self summary ───");
for (const r of results) {
  const icon =
    r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "○";
  const dur =
    r.durationMs > 0 ? ` (${(r.durationMs / 1000).toFixed(1)}s)` : "";
  console.log(`  ${icon} ${r.lane}${dur}`);
}
console.log(
  `\n  ${summary.overall === "pass" ? "All lanes passed" : "FAILED"} in ${(summary.totalDurationMs / 1000).toFixed(1)}s`,
);
console.log(`  Report: ${reportDir}/summary.json\n`);

if (failed) {
  process.exit(1);
}
