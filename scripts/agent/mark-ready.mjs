// Ready gate for the autonomous contribution loop.
//
// Promotes an agent-authored draft PR to "ready for human review" ONLY when the
// hand-off preconditions all hold. Gates 1 and 2 are UNFORGEABLE — they read
// evidence a separate actor produced that the author agent cannot fabricate:
//
//   1. The "CI" workflow run for the PR head SHA concluded `success` (read via
//      the Actions API — the author agent cannot create or forge a CI run; this
//      replaces parsing the <!-- harness-verification --> comment, which the
//      author's issues:write could post).
//   2. The `agent-independent-review` check run on the PR head SHA concluded
//      `success` — an INDEPENDENT reviewer approved it. Only the reviewer
//      workflow (which has checks:write) can post that check, so the author
//      agent cannot forge its own approval.
//
// Gate 3 is a REQUIRED SELF-DISCLOSURE, not separate-actor evidence — the author
// agent writes the PR body. It is not adversary-proof (a truthful agent has no
// incentive to hide its own authorship; a dishonest one simply stays a draft).
// It is belt-and-suspenders with the commit-trailer hook:
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

const HANDOFF_MARKER = "<!-- agent-handoff -->";
const REVIEW_CHECK_NAME = "agent-independent-review";

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
    "number,body,isDraft,labels,headRefName,headRefOid,url",
  ]);
} catch (err) {
  console.error(`Failed to read PR #${prNumber}: ${err.message}`);
  process.exit(2);
}

const body = pr.body ?? "";

// --- gate 1: CI passed (authoritative, not the author-writable PR comment) --

// Read the "CI" workflow-run conclusion for the PR head SHA via the Actions API.
// The author agent's workflows cannot create a CI workflow run or forge its
// conclusion, so this is evidence a separate actor (GitHub Actions) produced —
// unlike the <!-- harness-verification --> PR comment, which the author agent
// could post itself with issues:write. A workflow run concludes "success" only
// when every CI job (verify-self / verify-browser / verify-integration) passed.
function ciPassed(sha) {
  if (!sha) return false;
  let data;
  try {
    data = ghJson(["api", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`]);
  } catch {
    return false;
  }
  const runs = (data.workflow_runs ?? []).filter((r) => r.name === "CI");
  if (runs.length === 0) return false;
  // Latest CI run for this SHA wins (handles re-runs).
  runs.sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));
  return runs[0].conclusion === "success";
}

const ciGate = ciPassed(pr.headRefOid);

// --- gate 2: independent review approved -----------------------------------

// Evidence-based: read the `agent-independent-review` check run on the PR head
// SHA. Only the reviewer workflow can post it; the author agent cannot.
function independentReviewApproved(sha) {
  if (!sha) return false;
  let data;
  try {
    data = ghJson(["api", `repos/{owner}/{repo}/commits/${sha}/check-runs`]);
  } catch {
    return false;
  }
  const runs = (data.check_runs ?? []).filter((r) => r.name === REVIEW_CHECK_NAME);
  if (runs.length === 0) return false;
  // Newest first, so re-reviews on the same SHA use the latest verdict.
  runs.sort((a, b) => new Date(b.started_at ?? 0) - new Date(a.started_at ?? 0));
  return runs[0].conclusion === "success";
}

const reviewApproved = independentReviewApproved(pr.headRefOid);

// --- gate 3: AI disclosure -------------------------------------------------

const disclosure =
  /autonomous/i.test(body) &&
  /(claude|ai[- ]assist|ai tools)/i.test(body);

// --- report ----------------------------------------------------------------

const gates = [
  { name: "CI verification (verify:self ✅ + verify:integration ✅/skip)", ok: ciGate },
  { name: `Independent review approved (${REVIEW_CHECK_NAME} check ✅)`, ok: reviewApproved },
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
  "- ✅ An independent reviewer (`agent-independent-review`) approved with no blocking findings.",
  "- ✅ Autonomous authorship is disclosed in the PR body.",
  "",
  "**No human has verified these changes yet — please review every line.** The",
  "approving reviewer is the accountable signer, exactly as `CONTRIBUTING.md`",
  "requires. Merge, release, and deploy remain manual.",
].join("\n");

gh(["pr", "comment", prNumber, "--body", handoff]);

console.log(`\nPromoted PR #${prNumber} to ready and requested human review.`);
