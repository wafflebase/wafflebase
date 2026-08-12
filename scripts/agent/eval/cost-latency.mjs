// What one review COSTS and how LONG it takes, per item and per replicate, over
// stored run envelopes. Spec §3.4.
//
// This is the metric a budget holder reads first and the only one in Wave 3 that
// needs no labels, no matcher and no second arm to be computable — so it ships
// earliest and is quoted hardest. That is the whole difficulty. A dollar figure
// per pull request is arithmetic; a dollar figure that cannot be misread is the
// deliverable, and there are four specific misreadings this file is shaped to
// make impossible:
//
//   1. "our reviews take half an hour."  The envelope carries TWO time fields and
//      only one of them is elapsed time. The other is the flat sum over every SDK
//      call, which overcounts by the concurrency factor because the panel runs its
//      lenses — and each lens's samples and verifier calls — concurrently (#669
//      measured a ~12-minute panel reported as 36–63). `wallMsOf` is the ONE place
//      a duration is read here, it reads `duration_ms` beside `duration_source`,
//      and the summed field is not named anywhere in this file. A test greps for
//      that, because the trap is a naming hazard rather than a missing feature.
//   2. "big pull requests cost more, so bill by size."  Measured over the pilot:
//      cost is dominated by a per-item FLOOR. The 1004-line item costs ~3× the
//      22-line one for 46× the lines. So no average cost-per-line is emitted at
//      all — see `fitCostToSize`, and the note on why the fit is reported and the
//      average is not.
//   3. "latency scales with size."  It does not, and the pilot falsifies it on
//      real pairs: a 22-line item took 9.6 minutes while a 160-line one took 7.0.
//      `sizeOrder` counts the pairs that violate the ordering instead of asserting
//      a trend, so the exception is in the output rather than in a footnote.
//   4. "we are cheaper than CodeRabbit."  Their cost is a flat subscription and
//      ours is metered per review. There is no ratio between those two numbers and
//      this file computes none — the two live under different keys, in different
//      units, each naming its basis. See `coderabbitCost`.
//
// TWO NUMBERS ARE DECLARED NULL RATHER THAN APPROXIMATED, and both are in
// `declaredGaps`. Cost per real finding needs confirmed-real findings and zero
// adjudicated labels exist; the tempting substitute — cost ÷ all findings — is the
// worst option available precisely because it looks like the real metric. Same for
// CodeRabbit's latency, for a different reason: it is measurable, from the other
// arm's own start marker, and not from anything in the store. When it arrives it
// arrives as an INJECTED option and goes in its own block — never on one axis with
// our figure, which is a replay process's time and runs about 2.2x LONGER than
// theirs when both are measured in production from one trigger. See `declaredGaps`.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. No stage attribution — which stage
// spends the money is §3.6, and `stageDetail` is not read here. No cost per
// finding of any kind. No ratio between arms. No chart and no markdown report.
//
// NOTHING IS WRITTEN AND NOTHING IS SPENT. It reads a store, computes, prints.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopeSize } from "../metrics.mjs";
import { parseArgs } from "../gh-checks.mjs";
import { ITEM_STATUSES } from "./store.mjs";
// One definition of "median" and "the distribution of a per-item series" across
// the scorers, rather than a second one here. Two tables of the same run that
// disagree about a median because each file rolled its own is the failure mode
// this project has already shipped once with two line counts; `volume-mix.mjs`
// exports these as pure functions for exactly this reuse, and `pin` is its
// vocabulary guard.
import { distribution, pin } from "./volume-mix.mjs";
// The reviewer-identity and corpus-label guards are the RELIABILITY scorer's, not a
// second pair here. Both files ask the same question of the same store for the same
// reason — decision 13's "the reviewer is the pair `(config_hash, panel_sha)`" — and
// two guards with one name that drift apart is the failure this directory documents
// most often. Theirs is also the stricter of the two: it refuses an input where NO
// run states an identity, which an earlier draft of this file returned `null` for.
// The only adaptation is the input shape, below.
import { assertOneReviewer, assertRequestedCorpus } from "./reliability.mjs";

const refuse = (msg) => {
  throw new Error(`cost & latency: ${msg}`);
};

/** Bumped when a field changes meaning, never when one is added. */
export const SCHEMA_VERSION = 1;

/**
 * The store's own name for a metric file, from its `scores/<scorer_id>.json`
 * layout. Carried in the result so that a later PR which persists a score has an
 * id already agreed, and so a printed number can be traced to the code that made
 * it. NOTHING IS WRITTEN HERE — the merged scorers print and store nothing, and
 * this one follows them.
 */
export const SCORER_ID = "cost-latency-v1";

/** The one item status that means "a real verdict, poolable as one" (decision 8),
 *  pinned against the store's vocabulary so a rename there stops this file
 *  loading rather than leaving a comparison that silently never matches. */
const OK = pin("ok", ITEM_STATUSES, "the poolable item status");

/**
 * WHERE a stored `duration_ms` came from, and there are THREE answers rather than
 * the two a reader expects.
 *
 * This is the one vocabulary in this file with no exported owner: `run.mjs` writes
 * the strings inline (`run.mjs:955` and `run.mjs:1100`), so there is nothing to
 * `pin` against. The remedy is the opposite of a default — an unrecognised value
 * is counted under its own key AND named in the completeness reasons, so a fourth
 * flavour appearing upstream shows up as an unexplained bucket instead of being
 * folded into one of these.
 *
 *   review-timing.json  the panel's own elapsed time for the round, stamped by
 *                       `review-panel.mjs:2969` from a `Date.now()` taken at the
 *                       top of `main()`. TRUE wall clock, and all 21 pilot replays
 *                       carry it.
 *   absent              the panel ran and wrote no timing file. The duration is
 *                       UNKNOWN. Never 0, never the mean — a replay with no timing
 *                       file is not a fast replay, and the path has never run on
 *                       real data, which is exactly when a default would go
 *                       unnoticed.
 *   not-run             no panel ran at all: a pre-spawn refusal or an exception
 *                       (`run.mjs:955`). A different absence from the one above and
 *                       kept apart from it, because pooling the two would report
 *                       "we could not time it" for an item that was never timed
 *                       because it was never reviewed.
 */
