// Duplicate-suppression corpora — the two things a hunter must be told are NOT
// defects.
//
// Without these the explorer has no way to know what the project already knows,
// and the two failure modes are different in kind:
//
//   1. ALREADY FILED. Re-reporting an open issue wastes the same maintainer
//      attention twice. The corpus here is small enough to hand over whole — 53
//      issues, titles AND bodies, ~35 KB — so no embedding, no vector store, no
//      similarity threshold to calibrate. Just give the model the list.
//
//   2. DELIBERATELY DEFERRED. This is the subtler one and the reason this module
//      exists at all. `docs/design/**` is dense with conscious non-goals —
//      "Device flow or headless authentication (may be added later)", "Encrypting
//      stored tokens", "Block-level write or patch on Docs". Every one of those
//      reads exactly like a contract violation to a hunter that hasn't been told
//      otherwise, and reporting one is pure noise.
//
// The design constraint that shapes everything below: `docs/design/**` is 100
// files and ~1.5 MB (~375K tokens). It cannot go in a prompt. So extraction is a
// DETERMINISTIC digest — plain grep and section slicing, no model in the loop —
// scoped to the charter's own docsScope. A model summarising the deferrals would
// be one more place for a hallucination to enter the one input whose job is to
// PREVENT hallucinated findings.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Phrases that mark a conscious decision not to do something. Deliberately
 * generous — a false positive here only adds a line to a digest, while a miss
 * lets a known non-goal through as a "finding".
 */
const DEFERRAL_RE =
  /deferred|out of scope|not in scope|future work|may be added later|not supported|non-goals?|v1 only|for now|planned\b/i;

/**
 * Pull the body of a `Non-Goals` section, at any heading depth.
 *
 * The depth-agnostic match is load-bearing. A first cut anchored on `^## Non-Goals`
 * silently produced a 198-token digest, because `docs/design/cli.md` uses `###`
 * — so the real non-goals (device flow, token encryption, block-level writes)
 * never reached the model. An extractor that quietly finds nothing is worse than
 * one that errors, because a thin digest looks like "this doc has no non-goals".
 */
export function extractNonGoals(text) {
  const lines = String(text ?? "").split("\n");
  const out = [];
  let depth = null;
  for (const line of lines) {
    const heading = /^(#+)\s+(.*)$/.exec(line);
    if (heading) {
      if (depth === null && /non-goals?/i.test(heading[2])) {
        depth = heading[1].length;
        continue;
      }
      // Any heading at the same or shallower depth ends the section. A DEEPER
      // heading is a subsection of the non-goals and stays in.
      if (depth !== null && heading[1].length <= depth) depth = null;
    }
    if (depth !== null) out.push(line);
  }
  return out.join("\n").trim();
}

/** Lines anywhere in a doc that record a deferral, with line numbers for citing. */
export function extractDeferralLines(text, { max = 40 } = {}) {
  const out = [];
  String(text ?? "")
    .split("\n")
    .forEach((line, i) => {
      if (out.length < max && DEFERRAL_RE.test(line) && line.trim() !== "") {
        out.push(`${i + 1}: ${line.trim()}`);
      }
    });
  return out;
}

/**
 * Build the deferrals digest for a charter, from files it already declares.
 *
 * `docs` is a `Map<path, text>` so this stays pure and testable — the caller does
 * the reading. Scoped to `docsScope` rather than all of `docs/design/**`: a
 * charter that only judges the CLI has no use for the slides roadmap, and the
 * token budget is better spent on issues.
 */
export function renderDeferrals(docs) {
  const parts = [
    "## Deliberate deferrals, non-goals and known limitations",
    "",
    "These are CONSCIOUS project decisions, not defects. Reporting one is noise.",
    "",
  ];
  for (const [path, text] of docs) {
    const nonGoals = extractNonGoals(text);
    const lines = extractDeferralLines(text);
    if (!nonGoals && lines.length === 0) continue;
    parts.push(`### ${path}`);
    if (nonGoals) parts.push("", "Non-Goals section:", "", nonGoals);
    if (lines.length) parts.push("", "Deferral lines:", "", ...lines);
    parts.push("");
  }
  if (parts.length === 4) parts.push("(no deferrals found in the charter's docsScope)");
  return parts.join("\n");
}

/** Read a charter's docsScope entries that are concrete files (not globs). */
export function loadScopedDocs(repo, docsScope) {
  const docs = new Map();
  for (const entry of Array.isArray(docsScope) ? docsScope : []) {
    // Globs are skipped deliberately: expanding `packages/cli/skills/**` would
    // pull 32 KB of skill files whose deferral density is near zero. Concrete
    // design docs are where non-goals actually live.
    if (entry.includes("*")) continue;
    const p = `${repo}/${entry}`;
    if (existsSync(p)) docs.set(entry, readFileSync(p, "utf8"));
  }
  return docs;
}

/**
 * Fetch every issue — open AND closed — with titles and bodies.
 *
 * Closed ones matter as much as open: a defect closed as "working as intended" or
 * "won't fix" is exactly the thing a hunter would otherwise re-report with
 * conviction. Bodies are truncated per-issue rather than dropping issues, because
 * coverage of WHICH defects are known beats depth on any one of them.
 *
 * `runner` is injectable so tests never shell out to `gh`.
 */
export function renderIssues(issues, { bodyChars = 600 } = {}) {
  const rows = (Array.isArray(issues) ? issues : [])
    .filter((i) => i && typeof i.number === "number")
    .map((i) => {
      const body = String(i.body ?? "").slice(0, bodyChars);
      return `#${i.number} [${i.state ?? "?"}] ${i.title ?? ""}\n${body}\n---`;
    });
  if (rows.length === 0) return "(no issues supplied)";
  return [`## Issues already filed (${rows.length}) — NOT findings`, "", ...rows].join("\n");
}

export function fetchIssues(repoSlug, { runner = null, limit = 500 } = {}) {
  const run =
    runner ??
    ((args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 << 20 }));
  try {
    const raw = run([
      "issue", "list",
      "--repo", repoSlug,
      "--state", "all",
      "--limit", String(limit),
      "--json", "number,state,title,body",
    ]);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // Degrade to an empty corpus rather than aborting the run. The cost is a
    // hunter that might re-report a known issue — which the verifiers' own
    // duplicate check still guards — whereas aborting loses the whole run over a
    // `gh` auth hiccup. The caller warns so the weaker suppression is visible.
    return { error: String(err.message ?? err) };
  }
}
