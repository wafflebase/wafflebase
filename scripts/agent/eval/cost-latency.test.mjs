// What these tests are FOR. A cost scorer is the easiest kind of module to make
// green and the hardest to make TRUE: every figure it prints is a plausible
// number, so an assertion on arithmetic proves nothing anyone doubted. These
// concentrate on the four ways this particular file could be quietly wrong —
// reading the wrong time field, treating an absence as a zero, pooling a failed
// item's spend into the price of a review, and letting one arm's number be divided
// by the other's — plus the guards that are supposed to refuse.
//
// The first test is the one this PR exists for. `sdk_duration_ms_sum` sits in the
// envelope beside `duration_ms`, is 2–5× larger because the panel's lenses, samples
// and verifier calls run concurrently, and reads exactly like a duration. Reading
// it would make our own arm's latency 3–5× too high on a headline metric, and
// nothing would go red. So there are two tests against it: one that the module's
// source never names it, and one that a fixture whose summed value disagrees
// wildly with its wall clock still produces the wall clock.
//
// The envelope fixtures are REAL, from `pilot-01__k1` over corpus
// `2026-08-10-pilot-reviewed` (2026-08-10), because the interesting shape is not
// invented: pr-524 is 22 frozen lines that took LONGER than the 160-line pr-471,
// which is the counterexample the size-ordering test needs.
//
// Nothing here reads a store, calls a model, needs an API key or touches the
// network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DURATION_SOURCES,
  MEASURED_DURATION_SOURCE,
  SCORER_ID,
  coderabbitCost,
  costLatencyOf,
  declaredGaps,
  durationCensus,
  fitCostToSize,
  renderReport,
  scoreReplicate,
  seriesOf,
  sizeOf,
  sizeOrder,
  spendOf,
  wallMsOf,
} from "./cost-latency.mjs";

// --- fixtures ---------------------------------------------------------------

const CONFIG_HASH = "sha256:1c7853debf4edf92646d2299b0c924cb48cca89d6bb68b81648c57508a762f01";
const PANEL_SHA = "46da673dd46dd5576626ee6d1b4e2e40728345e0";
const CORPUS = "2026-08-10-pilot-reviewed";

/** One stored envelope, defaulting to a well-formed `ok` item of `pilot-01__k1`. */
const envelope = (over = {}) => ({
  run_id: "pilot-01__k1",
  item_id: "pr-415",
  config_hash: CONFIG_HASH,
  panel_sha: PANEL_SHA,
  corpus_version: CORPUS,
  timestamp: "2026-08-10T08:45:32.440Z",
  status: "ok",
  reason: null,
  cost_usd: 4.5739335,
  turns: 230,
  calls: 16,
  duration_ms: 506264,
  duration_source: MEASURED_DURATION_SOURCE,
  // Present on every real envelope and 3.1× the wall clock on this very item.
  // Carried in the fixture ON PURPOSE: a scorer that reads it would pass every
  // other test in this file.
  sdk_duration_ms_sum: 1591784,
  ...over,
});

/** The seven real (item, lines, cost, wall) tuples of `pilot-01__k1`. */
const K1 = [
  { item_id: "pr-415", lines: 273, additions: 249, deletions: 24, cost_usd: 4.5739335, duration_ms: 506264, turns: 230, calls: 16, sdk: 1591784 },
  { item_id: "pr-429", lines: 792, additions: 700, deletions: 92, cost_usd: 6.3602405, duration_ms: 674534, turns: 325, calls: 14, sdk: 1908000 },
  { item_id: "pr-465", lines: 725, additions: 600, deletions: 125, cost_usd: 6.2481655, duration_ms: 659272, turns: 327, calls: 18, sdk: 2094000 },
  { item_id: "pr-471", lines: 160, additions: 140, deletions: 20, cost_usd: 2.3516625, duration_ms: 418000, turns: 100, calls: 6, sdk: 762000 },
  // 22 lines and SLOWER than the 160-line item above. The size-order counterexample.
  { item_id: "pr-524", lines: 22, additions: 18, deletions: 4, cost_usd: 2.3317534, duration_ms: 575214, turns: 74, calls: 6, sdk: 786000 },
  { item_id: "pr-549", lines: 385, additions: 300, deletions: 85, cost_usd: 3.8584, duration_ms: 557000, turns: 189, calls: 14, sdk: 1596000 },
  { item_id: "pr-605", lines: 1004, additions: 900, deletions: 104, cost_usd: 7.1830458, duration_ms: 1128600, turns: 250, calls: 12, sdk: 2382000 },
];