export const DURATION_SOURCES = Object.freeze(["review-timing.json", "absent", "not-run"]);

/** The only `duration_source` whose `duration_ms` is elapsed time. */
export const MEASURED_DURATION_SOURCE = "review-timing.json";

/**
 * The item's wall clock, or `null` and why. THE ONE PLACE A DURATION IS READ.
 *
 * It reads the pair, never the value, and that is lesson 7 rather than
 * defensiveness: `duration_ms` alone cannot distinguish "the panel took no time"
 * from "nobody recorded how long it took", and the store permits `null` precisely
 * so the second is spellable. A scorer that read the number and ignored the
 * provenance would be correct today — 21 of 21 replays are measured — and would
 * start averaging zeros the first time a timing file went missing.
 *
 * The two halves must AGREE, and a disagreement REFUSES rather than picking one.
 * A finite duration filed under `absent`, or a null filed under the measured
 * source, means the writer and this reader disagree about what the field is, and
 * every latency number downstream would be built on whichever of them is wrong.
 */
export function wallMsOf(envelope) {
  const e = envelope ?? {};
  const source = typeof e.duration_source === "string" && e.duration_source.trim() !== "" ? e.duration_source : null;
  if (source === null) {
    refuse(`${e.run_id ?? "?"}/${e.item_id ?? "?"}: envelope.duration_source is missing, so a duration read from it would have no provenance`);
  }
  const measured = source === MEASURED_DURATION_SOURCE;
  const ms = Number.isFinite(e.duration_ms) ? e.duration_ms : null;
  if (measured && ms === null) {
    refuse(`${e.run_id}/${e.item_id}: duration_source is ${JSON.stringify(source)} but duration_ms is ${JSON.stringify(e.duration_ms)} — the provenance claims a measurement that is not there`);
  }
  if (!measured && ms !== null) {
    refuse(`${e.run_id}/${e.item_id}: duration_source is ${JSON.stringify(source)} but duration_ms is ${ms} — a number under an absent provenance is a number nobody can attribute`);
  }
  return { wall_ms: ms, duration_source: source, measured };
}

/**
 * Money, turns and calls off one envelope, all finite.
 *
 * `cost_usd` is read on EVERY item including the failed ones, and that is the
 * point rather than an oversight: a failed replay can have spent real money before
 * it failed. The pilot's own repair deleted an `infra` error item that had spent
 * $2.49, and `putRun` then recomputed the run totals from the envelopes still
 * present — so the store's figure is honestly lower than what was actually paid.
 * Nothing here can see a deleted item; what this file can do is keep "what a
 * successful review costs" and "what this run spent" as two separate numbers, so
 * that the second is never quoted as the first. See `scoreReplicate`.
 */
export function spendOf(envelope) {
  const e = envelope ?? {};
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { cost_usd: n(e.cost_usd), turns: n(e.turns), calls: n(e.calls) };
}

/**
 * The item's size and its size bucket, from the FROZEN diff.
 *
 * Both come off `meta.json` rather than being recounted: `diffLineCounts` froze
 * `additions`/`deletions` at extraction and `scopeSize` froze the bucket beside
 * them (`extract-corpus.mjs:390`, whose comment says this is what to segment on).
 * A second count here is how the manifest's size and this file's would come to
 * disagree about the same item.
 *
 * The stored bucket is CHECKED against `scopeSize` rather than trusted, because
 * the two are one fact derived twice and a silent disagreement would move an item
 * between buckets — which, on a 7-item corpus where one bucket holds a single
 * item, changes the reported cost of a size class outright.
 */
export function sizeOf(itemId, meta) {
  const m = meta ?? {};
  const additions = Number.isFinite(m.additions) ? m.additions : null;
  const deletions = Number.isFinite(m.deletions) ? m.deletions : null;
  // `null`, never 0: an item whose meta would not read has an UNKNOWN size, and a
  // zero would put it in the smallest bucket and pull that bucket's cost up.
  if (additions === null || deletions === null) return { item_id: itemId, diff_lines: null, size_bucket: null };
  const lines = additions + deletions;
  const computed = scopeSize(additions, deletions);
  const stored = typeof m.scope === "string" && m.scope.trim() !== "" ? m.scope : null;
  if (stored !== null && stored !== computed) {
    refuse(`${itemId}: meta.scope is ${JSON.stringify(stored)} but scopeSize(${additions}, ${deletions}) is ${JSON.stringify(computed)} — the frozen bucket and the rule that made it disagree, and every per-bucket cost figure would be about a different set of items than the manifest says`);
  }
  return { item_id: itemId, diff_lines: lines, size_bucket: stored ?? computed };
}

/**
 * A per-item or per-replicate series as a RANGE first.
 *
 * K=3 means three measurements of every item, and decision 25 is that the range is
 * reported rather than a bare mean. It is not a stylistic preference: the pilot's
 * per-item finding VOLUME moves 12–67% between replicates of the same reviewer on
 * the same item, so a mean of three draws that far apart describes none of them.
 * Cost turns out to be the stable one — which is itself a finding, and it is only
 * visible if both are reported the same way.
 *
 * `spread_over_min` names its own denominator, because "spread" has been quoted in
 * this project against the minimum and against the mean on the same page. It is
 * `null` when the minimum is 0 or the series is empty, never Infinity.
 */
export function seriesOf(values) {
  const xs = [...(Array.isArray(values) ? values : [])].filter((v) => Number.isFinite(v));
  const dist = distribution(xs);
  const range = dist.n === 0 ? null : dist.max - dist.min;
  return {
    ...dist,
    range,
    spread_over_min: dist.n === 0 || dist.min <= 0 ? null : range / dist.min,
  };
}

