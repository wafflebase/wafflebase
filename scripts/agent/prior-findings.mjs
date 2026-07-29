// Collect the PREVIOUS round's blocking findings, tagged with the lens that
// raised them, for `review-panel.mjs --prior-findings`.
//
// This is the cross-round re-check's input: without it, a finding that round N's
// fresh pass happens to miss vanishes from the gate even though nobody fixed it
// (the #521 false negative). Each prior finding is re-verified against the
// current repository and survives unless the verifier can refute it on grounded
// evidence.
//
// WHY A MODULE. The logic lived as ~40 lines of inline `github-script` in
// agent-review-panel.yml, and PR #558 needed a second copy for the on-demand
// workflow. Inline YAML JavaScript is untestable and un-lintable, and two copies
// of a gate input is how one of them rots. A plain `gh`-CLI script mirrors
// `review-round-guard.mjs` and `mark-ready.mjs`, and the parsing is unit-tested.
//
// Usage:
//   node prior-findings.mjs <pr-number> --lenses <lenses.json> [--out <file>]
// Writes a JSON array to --out (default stdout), and it is ALWAYS a valid array —
// see `tagPriorFindings` for why an API or parse error must not become a hard
// failure. The two exceptions are bad ARGUMENTS (unusable PR number, unreadable
// or empty lens manifest): those exit 2, because a broken invocation must not be
// indistinguishable from a legitimately empty first round.
//
// Requires the `gh` CLI authenticated via GH_TOKEN / GITHUB_TOKEN.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { latestLensRuns } from "./review-state.mjs";

/**
 * Turn `{ lensCheckName -> check run }` into a flat, lens-tagged findings array.
 *
 * FAIL DIRECTION, and it is the opposite of most things in this pipeline. Prior
 * findings are an ADDITIVE recall aid: they can only re-raise a blocker, never
 * clear one. So a parse failure must degrade to "carry fewer findings", never to
 * "fail the round" — a thrown error here would turn one lens's malformed JSON
 * into a panel-wide outage, which is strictly worse than losing that lens's
 * carry-forward for a round.
 *
 * Consequently each lens is parsed INDEPENDENTLY: one lens's garbage `output.text`
 * cannot zero out the other four. The inline version this replaces already had
 * that property (a `try` per lens inside the loop); it is restated here because
 * the granularity is a requirement, not an implementation detail, and every
 * `catch` in this module is per-lens or per-commit for the same reason.
 */
export function tagPriorFindings(runsByLens) {
  const out = [];
  const entries = runsByLens instanceof Map ? [...runsByLens] : Object.entries(runsByLens ?? {});
  for (const [name, run] of entries) {
    if (typeof name !== "string") continue;
    const lens = name.replace(/^agent-review-/, "");
    const text = run?.output?.text;
    if (typeof text !== "string" || text === "") continue; // absent ≠ "found nothing"
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue; // this lens only
    }
    if (!Array.isArray(parsed)) continue;
    for (const f of parsed) {
      // `lens` last: a finding cannot spoof its own origin by carrying a `lens`
      // key, since these come from a previous round's model output.
      if (f && typeof f === "object" && !Array.isArray(f)) out.push({ ...f, lens });
    }
  }
  return out;
}

/** Lens check-run names from a lenses.json manifest. Junk → []. */
export function lensCheckNames(manifest) {
  return (Array.isArray(manifest) ? manifest : [])
    .filter((l) => l && typeof l.id === "string" && l.id !== "")
    .map((l) => `agent-review-${l.id}`);
}

// --- CLI --------------------------------------------------------------------

// Prototype-free accumulator: `--__proto__ x` would otherwise set this object's
// prototype instead of a key. Also accepts flags before the positional, so
// argument order is not load-bearing.
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

/** One `gh api` call, parsed. Replaced by a stub in tests — see `collectPrior`. */
function gh(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
}

/**
 * Read every prior round's findings for a PR.
 *
 * `api` is injected — the reason this module exists is that inline YAML JavaScript
 * cannot be tested, and a version whose only API path was reachable exclusively
 * through a real `gh` binary would have kept exactly that problem. The four
 * failure paths below are each covered in prior-findings.test.mjs.
 *
 * NEVER throws: worst case it returns []. See `tagPriorFindings` for why the fail
 * direction here is the opposite of the rest of the pipeline.
 */
