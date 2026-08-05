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
  { name: "agent:tests", cmd: "cd scripts/agent && node --test '**/*.test.mjs'" },
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

function runCommand(cmd, cwd) {
  return new Promise((resolve) => {
    const chunks = [];
    const proc = spawn("sh", ["-c", cmd], {
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data) => {
      process.stdout.write(data);
      chunks.push(data);
    });

    proc.stderr.on("data", (data) => {
      process.stderr.write(data);
      chunks.push(data);
    });

    proc.on("close", (exitCode) => {
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