/**
 * Cost against size as a FIXED FLOOR plus a marginal rate — the shape the pilot's
 * numbers actually have, and the one figure that stops a per-line rate being
 * quoted.
 *
 * Least squares over the items of one replicate: `cost ≈ intercept + slope × (lines
 * / 1000)`. `fixed_share` is `intercept × n / Σcost` — the fraction of a replicate
 * that is per-item overhead. On the pilot's first replicate that is 47%, and it is
 * the number that answers the budget question the average cannot: **the bill scales
 * with the number of items, not with their lines.**
 *
 * THE AVERAGE COST PER LINE IS DELIBERATELY NOT EMITTED, anywhere, at any level.
 * `Σcost / Σlines` is arithmetically fine and reads backwards: because of that
 * floor, the cheapest item per line is the biggest one, so the average makes a
 * 1004-line review look ~15× more efficient than a 22-line one. The same
 * size-confound swings findings-per-100-lines by 19× across this corpus, and §3.1
 * lists that as a size NORMALISER. A marginal slope cannot be misread the same way
 * — it is explicitly the cost of the next thousand lines and not the cost of the
 * average one.
 *
 * Refuses to fit fewer than three points or a series with no spread in x: two
 * points define a line through themselves and say nothing about a floor, and
 * identical sizes have no slope at all. `null` with a reason, never a number.
 */
export function fitCostToSize(points) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => Number.isFinite(p?.diff_lines) && Number.isFinite(p?.cost_usd));
  const n = pts.length;
  if (n < 3) return { n, intercept_usd: null, slope_usd_per_1000_lines: null, fixed_share: null, reason: `a floor-plus-slope fit needs at least 3 items, got ${n}` };
  // The no-spread check counts DISTINCT SIZES rather than testing the variance
  // against zero, and the difference is not pedantry: three items of 100 lines each
  // give an x-variance of 2e-33 rather than 0, because `100/1000` is not exact in
  // binary and the mean of three copies of it is not the value itself. A
  // `variance === 0` guard therefore lets that case through and divides by a
  // rounding error, which returned a slope of exactly 0 with a straight face. Line
  // counts are integers, so counting them is exact.
  if (new Set(pts.map((p) => p.diff_lines)).size < 2) {
    return { n, intercept_usd: null, slope_usd_per_1000_lines: null, fixed_share: null, reason: "every item is the same size, so there is no slope to fit" };
  }
  const xs = pts.map((p) => p.diff_lines / 1000);
  const ys = pts.map((p) => p.cost_usd);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
  const intercept = my - slope * mx;
  const total = ys.reduce((a, b) => a + b, 0);
  return {
    n,
    intercept_usd: intercept,
    slope_usd_per_1000_lines: slope,
    // `null` rather than a division by nothing, and it may legitimately exceed 1 if
    // the slope comes out negative on a small sample — which is a signal, not a
    // number to clamp.
    fixed_share: total === 0 ? null : (intercept * n) / total,
    reason: null,
  };
}

/**
 * How well a per-item series is ORDERED by size, as a count of pairs rather than a
 * claim.
 *
 * The pilot falsifies the obvious sentence about latency: the smallest item was the
 * second-slowest. So instead of a trend this reports every pair of items and
 * whether the bigger one also scored higher — concordant, discordant or tied. A
 * reader who wants to write "X scales with size" has the exceptions in front of
 * them, with the pairs counted.
 *
 * `tau` is Kendall's tau-a over the untied pairs, offered as a compact summary of
 * the same counts and NOT as a test: seven items give 21 pairs and no significance
 * claim is made or implied anywhere in this file.
 */
export function sizeOrder(points) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => Number.isFinite(p?.diff_lines) && Number.isFinite(p?.value));
  let concordant = 0, discordant = 0, tied = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].diff_lines - pts[j].diff_lines;
      const dy = pts[i].value - pts[j].value;
      const s = Math.sign(dx) * Math.sign(dy);
      if (s > 0) concordant++;
      else if (s < 0) discordant++;
      else tied++;
    }
  }
  const untied = concordant + discordant;
  return { n_items: pts.length, pairs: concordant + discordant + tied, concordant, discordant, tied, tau: untied === 0 ? null : (concordant - discordant) / untied };
}

/**
 * A census over `duration_source`, with every declared value printed at n=0.
 *
 * The zeros are the point. "No item was missing its timing file" and "we never
 * looked" are different facts, and `absent` has never occurred on real data — which
 * is precisely the state in which a mishandled absence goes unnoticed for months.
 * An unrecognised value gets its own key so that a fourth flavour is visible as an
 * unexplained bucket rather than silently pooled into one of the three.
 */
export function durationCensus(envelopes) {
  const counts = Object.fromEntries(DURATION_SOURCES.map((s) => [s, 0]));
  const unrecognised = {};
  for (const e of Array.isArray(envelopes) ? envelopes : []) {
    const s = typeof e?.duration_source === "string" ? e.duration_source : "(missing)";
    if (Object.hasOwn(counts, s)) counts[s]++;
    else unrecognised[s] = (unrecognised[s] ?? 0) + 1;
  }
  return { n: (Array.isArray(envelopes) ? envelopes : []).length, counts, unrecognised };
}

/**
 * One replicate: its per-item rows, what it spent, and what a review of it costs.
 *
 * THE TWO MONEY QUESTIONS ARE KEPT APART and neither is called "cost".
 *
 *   `spend.total_usd`     what this run's stored envelopes add up to, failures
 *                         included. The accounting number.
 *   `review.cost_usd`     the distribution over `ok` items only. The product
 *                         number — what one successful review costs.
 *
 * An `error` item is not a cheap review, it is a review that did not happen, and
 * the pilot has one that spent $2.49 before failing. Pooling it into the second
 * would make a rate-limited run look economical.
 *
 * `stored_total_usd` is the run's own `totals.cost_usd` and it is CHECKED against
 * the sum here rather than trusted or ignored. Both are recomputed from the
 * envelopes present, so they agree by construction — which makes a disagreement
 * evidence that the run directory changed under the summary, and that is worth a
 * reason in the output rather than a silent preference for one of them.
 */