const k1Items = () =>
  K1.map((r) => ({
    item_id: r.item_id,
    envelope: envelope({ item_id: r.item_id, cost_usd: r.cost_usd, duration_ms: r.duration_ms, turns: r.turns, calls: r.calls, sdk_duration_ms_sum: r.sdk }),
  }));

const k1Sizes = () => new Map(K1.map((r) => [r.item_id, sizeOf(r.item_id, { additions: r.additions, deletions: r.deletions })]));

const run = (over = {}) => ({ run_id: "pilot-01__k1", status: "complete", item_count: 7, items_ok: 7, items_error: 0, totals: { cost_usd: K1.reduce((a, r) => a + r.cost_usd, 0) }, ...over });

const oneRun = (over = {}) => [{ run_id: "pilot-01__k1", run: run(over), items: k1Items() }];

/** The same seven items replayed under another run id, each a dollar dearer — a
 *  second draw of one reviewer, which is what K buys. */
const anotherRun = (runId, delta) => ({
  run_id: runId,
  run: run({ run_id: runId, totals: { cost_usd: K1.reduce((a, r) => a + r.cost_usd + delta, 0) } }),
  items: k1Items().map((it) => ({ ...it, envelope: { ...it.envelope, run_id: runId, cost_usd: it.envelope.cost_usd + delta } })),
});

const scoreK1 = (opts = {}) => costLatencyOf(oneRun(), { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((r) => r.item_id), ...opts });

// --- the trap this PR exists for --------------------------------------------

test("THE TRAP: the module never names the summed SDK-call field", () => {
  const src = readFileSync(new URL("./cost-latency.mjs", import.meta.url), "utf8");
  // Built from parts so this file's own assertion does not put the identifier in
  // the module under test's source when somebody copies a line across.
  const forbidden = ["sdk", "duration", "ms", "sum"].join("_");
  assert.equal(
    src.includes(forbidden),
    false,
    `cost-latency.mjs names ${forbidden}. It is the flat sum over every SDK call and is NOT elapsed time — the panel runs lenses, samples and verifier calls concurrently, so reading it reports our own latency 3–5× high on a metric that ships before anything is validated`,
  );
});

test("THE TRAP, behaviourally: latency tracks duration_ms even when the summed field says otherwise", () => {
  // 3.1× apart, which is the real ratio on this item.
  const e = envelope({ duration_ms: 506264, sdk_duration_ms_sum: 1591784 });
  assert.equal(wallMsOf(e).wall_ms, 506264);
  const r = scoreK1();
  const rep = r.panel.replicates[0];
  assert.equal(rep.review.wall_ms.max, 1128600, "the slowest review is the wall clock of pr-605, not its summed SDK time");
  assert.equal(rep.review.items_wall_ms_sum, K1.reduce((a, x) => a + x.duration_ms, 0));
  assert.notEqual(rep.review.items_wall_ms_sum, K1.reduce((a, x) => a + x.sdk, 0));
});

// --- absence is never a zero -------------------------------------------------

test("wallMsOf refuses a duration whose provenance contradicts it, in both directions", () => {
  assert.throws(() => wallMsOf(envelope({ duration_ms: null })), /provenance claims a measurement that is not there/);
  assert.throws(() => wallMsOf(envelope({ duration_ms: 1000, duration_source: "absent" })), /a number under an absent provenance/);
  assert.throws(() => wallMsOf(envelope({ duration_source: "" })), /duration_source is missing/);
});

