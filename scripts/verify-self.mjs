import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const reportDir = path.resolve(repoRoot, ".harness-reports");

const LANES = [
  { name: "verify:fast", cmd: "pnpm verify:fast" },
  { name: "frontend:build", cmd: "pnpm frontend build" },
  { name: "verify:frontend:chunks", cmd: "pnpm verify:frontend:chunks" },
  { name: "verify:frontend:visual", cmd: "pnpm verify:frontend:visual" },
  { name: "backend:build", cmd: "pnpm backend build" },
  { name: "sheet:build", cmd: "pnpm sheet build" },
  { name: "verify:entropy", cmd: "pnpm verify:entropy" },
  { name: "verify:browser", cmd: "node ./scripts/verify-browser-lanes.mjs" },
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

// --- main ---

mkdirSync(reportDir, { recursive: true });

const results = [];
const totalStart = Date.now();
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