export function scoreReplicate({ run_id, run = null, items = [], sizes = new Map() } = {}) {
  const rows = [];
  for (const it of Array.isArray(items) ? items : []) {
    const e = it?.envelope ?? {};
    const size = sizes.get(it?.item_id) ?? { diff_lines: null, size_bucket: null };
    const { wall_ms, duration_source, measured } = wallMsOf(e);
    rows.push({
      item_id: it?.item_id ?? null,
      status: e.status ?? null,
      reason: e.reason ?? null,
      poolable: e.status === OK,
      ...spendOf(e),
      wall_ms,
      duration_source,
      wall_measured: measured,
      diff_lines: size.diff_lines,
      size_bucket: size.size_bucket,
      // WHEN the item was measured, carried because a run id does not imply one
      // sitting. A resumed run reuses items stored by an earlier dispatch — the
      // pilot's first replicate contains one, measured 18 minutes before that
      // dispatch started — so "what this dispatch cost" is not derivable from a
      // run's stored totals and is not claimed anywhere here.
      measured_at: typeof e.timestamp === "string" ? e.timestamp : null,
    });
  }
  const ok = rows.filter((r) => r.poolable);
  const timed = ok.filter((r) => r.wall_measured);
  const errored = rows.filter((r) => !r.poolable);
  const total = rows.reduce((a, r) => a + r.cost_usd, 0);
  const stored = Number.isFinite(run?.totals?.cost_usd) ? run.totals.cost_usd : null;
  return {
    run_id,
    status: run?.status ?? null,
    // Read TOGETHER, always: `complete` is derived from every planned item being
    // PRESENT, not from every item being `ok`, and an error item writes an envelope.
    // A run can therefore report `complete` with two dead items in it, which is how
    // the pilot's third replicate looked before its repair.
    item_count: Number.isFinite(run?.item_count) ? run.item_count : null,
    items_ok: Number.isFinite(run?.items_ok) ? run.items_ok : null,
    items_error: Number.isFinite(run?.items_error) ? run.items_error : null,
    items: rows,
    spend: {
      total_usd: total,
      ok_items_usd: ok.reduce((a, r) => a + r.cost_usd, 0),
      error_items_usd: errored.reduce((a, r) => a + r.cost_usd, 0),
      n_ok: ok.length,
      n_error: errored.length,
      stored_total_usd: stored,
      // A tolerance, not equality: both sides are sums of floats read from JSON.
      stored_total_agrees: stored === null ? null : Math.abs(stored - total) <= 1e-6 * Math.max(1, Math.abs(stored)),
    },
    review: {
      cost_usd: seriesOf(ok.map((r) => r.cost_usd)),
      turns: seriesOf(ok.map((r) => r.turns)),
      calls: seriesOf(ok.map((r) => r.calls)),
      // The wall-clock denominator is the TIMED items, not the ok ones, and it
      // carries its own n so a run with three missing timing files cannot read as a
      // run of three items.
      wall_ms: seriesOf(timed.map((r) => r.wall_ms)),
      // Summed over the stored items, and named so it is never read as the
      // dispatch's elapsed time: items a resume skipped were measured in another
      // sitting, and the panel's own clock excludes everything the lane does around
      // it (fetching refs, materialising a worktree, committing the store).
      items_wall_ms_sum: timed.reduce((a, r) => a + r.wall_ms, 0),
      n_timed: timed.length,
    },
    cost_vs_size: fitCostToSize(ok.map((r) => ({ diff_lines: r.diff_lines, cost_usd: r.cost_usd }))),
    cost_size_order: sizeOrder(ok.map((r) => ({ diff_lines: r.diff_lines, value: r.cost_usd }))),
    wall_size_order: sizeOrder(timed.map((r) => ({ diff_lines: r.diff_lines, value: r.wall_ms }))),
    duration_source: durationCensus(rows.map((r) => ({ duration_source: r.duration_source }))),
  };
}

/**
 * Per item ACROSS replicates — the range K bought.
 *
 * Only `ok` observations are pooled, and `replicates` is the count of them rather
 * than the number of runs asked for, so an item that failed in one leg reports a
 * range over two draws and says so.
 */
function perItemAcross(replicates, sizes) {
  const byItem = new Map();
  for (const rep of replicates) {
    for (const row of rep.items) {
      if (!byItem.has(row.item_id)) byItem.set(row.item_id, []);
      byItem.get(row.item_id).push({ run_id: rep.run_id, ...row });
    }
  }
  return [...byItem.keys()].sort().map((item_id) => {
    const obs = byItem.get(item_id);
    const ok = obs.filter((o) => o.poolable);
    const timed = ok.filter((o) => o.wall_measured);
    const size = sizes.get(item_id) ?? { diff_lines: null, size_bucket: null };
    return {
      item_id,
      diff_lines: size.diff_lines,
      size_bucket: size.size_bucket,
      replicates: ok.length,
      replicates_excluded: obs.filter((o) => !o.poolable).map((o) => ({ run_id: o.run_id, status: o.status, reason: o.reason, cost_usd: o.cost_usd })),
      cost_usd: seriesOf(ok.map((o) => o.cost_usd)),
      wall_ms: seriesOf(timed.map((o) => o.wall_ms)),
      n_timed: timed.length,
      turns: seriesOf(ok.map((o) => o.turns)),
      calls: seriesOf(ok.map((o) => o.calls)),
    };
  });
}

