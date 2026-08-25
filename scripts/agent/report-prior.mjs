// The reports already known — so a person is told "that one is filed" instead of
// having it filed twice.
//
// `report-intake.mjs` has always accepted a `--prior` LEDGER of past reports.
// This adds the other half the design asked for: the repository's OPEN ISSUES,
// which is where a defect someone else already reported actually lives.
//
// **THE COMPARISON IS DICE, NOT CONTAINMENT, AND THAT IS THE WHOLE DESIGN.**
// `tokenOverlap` divides by `min(|a|, |b|)` and its own docblock warns it is
// "BLIND TO THE LONGER OPERAND". A debug report is ONE SENTENCE; an issue body is
// paragraphs. Under containment, an issue whose body happens to contain most of a
// short sentence's words scores 1.0 — so "the toolbar icons are cramped" would be
// absorbed into a long unrelated issue, routed to `duplicate`, and NEVER FILED.
// Silently losing a report to a wrong match is far worse than filing a second
// one, so report-vs-issue uses `crossArmTokenOverlap` (Dice), which this
// repository already keeps for exactly this asymmetry.
//
// Issue text is UNTRUSTED — anyone who can open an issue writes it. It is read as
// data, never as instructions: only a number, a URL and a truncated title ever
// reach the plan, and the body is used for scoring and then dropped.
//
// Usage:
//   node report-prior.mjs [--repo owner/name] [--limit N] [--out prior.json]

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gh } from "./gh-checks.mjs";
import { findingKey } from "./finding-key.mjs";

/** How many open issues to read. Beyond this, older issues stop being checked. */
export const PRIOR_ISSUE_LIMIT = 200;

/** Titles longer than this are truncated before they reach the plan. */
export const MAX_TITLE = 120;

/**
 * A body longer than this is truncated before scoring.
 *
 * Not for cost — for honesty. Dice already penalises a long operand, and a
 * 4,000-word issue scored against one sentence produces a number too small to
 * mean anything either way. Truncating keeps the comparison between comparable
 * things.
 */
export const MAX_BODY_FOR_SCORING = 2000;

/**
 * Strip what makes text lie about itself.
 *
 * The SAME rule as `notification.service.ts`'s preview flattener, deliberately —
 * one semantic for "untrusted text a stranger wrote that a person will read",
 * not two. It cannot be imported: that is NestJS TypeScript and this is a script
 * outside the workspace.
 */
function plain(text) {
  return (
    String(text ?? "")
      // Invisible formatting characters are removed OUTRIGHT: a zero-width space
      // turned into a real space would split a word — and here that changes how
      // the text tokenises, so it changes the duplicate score.
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
      // C0/C1 controls become spaces — the newlines of a multi-line issue body
      // are word separators, not nothing.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * One issue in the shape `readPrior` already returns.
 *
 * `key` is built from the title alone: an issue carries no semantic address, so
 * there is no `file` slot to fill, and inventing one would make the exact-key
 * test fire on unrelated things. The prose test does the work here.
 */
export function priorFromIssue(issue) {
  const title = plain(issue?.title).slice(0, MAX_TITLE);
  const body = plain(issue?.body).slice(0, MAX_BODY_FOR_SCORING);
  return {
    key: findingKey({ file: "", summary: title }),
    // Title FIRST, body second: the title is the part written to identify the
    // defect, and truncation must never cost it.
    text: body ? `${title} ${body}` : title,
    ref: `#${issue?.number}`,
    title,
    url: issue?.url ?? null,
    // Marks which comparison applies. A ledger entry written by this pipeline is
    // one sentence against one sentence, where containment is defensible; an
    // issue body is not.
    source: "issue",
  };
}

/**
 * The open issues, as prior reports.
 *
 * Returns `[]` on any failure rather than throwing: `gh` may be absent, the
 * caller may be offline, or the repository may be private to them. The cost of
 * getting this wrong is one duplicate comment; the cost of refusing to run is a
 * report nobody sees — the same trade `readPrior` already makes for a missing
 * ledger.
 */
export function openIssuesAsPrior({
  repo = null,
  limit = PRIOR_ISSUE_LIMIT,
  api = gh,
  log = console.error,
} = {}) {
  const args = [
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    String(limit),
    "--json",
    "number,title,body,url",
  ];
  if (repo) args.push("--repo", repo);
  try {
    const issues = api(args);
    return Array.isArray(issues) ? issues.map(priorFromIssue) : [];
  } catch (err) {
    log(`Could not read open issues (${err.message}); carrying none.`);
    return [];
  }
}

function argOf(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function main(argv) {
  const limit = Number(argOf(argv, "--limit") ?? PRIOR_ISSUE_LIMIT);
  const prior = openIssuesAsPrior({
    repo: argOf(argv, "--repo") ?? null,
    limit: Number.isFinite(limit) && limit > 0 ? limit : PRIOR_ISSUE_LIMIT,
  });
  const out = argOf(argv, "--out");
  if (out) writeFileSync(out, `${JSON.stringify(prior, null, 2)}\n`);
  process.stdout.write(`${prior.length} open issue(s) read as prior reports\n`);
  if (!out) process.stdout.write(`${JSON.stringify(prior)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
