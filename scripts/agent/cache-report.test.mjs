import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectCacheSavings,
  estimateTokens,
  MIN_CACHEABLE_TOKENS,
  renderReport,
  planSessions,
} from "./cache-report.mjs";
import { sliceDiffByFile } from "./review-panel.mjs";
import { TOKEN_WEIGHTS } from "./metrics.mjs";

// This module's whole job is to state a number a human will trust when deciding
// whether the caching change paid off. So the arithmetic is asserted against
// hand-computed expectations, not against itself — a projection that merely agrees
// with its own implementation would happily report a saving that isn't there.

const bigPrefix = "x".repeat(MIN_CACHEABLE_TOKENS * 4); // exactly at the minimum
const session = (lensId, prefix, userPrompt = "u".repeat(400)) => ({ lensId, prefix, userPrompt });

test("projectCacheSavings: one lens, 2 samples — the second sample is a cache read", () => {
  const { groups, totals } = projectCacheSavings([
    session("correctness", bigPrefix),
    session("correctness", bigPrefix),
  ]);
  assert.equal(groups.length, 1, "identical prefixes are ONE warm-up group");
  const g = groups[0];
  assert.equal(g.sessions, 2);
  assert.equal(g.prefixTokens, MIN_CACHEABLE_TOKENS);
  assert.equal(g.cacheable, true);
  assert.equal(g.readTokens, MIN_CACHEABLE_TOKENS, "one write, one read");

  const user = estimateTokens("u".repeat(400)) * 2;
  assert.equal(g.before, 2 * MIN_CACHEABLE_TOKENS + user, "before = every session re-sends the prefix");
  assert.equal(
    g.after,
    Math.round(
      MIN_CACHEABLE_TOKENS * TOKEN_WEIGHTS.cacheCreation +
        MIN_CACHEABLE_TOKENS * TOKEN_WEIGHTS.cacheRead +
        user * TOKEN_WEIGHTS.input,
    ),
  );
  assert.ok(totals.savedPct > 0 && totals.savedPct < 100);
});

test("projectCacheSavings: lenses sharing a prefix share one warm-up", () => {
  // The cross-lens saving, which is the reason grouping is keyed on the prefix
  // rather than on the lens.
  const shared = projectCacheSavings([
    session("correctness", bigPrefix), session("correctness", bigPrefix),
    session("security", bigPrefix), session("security", bigPrefix),
  ]);
  assert.equal(shared.groups.length, 1);
  assert.deepEqual(shared.groups[0].lenses, ["correctness", "security"]);
  assert.equal(shared.groups[0].readTokens, 3 * MIN_CACHEABLE_TOKENS, "1 write + 3 reads across both lenses");

  // Distinct slices must NOT be pooled: each pays its own write.
  const split = projectCacheSavings([
    session("correctness", bigPrefix), session("correctness", bigPrefix),
    session("security", bigPrefix + "different"), session("security", bigPrefix + "different"),
  ]);
  assert.equal(split.groups.length, 2);
  assert.ok(split.totals.after > shared.totals.after,
    "two separate warm-ups must cost more than one shared one, or grouping buys nothing");
});

test("projectCacheSavings: a prefix below the cache minimum reports NO saving", () => {
  // The API declines to cache short prefixes silently. Reporting a phantom saving
  // on a small PR would be the one way this script could actively mislead.
  const { groups, totals } = projectCacheSavings([session("prose", "tiny"), session("prose", "tiny")]);
  assert.equal(groups[0].cacheable, false);
  assert.equal(groups[0].readTokens, 0);
  assert.equal(groups[0].after, groups[0].before);
  assert.equal(totals.savedPct, 0);
  assert.equal(totals.cacheHitPct, 0);
});