/**
 * By SIZE BUCKET, which is the only size-segmented number this file emits.
 *
 * The unit is one OBSERVATION — one item in one replicate — because that is what a
 * cost measurement is. `items` is carried beside `n` so that a bucket holding one
 * item measured three times is not read as three items: on the pilot the `S` bucket
 * is exactly that, and its "three observations" are three draws of one pull
 * request.
 */
function bySizeBucket(replicates, sizes) {
  const buckets = new Map();
  for (const rep of replicates) {
    for (const row of rep.items) {
      if (!row.poolable) continue;
      const key = row.size_bucket ?? "(unknown)";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
  }
  return [...buckets.keys()].sort().map((bucket) => {
    const obs = buckets.get(bucket);
    const items = [...new Set(obs.map((o) => o.item_id))].sort();
    const timed = obs.filter((o) => o.wall_measured);
    return {
      size_bucket: bucket,
      items,
      item_count: items.length,
      observations: obs.length,
      diff_lines: seriesOf(items.map((id) => sizes.get(id)?.diff_lines).filter((v) => Number.isFinite(v))),
      cost_usd: seriesOf(obs.map((o) => o.cost_usd)),
      wall_ms: seriesOf(timed.map((o) => o.wall_ms)),
      n_timed: timed.length,
    };
  });
}

/**
 * CodeRabbit's cost, which is A DIFFERENT KIND OF NUMBER and is built so that it
 * cannot be read as ours.
 *
 * Their price is a flat subscription: it does not vary with the pull request, it is
 * not incurred by a review, and there is no per-review figure to compare against
 * $4.70. §3.4 asks for list price per PR, which is an AMORTISATION — a monthly fee
 * divided by however many pull requests that month happened to carry — and the
 * only honest way to emit one is with both inputs beside it, supplied by a caller
 * who knows them. Neither is in the store and neither is guessed here.
 *
 * Three properties make the misreading structurally hard rather than discouraged:
 * the key is `amortised_usd_per_pr` and not `cost_usd`; `metered` is `false`; and
 * NOTHING IN THIS FILE DIVIDES ONE ARM'S NUMBER BY THE OTHER'S. A side-by-side bar
 * of "$4.70 vs $X" compares a metered number with an amortised one, and the fix is
 * that the two never share a unit or a name.
 */
export function coderabbitCost({ listPriceUsdPerMonth = null, prsPerMonth = null } = {}) {
  const price = Number.isFinite(listPriceUsdPerMonth) && listPriceUsdPerMonth >= 0 ? listPriceUsdPerMonth : null;
  const prs = Number.isFinite(prsPerMonth) && prsPerMonth > 0 ? prsPerMonth : null;
  const base = { basis: "flat-subscription", metered: false, comparable_to_panel_cost: false };
  if (price === null || prs === null) {
    return {
      ...base,
      amortised_usd_per_pr: null,
      inputs: null,
      reason: "a flat subscription has no per-review price; an amortised one needs BOTH a list price and the pull-request volume it is spread over, and neither is in the store",
    };
  }
  return { ...base, amortised_usd_per_pr: price / prs, inputs: { list_price_usd_per_month: price, prs_per_month: prs }, reason: null };
}

/**
 * The two numbers §3.4 asks for that CANNOT be computed, emitted as explicit nulls
 * with their reasons rather than left out.
 *
 * A missing key reads as an oversight and gets filled in by the next reader with
 * whatever is to hand. A null with a reason is a decision, and both of these are
 * decisions: the substitutes are available, cheap and wrong.
 */
export function declaredGaps() {
  return [
    {
      metric: "cost_per_real_finding",
      value: null,
      reason:
        "it needs CONFIRMED-REAL findings and no adjudicated labels exist yet. The available substitute — cost divided by all findings — is the worst option on the table precisely because it looks like this metric and would be quoted as it, while a reviewer that raised twice as many false findings would score twice as cheap",
      unblocked_by: "adjudicated labels",
    },
    {
      metric: "coderabbit_latency_ms",
      value: null,
      reason:
        "MEASURABLE, and not from anything this scorer reads. The end is a finding's own posted_at; the start is CodeRabbit's OWN start marker — the HTML comment it stamps when it takes a job, per invocation for an on-demand review and once per pull request for its status comment — taking the latest such marker before the finding. The interval is therefore coderabbit-start-marker-to-first-finding, and reading it is an API call that belongs to the arm's adapter rather than to a scorer which touches no network; it arrives here as an injected option. Three other starts were rejected, and one of them is the trap THIS FIELD USED TO PROPOSE: the status comment's created_at-to-updated_at pair, which is wrong by 8x — 53.7 min against a true 6.6 on one pilot item — because the last edit is the last edit of anything, and a rule that is right on one comment kind and 8x wrong on another is not a rule. Also rejected: a push-time proxy off our own check runs, which times a HUMAN whenever a human asked for the review, and the pull request's created_at or the commit's committer date, neither of which dates the reviewed snapshot",
      unblocked_by:
        "a timing read in the arm's adapter. Note what that will NOT unblock: a COMPARISON. Ours is a panel process's elapsed time on an offline replay that queued for nothing; theirs is a production reviewer measured end to end. Where both were measured from one trigger in production, ours ran about 2.2x LONGER — the opposite of the direction this was long assumed to err in — so the two stay in separate blocks with separate units and no ratio, and minutes need that discipline more than dollars because they look commensurable",
    },
  ];
}

/**
 * Cost and latency for every replicate of ONE reviewer over ONE corpus.
 *
 * `runs` is exactly what the store yields: `{run_id, run, items:[{item_id,
 * envelope}]}` per replicate. Unlike the volume scorer this one DOES aggregate
 * across K, and that is not a contradiction — a mean, a union and an intersection
 * of FINDINGS are three different metrics, whereas three measurements of a price
 * are three measurements of a price. What it must not do is hide the spread, so
 * every cross-replicate figure is a range.
 *
 * Refuses on a caller error (two reviewers, two corpora, a corpus label the data
 * cannot verify, a duration whose provenance contradicts it) and LABELS a data
 * shortfall (a failed item, a missing timing file, a corpus item no run reached).
 * The split is the one `volume-mix.mjs` draws: the first means the number would be
 * wrong, the rest mean it is right about less than a reader may assume.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE RELIABILITY SCORER, whose identity guards this
 * borrows: that file also calls `assertItemsOk` and ABORTS on a failed item, because
 * a truncated finding set reads as disagreement and would make the panel look
 * unreliable when the harness failed. Cost has the opposite requirement — a failed
 * replay still spent money, and refusing the run would make that spend invisible —
 * so a failed item is REPORTED here rather than refused, under `spend` and never
 * under `review`. Two scorers, one store, two correct answers.
 */
export function costLatencyOf(runs = [], { sizes = new Map(), corpusVersion = null, corpusItemIds = [], coderabbit = {} } = {}) {
  const list = Array.isArray(runs) ? runs : [];
  const envelopes = list.flatMap((r) => (Array.isArray(r.items) ? r.items : []).map((it) => it.envelope ?? {}));
  // Adapted to the shape the borrowed guards take: they read identity off `items[]`
  // entries directly and the corpus off either the run or its items. A stored
  // envelope carries all three fields, so the adaptation is a projection and not a
  // second source of truth.
  const identity = assertOneReviewer(
    list.map((r) => ({
      run_id: r.run_id,
      corpus_version: r.run?.corpus_version,
      items: (Array.isArray(r.items) ? r.items : []).map((it) => it.envelope ?? {}),
    })),
  );
  const reviewer = { config_hash: identity.config_hash, panel_sha: identity.panel_sha };
  const corpus = assertRequestedCorpus(identity.corpus_version, corpusVersion);

  const replicates = list.map((r) => scoreReplicate({ ...r, sizes }));
  const per_item = perItemAcross(replicates, sizes);
  const corpusIds = [...new Set(corpusItemIds)].sort();

  const reasons = [];
  for (const rep of replicates) {
    if (rep.status !== null && rep.status !== "complete") reasons.push(`${rep.run_id}: run status ${rep.status}`);
    // `items_ok` against `item_count`, never `status` alone — see `scoreReplicate`.
    if (Number.isFinite(rep.item_count) && Number.isFinite(rep.items_ok) && rep.items_ok < rep.item_count) {
      reasons.push(`${rep.run_id}: ${rep.items_ok} of ${rep.item_count} item(s) ok`);
    }
    for (const r of rep.items.filter((x) => !x.poolable)) reasons.push(`${rep.run_id}/${r.item_id}: ${r.status}${r.reason ? ` (${r.reason})` : ""}, $${r.cost_usd.toFixed(2)} spent and not counted as a review`);
    for (const r of rep.items.filter((x) => x.poolable && !x.wall_measured)) reasons.push(`${rep.run_id}/${r.item_id}: no wall clock (duration_source ${r.duration_source}) — excluded from every latency figure, not counted as zero`);
    for (const [value, n] of Object.entries(rep.duration_source.unrecognised)) reasons.push(`${rep.run_id}: ${n} item(s) carry an unrecognised duration_source ${JSON.stringify(value)} — it is not one of ${DURATION_SOURCES.join(" | ")} and has been pooled with nothing`);
    // Both sides at the same precision: two dollar figures printed to different
    // numbers of places invite a reader to blame the formatting for the gap.
    if (rep.spend.stored_total_agrees === false) reasons.push(`${rep.run_id}: run.json totals say $${rep.spend.stored_total_usd.toFixed(4)} and the stored envelopes sum to $${rep.spend.total_usd.toFixed(4)} — the summary and the items disagree`);
    const seen = new Set(rep.items.map((r) => r.item_id));
    const missing = corpusIds.filter((id) => !seen.has(id));
    if (missing.length > 0) reasons.push(`${rep.run_id}: ${missing.length} corpus item(s) never replayed (${missing.join(", ")})`);
  }
  // AN UNKNOWN SIZE IS A LABELLED SHORTFALL, not a silent bucket. An item whose
  // frozen input is not under this root is priced correctly — the dollars come off
  // the envelope — but it can be placed in no size bucket, so it lands in
  // `(unknown)` and every size-segmented statement is about less than the corpus.
  // Derived from the ROWS rather than from what the caller passed, so a caller that
  // built its size map wrongly is caught by the same check as one that could not
  // read an item: the reason this file exists is that a scorer which computes a
  // right number over a wrong subset looks exactly like one that did not.
  const unsized = [...new Set(replicates.flatMap((rep) => rep.items.filter((r) => r.size_bucket === null).map((r) => r.item_id)))].sort();
  for (const id of unsized) reasons.push(`${id}: size unknown (no frozen corpus item under this root) — priced, but in no size bucket, so every per-size figure excludes it`);
  // The items priced in EVERY replicate: the only population a range may be quoted
  // over, because an item measured twice and an item measured three times have
  // ranges that are not comparable.
  const complete_items = per_item.filter((it) => it.replicates === replicates.length && replicates.length > 0).map((it) => it.item_id);

  return {
    schema_version: SCHEMA_VERSION,
    scorer_id: SCORER_ID,
    scope: "cross-run",
    // NAMED BESIDE EVERY DOLLAR FIGURE, per decision 13: these numbers price one
    // reviewer and do not generalise to another panel version.
    reviewer,
    corpus_version: corpus ?? corpusVersion ?? null,
    run_ids: replicates.map((r) => r.run_id),
    completeness: {
      verdict: reasons.length === 0 && corpusIds.length > 0 && replicates.length > 0 ? "complete" : "partial",
      reasons,
      corpus_item_count: corpusIds.length,
      items_priced_in_every_replicate: complete_items,
      // Nothing here can see money spent by an item that was later deleted from
      // the store: `putRun` recomputes a run's totals from the envelopes PRESENT,
      // so a failed attempt that was removed leaves no trace in any total this
      // file can read. Stated as a standing caveat rather than a computed one,
      // because the evidence for it is outside the store by construction.
      totals_caveat: "every total here is recomputed from the envelopes present; an item deleted from the store takes its spend out of both this figure and run.json's",
    },
    panel: {
      unit: "usd_per_review_metered",
      replicates,
      per_item,
      by_size_bucket: bySizeBucket(replicates, sizes),
      // Across replicates, so the stability of the PRICE is visible beside the
      // instability of the content: the pilot's replicate totals move ~11% of the
      // cheapest leg while per-item finding volume moves 12–67%. The denominator is
      // named because both figures are quoted in this project against the minimum
      // and against the mean, and half-range-over-mean makes the same three legs
      // read ~6%. This field is `spread_over_min`, so ~11% is the one that matches
      // what the row prints.
      replicate_spend_usd: seriesOf(replicates.map((r) => r.spend.total_usd)),
      duration_source: durationCensus(envelopes),
    },
    coderabbit: {
      unit: "amortised_usd_per_pr",
      cost: coderabbitCost(coderabbit),
      latency: { wall_ms: null, reason: declaredGaps().find((g) => g.metric === "coderabbit_latency_ms").reason },
    },
    cost_per_real_finding: null,
    declared_gaps: declaredGaps(),
  };
}

// --- the report -------------------------------------------------------------

const usd = (v) => (Number.isFinite(v) ? `$${v.toFixed(2)}` : "n/a");
const mins = (ms) => (Number.isFinite(ms) ? `${(ms / 60000).toFixed(1)}m` : "n/a");
const pctOf = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : "n/a");
const rangeStr = (s, fmt) => (s.n === 0 ? "n/a (n=0)" : `${fmt(s.min)}–${fmt(s.max)} (median ${fmt(s.median)}, n=${s.n})`);

