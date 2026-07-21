// Phase 21 (Agent Observability): turn the harness lane reports into a compact,
// ranked, agent-readable diagnosis so an agent can fix a CI failure without a
// human interpreting the raw logs.
//
// Reads the artifacts that `scripts/verify-self.mjs` already writes:
//   .harness-reports/summary.json           { overall, totalDurationMs, lanes: [{ lane, status, durationMs }] }
//   .harness-reports/<lane-with-dashes>.json { lane, status, durationMs, exitCode, failureSummary }
//
// Prints a Markdown digest to stdout. In CI, capture it into a step output:
//   {
//     echo "summary<<HARNESS_EOF"
//     node ./scripts/agent/summarize-ci.mjs
//     echo "HARNESS_EOF"
//   } >> "$GITHUB_OUTPUT"
//
// Usage: node ./scripts/agent/summarize-ci.mjs [reportDir]
//   reportDir defaults to .harness-reports

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const reportDir = path.resolve(process.cwd(), process.argv[2] ?? ".harness-reports");
const summaryPath = path.join(reportDir, "summary.json");

function laneFileName(lane) {
  // Mirror verify-self.mjs: ":" -> "-"
  return lane.replaceAll(":", "-");
}

function readLaneReport(lane) {
  const filePath = path.join(reportDir, `${laneFileName(lane)}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

if (!existsSync(summaryPath)) {
  console.log(
    [
      "No `.harness-reports/summary.json` found.",
      "",
      "`verify:self` may have crashed before producing any report, or the",
      "artifact was not downloaded. Re-run `pnpm verify:self` locally and read",
      "its console output directly to diagnose the failure.",
    ].join("\n"),
  );
  process.exit(0);
}

let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, "utf8"));
} catch (err) {
  console.log(`Could not parse summary.json: ${err.message}`);
  process.exit(0);
}

const lanes = Array.isArray(summary.lanes) ? summary.lanes : [];
const failed = lanes.filter((l) => l.status === "fail");
const skipped = lanes.filter((l) => l.status === "skip");
const passed = lanes.filter((l) => l.status === "pass");

const out = [];
const overallIcon = summary.overall === "pass" ? "✅" : "❌";
out.push(`## Harness CI diagnosis — ${overallIcon} ${String(summary.overall ?? "unknown").toUpperCase()}`);
out.push("");
out.push(
  `Lanes: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped ` +
    `(of ${summary.lanesTotal ?? lanes.length}).`,
);
out.push("");

if (failed.length === 0) {
  out.push(
    "No lane is marked `fail` in the self-contained report. The failing check is",
    "likely in a lane not covered by `verify:self` (e.g. `verify-browser` or",
    "`verify-integration`) — inspect that job's logs directly.",
  );
  console.log(out.join("\n"));
  process.exit(0);
}

// Lanes run sequentially and stop at the first failure, so the first failed
// lane is the root cause; anything after it is skipped, not independently broken.
out.push("### Root cause (fix this first)");
out.push("");
for (const lane of failed) {
  const detail = readLaneReport(lane.lane);
  const failureSummary = detail?.failureSummary ?? "(no failure summary captured)";
  const exitCode = detail?.exitCode ?? "?";
  const dur = lane.durationMs > 0 ? ` after ${(lane.durationMs / 1000).toFixed(1)}s` : "";
  out.push(`- **\`${lane.lane}\`** (exit ${exitCode})${dur}`);
  out.push("  ```");
  out.push(`  ${failureSummary}`);
  out.push("  ```");
}
out.push("");

if (skipped.length > 0) {
  out.push(
    `> ${skipped.length} downstream lane(s) were skipped because an earlier lane failed ` +
      `(${skipped.map((l) => `\`${l.lane}\``).join(", ")}). They are not independently broken — ` +
      "fix the root cause above and they will run.",
  );
  out.push("");
}

out.push("### How to reproduce locally");
out.push("");
out.push("```bash");
out.push("pnpm install --frozen-lockfile");
out.push("pnpm verify:self   # or run just the failing lane's command from package.json");
out.push("```");

console.log(out.join("\n"));
