import { test } from "node:test";
import assert from "node:assert/strict";
import { projectCacheSavings, estimateTokens, MIN_CACHEABLE_TOKENS, renderReport } from "./cache-report.mjs";
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
  assert.equal(groups[0].readTokens, 0);
  assert.equal(groups[0].after, groups[0].before, "no write premium, no read discount — unchanged cost");
  assert.equal(totals.savedPct, 0);
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