test('an "absent" wall clock is EXCLUDED from every latency figure and is not a fast replay', () => {
  const items = k1Items();
  items[4] = { item_id: "pr-524", envelope: envelope({ item_id: "pr-524", cost_usd: 2.3317534, duration_ms: null, duration_source: "absent" }) };
  const r = costLatencyOf([{ run_id: "pilot-01__k1", run: run(), items }], { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id) });
  const rep = r.panel.replicates[0];
  assert.equal(rep.review.wall_ms.n, 6, "six timed items, not seven");
  assert.equal(rep.review.n_timed, 6);
  assert.equal(rep.review.wall_ms.min, 418000, "the minimum is still pr-471 — a null did not become the fastest review");
  assert.equal(rep.review.cost_usd.n, 7, "its COST is still counted: the money was spent and only the clock is missing");
  assert.match(r.completeness.reasons.join("\n"), /pr-524: no wall clock \(duration_source absent\).*not counted as zero/);
  assert.equal(r.completeness.verdict, "partial");
});

test('"absent" and "not-run" are counted apart, and both are printed at n=0', () => {
  const census = durationCensus([{ duration_source: MEASURED_DURATION_SOURCE }, { duration_source: "absent" }]);
  assert.deepEqual(census.counts, { "review-timing.json": 1, absent: 1, "not-run": 0 });
  assert.deepEqual(DURATION_SOURCES, ["review-timing.json", "absent", "not-run"]);
  // A panel that never ran is not a panel we failed to time.
  const both = durationCensus([{ duration_source: "absent" }, { duration_source: "not-run" }]);
  assert.equal(both.counts.absent, 1);
  assert.equal(both.counts["not-run"], 1);
  assert.deepEqual(both.unrecognised, {});
});

test("an unrecognised duration_source gets its own bucket and a reason, and is pooled with nothing", () => {
  const census = durationCensus([{ duration_source: "wall-clock-v2" }]);
  assert.deepEqual(census.counts, { "review-timing.json": 0, absent: 0, "not-run": 0 });
  assert.deepEqual(census.unrecognised, { "wall-clock-v2": 1 });
  const items = k1Items();
  items[0] = { item_id: "pr-415", envelope: envelope({ duration_ms: null, duration_source: "wall-clock-v2" }) };
  const r = costLatencyOf([{ run_id: "pilot-01__k1", run: run(), items }], { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id) });
  assert.match(r.completeness.reasons.join("\n"), /unrecognised duration_source "wall-clock-v2".*pooled with nothing/);
});

// --- a failed item is not a cheap review -------------------------------------

test("a failed item's spend is in the run total and NOT in the price of a review", () => {
  const items = k1Items();
  // The pilot's own case: an infra error item that had already spent $2.49.
  items[5] = { item_id: "pr-549", envelope: envelope({ item_id: "pr-549", status: "error", reason: "infra", cost_usd: 2.4935073, duration_ms: null, duration_source: "absent" }) };
  const r = costLatencyOf([{ run_id: "pilot-01__k1", run: run({ items_ok: 6, items_error: 1 }), items }], { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id) });
  const s = r.panel.replicates[0].spend;
  assert.equal(s.n_ok, 6);
  assert.equal(s.n_error, 1);
  assert.ok(Math.abs(s.error_items_usd - 2.4935073) < 1e-9);
  assert.ok(Math.abs(s.total_usd - (s.ok_items_usd + s.error_items_usd)) < 1e-9, "the spend accounts for every item, failures included");
  // The load-bearing comparison: the PRICE OF A REVIEW must be exactly what it
  // would be if the failed item were not in the run at all. Anything less is a
  // failed review priced as a cheap one.
  const without = costLatencyOf([{ run_id: "pilot-01__k1", run: run({ items_ok: 6 }), items: k1Items().filter((it) => it.item_id !== "pr-549") }], { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id) });
  assert.deepEqual(r.panel.replicates[0].review.cost_usd, without.panel.replicates[0].review.cost_usd);
  assert.equal(r.panel.replicates[0].review.cost_usd.n, 6, "the price of a review is over the six that happened");
  assert.match(r.completeness.reasons.join("\n"), /pr-549: error \(infra\), \$2\.49 spent and not counted as a review/);
});

