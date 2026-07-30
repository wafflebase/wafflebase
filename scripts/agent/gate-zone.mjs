// The GATE ZONE: the files that decide whether a PR may be promoted.
//
// WHY THIS EXISTS. `.github/workflows/**` is already protected — the agent App has
// no `workflows` scope, which is what rejected #564's push, and that restriction is
// load-bearing rather than annoying: `ci.yml` runs on `pull_request`, so a branch
// that could rewrite workflows could make CI pass on its own PR and defeat
// `mark-ready.mjs` gate 1 in one commit. NEVER grant the App that scope.
//
// Every OTHER file that defines the gate is unprotected, and the agent edits them
// routinely — #564 rewrote `lenses.json` itself, #525/#526/#550 changed the
// orchestrator and the round guard, and this series has changed nine of the files
// listed below. `CODEOWNERS` covers them for human review, which is exactly the
// control that disappears the day a human stops reviewing.
//
// SHADOW MODE. Nothing here blocks anything. `metrics.mjs summarize` renders a
// `Merge-eligibility:` line so the decision this WOULD make accumulates against
// what humans actually did. 13 of 19 merged agent PRs were pipeline
// self-improvement; gating promotion on a gate-zone hit today would stop the
// pipeline improving itself overnight. Flipping it from advisory to blocking is a
// one-line change, made later, on evidence.
//
// Auto-merge safety comes from narrowing the class of change that is ELIGIBLE, not
// from trusting the reviewer more. Dependabot patch bumps are safe because the diff
// shape is mechanically verifiable, not because something reviewed them well.

import { globToRegExp } from "./review-panel.mjs";

/**
 * Files whose contents decide whether code can be promoted.
 *
 * DELIBERATELY hand-written, not derived. Membership is a judgement about what
 * "decides the gate" means, and a derived list could not express the exclusions
 * below. But a hand-written list is also how `DEFAULT_REVIEW_CHECKS` nearly rotted,
 * so `gate-zone.test.mjs` derives the import closure of `GATE_ENTRY_POINTS` and
 * fails if anything in it is neither listed here nor explicitly excluded. Adding a
 * gate dependency without a decision is what that test makes impossible.
 */
export const GATE_ZONE = [
  // --- the gate's own definition -------------------------------------------
  ".github/workflows/**", // already unpushable by the App; named so the boundary is complete
  ".github/CODEOWNERS", // who must approve
  "scripts/agent/gate-zone.mjs", // self-protecting
  // --- the promotion decision ----------------------------------------------
  "scripts/agent/mark-ready.mjs", // the ready gate: CI + required checks + disclosure
  "scripts/agent/checks.mjs", // allRequiredPassed, DEFAULT_REVIEW_CHECKS
  "scripts/agent/disclosure.mjs", // mark-ready gate 3
  // --- what counts as a blocking finding -----------------------------------
  "scripts/agent/review-panel.mjs", // isDroppingVerdict, keepUnrefuted, gatingFindings, panelEntry
  "scripts/agent/severity.mjs", // BLOCKING, classify, normalizeSeverity
  "scripts/agent/novelty.mjs", // DEMOTING_ORIGINS — whether a finding gates AT ALL
  "scripts/agent/citation.mjs", // what counts as evidence for a refutation
  "scripts/agent/lenses/**", // gating flags, scopes, and the rubrics themselves
  // --- what gets reviewed, and whether the loop keeps going -----------------
  "scripts/agent/review-state.mjs", // whether code is reviewed at all (narrowing)
  "scripts/agent/review-scope.mjs", // ditto, the caller
  "scripts/agent/gh-checks.mjs", // the gate's inputs from the checks API
  "scripts/agent/prior-findings.mjs", // the cross-round re-check's input
  "scripts/agent/rounds.mjs", // round grouping + stall detection
  "scripts/agent/review-round-guard.mjs", // when to page a human
  // --- the capability boundary ---------------------------------------------
  // ask.mjs owns PERMITTED_TOOLS. Widening it hands a model that is reading an
  // untrusted diff the ability to execute — a larger hole than any verdict rule.
  "scripts/agent/ask.mjs",
];

/**
 * Where the gate decision starts. The test walks their local imports transitively.
 * These are the scripts the panel workflow runs to DECIDE something, not to report
 * it — `metrics.mjs` is invoked on the same path and is deliberately absent.
 */
export const GATE_ENTRY_POINTS = [
  "mark-ready.mjs",
  "review-panel.mjs",
  "review-round-guard.mjs",
  "review-scope.mjs",
  "prior-findings.mjs",
];

/**
 * In a gate entry point's import closure, but NOT gate-deciding. Each needs a
 * reason, because "it was never considered" and "it was considered and excluded"
 * are indistinguishable from an absence.
 */
export const NON_GATE = {
  // mark-ready imports `computeLabelSet` to apply a label AFTER it has decided.
  // Labels are an advisory projection of state, never an input to it — the three
  // gates are CI, required checks, and disclosure.
  "set-state.mjs":
    "labels only; mark-ready imports it to project the decision, not to make it",
};

/**
 * Which changed files touch the gate zone. Names only, in input order.
 *
 * Junk in → `[]` rather than a throw, because this must never be the reason a
 * metrics comment fails to render. The CALLER carries the other half of that:
 * once this gates anything, an unreadable file list must be treated as INELIGIBLE,
 * never as clean — see `isMergeEligible`, which requires a usable list.
 */
