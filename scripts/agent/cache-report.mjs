#!/usr/bin/env node
// Projects what the review panel's prompt caching saves on a given diff, and
// prints it as a markdown table you can paste into a PR body.
//
// WHY this exists as a script rather than a metric: the panel's cost win is
// invisible in the metrics ledger until a real review round runs on a real PR,
// and confirming it there means eyeballing `weightedTokens` against a comparable
// earlier PR. This computes the SAME arithmetic offline from the real prompt
// builders, so the expected decrease is a number you can state before merging and
// then check against the ledger afterwards.
//
// It opens NO sessions and needs no SDK, no token and no network: it renders the
// prompts the panel would send, groups them by cacheable prefix exactly the way
// `createWarmupGate` will at runtime, and applies metrics.mjs's own TOKEN_WEIGHTS.
//
// Usage:
//   node cache-report.mjs --diff-file <f> [--changed-files <f>] [--issue-file <f>]
//        [--lenses-dir <dir>] [--json]
//
// Two honest caveats, both stated in the output:
//   1. Token counts are ESTIMATED at ~4 chars/token, not tokenized. The absolute
//      numbers are approximate; the PERCENTAGES are near-invariant to that
//      constant, since it scales both sides of the comparison.
//   2. It models the prompt input this repo controls. The SDK adds its own
//      session scaffolding, and output tokens are unaffected either way — so the
//      real end-to-end reduction is smaller than the input-side figure here.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLenses,
  sliceDiffByFile,
  lensReviewPlan,
  lensCacheKey,
  buildLensPrompt,
  resolveReviewScope,
} from "./review-panel.mjs";
import { TOKEN_WEIGHTS } from "./metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Rough token count. Deliberately crude and deliberately the SAME function on
 * both sides of the before/after comparison, so the ratio it produces is far more
 * trustworthy than its absolute output.
 */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4);
}

/**
 * Minimum cacheable prefix for Opus-5. Below this the API silently declines to
 * cache — no error, no cache_creation, just full price. Worth reporting rather
 * than hiding: a tiny PR shows "not cacheable" instead of a phantom saving.
 */
export const MIN_CACHEABLE_TOKENS = 512;

/**
 * Model the round's input cost with and without the cacheable prefix.
 *
 * `sessions` is one entry per SDK call the panel would make: `{ lensId, prefix,
 * userPrompt }`, already expanded per sample. Grouping is by `prefix` — byte
 * identity, the same key `createWarmupGate` uses — so a group of N sessions pays
 * one cache WRITE (1.25x) and N-1 cache READS (0.1x) instead of N full-price
 * copies of the same diff.
 */
export function projectCacheSavings(sessions) {
  const byPrefix = new Map();
  for (const s of sessions) {
    const g = byPrefix.get(s.prefix) ?? { prefix: s.prefix, lenses: [], sessions: 0, userTokens: 0 };
    g.lenses.push(s.lensId);
    g.sessions++;
    g.userTokens += estimateTokens(s.userPrompt);
    byPrefix.set(s.prefix, g);
  }

  const groups = [...byPrefix.values()].map((g) => {
    const prefixTokens = estimateTokens(g.prefix);
    // Mirrors the panel's own two conditions for caching a prefix at all:
    //   - big enough that the API will cache it (below this it silently won't), and
    //   - shared by a SECOND session, since a write nobody re-reads costs 1.25x for
    //     nothing (review-panel.mjs `countPrefixSessions`).
    // Modelling this matters: without it the report would show a phantom loss on
    // the single-sample `docs` lens that the shipped code does not actually incur.
    const cacheable = prefixTokens >= MIN_CACHEABLE_TOKENS && g.sessions > 1;
    // Every session re-sends the whole prefix at full input price. This is the
    // panel's behaviour before the change, and it is also the fallback whenever
    // the prefix is too small to cache.
    const before = g.sessions * prefixTokens * TOKEN_WEIGHTS.input + g.userTokens * TOKEN_WEIGHTS.input;
    const readTokens = cacheable ? (g.sessions - 1) * prefixTokens : 0;
    const after = cacheable
      ? prefixTokens * TOKEN_WEIGHTS.cacheCreation +
        readTokens * TOKEN_WEIGHTS.cacheRead +
        g.userTokens * TOKEN_WEIGHTS.input
      : before;
    return {
      // Sorted so the label is stable run to run; a group is identified by WHICH
      // lenses share it, which is the interesting fact under file-class routing.
      lenses: [...new Set(g.lenses)].sort(),
      sessions: g.sessions,
      prefixTokens,
      userTokens: g.userTokens,
      cacheable,
      // WHY a group is not cached, since the two reasons call for different
      // responses: "too small" is just a small PR, while "one session" means the
      // lens is configured with a single sample and a prefix nobody shares.
      uncachedReason: cacheable ? null : g.sessions <= 1 ? "single session" : "below cache minimum",
      readTokens,
      before: Math.round(before),
      after: Math.round(after),
    };
  });
  // Biggest saving first — that is the row a reader wants to see.
  groups.sort((a, b) => b.before - b.after - (a.before - a.after));

  const sum = (f) => groups.reduce((s, g) => s + g[f], 0);
  const before = sum("before");
  const after = sum("after");
  // The cache-hit share: of all the prompt input the panel processes, how much
  // arrives as a cheap re-read rather than as fresh tokens. Counted in RAW tokens,
  // not weighted ones, because that is what the ledger's usage fields report.
  const rawInput = groups.reduce((s, g) => s + g.sessions * g.prefixTokens + g.userTokens, 0);
  const cacheRead = sum("readTokens");
  return {
    groups,
    totals: {
      sessions: sum("sessions"),
      before,
      after,
      savedPct: before > 0 ? Math.round(((before - after) / before) * 1000) / 10 : 0,
      cacheHitPct: rawInput > 0 ? Math.round((cacheRead / rawInput) * 1000) / 10 : 0,
      rawInput,
      cacheRead,
    },
  };
}