test('a run that says "complete" with a failed item still reports the shortfall', () => {
  // `complete` is derived from every planned item being PRESENT, and an error item
  // writes an envelope — which is how the pilot's third replicate reported success
  // with two dead items in it.
  const r = costLatencyOf(oneRun({ status: "complete", items_ok: 5, items_error: 2 }), { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id) });
  assert.match(r.completeness.reasons.join("\n"), /5 of 7 item\(s\) ok/);
  assert.equal(r.completeness.verdict, "partial");
});

test("run.json's total is checked against the stored envelopes rather than trusted", () => {
  const good = scoreK1();
  assert.equal(good.panel.replicates[0].spend.stored_total_agrees, true);
  const r = costLatencyOf(oneRun({ totals: { cost_usd: 40 } }), { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id) });
  assert.equal(r.panel.replicates[0].spend.stored_total_agrees, false);
  assert.match(r.completeness.reasons.join("\n"), /run\.json totals say \$40\.0000 and the stored envelopes sum to \$32\.9\d{3}/);
});

// --- the guards --------------------------------------------------------------

// The identity guards are `reliability.mjs`'s and are tested there. What is tested
// HERE is the wiring: that this scorer actually reaches them, and reaches them with
// an input they can read — an adaptation that silently produced an empty item list
// would leave every guard running and never firing, which is the shape of lesson 7
// and is not visible from either file alone.
test("two reviewers refuse through this scorer: cost is a property of (config_hash, panel_sha)", () => {
  const mixed = oneRun();
  mixed[0].items[0] = { item_id: "pr-415", envelope: envelope({ panel_sha: "0".repeat(40) }) };
  assert.throws(
    () => costLatencyOf(mixed, { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id) }),
    /span 2 \(config_hash, panel_sha\) identities/,
  );
  // And the identity actually reaches the result, which is what proves the
  // adaptation handed the guard something it could read rather than nothing.
  assert.deepEqual(scoreK1().reviewer, { config_hash: CONFIG_HASH, panel_sha: PANEL_SHA });
});

test("two corpora refuse, and a corpus label the data cannot verify refuses", () => {
  const mixed = oneRun();
  mixed[0].items[1] = { item_id: "pr-429", envelope: envelope({ item_id: "pr-429", corpus_version: "2026-08-07-pilot" }) };
  assert.throws(() => costLatencyOf(mixed, { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: [] }), /span 2 corpus versions/);
  assert.throws(
    () => costLatencyOf(oneRun(), { sizes: k1Sizes(), corpusVersion: "2026-08-07-pilot", corpusItemIds: [] }),
    /asked for corpus "2026-08-07-pilot" but the runs replayed "2026-08-10-pilot-reviewed"/,
  );
  assert.equal(scoreK1().corpus_version, CORPUS);
});

test("the frozen size bucket is checked against the rule that made it", () => {
  assert.deepEqual(sizeOf("pr-524", { additions: 18, deletions: 4, scope: "S" }), { item_id: "pr-524", diff_lines: 22, size_bucket: "S" });
  assert.deepEqual(sizeOf("pr-415", { additions: 249, deletions: 24 }), { item_id: "pr-415", diff_lines: 273, size_bucket: "M" });
  assert.throws(() => sizeOf("pr-524", { additions: 18, deletions: 4, scope: "L" }), /meta\.scope is "L" but scopeSize\(18, 4\) is "S"/);
});

test("an unreadable item has an UNKNOWN size, never a zero one", () => {
  assert.deepEqual(sizeOf("pr-999", null), { item_id: "pr-999", diff_lines: null, size_bucket: null });
  assert.deepEqual(sizeOf("pr-999", { additions: 5 }), { item_id: "pr-999", diff_lines: null, size_bucket: null });
});

// --- the size story ----------------------------------------------------------

