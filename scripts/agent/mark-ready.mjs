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
//   node ./scripts/agent/mark-ready.mjs <pr-number> [--promote] [--require-checks a,b,c]
//     (default is a dry run that only reports gate status and exits non-zero if
//      the PR is not ready; pass --promote to actually flip the PR to ready)
//     --require-checks: comma-separated check-run names that must ALL be success
//      (defaults to the review-panel lens checks below).
//
// Requires the `gh` CLI authenticated via GH_TOKEN / GITHUB_TOKEN.

import { execFileSync } from "node:child_process";
import { allRequiredPassed } from "./checks.mjs";

const prNumber = process.argv[2];
const promote = process.argv.includes("--promote");

if (!prNumber || !/^\d+$/.test(prNumber)) {
  console.error("Usage: node ./scripts/agent/mark-ready.mjs <pr-number> [--promote] [--require-checks a,b,c]");
  process.exit(2);
}

const HANDOFF_MARKER = "<!-- agent-handoff -->";
const DEFAULT_REVIEW_CHECKS = [
  "agent-review-correctness",
  "agent-review-security",
  "agent-review-design-fit",
  "agent-review-test-adequacy",
];
const rcIdx = process.argv.indexOf("--require-checks");
// Absent flag → defaults. Explicit `--require-checks ""` → empty set. Only the
// missing flag falls back to DEFAULT; an explicitly empty value must NOT (else
// an all-advisory / no-blocking-lens panel would be pinned against four
// never-posted default checks and could never promote).
const REQUIRED_CHECKS =
  rcIdx === -1
    ? DEFAULT_REVIEW_CHECKS
    : (process.argv[rcIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// FAIL CLOSED on an empty required-check set. `allRequiredPassed(runs, [])` is
// vacuously true (`[].every` → true), so an empty set would satisfy gate 2 with
// ZERO review evidence — a fail-open in a component whose whole job is to fail
// closed. It's unreachable with today's manifest (four lenses, all blocking,
// all appliesWhen "**", so the panel always emits ≥1 required check), but a
// future narrow-glob lens or an empty changed-file set could produce it. Treat
// it as a tooling error unless the caller OPTS IN explicitly.
if (REQUIRED_CHECKS.length === 0 && !process.argv.includes("--allow-no-checks")) {
  console.error(
    "Refusing to promote with an empty required-check set: gate 2 (review-panel " +
      "approval) would pass with no evidence. Pass --allow-no-checks only if a " +
      "no-blocking-lens panel is genuinely intended.",
  );
  process.exit(2);
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

// The promotion mutations (mark ready / labels / hand-off comment) need a token
// that can perform markPullRequestReadyForReview. The default GITHUB_TOKEN
// CANNOT — it returns "Resource not accessible by integration", which silently
// left gate-passing PRs stuck as drafts. Use GH_MUTATION_TOKEN (a GitHub App
// token) for these calls when provided; otherwise fall back to the default `gh`
// token (e.g. local dry runs).
function ghMutate(args) {
  const token = process.env.GH_MUTATION_TOKEN;
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  return execFileSync("gh", args, { encoding: "utf8", env });
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

// --- gate 2: every required review-panel lens check passed -----------------

// Evidence-based: read the per-lens `agent-review-<lens>` check runs on the PR
// head SHA. Only the review-panel workflow (checks:write) can post them; the
// author agent cannot forge them. The pass logic lives in checks.mjs (tested).
function reviewChecks(sha) {
  if (!sha) return { allPassed: false, perCheck: {} };
  let data;
  try {
    data = ghJson(["api", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`]);
  } catch {
    return { allPassed: false, perCheck: Object.fromEntries(REQUIRED_CHECKS.map((c) => [c, false])) };
  }
  return allRequiredPassed(data.check_runs ?? [], REQUIRED_CHECKS);
}

const { allPassed: reviewApproved, perCheck } = reviewChecks(pr.headRefOid);

// --- gate 3: AI disclosure -------------------------------------------------

const disclosure =
  /autonomous/i.test(body) &&
  /(claude|ai[- ]assist|ai tools)/i.test(body);

// --- report ----------------------------------------------------------------

const gates = [
  { name: "CI verification (verify:self ✅ + verify:integration ✅/skip)", ok: ciGate },
  { name: `Review panel approved (all lens checks ✅: ${REQUIRED_CHECKS.join(", ")})`, ok: reviewApproved },
  { name: "AI authorship disclosed in PR body", ok: disclosure },
];

console.log(`Ready-gate report for PR #${prNumber} (${pr.url})`);
for (const g of gates) {
  console.log(`  ${g.ok ? "✅" : "❌"} ${g.name}`);
}
if (!reviewApproved) {
  for (const c of REQUIRED_CHECKS) console.log(`      ${perCheck[c] ? "✅" : "❌"} ${c}`);
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

// Flip draft → ready. This is the one mutation the default GITHUB_TOKEN can't
// do; a failure here is a permission/tooling problem, NOT a gate failure — exit
// 3 (distinct from the exit-1 "gates not satisfied") with a clear message so the
// workflow surfaces it loudly (and the stalled net pages a human) instead of
// silently leaving the PR a draft.
try {
  ghMutate(["pr", "ready", prNumber]);
} catch (err) {
  console.error(
    `\nAll ready-gates passed, but flipping PR #${prNumber} to ready FAILED: ${err.message}\n` +
      "This is a permission/tooling problem, not a gate failure. The promote job " +
      "must pass a GitHub App token via GH_MUTATION_TOKEN that can mark a PR ready — " +
      "the default GITHUB_TOKEN cannot (markPullRequestReadyForReview).",
  );
  process.exit(3);
}

// Swap labels (best-effort; a missing label must not abort the promotion or
// block the hand-off comment below). `gh` will not create an absent label.
try {
  ghMutate(["pr", "edit", prNumber, "--remove-label", "agent:iterating"]);
} catch {
  /* label may not be present */
}
try {
  ghMutate(["pr", "edit", prNumber, "--add-label", "agent:needs-human-review"]);
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
  `- ✅ The review panel approved with no blocking findings (${REQUIRED_CHECKS.join(", ")}).`,
  "- ✅ Autonomous authorship is disclosed in the PR body.",
  "",
  "**No human has verified these changes yet — please review every line.** The",
  "approving reviewer is the accountable signer, exactly as `CONTRIBUTING.md`",
  "requires. Merge, release, and deploy remain manual.",
].join("\n");

// Best-effort: the PR is already flipped to ready; don't fail the promotion if
// the hand-off comment can't be posted.
try {
  ghMutate(["pr", "comment", prNumber, "--body", handoff]);
} catch (err) {
  console.warn(`PR flipped to ready, but posting the hand-off comment failed: ${err.message}`);
}

console.log(`\nPromoted PR #${prNumber} to ready and requested human review.`);