/** Render the projection as a markdown block for a PR body. */
export function renderReport({ groups, totals }) {
  const n = (x) => x.toLocaleString("en-US");
  const lines = [
    "| Warm-up group (lenses sharing a prefix) | Sessions | Prefix tok | Weighted before | Weighted after | Saved |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const g of groups) {
    const saved = g.before > 0 ? Math.round(((g.before - g.after) / g.before) * 100) : 0;
    lines.push(
      `| ${g.lenses.join(" + ")}${g.cacheable ? "" : ` _(not cached: ${g.uncachedReason})_`} | ${g.sessions} | ` +
        `${n(g.prefixTokens)} | ${n(g.before)} | ${n(g.after)} | ${saved}% |`,
    );
  }
  lines.push(
    `| **Total** | **${totals.sessions}** | | **${n(totals.before)}** | **${n(totals.after)}** | ` +
      `**${totals.savedPct}%** |`,
  );
  lines.push(
    "",
    `Projected cache-hit share of prompt input: **${totals.cacheHitPct}%** ` +
      `(${n(totals.cacheRead)} of ${n(totals.rawInput)} estimated input tokens arrive as ~0.1x re-reads).`,
    "",
    "Estimated at ~4 chars/token over the prompts the panel actually builds, weighted by",
    "`metrics.mjs` TOKEN_WEIGHTS. Percentages are near-invariant to the chars/token constant;",
    "absolute counts are approximate. Models prompt input only — SDK session scaffolding and",
    "output tokens are unaffected, so the end-to-end round saving is smaller than the figure above.",
  );
  return lines.join("\n");
}

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { a[key] = next; i++; } else a[key] = true;
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv);
  const diffFile = args["diff-file"];
  if (!diffFile || !existsSync(String(diffFile))) {
    console.error(`Usage: node cache-report.mjs --diff-file <f> [--changed-files <f>] [--issue-file <f>] [--json]`);
    process.exit(2);
  }
  const diff = readFileSync(String(diffFile), "utf8");
  const issue = args["issue-file"] && existsSync(String(args["issue-file"]))
    ? readFileSync(String(args["issue-file"]), "utf8")
    : "";
  const changedFiles = args["changed-files"] && existsSync(String(args["changed-files"]))
    ? readFileSync(String(args["changed-files"]), "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
    // Derived from the diff itself when no list is passed, so the script is
    // usable on a bare `git diff` without the workflow's extra inputs.
    : sliceDiffByFile(diff).map((b) => b.path).filter(Boolean);
  const { scopeNote } = resolveReviewScope(args, changedFiles);
  const fileBlocks = sliceDiffByFile(diff);
  const lenses = loadLenses(path.resolve(String(args["lenses-dir"] ?? path.join(HERE, "lenses"))));

  const sessions = [];
  const skipped = [];
  for (const lens of lenses) {
    const plan = lensReviewPlan(lens, changedFiles, fileBlocks);
    if (plan.skip) { skipped.push(lens.id); continue; }
    // Same default as the panel: 2 samples per lens unless the manifest says
    // otherwise. Sample count is what makes the per-lens reuse worth having.
    const samples = Math.max(1, Number(lens.samples) || 2);
    const prefix = lensCacheKey(lens, { diff: plan.diff, issue, scopeNote });
    const userPrompt = buildLensPrompt(lens, { rubric: lens.rubric });
    for (let i = 0; i < samples; i++) sessions.push({ lensId: lens.id, prefix, userPrompt });
  }

  if (sessions.length === 0) {
    console.error("every lens skipped on this diff — nothing to project");
    process.exit(1);
  }
  const projection = projectCacheSavings(sessions);
  if (args.json) {
    console.log(JSON.stringify({ ...projection, skipped }, null, 2));
    return;
  }
  console.log(renderReport(projection));
  if (skipped.length) console.log(`\nSkipped on this diff (out of scope, no sessions): ${skipped.join(", ")}.`);
}

// Only run as a CLI, so the pure helpers above are importable by the test.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
