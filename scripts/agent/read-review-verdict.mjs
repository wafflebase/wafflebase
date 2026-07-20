// Normalize the independent reviewer's verdict into a check-run conclusion.
//
// The reviewer (a fresh, read-only Claude Code run) writes its findings to
// `.agent-review/verdict.json`. This script decides the check-run conclusion
// MECHANICALLY from finding severities — the reviewer classifies each finding,
// the harness computes pass/fail — so the agent cannot self-declare "approved".
//
// Severity scale: critical | major | minor | nit
//   - critical / major  → BLOCKING (changes requested)
//   - minor / nit        → non-blocking (informational)
// A PR is approved when no critical or major findings remain (minor/nit are OK).
// Any unrecognized severity is treated as `major` (fail-safe).
//
// Expected verdict.json shape:
//   {
//     "findings": [
//       { "severity": "critical|major|minor|nit", "file": "path", "summary": "what & why" }
//     ],
//     "summary": "one-paragraph overall assessment"
//   }
//
// Outputs (to $GITHUB_OUTPUT when set, and stdout):
//   conclusion=success|failure   blocking_count=<n>   valid=true|false
// Side effect: writes `<dir>/summary.md` (the check-run output body).
//
// Usage: node ./scripts/agent/read-review-verdict.mjs [verdict.json path]
//   defaults to .agent-review/verdict.json

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

const verdictPath = path.resolve(
  process.cwd(),
  process.argv[2] ?? ".agent-review/verdict.json",
);
const summaryPath = path.join(path.dirname(verdictPath), "summary.md");

const KNOWN = ["critical", "major", "minor", "nit"];
const BLOCKING = new Set(["critical", "major"]);

function emit({ conclusion, blockingCount, valid, summaryMd }) {
  writeFileSync(summaryPath, summaryMd + "\n");
  const line = `conclusion=${conclusion}\nblocking_count=${blockingCount}\nvalid=${valid}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  process.stdout.write(line);
}

// Normalize an arbitrary severity string; unknown → "major" (fail-safe).
function normalizeSeverity(raw) {
  const s = String(raw ?? "").toLowerCase().trim();
  return KNOWN.includes(s) ? s : "major";
}

function section(findings, severity, heading) {
  const rows = findings.filter((f) => f.severity === severity);
  if (rows.length === 0) return "";
  const body = rows
    .map((f) => `- ${f.file ? `\`${f.file}\` — ` : ""}${f.summary ?? "(no summary)"}`)
    .join("\n");
  return `\n### ${heading} (${rows.length})\n${body}\n`;
}

// --- invalid / missing verdict → fail closed --------------------------------

function failClosed(message) {
  emit({ conclusion: "failure", blockingCount: 0, valid: false, summaryMd: `❌ ${message}` });
  process.exit(0);
}

if (!existsSync(verdictPath)) {
  failClosed(
    "The reviewer did not produce a verdict file. Treating as **not approved** — a human should look.",
  );
}

let verdict;
try {
  verdict = JSON.parse(readFileSync(verdictPath, "utf8"));
} catch (err) {
  failClosed(
    `The reviewer's verdict file was not valid JSON (${err.message}). Treating as **not approved**.`,
  );
}

if (!Array.isArray(verdict.findings)) {
  failClosed(
    "The reviewer's verdict had no `findings` array. Treating as **not approved**.",
  );
}

// --- classify + decide ------------------------------------------------------

const findings = verdict.findings.map((f) => ({
  severity: normalizeSeverity(f?.severity),
  file: f?.file,
  summary: f?.summary,
}));

const blockingCount = findings.filter((f) => BLOCKING.has(f.severity)).length;
const approved = blockingCount === 0; // only minor/nit (or nothing) remain
const conclusion = approved ? "success" : "failure";

const counts = KNOWN.map((s) => `${findings.filter((f) => f.severity === s).length} ${s}`).join(", ");
const header = approved
  ? `✅ Independent review: **approved** — no critical or major findings (${counts}).`
  : `❌ Independent review: **changes requested** — ${blockingCount} blocking (critical/major) finding(s) (${counts}).`;

const summaryMd =
  `${header}\n\n${verdict.summary ?? ""}` +
  section(findings, "critical", "Critical") +
  section(findings, "major", "Major") +
  section(findings, "minor", "Minor (non-blocking)") +
  section(findings, "nit", "Nit (non-blocking)");

emit({ conclusion, blockingCount, valid: true, summaryMd });
