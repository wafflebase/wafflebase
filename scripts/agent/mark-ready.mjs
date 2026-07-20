// Ready gate for the autonomous contribution loop.
//
// Promotes an agent-authored draft PR to "ready for human review" ONLY when the
// hand-off preconditions all hold. Trust keys off CI-posted evidence, never the
// agent's own claims:
//
//   1. CI's `<!-- harness-verification -->` comment shows verify:self ✅ AND
//      verify:integration ✅ (or an explicit skip reason recorded in the PR body).
//   2. A self-review comment (`<!-- agent-self-review -->`) reports no unresolved
//      blocking findings.
//   3. The PR body discloses autonomous authorship.
//
// It NEVER merges. After promotion it flips draft → ready, swaps the
// `agent:iterating` label for `agent:needs-human-review`, and posts a hand-off
// comment. The final review + merge stay human, enforced by branch protection.
//
// Usage:
//   node ./scripts/agent/mark-ready.mjs <pr-number> [--promote]
//     (default is a dry run that only reports gate status and exits non-zero if
//      the PR is not ready; pass --promote to actually flip the PR to ready)
//
// Requires the `gh` CLI authenticated via GH_TOKEN / GITHUB_TOKEN.

import { execFileSync } from "node:child_process";

const prNumber = process.argv[2];
const promote = process.argv.includes("--promote");

if (!prNumber || !/^\d+$/.test(prNumber)) {
  console.error("Usage: node ./scripts/agent/mark-ready.mjs <pr-number> [--promote]");
  process.exit(2);
}

const SELF_REVIEW_MARKER = "<!-- agent-self-review -->";
const VERIFICATION_MARKER = "<!-- harness-verification -->";
const HANDOFF_MARKER = "<!-- agent-handoff -->";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

// --- gather PR state -------------------------------------------------------

let pr;
try {
  pr = ghJson([
    "pr",
    "view",
    prNumber,
    "--json",
    "number,body,isDraft,labels,headRefName,comments,url",
  ]);
} catch (err) {
  console.error(`Failed to read PR #${prNumber}: ${err.message}`);
  process.exit(2);
}

const comments = pr.comments ?? [];
const body = pr.body ?? "";

// --- gate 1: CI verification evidence --------------------------------------

const verificationComment = comments.find((c) => (c.body ?? "").includes(VERIFICATION_MARKER));
const verificationBody = verificationComment?.body ?? "";

// The comment renders each lane as "## Verification: verify:self" followed by
// "**Result:** ✅ PASS" / "❌ FAIL". Capture the FIRST result icon after the
// section header — a non-greedy match anchored to the first "Result:**" so a
// failing verify:self can't fall through to verify:integration's ✅.
function laneResultIcon(section) {
  const re = new RegExp(`Verification: ${section}[\\s\\S]*?Result:\\*\\*\\s*(✅|❌|⏭️)`);
  const m = verificationBody.match(re);
  return m ? m[1] : null;
}

const selfPassed = laneResultIcon("verify:self") === "✅";
const integrationPassed = laneResultIcon("verify:integration") === "✅";
// An explicit skip reason in the PR body lets a PR that legitimately doesn't
// touch integration paths still qualify (mirrors the PR template checkbox).
const integrationSkipReason = /Skip reason \(if applicable\):\s*\S/.test(body);

const ciGate = Boolean(verificationComment) && selfPassed && (integrationPassed || integrationSkipReason);

// --- gate 2: self-review clean ---------------------------------------------

const selfReviewComment = comments.find((c) => (c.body ?? "").includes(SELF_REVIEW_MARKER));
const selfReviewBody = selfReviewComment?.body ?? "";
// Anchor the word so "self-review: cleanup needed" does not read as clean.
const selfReviewClean = /self-review:\s*clean\b(?!\w)/i.test(selfReviewBody);

// --- gate 3: AI disclosure -------------------------------------------------

const disclosure =
  /autonomous/i.test(body) &&
  /(claude|ai[- ]assist|ai tools)/i.test(body);

// --- report ----------------------------------------------------------------

const gates = [
  { name: "CI verification (verify:self ✅ + verify:integration ✅/skip)", ok: ciGate },
  { name: "Self-review clean (no unresolved blocking findings)", ok: selfReviewClean },
  { name: "AI authorship disclosed in PR body", ok: disclosure },
];

console.log(`Ready-gate report for PR #${prNumber} (${pr.url})`);
for (const g of gates) {
  console.log(`  ${g.ok ? "✅" : "❌"} ${g.name}`);
}

const allOk = gates.every((g) => g.ok);

if (!allOk) {
  console.log("\nNot promoting: one or more gates are not satisfied.");
  process.exit(1);
}

if (!promote) {
  console.log("\nAll gates satisfied. Re-run with --promote to flip the PR to ready.");
  process.exit(0);
}

if (!pr.isDraft) {
  console.log("\nPR is already marked ready — nothing to do.");
  process.exit(0);
}

// --- promote ---------------------------------------------------------------

gh(["pr", "ready", prNumber]);

// Swap labels (best-effort; a missing label must not abort the promotion or
// block the hand-off comment below). `gh` will not create an absent label.
try {
  gh(["pr", "edit", prNumber, "--remove-label", "agent:iterating"]);
} catch {
  /* label may not be present */
}
try {
  gh(["pr", "edit", prNumber, "--add-label", "agent:needs-human-review"]);
} catch {
  console.warn(
    "Could not add 'agent:needs-human-review' label — create it in the repo's " +
      "label settings so provenance stays queryable.",
  );
}

const handoff = [
  HANDOFF_MARKER,
  "## 🤝 Ready for human review",
  "",
  "This PR was authored autonomously by Claude Code and has cleared the harness",
  "ready gate:",
  "",
  "- ✅ CI verification (`verify:self` and `verify:integration`) is green.",
  "- ✅ Self-review over the full diff reported no unresolved blocking findings.",
  "- ✅ Autonomous authorship is disclosed in the PR body.",
  "",
  "**No human has verified these changes yet — please review every line.** The",
  "approving reviewer is the accountable signer, exactly as `CONTRIBUTING.md`",
  "requires. Merge, release, and deploy remain manual.",
].join("\n");

gh(["pr", "comment", prNumber, "--body", handoff]);

console.log(`\nPromoted PR #${prNumber} to ready and requested human review.`);