/**
 * The result as lines. Pure and exported, so what a reader sees is testable without
 * spawning anything — and so the CLI cannot format a number the library did not
 * compute.
 *
 * RANGES ARE PRINTED BEFORE MEANS, everywhere, and several lines exist only to
 * carry a caveat next to the number they qualify. That is deliberate: the failure
 * this project keeps repeating is code that prints the evidence of its own limits
 * in a place nobody reads, so the limit is put in the same line as the figure.
 */
export function renderReport(result) {
  const out = [];
  const c = result.completeness;
  out.push(`cost & latency · corpus ${result.corpus_version ?? "(none)"} · ${c.verdict.toUpperCase()}`);
  out.push(`  reviewer ${result.reviewer.config_hash ?? "(none)"} @ panel ${(result.reviewer.panel_sha ?? "(none)").slice(0, 12)} — these prices describe THIS reviewer only`);
  out.push(`  ${result.run_ids.length} replicate(s): ${result.run_ids.join(", ") || "(none)"} · priced in every one: ${c.items_priced_in_every_replicate.join(", ") || "(none)"}`);
  for (const r of c.reasons) out.push(`  ! ${r}`);

  const p = result.panel;
  out.push("");
  out.push(`panel [${p.unit}]`);
  for (const rep of p.replicates) {
    out.push(
      `  ${rep.run_id}: spent ${usd(rep.spend.total_usd)} over ${rep.items.length} item(s)` +
        ` — ${usd(rep.spend.ok_items_usd)} on ${rep.spend.n_ok} review(s)` +
        `, ${usd(rep.spend.error_items_usd)} on ${rep.spend.n_error} failed item(s)` +
        (rep.spend.stored_total_agrees === false ? " · ⚠ DISAGREES with run.json" : ""),
    );
    out.push(`     per review: cost ${rangeStr(rep.review.cost_usd, usd)} · wall ${rangeStr(rep.review.wall_ms, mins)} · turns ${rangeStr(rep.review.turns, (v) => String(v))} · calls ${rangeStr(rep.review.calls, (v) => String(v))}`);
    // Named on the line, not in a docblock: this is the sum over items and NOT how
    // long the dispatch took.
    out.push(`     wall clock summed over ${rep.review.n_timed} timed item(s) = ${mins(rep.review.items_wall_ms_sum)} — a sum of panel runtimes, NOT the dispatch's elapsed time`);
    const f = rep.cost_vs_size;
    out.push(
      f.intercept_usd === null
        ? `     cost vs size: no fit (${f.reason})`
        : `     cost vs size: ${usd(f.intercept_usd)} per item + ${usd(f.slope_usd_per_1000_lines)} per 1000 lines (n=${f.n}) — ${pctOf(f.fixed_share)} of this replicate is the per-item floor, so the bill scales with the NUMBER of items`,
    );
    out.push(`     ordered by size: cost ${rep.cost_size_order.concordant}/${rep.cost_size_order.pairs} pair(s) concordant · wall ${rep.wall_size_order.concordant}/${rep.wall_size_order.pairs} — latency is NOT monotonic in size, and the discordant pairs are the reason`);
  }
  out.push(`  ACROSS REPLICATES: spend ${rangeStr(p.replicate_spend_usd, usd)}`);

  out.push("");
  out.push("per item, across replicates (range first — one draw is not a property of the item)");
  for (const it of p.per_item) {
    out.push(
      `  ${it.item_id}: ${it.diff_lines ?? "?"} line(s) [${it.size_bucket ?? "?"}] · k=${it.replicates}` +
        ` · cost ${rangeStr(it.cost_usd, usd)}${it.cost_usd.spread_over_min === null ? "" : ` spread ${pctOf(it.cost_usd.spread_over_min)} of min`}` +
        ` · wall ${rangeStr(it.wall_ms, mins)}`,
    );
    for (const ex of it.replicates_excluded) out.push(`     ! ${ex.run_id}: ${ex.status}${ex.reason ? ` (${ex.reason})` : ""}, ${usd(ex.cost_usd)} spent`);
  }

  out.push("");
  out.push("by size bucket (there is NO pooled cost-per-line figure — the per-item floor makes the average invert)");
  for (const b of p.by_size_bucket) {
    out.push(
      // Through `rangeStr` like every other series, because an item with no frozen
      // input has an UNKNOWN size and lands in this bucket with an empty line-count
      // series — which interpolated straight into the string printed `null–null`,
      // the one shape that reads as a measurement of nothing rather than as an
      // absence.
      `  ${b.size_bucket}: ${b.item_count} item(s) × ${b.observations} observation(s) · ${rangeStr(b.diff_lines, (v) => String(v))} line(s)` +
        ` · cost ${rangeStr(b.cost_usd, usd)} · wall ${rangeStr(b.wall_ms, mins)}`,
    );
  }

  out.push("");
  const dc = p.duration_source;
  out.push(`duration_source census over ${dc.n} envelope(s): ${DURATION_SOURCES.map((s) => `${s}=${dc.counts[s]}`).join(" · ")}${Object.entries(dc.unrecognised).map(([k, v]) => ` · UNRECOGNISED ${k}=${v}`).join("")}`);
  out.push(`  the zeros are printed on purpose: "absent" has never occurred on real data, and an absence read as a zero is a fast replay that never happened`);

  out.push("");
  const cr = result.coderabbit;
  out.push(`coderabbit [${cr.unit}] — ${cr.cost.basis}, metered=${cr.cost.metered}`);
  out.push(cr.cost.amortised_usd_per_pr === null ? `  amortised price: n/a — ${cr.cost.reason}` : `  amortised price: $${cr.cost.amortised_usd_per_pr.toFixed(2)}/PR from $${cr.cost.inputs.list_price_usd_per_month}/month ÷ ${cr.cost.inputs.prs_per_month} PR(s)/month`);
  out.push(`  ⚠ NOT comparable with the panel's figure above and no ratio between them is computed here: one is charged per review, the other is charged whether or not a review happens`);

  out.push("");
  out.push("declared gaps — asked for by §3.4, not computable, NOT approximated");
  for (const g of result.declared_gaps) out.push(`  ${g.metric} = null · ${g.reason} · unblocked by: ${g.unblocked_by}`);
  out.push(`  ! ${c.totals_caveat}`);
  return out;
}

