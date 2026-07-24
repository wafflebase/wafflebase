// CLI glue for the "Review-round guard" step in agent-review-panel.yml's
// `fix` job. Runs from a TRUSTED `ref: main` checkout (never the PR branch),
// so attacker-controlled branch code can never alter this gate's logic.
//
// Deliberately a plain `gh`-CLI-driven script (mirrors mark-ready.mjs), NOT
// `actions/github-script` — there is no precedent anywhere in this repo's
// workflows for dynamically importing a local ES module from inside a
// github-script sandbox, and this lets rounds.mjs be imported the normal,
// already-precedented way (see mark-ready.mjs's `import { allRequiredPassed }
// from "./checks.mjs"`).
//
// Usage (GH_TOKEN must be set):
//   node ./scripts/agent/review-round-guard.mjs <pr> <max-rounds> <all-valid:true|false> <required-checks-csv>
// Writes `paged` and `proceed` ("true"/"false") to $GITHUB_OUTPUT.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { countFailedReviewRounds } from "./rounds.mjs";

const [, , prArg, maxArg, allValidArg, requiredChecksArg] = process.argv;
const pr = Number(prArg);
const max = parseInt(maxArg, 10);
const allValid = allValidArg === "true";
const requiredCheckNames = (requiredChecksArg ?? "").split(",").filter(Boolean);

if (!Number.isInteger(pr) || pr <= 0 || !Number.isFinite(max)) {
  console.error(
    "Usage: node ./scripts/agent/review-round-guard.mjs <pr> <max-rounds> <all-valid> <required-checks-csv>",
  );
  process.exit(2);
}

const PAGED = "<!-- agent-review-paged -->";

function setOutput(name, value) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}
function ghJson(args) {
  return JSON.parse(gh(args));
}

// Bare-array endpoints: `--paginate` alone merges all pages into ONE valid
// JSON array (verified against a real multi-page response). Do NOT add
// --slurp here — that changes the shape to an array of per-page arrays.
function listAll(path) {
  return ghJson(["api", path, "--paginate"]);
}

function page(msg) {
  gh(["pr", "comment", String(pr), "--body", `${PAGED}\n🛑 ${msg}`]);
  // Just post the comment and latch `paged`. The single mutually-exclusive
  // `agent:blocked` state label is applied by the "Set state → blocked (paged)"
  // step (set-state.mjs), gated on this `paged` output — do NOT add a label
  // here. (#538 replaced the old additive `agent:needs-human-review` label.)
  setOutput("paged", "true");
  setOutput("proceed", "false");
}

// PAGED latch: paginate ALL comments (an iterating PR can exceed one page),
// so a later page isn't missed and the fix loop doesn't re-fire after a human
// was already paged.
const comments = listAll(`repos/{owner}/{repo}/issues/${pr}/comments?per_page=100`);
if (comments.some((c) => (c.body ?? "").includes(PAGED))) {
  setOutput("proceed", "false");
  process.exit(0);
}

// A lens that failed CLOSED (no valid verdict) → structural problem, page now.
if (!allValid) {
  page(`A review lens did not produce a valid verdict. A human should review PR #${pr}.`);
  process.exit(0);
}

// Object-wrapped-array endpoint (`{ total_count, check_runs: [] }`): plain
// `--paginate` concatenates raw per-page JSON objects, which is NOT valid
// single JSON (verified) — `--slurp` wraps each page as an array element
// instead; flatten `check_runs` across pages ourselves.
//
// Deliberately does NOT catch/swallow errors here (unlike mark-ready.mjs's
// read helpers, which fail closed by returning false): an uncaught throw
// fails this step, which fails the `fix` job, which the `stalled` job's
// safety net (its own page()) already catches and hands to a human. Silently
// treating an unreadable commit as "no failing checks" would under-count
// failedRounds and could let the loop run an extra round instead.
function checkRunsFor(sha) {
  const pages = ghJson(["api", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`, "--paginate", "--slurp"]);
  return pages.flatMap((p) => p.check_runs ?? []);
}

const commits = listAll(`repos/{owner}/{repo}/pulls/${pr}/commits?per_page=100`);
for (const c of commits) c.checkRuns = checkRunsFor(c.sha);

const failedRounds = countFailedReviewRounds(commits, requiredCheckNames);
if (failedRounds >= max) {
  page(
    `The review panel requested changes ${failedRounds} times (limit ${max}) without converging. A human should take over on PR #${pr}.`,
  );
  process.exit(0);
}

setOutput("proceed", "true");