test("cost fits a per-item FLOOR plus a marginal rate, and reproduces the pilot's", () => {
  const fit = fitCostToSize(K1.map((r) => ({ diff_lines: r.lines, cost_usd: r.cost_usd })));
  assert.equal(fit.n, 7);
  assert.equal(fit.intercept_usd.toFixed(2), "2.20");
  assert.equal(fit.slope_usd_per_1000_lines.toFixed(2), "5.20");
  assert.equal((fit.fixed_share * 100).toFixed(0), "47", "47% of a replicate is per-item overhead — the reason the bill scales with item count");
});

test("no average cost-per-line is emitted anywhere, at any level", () => {
  // The average inverts under a fixed floor: the biggest item is the cheapest per
  // line. A key that offered it would be quoted, so there must not be one.
  const json = JSON.stringify(scoreK1());
  for (const key of ["usd_per_line", "cost_per_line", "usd_per_1000_lines_average", "pooled_usd_per_line", "per_100_diff_lines"]) {
    assert.equal(json.includes(key), false, `${key} is present — an average cost per line reads backwards on this corpus: the biggest item is the cheapest per line`);
  }
});

test("a fit refuses fewer than three points, and refuses when every item is one size", () => {
  assert.equal(fitCostToSize([{ diff_lines: 10, cost_usd: 1 }, { diff_lines: 20, cost_usd: 2 }]).intercept_usd, null);
  assert.match(fitCostToSize([{ diff_lines: 10, cost_usd: 1 }]).reason, /at least 3 items, got 1/);
  const flat = fitCostToSize([{ diff_lines: 100, cost_usd: 1 }, { diff_lines: 100, cost_usd: 2 }, { diff_lines: 100, cost_usd: 3 }]);
  assert.equal(flat.slope_usd_per_1000_lines, null);
  assert.match(flat.reason, /no slope to fit/);
});

test("size ordering COUNTS the pairs that violate it rather than asserting a trend", () => {
  const cost = sizeOrder(K1.map((r) => ({ diff_lines: r.lines, value: r.cost_usd })));
  const wall = sizeOrder(K1.map((r) => ({ diff_lines: r.lines, value: r.duration_ms })));
  assert.equal(cost.pairs, 21);
  assert.equal(cost.concordant, 20);
  // The counterexample the fixture exists for: 22 lines took longer than 160. The
  // fixture is fixed, so the count is asserted EXACTLY — a lower bound passes just
  // as happily when a change makes latency look less ordered than it is, which is
  // the direction this number would be misread in.
  assert.equal(wall.discordant, 3, `latency is not monotonic in size — ${wall.discordant} discordant pair(s)`);
  assert.equal(wall.concordant, 18);
  assert.ok(wall.tau < cost.tau, "cost tracks size more closely than latency does, and both are reported as counts");
  assert.equal(sizeOrder([]).tau, null, "no pairs means no statistic, never 0");
  // Two items of one size are not evidence either way, and rolling them into
  // `concordant` would manufacture agreement out of a tie. The pilot has no tied
  // sizes, so this branch is only reachable from a fixture — which is exactly why
  // it needs one.
  const tie = sizeOrder([{ diff_lines: 100, value: 1 }, { diff_lines: 100, value: 2 }, { diff_lines: 200, value: 3 }]);
  assert.equal(tie.tied, 1);
  assert.equal(tie.concordant, 2);
  assert.equal(tie.pairs, 3, "every pair is accounted for: concordant + discordant + tied");
  // A tie is reachable from EITHER side — two items of one size, or two sizes at
  // one cost — and both must land in the same bucket. Two pull requests that cost
  // the same say nothing about which is bigger, and calling that agreement would
  // manufacture order out of a coincidence.
  const valueTie = sizeOrder([{ diff_lines: 100, value: 5 }, { diff_lines: 200, value: 5 }]);
  assert.equal(valueTie.tied, 1);
  assert.equal(valueTie.concordant, 0);
  assert.equal(valueTie.tau, null, "one pair, and it is tied — no untied pair means no statistic");
});

