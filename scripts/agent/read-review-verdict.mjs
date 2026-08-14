// Normalize a single reviewer's verdict.json into a check-run conclusion.
//
// The reviewer writes findings to a verdict file; this script decides the
// check-run conclusion MECHANICALLY from severities via the shared rule in
// severity.mjs — the reviewer classifies, the harness computes pass/fail — so a
// reviewer cannot self-declare "approved". Fails closed on missing/invalid input.
//
// Expected verdict.json shape:
//   { "findings": [ { "severity": "critical|major|minor|nit", "file": "path",
//                     "summary": "what & why" } ], "summary": "overall" }
//
// Outputs (to $GITHUB_OUTPUT when set, and stdout):
//   conclusion=success|failure   blocking_count=<n>   valid=true|false
// Side effect: writes `<dir>/summary.md` (the check-run output body).
//
// Usage: node ./scripts/agent/read-review-verdict.mjs [verdict.json path] [label]
//   defaults to .agent-review/verdict.json, label "Independent review"

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { classify, renderSummaryMd } from "./severity.mjs";

const verdictPath = path.resolve(process.cwd(), process.argv[2] ?? ".agent-review/verdict.json");
const label = process.argv[3] ?? "Independent review";
const summaryPath = path.join(path.dirname(verdictPath), "summary.md");

function emit({ conclusion, blockingCount, valid, summaryMd }) {
  // The workflow rm -rf's the report dir before the reviewer runs, and the
  // reviewer may crash without recreating it — so ensure the dir exists, or the
  // fail-closed path itself would throw ENOENT (defeating the safety mechanism).
  mkdirSync(path.dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, summaryMd + "\n");
  const line = `conclusion=${conclusion}\nblocking_count=${blockingCount}\nvalid=${valid}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  process.stdout.write(line);
}

function failClosed(message) {
  emit({ conclusion: "failure", blockingCount: 0, valid: false, summaryMd: `❌ ${message}` });
  process.exit(0);
}

if (!existsSync(verdictPath)) {
  failClosed("The reviewer did not produce a verdict file. Treating as **not approved** — a human should look.");
}

let verdict;
try {
  verdict = JSON.parse(readFileSync(verdictPath, "utf8"));
} catch (err) {
  failClosed(`The reviewer's verdict file was not valid JSON (${err.message}). Treating as **not approved**.`);
}

// Guard null/array/primitive BEFORE touching `.findings` — `JSON.parse("null")`
// returns null, and `null.findings` would throw outside the try, crashing the
// step and stalling the loop (the exact failure this fails-closed).
if (verdict === null || typeof verdict !== "object" || Array.isArray(verdict) || !Array.isArray(verdict.findings)) {
  failClosed("The reviewer's verdict was not an object with a `findings` array. Treating as **not approved**.");
}

const { conclusion, blockingCount, findings } = classify(verdict.findings);
emit({
  conclusion,
  blockingCount,
  valid: true,
  summaryMd: renderSummaryMd(label, findings, verdict.summary),
});