test("projectCacheSavings: a single-session group is not cached, so it is a wash", () => {
  // One session means the write would never be re-read, and a cache WRITE costs
  // 1.25x — so caching it would be a ~25% LOSS. The panel declines to cache such a
  // prefix (countPrefixSessions), and this must model that rather than reporting a
  // penalty the shipped code does not pay. `docs` is exactly this case.
  const { groups, totals } = projectCacheSavings([session("docs", bigPrefix)]);
  assert.equal(groups[0].cacheable, false, "a lone session must not request a cache write");
  // The two uncached reasons need different responses from a reader — "single
  // session" is a lens configuration, "below cache minimum" is just a small PR.
  assert.equal(groups[0].uncachedReason, "single session");
  assert.equal(projectCacheSavings([session("a", "tiny"), session("a", "tiny")]).groups[0].uncachedReason,
    "below cache minimum");
  // Both at once must name both. Reporting only "single session" would imply that
  // raising the lens to two samples makes the group cacheable, which it would not.
  assert.equal(projectCacheSavings([session("a", "tiny")]).groups[0].uncachedReason,
    "single session, below cache minimum");
  assert.equal(groups[0].readTokens, 0);
  assert.equal(groups[0].after, groups[0].before, "no write premium, no read discount — unchanged cost");
  assert.equal(totals.savedPct, 0);
});

test("planSessions: a lens with an empty slice contributes NO sessions", () => {
  // The panel runs zero samples for a lens that is in scope but has no changed
  // hunks it reads. If the projection counted them it would report cost that is
  // never paid — and it would count a prefix as SHARED (2+ sessions, therefore
  // cacheable) when only one session exists to read the write back, which is the
  // exact 1.25x-for-nothing loss `countPrefixSessions` exists to prevent.
  const blocks = sliceDiffByFile(
    "diff --git a/packages/x/src/a.ts b/packages/x/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
  );
  const files = ["packages/x/src/a.ts", "docs/tasks/active/notes.md"];
  const lenses = [
    { id: "correctness", title: "Correctness", scopeClasses: ["code"], samples: 2, rubric: "r" },
    // In scope (a prose file changed in this PR) but its slice holds no hunks,
    // because the only file with hunks in this diff is code.
    { id: "docs", title: "Docs", scopeClasses: ["prose"], samples: 2, rubric: "r" },
  ];
  const { sessions, skipped, noNewHunks } = planSessions(lenses, {
    changedFiles: files, fileBlocks: blocks, issue: "", scopeNote: "",
  });
  assert.deepEqual(noNewHunks, ["docs"], "an empty slice is reported, not silently priced");
  assert.deepEqual(skipped, [], "it was applicable — this is not the out-of-scope path");
  assert.deepEqual(sessions.map((s) => s.lensId), ["correctness", "correctness"]);

  // And it produces no cache-cost projection at all: the surviving prefix is the
  // code lens's, and the docs lens's prefix appears nowhere.
  const { groups } = projectCacheSavings(sessions);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].lenses, ["correctness"]);
  assert.equal(groups[0].sessions, 2);
});

test("projectCacheSavings: an empty round is shape-stable, not a special case", () => {
  // The CLI reports a zero-session round through the normal path rather than
  // bailing, so the empty projection has to carry the same shape every consumer
  // already reads — otherwise suppressing it would be the only safe option.
  const { groups, totals } = projectCacheSavings([]);
  assert.deepEqual(groups, []);
  assert.equal(totals.sessions, 0);
  assert.equal(totals.before, 0);
  assert.equal(totals.after, 0);
  assert.equal(totals.savedPct, 0, "no division by zero");
  assert.equal(totals.cacheHitPct, 0);
  // And it must still render, since that is the path the CLI now takes.
  assert.match(renderReport({ groups, totals }), /\*\*Total\*\*/);
});

test("renderReport: emits a markdown table with a total row and the caveats", () => {
  const md = renderReport(projectCacheSavings([session("a", bigPrefix), session("a", bigPrefix)]));
  assert.match(md, /\| Warm-up group/);
  assert.match(md, /\*\*Total\*\*/);
  assert.match(md, /cache-hit share of prompt input/);
  // The estimate must never be presented as a measurement.
  assert.match(md, /Estimated at ~4 chars\/token/);
  assert.match(md, /absolute counts are approximate/);
});