// --- the range, not the mean -------------------------------------------------

test("a series leads with its range and names the denominator of its spread", () => {
  const s = seriesOf([2, 3, 4]);
  assert.equal(s.min, 2);
  assert.equal(s.max, 4);
  assert.equal(s.range, 2);
  assert.equal(s.spread_over_min, 1, "(4-2)/2 — the field says which denominator, because this project has quoted spread against both min and mean");
  assert.equal(seriesOf([]).range, null);
  assert.equal(seriesOf([]).spread_over_min, null);
  assert.equal(seriesOf([0, 5]).spread_over_min, null, "never Infinity");
});

test("per item across replicates reports the range over the draws that succeeded", () => {
  const k2 = { run_id: "pilot-01__k2", run: run({ run_id: "pilot-01__k2", totals: { cost_usd: 0 } }), items: k1Items().map((it) => ({ ...it, envelope: { ...it.envelope, run_id: "pilot-01__k2", cost_usd: it.envelope.cost_usd + 1 } })) };
  // pr-471 failed in the second leg: two draws, and the exclusion is named.
  k2.items[3] = { item_id: "pr-471", envelope: envelope({ run_id: "pilot-01__k2", item_id: "pr-471", status: "error", reason: "infra", cost_usd: 0.5, duration_ms: null, duration_source: "absent" }) };
  const r = costLatencyOf([oneRun()[0], k2], { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id) });
  const byId = new Map(r.panel.per_item.map((it) => [it.item_id, it]));
  assert.equal(byId.get("pr-415").replicates, 2);
  assert.equal(byId.get("pr-415").cost_usd.range.toFixed(4), "1.0000");
  assert.equal(byId.get("pr-471").replicates, 1, "one usable draw, and the range is over that one");
  assert.deepEqual(byId.get("pr-471").replicates_excluded.map((e) => e.run_id), ["pilot-01__k2"]);
  assert.equal(r.completeness.items_priced_in_every_replicate.includes("pr-471"), false, "an item priced in one leg of two cannot carry a range comparable with the others'");
});

test("an item with no frozen metadata is bucketed unknown, LABELLED, and prints n/a for its lines", () => {
  // The CLI records such an item as unsized rather than leaving it out of the map,
  // so this is the shape the real read path produces.
  const sizes = k1Sizes();
  sizes.set("pr-524", { item_id: "pr-524", diff_lines: null, size_bucket: null });
  const r = costLatencyOf(oneRun(), { sizes, corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id) });
  const unknown = r.panel.by_size_bucket.find((b) => b.size_bucket === "(unknown)");
  assert.deepEqual(unknown.items, ["pr-524"]);
  assert.equal(unknown.diff_lines.n, 0, "no line count, rather than a zero line count");
  assert.ok(unknown.cost_usd.n > 0, "its DOLLARS are still counted — the envelope has them, only the size is missing");
  // Labelled, not merely bucketed: an unknown size makes every per-size figure
  // about less than the corpus, so it has to reach the verdict and the exit code.
  assert.match(r.completeness.reasons.join("\n"), /pr-524: size unknown \(no frozen corpus item under this root\)/);
  assert.equal(r.completeness.verdict, "partial");
  // And it must not print `null–null`, which reads as a measurement rather than
  // as an absence.
  const line = renderReport(r).find((l) => l.includes("(unknown):"));
  assert.match(line, /n\/a \(n=0\) line\(s\)/);
  assert.equal(line.includes("null"), false, `the unknown bucket printed a null: ${line}`);
});

test("size buckets carry their ITEM count beside the observation count", () => {
  // THREE replicates, because that is the case the two counts exist to keep apart:
  // the pilot's S bucket is one pull request measured three times, and reading its
  // three observations as three items would treat one item's replicate noise as a
  // population.
  const r = costLatencyOf([oneRun()[0], anotherRun("pilot-01__k2", 1), anotherRun("pilot-01__k3", 2)], { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id) });
  const s = r.panel.by_size_bucket.find((b) => b.size_bucket === "S");
  assert.equal(s.item_count, 1, "one pull request");
  assert.equal(s.observations, 3, "measured three times");
  assert.deepEqual(s.items, ["pr-524"]);
  const l = r.panel.by_size_bucket.find((b) => b.size_bucket === "L");
  assert.equal(l.item_count, 4);
  assert.equal(l.observations, 12);
});