// --- CLI: read a store, print the numbers. Writes nothing. -------------------

const USAGE =
  "usage: cost-latency.mjs --root <eval-data-root> --corpus-version <v> --runs <id,id,id>\n" +
  "                       [--coderabbit-usd-per-month <n> --coderabbit-prs-per-month <n>] [--json]\n" +
  "\n" +
  "Cost and wall-clock latency per item and per replicate, over stored run\n" +
  "envelopes. Reads only; writes nothing, spawns nothing and costs nothing.\n" +
  "\n" +
  "--runs takes EVERY replicate of one reviewer, comma-separated, and is required:\n" +
  "runs/ is never globbed (decision 6), and the range across K is the headline.\n" +
  "--json prints the whole result to stdout; the report goes to stderr.";

async function main() {
  const args = parseArgs(process.argv, { booleans: ["json", "help"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  // `--root` is REQUIRED and has no default anywhere in this directory: git history
  // is permanent, so one flag that fell back to a path inside this repository would
  // commit benchmark data into `wafflebase` for good.
  if (!args.root || !args["corpus-version"] || !args.runs) {
    console.error(USAGE);
    process.exit(2);
  }
  const runIds = String(args.runs).split(",").map((s) => s.trim()).filter(Boolean);
  if (runIds.length === 0) {
    console.error("--runs must name at least one run id");
    process.exit(2);
  }

  const { EvalStore } = await import("./store.mjs");
  const store = new EvalStore(args.root);
  const corpus = store.getCorpus(args["corpus-version"]);
  if (corpus === null) {
    console.error(`corpus version ${JSON.stringify(args["corpus-version"])} does not exist under this root`);
    process.exit(1);
  }
  const sizes = new Map();
  for (const it of corpus) {
    const input = store.getCorpusItemInput(it.id);
    // A read path: an item that is not frozen under this root degrades to an
    // unknown size, and every per-line and per-bucket figure on it says so rather
    // than placing it in the smallest bucket. It is RECORDED as unsized rather than
    // left out of the map, so the shortfall reaches `completeness` as a named
    // reason — and therefore the non-zero exit — instead of only reaching a line of
    // stderr somebody has to notice.
    sizes.set(it.id, input ? sizeOf(it.id, input.meta) : { item_id: it.id, diff_lines: null, size_bucket: null });
  }

  const runs = [];
  for (const runId of runIds) {
    const stored = store.getRun(runId);
    if (!stored) {
      console.error(`run ${JSON.stringify(runId)} does not exist under this root`);
      process.exit(1);
    }
    runs.push({
      run_id: runId,
      run: stored.runJson,
      items: store.listItems(runId).map((itemId) => ({ item_id: itemId, envelope: store.getItem(runId, itemId)?.envelope ?? {} })),
    });
  }

  const price = Number(args["coderabbit-usd-per-month"]);
  const prs = Number(args["coderabbit-prs-per-month"]);
  const result = costLatencyOf(runs, {
    sizes,
    corpusVersion: args["corpus-version"],
    corpusItemIds: corpus.map((it) => it.id),
    coderabbit: { listPriceUsdPerMonth: Number.isFinite(price) ? price : null, prsPerMonth: Number.isFinite(prs) ? prs : null },
  });
  for (const line of renderReport(result)) console.error(line);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  // A PARTIAL result exits non-zero, so a pipeline cannot quote it as a complete one
  // by ignoring a line of stderr.
  process.exitCode = result.completeness.verdict === "complete" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("cost & latency failed:", e.message);
    process.exit(1);
  });
}