export function collectPrior({ pr, names, api = gh, log = console.error }) {
  // Object-wrapped-array endpoint (`{ total_count, check_runs: [] }`). Plain
  // `--paginate` concatenates the raw per-page objects, which is NOT valid single
  // JSON — verified and documented in review-round-guard.mjs, which hit this
  // first. `--slurp` wraps each page as an array element instead; flatten
  // `check_runs` across pages ourselves. Without `--slurp`, any commit past one
  // page of check runs throws.
  const checkRunsFor = (sha) => {
    const pages = api(["api", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`, "--paginate", "--slurp"]);
    return (Array.isArray(pages) ? pages : []).flatMap((p) => p?.check_runs ?? []);
  };

  // Re-fetch each SELECTED run so `output.text` is the FULL payload. The list
  // response omits or truncates it — the inline github-script this replaces does a
  // per-run `checks.get` for exactly that reason, and review-round-guard.mjs
  // documents the same contract and back-fills too. Reading the list copy instead
  // would be worse than useless: a truncated payload fails `JSON.parse`, so a lens
  // with many findings silently carries ZERO — the #521 false negative this whole
  // path exists to prevent.
  //
  // Bounded at one call per lens (five today). Per-lens `try`, falling back to the
  // list copy rather than dropping the lens: if that copy is complete it parses,
  // and if it is truncated the outcome is the same skip.
  const withFullOutput = (byLens) => {
    const out = new Map();
    for (const [name, run] of byLens) {
      out.set(name, run);
      if (!run?.id) continue;
      try {
        out.set(name, api(["api", `repos/{owner}/{repo}/check-runs/${run.id}`]));
      } catch (err) {
        log(`could not fetch ${name} in full (${err.message}); using the list copy.`);
      }
    }
    return out;
  };

  // Every commit on the PR, not just the head: the last completed run for a lens
  // may sit on an earlier commit if that lens produced no verdict in the most
  // recent round. Bare-array endpoint, so plain `--paginate` is correct here (same
  // call shape as review-round-guard.mjs's `listAll`).
  let commits;
  try {
    commits = api(["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/commits?per_page=100`]);
  } catch (err) {
    // Nothing left to enumerate. Fewer findings, not an outage.
    log(`Could not list commits for #${pr} (${err.message}); carrying no prior findings.`);
    return [];
  }
  const runs = [];
  for (const c of Array.isArray(commits) ? commits : []) {
    if (!c?.sha) continue;
    // PER COMMIT, so one unreadable commit costs that commit's runs and not the
    // whole PR's carry-forward. An older run then speaks for the lens, which is
    // still additive; a panel-wide zero would not be.
    try {
      runs.push(...checkRunsFor(c.sha));
    } catch (err) {
      log(`could not read check runs for ${c.sha} (${err.message}); skipping that commit.`);
    }
  }
  try {
    return tagPriorFindings(withFullOutput(latestLensRuns(runs, names)));
  } catch (err) {
    log(`Could not assemble prior findings (${err.message}); carrying none.`);
    return [];
  }
}

function main() {
  const args = parseArgs(process.argv);
  const pr = args._[0];
  if (!pr || !/^\d+$/.test(pr)) {
    console.error("Usage: node prior-findings.mjs <pr-number> --lenses <lenses.json> [--out <file>]");
    process.exit(2); // usage error is a tooling error, not a review outcome
  }
  // An unreadable manifest is the SAME class of error as a bad PR number: this is
  // a trusted repo file the caller named, not untrusted API data. Exiting 2 keeps
  // a broken invocation distinguishable from a legitimately empty first round —
  // silently writing `[]` here would disable carry-forward on every round of
  // every PR with nothing to notice it.
  let names = [];
  try {
    names = lensCheckNames(JSON.parse(readFileSync(args.lenses, "utf8")));
  } catch (err) {
    console.error(`Could not read --lenses '${args.lenses}': ${err.message}`);
    process.exit(2);
  }
  if (names.length === 0) {
    console.error(`No lens ids in '${args.lenses}' — refusing to pretend there are no prior findings.`);
    process.exit(2);
  }

  const prior = collectPrior({ pr, names });
  const json = JSON.stringify(prior);
  if (args.out) writeFileSync(args.out, json);
  else console.log(json);
  console.error(`prior findings carried into re-check: ${prior.length}`);
}

// Only run as a CLI, so the pure helpers above are importable by tests.
if (process.argv[1] && process.argv[1].endsWith("prior-findings.mjs")) main();