// --- the other arm -----------------------------------------------------------

test("CodeRabbit's price is null without BOTH inputs, and never guessed", () => {
  const none = coderabbitCost({});
  assert.equal(none.amortised_usd_per_pr, null);
  assert.equal(none.metered, false);
  assert.equal(none.basis, "flat-subscription");
  assert.match(none.reason, /neither is in the store/);
  assert.equal(coderabbitCost({ listPriceUsdPerMonth: 30 }).amortised_usd_per_pr, null, "a price with no volume is not a per-PR figure");
  assert.equal(coderabbitCost({ prsPerMonth: 10 }).amortised_usd_per_pr, null);
  const both = coderabbitCost({ listPriceUsdPerMonth: 30, prsPerMonth: 10 });
  assert.equal(both.amortised_usd_per_pr, 3);
  assert.deepEqual(both.inputs, { list_price_usd_per_month: 30, prs_per_month: 10 });
});

test("the two arms' costs cannot be read as like-for-like, structurally", () => {
  const r = costLatencyOf(oneRun(), { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: K1.map((x) => x.item_id), coderabbit: { listPriceUsdPerMonth: 30, prsPerMonth: 10 } });
  assert.notEqual(r.panel.unit, r.coderabbit.unit);
  assert.equal(r.coderabbit.cost.comparable_to_panel_cost, false);
  // Different key names, so no consumer can line the two up by field name — on
  // BOTH branches, including the priced-null one, which is the branch that ships
  // until somebody supplies a subscription price.
  for (const block of [r.coderabbit.cost, scoreK1().coderabbit.cost]) {
    assert.equal(Object.hasOwn(block, "cost_usd"), false, "our arm's key name on their arm's figure is how the two get charted side by side");
    assert.equal(block.comparable_to_panel_cost, false);
  }
  assert.equal(Object.hasOwn(r.panel, "amortised_usd_per_pr"), false);
  // And no ratio between the arms exists anywhere in the result. Matched as QUOTED
  // KEYS, because a bare substring search for "ratio" hits `duration_source` — the
  // word is inside "duration" — and a check that can never fail is decoration.
  const json = JSON.stringify(r);
  for (const key of ["ratio", "vs_coderabbit", "cheaper", "times_cheaper", "savings", "arm_ratio"]) {
    assert.equal(json.includes(`"${key}"`), false, `${key} compares a metered number with an amortised one`);
  }
});

