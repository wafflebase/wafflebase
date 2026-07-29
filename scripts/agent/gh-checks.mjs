// Read a PR's check runs from the GitHub API, correctly.
//
// WHY THIS IS A MODULE AND NOT THREE COPIES. Two contracts of the check-runs API
// are non-obvious, and this repo has now got each of them wrong at least once:
//
//   1. `commits/{sha}/check-runs` returns an OBJECT (`{ total_count, check_runs }`),
//      so plain `gh api --paginate` concatenates raw per-page objects into text
//      that is NOT valid JSON. `--slurp` wraps each page as an array element
//      instead, and the caller flattens `check_runs` itself.
//   2. That list response OMITS or TRUNCATES `output.text`. Reading findings from
//      it yields nothing for a lens that had many — a truncated payload does not
//      even fail loudly, it just fails `JSON.parse` and gets skipped.
//
// Both were verified the hard way in review-round-guard.mjs, then re-broken in the
// first draft of prior-findings.mjs. Stating them once is the point of this file:
// a hand-written third copy is how one of them rots.
//
// FAIL DIRECTION. Every read here degrades to less data, never to a throw, and
// every `catch` is per-commit or per-run so one bad response cannot zero the rest.
// Both consumers can survive missing data (carry fewer prior findings; fall back
// to a full review) and neither can survive an outage of the whole panel.

import { execFileSync } from "node:child_process";

/** One `gh api` call, parsed. Injected as `api` in tests. */
export function gh(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
}

/**
 * `--flag value` pairs plus positionals in `_`, shared by the two CLIs in this
 * pair rather than copied into each.
 *
 * Two properties worth keeping in one place: the accumulator has a NULL prototype,
 * so `--__proto__ x` writes an ordinary key instead of setting the object's
 * prototype; and positionals are collected wherever they appear, so argument order
 * is not load-bearing (reading the PR number from `argv[2]` made a flag-first
 * invocation fail with a usage error).
 */
export function parseArgs(argv) {
  const a = Object.create(null);
  const positional = [];
  for (let i = 2; i < (Array.isArray(argv) ? argv.length : 0); i++) {
    const v = argv[i];
    if (typeof v !== "string") continue;
    if (v.startsWith("--")) { a[v.slice(2)] = argv[i + 1]; i++; } else positional.push(v);
  }
  a._ = positional;
  return a;
}

/**
 * Every commit on the PR with its check runs attached: `[{ sha, checkRuns }]`.
 *
 * All commits, not just the head: the last completed run for a lens may sit on an
 * earlier commit if that lens produced no verdict in the most recent round. The
 * shape matches what `rounds.mjs::groupReviewRounds` consumes, so a caller that
 * needs a round count can pass this straight through.
 *
 * `pulls/{pr}/commits` is a bare-array endpoint, where plain `--paginate` is
 * correct (same call shape as review-round-guard.mjs's `listAll`). Only the
 * check-runs endpoint needs `--slurp`.
 */
export function prCommitsWithCheckRuns(pr, opts) {
  const { api = gh, log = console.error } = opts && typeof opts === "object" ? opts : {};
  let commits;
  try {
    commits = api(["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/commits?per_page=100`]);
  } catch (err) {
    log(`could not list commits for #${pr} (${err.message}); treating the PR as having none.`);
    return [];
  }
  const out = [];
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c?.sha) continue;
    // PER COMMIT: one unreadable commit costs that commit's runs, not the PR's.
    try {
      const pages = api([
        "api",
        `repos/{owner}/{repo}/commits/${c.sha}/check-runs?per_page=100`,
        "--paginate",
        "--slurp",
      ]);
      out.push({ sha: c.sha, checkRuns: (Array.isArray(pages) ? pages : []).flatMap((p) => p?.check_runs ?? []) });
    } catch (err) {
      log(`could not read check runs for ${c.sha} (${err.message}); skipping that commit.`);
      // Still record the commit: `groupReviewRounds` treats a commit with no lens
      // runs as "not a round", which is the same conclusion it would reach for a
      // commit that genuinely has none. Dropping it entirely would be identical
      // here, but keeping it means the caller's commit count stays truthful.
      out.push({ sha: c.sha, checkRuns: [] });
    }
  }
  return out;
}

/** Flatten `prCommitsWithCheckRuns` output to a single run list. */
export function allCheckRuns(commits) {
  return (Array.isArray(commits) ? commits : []).flatMap((c) => c?.checkRuns ?? []);
}

/**
 * Re-fetch each selected run by id so `output.text` is the FULL payload.
 *
 * See contract 2 in the header. Bounded at one call per entry (five lenses today).
 * Per-entry `try`, falling back to the list copy rather than dropping the entry: if
 * that copy happens to be complete it parses, and if it is truncated the outcome is
 * the same skip the caller would have reached anyway.
 */
export function withFullOutput(byName, opts) {
  const { api = gh, log = console.error } = opts && typeof opts === "object" ? opts : {};
  const out = new Map();
  for (const [name, run] of byName instanceof Map ? byName : Object.entries(byName ?? {})) {
    out.set(name, run);
    if (!run?.id) continue;
    try {
      out.set(name, api(["api", `repos/{owner}/{repo}/check-runs/${run.id}`]));
    } catch (err) {
      log(`could not fetch ${name} in full (${err.message}); using the list copy.`);
    }
  }
  return out;
}
