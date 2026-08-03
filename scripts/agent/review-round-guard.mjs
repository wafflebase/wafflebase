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
//   node ./scripts/agent/review-round-guard.mjs <pr> <max-rounds> <all-valid:true|false> <required-checks-csv> [infra-detail]
// Writes `paged` and `proceed` ("true"/"false") to $GITHUB_OUTPUT.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import {
  countFailedReviewRounds,
  groupReviewRounds,
  detectStalledRounds,
  DEFAULT_SIMILARITY,
  PAGED_LATCH,
  isPagedLatchComment,
} from "./rounds.mjs";

const [, , prArg, maxArg, allValidArg, requiredChecksArg, infraArg] = process.argv;
const pr = Number(prArg);
const max = parseInt(maxArg, 10);
const allValid = allValidArg === "true";
const requiredCheckNames = (requiredChecksArg ?? "").split(",").filter(Boolean);
// Non-empty when EVERY blocking lens failed on an API/quota error (the panel
// never ran) — a distinct, non-code failure worth its own honest hand-off.
const infra = (infraArg ?? "").trim();

// Convergence tuning, read from the env rather than added as a 6th and 7th
// positional: this script already takes five, and keeping it env-driven means
// the feature ships without a workflow edit (the agent App cannot push
// .github/workflows/**).
const stallRepeats = Number(process.env.STALL_REPEATS) || 2;
const stallSimilarity = Number(process.env.STALL_SIMILARITY) || DEFAULT_SIMILARITY;

if (!Number.isInteger(pr) || pr <= 0 || !Number.isFinite(max)) {
  console.error(
    "Usage: node ./scripts/agent/review-round-guard.mjs <pr> <max-rounds> <all-valid> <required-checks-csv> [infra-detail]",
  );
  process.exit(2);
}

// Imported, not re-declared: agent-review-panel.yml's `gate` job now reads the
// same latch to stop running the panel, so a second literal here would be a
// second thing to keep in sync. See PAGED_LATCH's docblock in rounds.mjs.
const PAGED = PAGED_LATCH;

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

// Appended to every page. The latch does not just stop the fixer any more —
// agent-review-panel.yml's `gate` job reads it too and stops running the panel,
// so from here on there are no fresh lens verdicts and nothing will flip the
// PR to ready. Saying so is the difference between a handoff and a PR that
// looks like it is still being worked on.
const HANDOFF_NOTE =
  "\n\nThe review panel will not run again on this PR, so the " +
  "`agent-review-*` checks are now frozen at their current state and the ready " +
  "gate will not promote it. Review and merge it manually.";

function page(msg) {
  gh(["pr", "comment", String(pr), "--body", `${PAGED}\n🛑 ${msg}${HANDOFF_NOTE}`]);
  // Labeling is intentionally NOT done here: the single-value state machine
  // owns it. The "Set state → blocked (paged)" step (gated on this `paged`
  // output) runs set-state.mjs, which atomically strips every lifecycle label
  // and sets agent:blocked. Writing agent:needs-human-review here would only
  // be immediately overwritten and contradicts that clean single-label cutover.
  setOutput("paged", "true");
  setOutput("proceed", "false");
}

// PAGED latch: paginate ALL comments (an iterating PR can exceed one page),
// so a later page isn't missed and the fix loop doesn't re-fire after a human
// was already paged.
// AUTHOR-CHECKED: this repo is public, so a body test alone would let any
// GitHub account stop the fix loop by pasting the marker. See
// isPagedLatchComment.
const comments = listAll(`repos/{owner}/{repo}/issues/${pr}/comments?per_page=100`);
if (comments.some(isPagedLatchComment)) {
  setOutput("proceed", "false");
  process.exit(0);
}

// API/quota outage (every blocking lens failed on an API error) → the reviewer
// never ran. Page with the REAL reason and DO NOT dispatch the fixer or count a
// round — there's nothing to fix, and a quota outage isn't a failed review
// round. Checked before the generic all_valid page so the message is honest.
if (infra) {
  page(
    `The review panel could not run — Claude API/quota error: ${infra} ` +
      `This is an infrastructure/credential issue, not a code problem. Re-run the panel after the limit resets.`,
  );
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

// CONVERGENCE, checked before the round cap. A loop that keeps re-raising the
// same findings without reducing them has already failed; saying *that* is more
// actionable than "we hit 5 rounds", and it pages ~2 rounds sooner. Same
// ordering rationale as the INFRA branch above: the more specific reason wins.
//
// The list response for commits/{sha}/check-runs can omit or truncate
// output.text (the panel workflow's own "Read prior findings" step does a
// separate checks.get for exactly this reason), so back-fill it — but only for
// the newest rounds convergence actually inspects, and only where it is
// missing. Bounded to about (rounds x lenses) extra calls, usually zero.
const lensNames = new Set(requiredCheckNames);
const isLensRun = (r) => lensNames.has(r.name) && r.app?.slug === "github-actions";
for (const c of commits.filter((x) => (x.checkRuns ?? []).some(isLensRun)).slice(-(stallRepeats + 1))) {
  for (const r of c.checkRuns) {
    if (!isLensRun(r) || (typeof r.output?.text === "string" && r.output.text !== "")) continue;
    // A failure here leaves output.text absent, which groupReviewRounds treats
    // as a PARTIAL round — that breaks the stall run rather than inventing one.
    try {
      r.output = ghJson(["api", `repos/{owner}/{repo}/check-runs/${r.id}`]).output ?? r.output;
    } catch {
      /* fail toward not paging */
    }
  }
}

const stall = detectStalledRounds(groupReviewRounds(commits, requiredCheckNames), {
  minRepeats: stallRepeats,
  similarity: stallSimilarity,
});
console.error(`convergence: ${stall.reason} (stalls=${stall.stalls}, rounds=${stall.rounds})`);
if (stall.stalled) {
  const named = stall.repeated
    .slice(0, 5)
    .map((f) => `\`${f.file || "?"}\` — ${String(f.summary ?? "").slice(0, 160)}`)
    .join("; ");
  page(
    `The review panel is re-raising the same findings without resolving them ` +
      `(${stall.stalls + 1} consecutive rounds with no reduction in blocking findings). ` +
      `Repeated: ${named}. Another fix round would spend budget on the same ground — ` +
      `a human should take over on PR #${pr}.`,
  );
  process.exit(0);
}

const failedRounds = countFailedReviewRounds(commits, requiredCheckNames);
if (failedRounds >= max) {
  page(
    `The review panel requested changes ${failedRounds} times (limit ${max}) without converging. A human should take over on PR #${pr}.`,
  );
  process.exit(0);
}

setOutput("proceed", "true");