test("the two uncomputable metrics are explicit nulls with reasons, not omissions", () => {
  const r = scoreK1();
  assert.equal(r.cost_per_real_finding, null);
  // The VALUE of every declared gap is null, checked as its own assertion: a
  // reason beside an approximation would read as a caveat on a real number rather
  // than as a refusal to produce one.
  for (const g of r.declared_gaps) assert.equal(g.value, null, `${g.metric} carries a value — a declared gap is a null, not an estimate with an apology`);
  const gaps = new Map(declaredGaps().map((g) => [g.metric, g]));
  assert.match(gaps.get("cost_per_real_finding").reason, /no adjudicated labels exist/);
  assert.match(gaps.get("cost_per_real_finding").reason, /cost divided by all findings/);
  // The latency gap says MEASURABLE-but-not-here, not "impossible". The distinction
  // is the whole value of the field: a reader who is told a number cannot exist
  // stops looking, and this one can — from the other arm's own status-comment edit
  // history, which is the adapter's to read.
  assert.match(gaps.get("coderabbit_latency_ms").reason, /MEASURABLE, and not from anything this scorer reads/);
  // The DECIDED interval, named. A gap that says "measurable" without saying which
  // interval invites the next reader to pick one, and three of the available
  // choices are wrong in ways that were measured rather than argued.
  assert.match(gaps.get("coderabbit_latency_ms").reason, /coderabbit-start-marker-to-first-finding/);
  // Including the one THIS FIELD used to propose, kept as a named rejection with
  // its error rather than quietly dropped: a deleted wrong answer gets reinvented.
  assert.match(gaps.get("coderabbit_latency_ms").reason, /created_at-to-updated_at pair, which is wrong by 8x/);
  assert.match(gaps.get("coderabbit_latency_ms").unblocked_by, /timing read in the arm's adapter/);
  // The half that matters most: arriving at a number does not make the two arms
  // comparable, and the bias runs the opposite way from the long-standing worry.
  assert.match(gaps.get("coderabbit_latency_ms").unblocked_by, /2\.2x LONGER/);
  assert.match(gaps.get("coderabbit_latency_ms").unblocked_by, /no ratio/);
  assert.deepEqual(r.declared_gaps.map((g) => g.metric), ["cost_per_real_finding", "coderabbit_latency_ms"]);
  assert.equal(r.coderabbit.latency.wall_ms, null);
});

// --- what a reader actually sees ---------------------------------------------

test("the report prints each caveat on the line of the number it qualifies", () => {
  const lines = renderReport(scoreK1());
  const text = lines.join("\n");
  const sumLine = lines.find((l) => l.includes("wall clock summed"));
  assert.match(sumLine, /NOT the dispatch's elapsed time/, "the sum and its caveat must be one line — a caveat two lines away is not read");
  const fitLine = lines.find((l) => l.includes("cost vs size"));
  assert.match(fitLine, /per item \+ .* per 1000 lines .* of this replicate is the per-item floor/);
  assert.match(text, /absent=0/, "the census prints its zeros");
  assert.match(text, /no ratio between them is computed here/);
  assert.match(text, /these prices describe THIS reviewer only/);
  assert.match(text, /cost_per_real_finding = null/);
});

test("the report names the reviewer pair beside the money", () => {
  const head = renderReport(scoreK1()).slice(0, 3).join("\n");
  assert.match(head, new RegExp(CONFIG_HASH.slice(0, 20)));
  assert.match(head, /panel 46da673dd46d/);
});

// --- shape -------------------------------------------------------------------

test("a replicate row carries when each item was measured, so a resumed item is visible", () => {
  const rep = scoreReplicate({ run_id: "pilot-01__k1", run: run(), items: k1Items(), sizes: k1Sizes() });
  assert.equal(rep.items[0].measured_at, "2026-08-10T08:45:32.440Z");
  assert.equal(rep.items.every((r) => r.poolable), true);
});

test("spendOf never returns a non-finite number", () => {
  assert.deepEqual(spendOf({}), { cost_usd: 0, turns: 0, calls: 0 });
  assert.deepEqual(spendOf({ cost_usd: "1.5", turns: null, calls: undefined }), { cost_usd: 1.5, turns: 0, calls: 0 });
});

test("the result names the scorer and the reviewer it prices", () => {
  const r = scoreK1();
  assert.equal(r.scorer_id, SCORER_ID);
  assert.equal(r.scope, "cross-run");
  assert.deepEqual(r.reviewer, { config_hash: CONFIG_HASH, panel_sha: PANEL_SHA });
  assert.deepEqual(r.run_ids, ["pilot-01__k1"]);
  assert.equal(r.corpus_version, CORPUS);
  assert.equal(r.completeness.verdict, "complete");
  assert.match(r.completeness.totals_caveat, /an item deleted from the store takes its spend out of both/);
});

test("a corpus item no run reached is named, not silently missing", () => {
  const r = costLatencyOf(oneRun(), { sizes: k1Sizes(), corpusVersion: CORPUS, corpusItemIds: [...K1.map((x) => x.item_id), "pr-500"] });
  assert.match(r.completeness.reasons.join("\n"), /1 corpus item\(s\) never replayed \(pr-500\)/);
  assert.equal(r.completeness.verdict, "partial");
});
