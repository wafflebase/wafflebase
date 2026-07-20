// Normalize the independent reviewer's verdict into a check-run conclusion.
//
// The reviewer (a fresh, read-only Claude Code run) writes its verdict to
// `.agent-review/verdict.json`. This script reads it, decides the check-run
// conclusion mechanically (the reviewer classifies severity; the harness
// computes pass/fail from the blocking count), and writes a Markdown summary
// for the check run. Keeping the pass/fail decision here — not in the agent —
// means the agent cannot simply declare "success".
//
// Expected verdict.json shape:
//   {
//     "verdict": "approve" | "request_changes",
//     "blocking": [ { "file": "...", "summary": "..." }, ... ],
//     "minor":    [ { "file": "...", "summary": "..." }, ... ],
//     "summary":  "one-paragraph overall assessment"
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

function emit({ conclusion, blockingCount, valid, summaryMd }) {
  writeFileSync(summaryPath, summaryMd + "\n");
  const line = `conclusion=${conclusion}\nblocking_count=${blockingCount}\nvalid=${valid}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  process.stdout.write(line);
}

function findingList(items, heading) {
  if (!Array.isArray(items) || items.length === 0) return "";
  const rows = items
    .map((f) => `- ${f.file ? `\`${f.file}\` — ` : ""}${f.summary ?? "(no summary)"}`)
    .join("\n");
  return `\n### ${heading}\n${rows}\n`;
}

// --- invalid / missing verdict → fail closed --------------------------------

if (!existsSync(verdictPath)) {
  emit({
    conclusion: "failure",
    blockingCount: 0,
    valid: false,
    summaryMd:
      "❌ The reviewer did not produce a verdict file. Treating as **not approved** — a human should look.",
  });
  process.exit(0);
}

let verdict;
try {
  verdict = JSON.parse(readFileSync(verdictPath, "utf8"));
} catch (err) {
  emit({
    conclusion: "failure",
    blockingCount: 0,
    valid: false,
    summaryMd: `❌ The reviewer's verdict file was not valid JSON (${err.message}). Treating as **not approved**.`,
  });
  process.exit(0);
}

const blocking = Array.isArray(verdict.blocking) ? verdict.blocking : [];
const minor = Array.isArray(verdict.minor) ? verdict.minor : [];
const valid = verdict.verdict === "approve" || verdict.verdict === "request_changes";

// Approve requires BOTH an explicit approve verdict AND zero blocking findings.
const approved = valid && verdict.verdict === "approve" && blocking.length === 0;
const conclusion = approved ? "success" : "failure";

const header = approved
  ? "✅ Independent review: **approved** (no blocking findings)."
  : `❌ Independent review: **changes requested** (${blocking.length} blocking finding(s)).`;

const summaryMd =
  `${header}\n\n${verdict.summary ?? ""}` +
  findingList(blocking, "Blocking findings") +
  findingList(minor, "Minor findings (non-blocking)");

emit({ conclusion, blockingCount: blocking.length, valid, summaryMd });