export function gateZoneHits(changedFiles, zone = GATE_ZONE) {
  const files = (Array.isArray(changedFiles) ? changedFiles : []).filter(
    (f) => typeof f === "string" && f.trim() !== "",
  );
  const globs = (Array.isArray(zone) ? zone : []).filter((g) => typeof g === "string" && g !== "");
  const res = globs.map(globToRegExp);
  return files.filter((f) => res.some((r) => r.test(f.trim())));
}

/**
 * What the agent App CANNOT PUSH, whatever an issue asks of it. A strict subset of
 * the gate zone, and a different question:
 *
 *   GATE_ZONE  — "this should not be promoted without a human looking"
 *   UNPUSHABLE — "no agent run can deliver this at all"
 *
 * #563 conflated them and that is why #564 never converged: the issue bundled a
 * doable script change with a workflow-prompt change, design-fit correctly reported
 * an incomplete deliverable every round, and the fixer had nothing it could do
 * about it. Splitting the two lets the kickoff say so up front instead.
 */
export const UNPUSHABLE = [".github/workflows/**"];

/**
 * Path-like tokens in free text. Deliberately loose — this reads an issue body, so
 * it is a hint generator, not a parser. Only ever used to test against the globs
 * below; the extracted text is never echoed anywhere it could be interpreted.
 */
export function pathsMentionedIn(text) {
  if (typeof text !== "string" || text === "") return [];
  const out = new Set();
  // `a/b`, `a/b/c.ext`, `dir/**`, and backticked spans of the same.
  for (const m of text.matchAll(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.*-]+)+/g)) out.add(m[0]);
  return [...out];
}

/**
 * Which UNPUSHABLE globs an issue's text appears to require. Returns the GLOB
 * names, not the matched text — so a caller can put the result in a prompt without
 * relaying anything the issue author wrote.
 *
 * Fuzzy by construction: acceptance criteria are prose. It must therefore never
 * gate anything, only inform.
 */
export function unpushableAsksIn(text) {
  const mentioned = pathsMentionedIn(text);
  return UNPUSHABLE.filter((glob) => {
    const re = globToRegExp(glob);
    // A mention of the DIRECTORY counts too: an issue usually says
    // ".github/workflows/agent-implement.yml" but sometimes just "the workflows".
    const dir = glob.replace(/\/\*\*$/, "");
    return mentioned.some((p) => re.test(p) || p === dir || p.startsWith(`${dir}/`));
  });
}

/** Sample agreements that mean the panel did not agree with itself. */
const UNRELIABLE_AGREEMENT = new Set(["disjoint"]);
/** Rounds above this mean the loop struggled, whatever it concluded. */
const MAX_CLEAN_ROUNDS = 2;

/**
 * Would this PR be safe to merge without a human? ADVISORY — nothing reads this to
 * gate anything yet.
 *
 * Reports EVERY failing reason rather than short-circuiting: the interesting
 * question over months of shadow data is which conditions fire together, and a
 * first-failure-wins answer cannot say.
 *
 * Fails toward INELIGIBLE on unusable input. `gateZoneHits` returning `[]` for junk
 * is the right shape there (a report must not crash), but "we could not read the
 * changed files" must never read as "the PR changed nothing sensitive" — that is
 * the difference between a report and a gate, and this is the gate half.
 */
export function isMergeEligible(opts) {
  const { changedFiles, lensStats, rounds } = opts && typeof opts === "object" ? opts : {};
  const reasons = [];

  const files = Array.isArray(changedFiles)
    ? changedFiles.filter((f) => typeof f === "string" && f.trim() !== "")
    : null;
  if (files === null || files.length === 0) {
    // No list, or nothing usable in it. A PR always changes something, so this is
    // a broken input rather than an empty change.
    reasons.push("changed-files-unavailable");
  } else {
    const hits = gateZoneHits(files);
    if (hits.length > 0) reasons.push(`gate-zone: ${hits.slice(0, 5).join(", ")}`);
  }

  const stats = Array.isArray(lensStats) ? lensStats : null;
  if (stats === null) {
    reasons.push("lens-stats-unavailable");
  } else {
    const bad = stats
      .filter((e) => e && UNRELIABLE_AGREEMENT.has(e.agreement))
      .map((e) => e.id ?? "?");
    if (bad.length > 0) reasons.push(`sample-disagreement: ${bad.join(", ")}`);
  }

  // `rounds > 2` means the fix loop needed more than one correction. Not a defect
  // in itself, but it is the signal that most strongly separated the PRs humans
  // had to intervene on.
  if (!Number.isInteger(rounds) || rounds < 0) reasons.push("rounds-unavailable");
  else if (rounds > MAX_CLEAN_ROUNDS) reasons.push(`rounds: ${rounds}`);

  return { eligible: reasons.length === 0, reasons };
}

/** One line for the metrics comment. Never throws; unusable input still renders. */
export function renderMergeEligibility(opts) {
  const { eligible, reasons } = isMergeEligible(opts);
  return eligible ? "eligible" : `ineligible: ${reasons.join("; ")}`;
}
