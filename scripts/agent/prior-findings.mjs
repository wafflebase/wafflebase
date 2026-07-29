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
// Writes a JSON array to --out (default stdout). ALWAYS writes a valid array —
// see `tagPriorFindings` for why an error must not become a hard failure here.
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
 * cannot zero out the other four. That was the concrete defect in the inline
 * version — a single `JSON.parse` inside one `try` around the whole loop.
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

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { a[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return a;
}

function gh(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
}

function main() {
  const args = parseArgs(process.argv);
  const pr = process.argv[2];
  if (!pr || !/^\d+$/.test(pr)) {
    console.error("Usage: node prior-findings.mjs <pr-number> --lenses <lenses.json> [--out <file>]");
    process.exit(2); // usage error is a tooling error, not a review outcome
  }
  let names = [];
  try {
    names = lensCheckNames(JSON.parse(readFileSync(args.lenses, "utf8")));
  } catch (err) {
    console.error(`Could not read --lenses (${err.message}); carrying no prior findings.`);
  }

  let prior = [];
  if (names.length > 0) {
    try {
      // Every commit on the PR, not just the head: the last completed run for a
      // lens may sit on an earlier commit if that lens produced no verdict in the
      // most recent round.
      const commits = gh(["api", "--paginate", `repos/{owner}/{repo}/pulls/${pr}/commits?per_page=100`]);
      const runs = [];
      for (const c of Array.isArray(commits) ? commits : []) {
        if (!c?.sha) continue;
        const data = gh(["api", "--paginate", `repos/{owner}/{repo}/commits/${c.sha}/check-runs?per_page=100`]);
        for (const r of data?.check_runs ?? []) runs.push(r);
      }
      prior = tagPriorFindings(latestLensRuns(runs, names));
    } catch (err) {
      // Same fail direction as above: no prior findings this round, not an outage.
      console.error(`Could not read prior findings (${err.message}); carrying none.`);
      prior = [];
    }
  }

  const json = JSON.stringify(prior);
  if (args.out) writeFileSync(args.out, json);
  else console.log(json);
  console.error(`prior findings carried into re-check: ${prior.length}`);
}

// Only run as a CLI, so the pure helpers above are importable by tests.
if (process.argv[1] && process.argv[1].endsWith("prior-findings.mjs")) main();
