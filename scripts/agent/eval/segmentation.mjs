// WHERE EACH REVIEWER WINS: the metrics that already exist, cut by the §4 axes.
//
// This file computes NO new quantity. Every value in its output is one the volume
// and mix scorer already produces — nit ratio, localisation rate, scope
// discipline, findings per PR, findings per 100 diff lines — recomputed over a
// SUBSET of the same records. A new metric here would be a different PR; what is
// new is the slicing, and the two rules that keep a slice honest:
//
//   1. MIN-N SUPPRESSION. Slicing 7 items and 30 findings six ways produces cells
//      with n=1. A cell below the threshold is WITHHELD — it carries its `n` and
//      the `min_n` it failed and no value at all, so there is nothing for a reader
//      to quote. This is not formatting. A blank cell gets questioned and a number
//      does not, so a cell that prints a figure it should have suppressed is worse
//      than one that prints nothing.
//   2. A WILSON 95% INTERVAL ON EVERY PROPORTION. At the n a segmented pilot
//      produces, the textbook interval is not merely wide, it is wrong in a
//      specific direction: at k=0 and at k=n it collapses to a point and claims
//      certainty from the smallest possible sample. Wilson does not. Nothing else
//      in `scripts/agent/` computes one — grepped, zero hits — so it is here, with
//      its four edge cases pinned by tests rather than by trust.
//
// THE UNIT IS PART OF EVERY FIGURE, and on this data it is the difference between
// two true statements that point opposite ways: per PULL REQUEST the pilot has 7
// observations and almost every cell is correctly blank, while per FINDING our arm
// has 142 and CodeRabbit 30, so `minor` and `nit` clear a threshold of 5 on their
// own. Spec §4.1's two-currency table is the authority for which axes may cut
// which metric, and it is enforced here rather than described: a per-PR metric is
// only ever cut by a per-PR axis.
//
// WHAT IT DELIBERATELY DOES NOT DO. It defines no metric, adjudicates nothing and
// therefore reports no precision or recall — defect type is the axis everyone
// wants and it is assigned at adjudication, so it is declared `not-computed` with
// a reason rather than approximated from a lens id. It does not re-threshold the
// matcher, does not widen any record, and does not write: it reads a store,
// computes, prints. Nothing is spent.
//
// EVERY CELL IS SINGLE-ARM. There is no cell whose `n` pools the two reviewers,
// because CodeRabbit's 30 findings would bind every such denominator while ours
// are 4.7× more numerous — a comparison is made by reading two cells side by side,
// each carrying its own arm's `n` and its own suppression verdict. So a segment
// where one arm clears the threshold and the other does not is visible as exactly
// that, rather than as one number resting on the thinner side.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN } from "../severity.mjs";
import { FILE_CLASSES, classifyFile } from "../review-panel.mjs";
import { ORIGINS } from "../novelty.mjs";
import { scopeSize } from "../metrics.mjs";
import { parseArgs } from "../gh-checks.mjs";
import { POPULATIONS } from "./finding-record.mjs";
import { WINDOW } from "./adapters/coderabbit.mjs";
import {
  assertComparableWindow,
  assertOnePopulation,
  assertRunMatchesCorpus,
  gateSegmentOf,
  itemGeometry,
  localizationOf,
  median,
  proportion,
  scopeOf,
  severityIsStated,
  severityMix,
} from "./volume-mix.mjs";
import { repeated } from "./reliability.mjs";

const refuse = (msg) => {
  throw new Error(`segmentation: ${msg}`);
};

/** A caller-supplied list, or `[]` when it was not supplied at all. A non-array is
 *  REFUSED by name rather than coerced: an iterable that is not a list of records —
 *  a string is the reachable case — would be walked element by element and bucketed,
 *  which is a wrong grid rather than an error. */
const asArray = (value, what) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) refuse(`${what} must be an array, got ${JSON.stringify(value)} — a non-list would be iterated element by element and filed as findings`);
  return value;
};

/**
 * A composite-key separator no bucket can contain — CodeRabbit's own category names
 * carry spaces and ampersands, so `/` and `|` are not safe.
 *
 * Built with `String.fromCharCode` rather than written as a literal, which is not
 * fussiness: a raw control byte in a source file makes `file` call it *data* and
 * `grep` silently find nothing in it under a UTF-8 locale. `volume-mix.mjs` has two
 * such bytes and a session has already drawn a wrong conclusion from grepping it.
 */
const KEY_SEP = String.fromCharCode(31);

/** Bumped when a field changes meaning, never when one is added — the rule every
 *  module on this surface states, because every reader downstream is additive. */
export const SCHEMA_VERSION = 1;

/** What this score is filed as. The pair is the report's own vocabulary, and it
 *  rides IN the payload so a score file and the directory it lands in cannot
 *  disagree about which scorer wrote it. */
export const SCORER_ID = "segmentation-v1";
export const SCOPE = "cross-run";

/**
 * The suppression threshold, and it is a DEFAULT rather than a constant because
 * every consumer reads it back per cell.
 *
 * 5 is spec §4.1's number ("cells with n < 5 are suppressed and shown as `n<5`").
 * It is overridable — a larger corpus may want more — and the override is carried
 * on every cell for one reason: a report that captioned this grid with a threshold
 * the grid no longer uses would be a caption contradicting its own table. Lowering
 * it below the spec's 5 is possible and is announced in the output, because the one
 * thing a threshold must never do is move quietly.
 */
export const MIN_N = 5;

/**
 * The 97.5th percentile of the standard normal — the `z` that makes the interval a
 * 95% one. Written to full double precision rather than as 1.96 so the closed forms
 * the tests pin (`z²/(n+z²)` at k=0, `n/(n+z²)` at k=n) hold to the last bit and a
 * mutation to the formula cannot hide inside a rounded constant.
 */
export const Z_95 = 1.959963984540054;

/** Float-noise tolerance for the [0,1] check below. Not a fudge factor: measured
 *  over every n from 1 to 20000, the worst excursion is 7e-18 below 0 (at k=0) and
 *  2e-16 above 1 (at k=n), so anything past 1e-9 is an arithmetic defect and is
 *  refused rather than clamped into looking fine. */
const EPS = 1e-9;

/**
 * A Wilson score interval for `k` successes in `n` trials.
 *
 * THE EDGES ARE THE ENTIRE REASON TO USE IT, so they are what the tests assert:
 *
 *   k=0    the lower bound is exactly 0 and the UPPER bound is `z²/(n+z²)` > 0. The
 *          textbook interval is [0,0] — "we observed none, therefore there are
 *          none", from a sample of any size. On a segmented pilot that is the most
 *          common cell there is.
 *   k=n    the upper bound is 1 and the LOWER bound is `n/(n+z²)` < 1, where the
 *          textbook interval again claims a point.
 *   n=1    still an interval — [0, 0.793] or [0.207, 1] — rather than a claim.
 *   n=0    NO INTERVAL EXISTS, and this returns nulls with the reason. Not [0,0],
 *          not [0,1]: a proportion with no denominator is not a wide measurement,
 *          it is an absent one, and `0/0 → 0.000` is precisely the shape the house
 *          `proportion()` was written to make unspellable.
 *
 * Pure, integer-checked, and it REFUSES on impossible input (`k > n`, negatives,
 * non-integers). A caller that computed a numerator larger than its denominator has
 * a broken segment filter, and returning a plausible interval for it would publish
 * the breakage as a result.
 */
export function wilson(k, n, { z = Z_95 } = {}) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0) {
    refuse(`wilson needs non-negative integers, got k=${JSON.stringify(k)} n=${JSON.stringify(n)}`);
  }
  if (k > n) {
    refuse(`wilson got k=${k} > n=${n} — a numerator larger than its denominator means the segment filter is broken, and an interval over it would publish that as a measurement`);
  }
  if (!(Number.isFinite(z) && z > 0)) refuse(`wilson needs a positive z, got ${JSON.stringify(z)}`);
  if (n === 0) {
    return {
      low: null,
      high: null,
      z,
      method: "wilson-score",
      undefined_reason: "n=0: there is no denominator, so no interval exists — an absent measurement rather than a wide one",
    };
  }
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const low = centre - half;
  const high = centre + half;
  if (low < -EPS || high > 1 + EPS) {
    refuse(`wilson(${k}, ${n}) produced [${low}, ${high}], which is outside [0,1] by more than float noise — the formula is wrong, and clamping it would hide that`);
  }
  return { low: Math.min(1, Math.max(0, low)), high: Math.min(1, Math.max(0, high)), z, method: "wilson-score", undefined_reason: null };
}

/** A metric with no `k` has no Wilson interval, and that is a property of the
 *  statistic rather than a gap in the computation — so it is stated on the cell
 *  instead of the field being absent. */
export function noInterval(reason) {
  if (typeof reason !== "string" || reason.trim() === "") refuse("noInterval needs a reason — an absent interval that does not say why cannot be told from one nobody computed");
  return { low: null, high: null, z: null, method: null, undefined_reason: reason };
}

// --- the axes ---------------------------------------------------------------
// Spec §4's table, with the buckets each axis actually has in the code that owns
// it rather than the ones the spec listed. Two of §4's rows named vocabularies
// that do not exist; both are corrected here and the correction is the comment.

/**
 * A finding whose severity the reviewer never STATED gets its own bucket, and does
 * not go in the bucket its floor value names.
 *
 * `normalizeSeverity` maps an unrecognised severity to `major`, which is blocking,
 * so filing an unstated finding under `major` would grow the blocking stratum with
 * findings nobody called blocking. `SEVERITY_BASIS`'s standing instruction is that
 * no severity-segmented number may pool an unstated record with a stated one, and
 * this bucket is that instruction taking a shape. Measured on the pilot: 0 of 30
 * CodeRabbit records and 0 of 142 panel records land here, so it is a guard today
 * rather than a correction — and the guard is what keeps that true.
 */
const SEVERITY_UNSTATED = "severity-unstated";

/** A finding citing no file at all. `classifyFile("")` answers `code` — a
 *  deliberate fail-safe for the panel, where an unclassifiable path must still be
 *  reviewed by the code lenses — and reading that answer here would file a finding
 *  with NO citation among the ones citing source code. 1 of 142 panel records in
 *  replicate 1 has no file, so this is measured rather than defensive. */
const NO_FILE = "no-file";

/** An item whose frozen `additions`/`deletions` would not read has an UNKNOWN size,
 *  which is not a size bucket. */
const SIZE_UNKNOWN = "size-unknown";

/** A `meta.provenance` this file has not heard of. `classifyProvenance` owns that
 *  vocabulary and exports no list, so a new value would otherwise vanish from every
 *  authorship cell silently; it lands here and is named in the census instead. */
const PROVENANCE_UNRECOGNISED = "provenance-unrecognised";

/** CodeRabbit filed the finding under no category. Their field, so its absence is
 *  a fact about their output and not a fault of ours. */
const CATEGORY_UNSTATED = "category-unstated";

/** A CodeRabbit record carrying no `window` at all — distinct from `no-window`,
 *  which is the adapter's own answer for "there was no snapshot to place it in". */
const WINDOW_UNSTATED = "window-unstated";

/**
 * A panel finding that was never given a novelty origin — as opposed to one that
 * was given `unknown`.
 *
 * `annotateFindings` stamps novelty ONLY on critical/major findings ("non-blocking
 * findings are returned untouched, without a lane"), so on the pilot 36 of 142
 * records carry an origin and 106 carry no `novelty` object at all. Pooling those
 * 106 into `unknown` would report "git could not place this code" about findings git
 * was never asked about, and would make the novelty axis look like it covers the
 * whole arm when it covers the blocking stratum. Lesson 6, at the one axis where the
 * absence is the design.
 */
const NOT_ANNOTATED = "not-annotated";

/**
 * Diff size, and WHICH of the two scales this is.
 *
 * There are two in play and they collide by name: `scopeSize` (`metrics.mjs`) is
 * three buckets (S ≤50 · M ≤300 · L >300) and is what the corpus manifest froze
 * into `meta.scope`, while spec §4 describes a five-bucket XS/S/M/L/XL scale as
 * "the report's own". THE FIVE-BUCKET SCALE IS IMPLEMENTED NOWHERE in `scripts/` —
 * grepped, zero hits — so offering it here would be inventing a bucketing rather
 * than segmenting by one, and §4 requires the choice to be stated in the payload
 * rather than in prose. So the scale's name is part of the axis id, and therefore
 * part of every segment label it produces.
 *
 * `S`/`M`/`L` are re-typed from `scopeSize`'s own branches, which export no
 * vocabulary to `pin` against. A test runs `scopeSize` at both boundaries and
 * asserts the three answers equal these three strings — the remedy
 * `ARM_RESTATEMENT_TIER` documents for the same situation in `volume-mix.mjs`.
 */
const SCOPE_SIZE_BUCKETS = Object.freeze(["S", "M", "L"]);
const SCOPE_SIZE_AXIS = "diff_size:scopeSize";
const SCOPE_SIZE_SCALE = "scopeSize (S ≤50 · M ≤300 · L >300 changed lines) — metrics.mjs, and the value the corpus manifest froze into meta.scope";

/** `classifyProvenance`'s three answers, re-typed for the same reason and pinned by
 *  a test the same way. §4 calls this axis "agent-authored vs human-authored" — the
 *  extractor produces THREE values, not two, and collapsing `local-cli-agent` into
 *  either side would be a judgement this scorer has no basis for. */
const PROVENANCE_BUCKETS = Object.freeze(["human", "local-cli-agent", "autonomous"]);

/**
 * Every bucket name that must stay disjoint from the vocabulary it sits beside, and
 * the vocabulary in question. A collision would pool the two facts the bucket exists
 * to separate, silently.
 *
 * BOTH KINDS OF VOCABULARY ARE IN HERE and they fail differently. The first four are
 * imported from the modules that own them, so a rename upstream could introduce a
 * collision under a file nobody edited. The last two are re-typed here — `scopeSize`
 * and `classifyProvenance` export no list to `pin` against — so a collision would be a
 * same-file typo instead. Neither is more survivable once it happens, which is why the
 * check does not discriminate between them.
 *
 * Exported, with the check exported beside it, for the reason `pin` is: a guard nothing
 * can prove fires is decoration, and this one runs over frozen constants at import time
 * so a test cannot otherwise reach it.
 */
export const DISJOINT_BUCKETS = Object.freeze([
  Object.freeze([SEVERITY_UNSTATED, KNOWN, "the unstated-severity bucket"]),
  Object.freeze([NO_FILE, FILE_CLASSES, "the no-file bucket"]),
  Object.freeze([NOT_ANNOTATED, ORIGINS, "the not-annotated novelty bucket"]),
  Object.freeze([WINDOW_UNSTATED, WINDOW, "the unstated-window bucket"]),
  Object.freeze([SIZE_UNKNOWN, SCOPE_SIZE_BUCKETS, "the unknown-size bucket"]),
  Object.freeze([PROVENANCE_UNRECOGNISED, PROVENANCE_BUCKETS, "the unrecognised-provenance bucket"]),
]);

/** Refuses if any bucket name has become a member of the vocabulary beside it. */
export function assertBucketsDisjoint(rows) {
  for (const [name, vocabulary, what] of Array.isArray(rows) ? rows : []) {
    if ((Array.isArray(vocabulary) ? vocabulary : []).includes(name)) {
      refuse(`${what} is ${JSON.stringify(name)}, which is now also a value of the vocabulary it sits beside — the two facts it exists to keep apart would be pooled under one bucket`);
    }
  }
  return rows.length;
}

// At import time, which is where `pin` puts the same class of check: a guard that fires
// when the code loads beats one that never fires at all.
assertBucketsDisjoint(DISJOINT_BUCKETS);

/**
 * Every axis, what it cuts, and which arms can answer it.
 *
 * `unit` is the axis's own denominator: a `finding` axis reads a value off each
 * record, an `item` axis off the pull request the record belongs to. It decides
 * which metrics an axis may cut (§4.1), and it is carried into the payload so a
 * reader never has to infer it.
 *
 * `fault_buckets` get a cell only when something lands in them. A declared
 * vocabulary bucket ALWAYS gets one, including at n=0, because "CodeRabbit raised 0
 * criticals across 30 findings" is a fact about CodeRabbit; a fault bucket nothing
 * reached is not a fact about either reviewer, and the census proves it empty.
 */
export const AXES = Object.freeze([
  {
    id: "severity",
    unit: "finding",
    arms: Object.freeze(["panel", "coderabbit"]),
    buckets: Object.freeze([...KNOWN]),
    fault_buckets: Object.freeze([SEVERITY_UNSTATED]),
    source: "the finding record's own `severity`, after the arm boundary translated CodeRabbit's `trivial` to `nit`",
    note: "CodeRabbit's largest tier is `trivial`, which is not on our scale; `adapters/coderabbit.mjs` translates it and this axis reads the translated value. Re-translating here would apply the translation twice",
  },
  {
    id: "file_class",
    unit: "finding",
    arms: Object.freeze(["panel", "coderabbit"]),
    buckets: Object.freeze([...FILE_CLASSES]),
    fault_buckets: Object.freeze([NO_FILE]),
    source: "`classifyFile` (`review-panel.mjs`) over the record's cited path",
    note: "FIVE classes, which is what `FILE_CLASSES` holds. §4's six (frontend/backend/docs/config/tests/harness) never existed in the code it cited",
  },
  {
    id: SCOPE_SIZE_AXIS,
    unit: "item",
    arms: Object.freeze(["panel", "coderabbit"]),
    buckets: SCOPE_SIZE_BUCKETS,
    fault_buckets: Object.freeze([SIZE_UNKNOWN]),
    source: "`scopeSize(meta.additions, meta.deletions)`, cross-checked against the `meta.scope` the manifest froze beside them",
    scale: SCOPE_SIZE_SCALE,
    note: "the OTHER scale §4 names — five buckets, XS…XL — is implemented nowhere in scripts/, so it is not offered here rather than being invented",
  },
  {
    id: "provenance",
    unit: "item",
    arms: Object.freeze(["panel", "coderabbit"]),
    buckets: PROVENANCE_BUCKETS,
    fault_buckets: Object.freeze([PROVENANCE_UNRECOGNISED]),
    source: "`meta.provenance`, written by `classifyProvenance` at extraction",
    note: "measured: only 3 autonomous pull requests exist in the 106-PR candidate pool, so a difference along this axis cannot be ATTRIBUTED to authorship even where n clears the threshold. The cells are reported; the attribution is not available",
  },
  {
    id: "novelty",
    unit: "finding",
    arms: Object.freeze(["panel"]),
    buckets: Object.freeze([...ORIGINS]),
    always_buckets: Object.freeze([NOT_ANNOTATED]),
    fault_buckets: Object.freeze([]),
    source: "the origin the replay's own novelty gate FROZE onto the record (`panel.novelty.origin`)",
    note: "read off the record, never recomputed: `noveltyOf` is async and reads git, so a scorer calling it would answer a question about today's tree instead of the reviewed one. CodeRabbit records have no counterpart, so this axis is one-armed",
  },
  {
    id: "coderabbit_category",
    unit: "finding",
    arms: Object.freeze(["coderabbit"]),
    buckets: null,
    buckets_from: "data",
    fault_buckets: Object.freeze([CATEGORY_UNSTATED]),
    source: "`coderabbit.category` — CodeRabbit's own CHILL vocabulary, verbatim",
    note: "THEIR taxonomy, not ours, and it is discovered from the data rather than declared because we do not own it. Never a defect-type axis: it is a pre-run proxy for one, and conflating the two would report their routing as our ground truth",
  },
  {
    id: "window",
    unit: "finding",
    arms: Object.freeze(["coderabbit"]),
    buckets: Object.freeze([...WINDOW]),
    fault_buckets: Object.freeze([WINDOW_UNSTATED]),
    source: "`coderabbit.window` — which snapshot of the pull request the finding is about",
    note: "not an insight axis but a comparability one, and it is here because `assertComparableWindow` names this scorer as the remedy: a finding about code our arm never reviewed may be SEGMENTED but never pooled. Our arm has no window field, so it is one-armed by construction rather than by choice",
  },
  {
    id: "defect_type",
    unit: "finding",
    arms: Object.freeze([]),
    status: "not-computed",
    reason: "defect type is assigned at adjudication and no adjudicated labels exist, so there is nothing to cut by. Pre-filling it from a lens id would report our own routing as a property of the defect",
  },
]);

/** Axes that can produce cells today. `defect_type` is declared and cannot. */
const COMPUTABLE_AXES = AXES.filter((a) => a.status !== "not-computed");
export const AXIS_IDS = Object.freeze(COMPUTABLE_AXES.map((a) => a.id));

/** The axis row for an id, refusing an unknown one so a `--axis` typo cannot
 *  quietly produce a grid with an axis missing instead of an error. */
export function axisFor(id) {
  const a = AXES.find((x) => x.id === id);
  if (!a) refuse(`unknown axis ${JSON.stringify(id)} — known: ${AXES.map((x) => x.id).join(", ")}`);
  return a;
}

// --- the metrics ------------------------------------------------------------
// Each one already exists in `volume-mix.mjs`; what is here is the currency it is
// counted in and the function that recomputes it over a subset.

/**
 * The metrics, their currency, and what each is derived from.
 *
 * `currency` is §4.1's constraint made executable. A `finding`-denominated metric
 * may be cut by any axis, because every finding is one observation and a subset of
 * findings is a smaller sample of the same quantity. An `item`-denominated one may
 * only be cut by an `item` axis: "the median number of MINOR findings per PR" is
 * not "findings per PR" segmented — the denominator stays every item whatever the
 * severity bucket says — it is a different metric, and defining one is out of scope
 * for this PR.
 *
 * A pair the axis DETERMINES is skipped — see `TAUTOLOGICAL_PAIRS`.
 */
export const METRICS = Object.freeze([
  {
    id: "nit_ratio",
    kind: "proportion",
    currency: "finding",
    denominator_noun: "findings with a stated severity",
    spec: "§3.1 — share of findings that are `nit` or `minor`",
  },
  {
    id: "localization_rate",
    kind: "proportion",
    currency: "finding",
    denominator_noun: "findings",
    spec: "§3.1 — share of findings citing a file and line that resolves against the frozen diff",
  },
  {
    id: "in_diff_rate",
    kind: "proportion",
    currency: "finding",
    denominator_noun: "findings",
    spec: "§3.1 — scope discipline: share of findings anchored inside a changed region",
  },
  {
    id: "findings_per_pr",
    kind: "median-over-items",
    currency: "item",
    denominator_noun: "PRs",
    spec: "§3.1 — findings per pull request",
  },
  {
    id: "findings_per_100_lines",
    kind: "median-over-items",
    currency: "item",
    denominator_noun: "PRs with a known diff size",
    spec: "§3.1 — findings per 100 diff lines, which is severely size-confounded and must be read per size bucket rather than pooled",
  },
]);

export const METRIC_IDS = Object.freeze(METRICS.map((m) => m.id));

/**
 * Pairs where the axis DETERMINES the metric, so the cell would restate its own
 * bucket. Both were found by running the grid and reading it, not by reasoning
 * about it — the second one especially, which looked like an insight until its
 * three values turned out to be 0.000, 0.000 and 1.000.
 *
 * A tautology is worse here than a thin cell, because it clears min-n comfortably
 * and therefore gets published: `nit_ratio/novelty=not-annotated` reported
 * **1.000 (112/112)** on the pilot with a tight Wilson interval, which reads as a
 * strong finding about pre-existing code and is arithmetic.
 */
export const TAUTOLOGICAL_PAIRS = Object.freeze([
  {
    metric: "nit_ratio",
    axis: "severity",
    reason: "the nit ratio is a function of severity, so `severity=nit` reports 1.000 and `severity=major` reports 0.000 by construction",
  },
  {
    metric: "nit_ratio",
    axis: "novelty",
    reason:
      "the novelty annotation is stamped ONLY on critical/major findings (`annotateFindings` returns non-blockers untouched), so every annotated bucket has a nit ratio of 0 and `not-annotated` has 1 — measured 0.000 · 0.000 · 1.000 on the pilot. The novelty axis is severity-confounded by construction, which is a fact about the annotation and not about the code's age",
  },
]);

/** Whether this metric may be cut by this axis, and why not when it may not. */
export function pairing(metric, axis) {
  if (metric.currency === "item" && axis.unit !== "item") {
    return {
      allowed: false,
      reason: `${metric.id} is counted in ${metric.denominator_noun} and ${axis.id} cuts findings, so every bucket would share one denominator — that is a numerator filter, not a segment (§4.1)`,
    };
  }
  const tautology = TAUTOLOGICAL_PAIRS.find((p) => p.metric === metric.id && p.axis === axis.id);
  if (tautology) return { allowed: false, reason: tautology.reason };
  return { allowed: true, reason: null };
}

// --- placing one record, or one item, in a bucket ----------------------------

/** Severity, with unstated kept apart from the floor value it would otherwise
 *  inherit. Pure. */
export function severityBucketOf(record) {
  return severityIsStated(record) ? String(record?.severity ?? "") : SEVERITY_UNSTATED;
}

/** File class off the cited path, with "no path at all" kept out of `code`. Pure. */
export function fileClassOf(record) {
  const file = typeof record?.file === "string" ? record.file.trim() : "";
  return file === "" ? NO_FILE : classifyFile(file);
}

/**
 * The frozen novelty origin, or the statement that none was ever asked for.
 *
 * An origin OUTSIDE `ORIGINS` is refused rather than bucketed: it would mean
 * `novelty.mjs`'s vocabulary moved under records that are already written, and the
 * safe-looking read — filing it as `unknown` — is exactly the pooling
 * `NOT_ANNOTATED` exists to prevent.
 */
export function noveltyBucketOf(record) {
  const novelty = record?.panel?.novelty;
  if (!(novelty && typeof novelty === "object")) return NOT_ANNOTATED;
  const origin = novelty.origin;
  if (typeof origin !== "string" || origin.trim() === "") return NOT_ANNOTATED;
  if (!ORIGINS.includes(origin)) {
    refuse(`novelty origin ${JSON.stringify(origin)} on ${record?.item_id}/${record?.finding_key} is not one of ${ORIGINS.join(" | ")} — filing it as \`unknown\` would pool a vocabulary change with a git answer`);
  }
  return origin;
}

/** CodeRabbit's own category, verbatim, or the fact that it wrote none. */
export function categoryBucketOf(record) {
  const category = record?.coderabbit?.category;
  return typeof category === "string" && category.trim() !== "" ? category.trim() : CATEGORY_UNSTATED;
}

/** Which snapshot the finding is about. Refuses a value outside `WINDOW`, for the
 *  reason `noveltyBucketOf` refuses an unknown origin. */
export function windowBucketOf(record) {
  const w = record?.coderabbit?.window;
  if (typeof w !== "string" || w.trim() === "") return WINDOW_UNSTATED;
  if (!WINDOW.includes(w)) refuse(`window ${JSON.stringify(w)} on ${record?.item_id} is not one of ${WINDOW.join(" | ")} — a window value this file cannot place must not be filed under one it can`);
  return w;
}

/**
 * The item's size bucket, from the two fields the manifest froze — and CHECKED
 * against the bucket the manifest froze beside them.
 *
 * One fact derived two ways, so a disagreement is a real defect: `meta.scope` was
 * computed by `extract-corpus.mjs` at freeze time from these same two numbers, and
 * if recomputing it here gives a different answer then either the manifest is stale
 * or `scopeSize`'s boundaries moved. Both would silently re-file every finding on
 * the item, which is the shape of error this whole file exists not to publish, so it
 * REFUSES rather than preferring one of the two.
 */
export function diffSizeOf(item) {
  const additions = Number.isFinite(item?.additions) ? item.additions : null;
  const deletions = Number.isFinite(item?.deletions) ? item.deletions : null;
  if (additions === null || deletions === null) return SIZE_UNKNOWN;
  const computed = scopeSize(additions, deletions);
  const frozen = typeof item?.scope === "string" && item.scope.trim() !== "" ? item.scope.trim() : null;
  if (frozen !== null && frozen !== computed) {
    refuse(
      `${item?.item_id ?? "(unnamed item)"}: the manifest froze scope ${JSON.stringify(frozen)} and scopeSize(${additions}, ${deletions}) says ${JSON.stringify(computed)} — ` +
        `one fact derived two ways, and every finding on this item would be filed in whichever bucket the reader happened to trust`,
    );
  }
  return computed;
}

/** Who wrote the pull request, per the manifest. */
export function provenanceOf(item) {
  const p = typeof item?.provenance === "string" ? item.provenance.trim() : "";
  return PROVENANCE_BUCKETS.includes(p) ? p : PROVENANCE_UNRECOGNISED;
}

/**
 * The bucket for one axis. One place, so the axis table and the placement cannot
 * drift apart.
 *
 * An `item` axis ignores `record` and a `finding` axis ignores `item`, which is what
 * lets the same function serve both passes: the per-finding pass places each record,
 * and the per-item pass places each item id so that an item with NO finding in a
 * bucket still counts toward that bucket's per-PR denominator.
 */
export function bucketOf(axisId, { record = null, item = null } = {}) {
  switch (axisId) {
    case "severity":
      return severityBucketOf(record);
    case "file_class":
      return fileClassOf(record);
    case "novelty":
      return noveltyBucketOf(record);
    case "coderabbit_category":
      return categoryBucketOf(record);
    case "window":
      return windowBucketOf(record);
    case "provenance":
      return provenanceOf(item);
    case SCOPE_SIZE_AXIS:
      return diffSizeOf(item);
    default:
      return refuse(`no bucket function for axis ${JSON.stringify(axisId)}`);
  }
}

// --- the segment label ------------------------------------------------------

/**
 * The flat label a cell is known by. THE GRAMMAR IS PART OF THE OUTPUT:
 *
 *   metric=<metric id>/<axis id>=<bucket>/arm=<arm>
 *
 * It is flat because the consumer's cell has one `segment` string. WHAT FLATTENING
 * LOSES, stated because a reader of a rendered table cannot see it: the grid is
 * three-dimensional (metric × axis-bucket × arm) and a flat list gives no ordering,
 * no grouping and no way to ask "show me both arms on this bucket" without parsing
 * the string back apart. So the payload carries the three components separately
 * BESIDE the label — a consumer reading only `segment` is unaffected — and the
 * cross-arm pairing is computed here rather than left to whoever reads the table.
 *
 * Buckets are used verbatim, including CodeRabbit's spaces and ampersands, because a
 * label identifies a segment and tidying a foreign vocabulary is how two of its
 * categories come to share one row.
 */
export function segmentLabel({ metric, axis, bucket, arm }) {
  for (const [what, value] of [
    ["metric", metric],
    ["axis", axis],
    ["bucket", bucket],
    ["arm", arm],
  ]) {
    if (typeof value !== "string" || value.trim() === "") {
      refuse(`a segment label needs its ${what}, got ${JSON.stringify(value)} — an unlabelled cell cannot be told apart from any other cell`);
    }
  }
  return `metric=${metric}/${axis}=${bucket}/arm=${arm}`;
}

// --- one cell ---------------------------------------------------------------

/**
 * Which replicate a cell's value comes from, when K of them exist.
 *
 * A CELL HOLDS ONE VALUE AND K REPLICATES ARE K DRAWS, so this choice is the one
 * place this file can go wrong invisibly. It takes the MEDIAN leg by value — the
 * lower of the two middle legs at even K, which is the conservative half — and the
 * unit says so, so no reader has to guess which draw they are reading.
 *
 * 🔴 IT IS NOT A MAX, and that rule has an incident behind it: a sibling scorer's
 * first draft divided by `Math.max(...)` over these same three replicates and
 * published 4.9× where the project's figure is 4.7×, because the max is one
 * particular draw. It was flattering, invisible in the output, and produced by a
 * one-word choice. So any statistic over K here names its aggregation at the
 * function and carries every leg's value beside the chosen one.
 *
 * `run_id` breaks a tie, so the answer does not depend on input order.
 */
/** Why a cell is thin, from the per-leg denominators alone. Exported so the
 *  distinction between "no replicate saw one" and "one replicate saw none" can be
 *  tested directly rather than through a whole grid. */
export function suppressionBasis(ns, thinnest) {
  const list = Array.isArray(ns) ? ns : [];
  if (list.length === 0) return "no replicate contributed this segment";
  if (Math.max(...list) === 0) return "no observation fell in this bucket, in any replicate";
  if (thinnest === 0) return `at least one replicate found none here (per replicate: ${list.join(", ")}) — a zero measured once is not a structural zero`;
  return "denominator below min_n";
}

export function medianLeg(legs) {
  const list = (Array.isArray(legs) ? legs : []).filter((l) => l && Number.isFinite(l.value));
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a.value - b.value || String(a.run_id ?? "").localeCompare(String(b.run_id ?? "")));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * One cell, from one per-leg figure per replicate.
 *
 * SUPPRESSION IS DECIDED BEFORE THE VALUE IS EVEN CHOSEN, and a suppressed cell
 * carries no value, no numerator and no interval — not a value a renderer happens
 * to ignore. A payload is a file anybody can read, so "withheld" has to mean the
 * number is not in it; a suppressed cell that still carried its figure would be one
 * `jq` away from being quoted.
 *
 * WHICH `n` EACH STATE PRINTS, because they are two different numbers and each is
 * the right one for its own sentence:
 *
 *   suppressed   the THINNEST leg's n — the denominator that actually failed the
 *                threshold, so `n=2 < 5` is a true statement rather than an average
 *                of one that failed and two that did not.
 *   reported     the MEDIAN leg's n, together with that same leg's `k` and value.
 *
 * The suppression TEST is still the thinnest leg, deliberately: the value is an
 * aggregate over K draws and an aggregate is only as supported as its weakest input,
 * so a segment one replicate barely saw is withheld even when the median leg is fat.
 *
 * 🔴 `value`, `k` AND `n` ALL COME FROM ONE LEG, and an invariant below refuses if
 * they do not. The first draft of this function took `n` from the thinnest leg and
 * `k` from the median one, and published `0.833 (25/17)` — a ratio whose numerator
 * exceeds its denominator, on real pilot data, because the two came from different
 * replicates. Nothing was blank and nothing threw; the number was simply not a
 * number. That is why the check is a refusal and not a comment.
 */
export function cellFrom({ metric, axis, bucket, arm, unit, minN, legs = [], intervalFor = null }) {
  const segment = segmentLabel({ metric, axis, bucket, arm });
  if (!Number.isInteger(minN) || minN < 1) refuse(`min_n must be a positive integer, got ${JSON.stringify(minN)}`);
  // The consumer's `figure()` refuses a unitless cell; refusing here too names the
  // metric that forgot rather than failing inside somebody else's renderer.
  if (typeof unit !== "string" || unit.trim() === "") refuse(`${segment}: a cell needs its unit — decision 28, and the report's own figure constructor refuses without one`);
  const ns = legs.map((l) => (Number.isFinite(l?.n) ? l.n : 0));
  const thinnest = ns.length === 0 ? 0 : Math.min(...ns);
  const base = {
    segment,
    metric,
    axis,
    bucket,
    arm,
    min_n: minN,
    unit,
    n_by_replicate: legs.map((l) => ({ run_id: l?.run_id ?? null, n: Number.isFinite(l?.n) ? l.n : 0 })),
  };
  if (thinnest < minN) {
    return {
      ...base,
      suppressed: true,
      n: thinnest,
      n_basis: "thinnest replicate — the denominator that failed the threshold",
      // WHY it is thin, which a bare `n < min_n` does not say. FOUR causes, and the
      // third is the one real data exposed: `severity=critical` withholds at n=0
      // while replicate 2 raised three criticals and replicate 3 raised one, so
      // "nothing fell here" would have been a false statement about the reviewer.
      // A zero measured once is not a structural zero — this project has already
      // published that mistake about this exact bucket.
      suppression_basis: suppressionBasis(ns, thinnest),
    };
  }
  const chosen = medianLeg(legs);
  if (chosen === null) {
    // Every leg cleared the threshold and none produced a finite value. The only way
    // that happens is a metric returning null over a non-empty denominator, which is
    // a defect in the metric rather than a thin cell — so it is not filed as one.
    refuse(`${segment}: n=${thinnest} clears min_n=${minN} and no replicate produced a finite value — a metric that cannot answer over a full denominator is a defect, not a suppression`);
  }
  const k = Number.isInteger(chosen.k) ? chosen.k : null;
  const n = chosen.n;
  // The invariant that makes "one leg" true rather than intended.
  if (k !== null) {
    if (k > n) refuse(`${segment}: k=${k} exceeds n=${n} — the numerator and the denominator are not from the same replicate`);
    if (Math.abs(chosen.value - k / n) > 1e-12) {
      refuse(`${segment}: value ${chosen.value} is not k/n (${k}/${n}) — value, numerator and denominator must all come from ONE replicate, and a mismatch means they do not`);
    }
  }
  return {
    ...base,
    suppressed: false,
    n,
    n_basis: legs.length > 1 ? "median replicate — the same leg the value and k come from" : "the single observation",
    thinnest_replicate_n: thinnest,
    value: chosen.value,
    k,
    // Which draw the value is, named rather than implied.
    value_from_replicate: chosen.run_id ?? null,
    values_by_replicate: legs.map((l) => ({ run_id: l?.run_id ?? null, value: Number.isFinite(l?.value) ? l.value : null })),
    interval: typeof intervalFor === "function" ? intervalFor(k, chosen.n) : noInterval("no interval was asked for"),
  };
}

// --- guards -----------------------------------------------------------------

/**
 * One gate state, or nothing here is comparable.
 *
 * A gate-off replay reads `gating: "gates"` for every blocking finding — true of
 * that replay and misleading about the shipped gate — so `volume-mix.mjs` makes
 * `gate_state` a row key, and the standing rule for every scorer on this surface is
 * that a gate-off run is never pooled with a gate-on one. This file segments by §4's
 * axes and `gate_state` is not one of them, so the rule is kept the other way round:
 * mixed gate states are REFUSED, and the remedy is to select runs that share one.
 *
 * `null` when there is no panel arm at all. That is not a missing gate state: the
 * other arm has no merge gate, and reporting `gate-state-unrecorded` for it would be
 * uncertainty invented out of a structural fact.
 */
export function assertOneGateState(records) {
  const seen = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (r?.arm !== "panel") continue;
    const seg = gateSegmentOf(r);
    if (!seen.has(seg)) seen.set(seg, new Set());
    seen.get(seg).add(r.run_id ?? "(no run id)");
  }
  if (seen.size > 1) {
    refuse(
      `the panel records span ${seen.size} gate states (${[...seen.entries()].map(([s, runs]) => `${s}: ${[...runs].sort().join(", ")}`).join(" · ")}) — ` +
        `a gate-off replay routes every blocking finding to the gate because the novelty gate never ran, so a cell pooling the two describes the harness rather than the reviewer. Select runs that share a gate state`,
    );
  }
  return seen.size === 1 ? [...seen.keys()][0] : null;
}

/**
 * A finding about code our arm never reviewed may be segmented, never pooled.
 *
 * `assertComparableWindow` refuses `after-window` outright and names THIS scorer as
 * the remedy — "segment on window, which is the segmentation engine's job". So the
 * refusal is conditional here: with the `window` axis selected, an `after-window`
 * record lands in its own cell and no denominator mixes two snapshots; without it,
 * the sibling's refusal is delegated to verbatim rather than restated, and any other
 * multi-valued window is refused for the same reason.
 */
export function assertWindowSegmented(records, axisIds) {
  if ((Array.isArray(axisIds) ? axisIds : []).includes("window")) return;
  assertComparableWindow(records);
  const seen = [...new Set((Array.isArray(records) ? records : []).map((r) => r?.coderabbit?.window).filter((w) => typeof w === "string"))].sort();
  if (seen.length > 1) {
    refuse(`the CodeRabbit records span ${seen.length} window values (${seen.join(", ")}) and the window axis is not selected, so every cell would pool findings about different snapshots — add \`--axis window\``);
  }
}

/** Legs are distinct observations. The same run twice would make a "median of 3
 *  replicates" a median of one, with nothing in the output saying so. */
export function assertDistinctLegs(arm, legs) {
  const list = Array.isArray(legs) ? legs : [];
  if (list.length === 0) refuse(`arm ${arm} was read with no replicate at all — an arm with no observation is not an arm that found nothing`);
  const ids = list.map((l) => l?.run_id ?? "(none)");
  if (new Set(ids).size !== ids.length) refuse(`arm ${arm} has the same run id twice (${ids.join(", ")}) — an aggregate over one run repeated is not an aggregate over K`);
  return list;
}

// --- the grid ---------------------------------------------------------------

/** The per-leg figure for one metric over one subset of one leg. Returns
 *  `{value, k, n}`, with `n` in the metric's own currency. */
function figureFor(metric, { records, itemIds, geometry, items }) {
  switch (metric.id) {
    case "nit_ratio": {
      // Reuses `severityMix`, so this number and the arm-level one in
      // `volume-mix.mjs` are one derivation: it excludes unstated records from the
      // denominator rather than counting them at their floor severity.
      const mix = severityMix(records);
      return { value: mix.stated.nit_ratio.ratio, k: mix.stated.nit_ratio.k, n: mix.stated.nit_ratio.n };
    }
    case "localization_rate": {
      const p = proportion(records.filter((r) => localizationOf(r, geometry.get(r.item_id) ?? null).localization === "resolved").length, records.length);
      return { value: p.ratio, k: p.k, n: p.n };
    }
    case "in_diff_rate": {
      const p = proportion(records.filter((r) => scopeOf(r, geometry.get(r.item_id) ?? null).scope === "in-diff").length, records.length);
      return { value: p.ratio, k: p.k, n: p.n };
    }
    case "findings_per_pr": {
      // EVERY item in the population contributes, including the ones with no finding
      // in this bucket. An item the arm reviewed and found nothing in is a MEASURED
      // ZERO; dropping it would report the median over "the items that happened to
      // have one", which rises as the reviewer gets quieter.
      const counts = itemIds.map((id) => records.filter((r) => r.item_id === id).length);
      return { value: median(counts), k: null, n: counts.length };
    }
    case "findings_per_100_lines": {
      // The denominator is items with a KNOWN size. An item whose frozen size would
      // not read has no density, and `findings / 0` is either Infinity or a silent
      // skip — so it leaves the denominator and the `n` says so.
      const per = [];
      for (const id of itemIds) {
        const lines = linesOf(id, geometry, items);
        if (!Number.isFinite(lines) || lines === 0) continue;
        per.push((records.filter((r) => r.item_id === id).length / lines) * 100);
      }
      return { value: median(per), k: null, n: per.length };
    }
    default:
      return refuse(`no figure function for metric ${JSON.stringify(metric.id)}`);
  }
}

/** An item's frozen diff size, from the geometry if it was parsed and from the
 *  manifest's own two fields otherwise. `null` when neither answers — never 0,
 *  which would make an unmeasurable density look infinite. */
function linesOf(itemId, geometry, items) {
  const fromGeometry = geometry.get(itemId)?.diff_lines;
  if (Number.isFinite(fromGeometry)) return fromGeometry;
  const item = items.get(itemId);
  return Number.isFinite(item?.additions) && Number.isFinite(item?.deletions) ? item.additions + item.deletions : null;
}

/** How a cell's `unit` names both what `n` counts and how K replicates were
 *  aggregated. A consumer prints `value (n=<n> <unit>)`, so this is the whole of
 *  what a reader is told about the denominator. */
export function unitFor(metric, legCount) {
  const aggregation = legCount > 1 ? `median of ${legCount} replicates` : "single observation";
  const shape = metric.kind === "median-over-items" ? `${metric.denominator_noun}, value is the median over PRs` : metric.denominator_noun;
  return `${shape}; ${aggregation}`;
}

/** The bucket list for one axis and one arm: the declared vocabulary always, plus
 *  the fault and discovered buckets something actually landed in. */
function bucketsFor(axis, observed) {
  const fromData = axis.buckets_from === "data";
  const declared = fromData ? [] : [...axis.buckets, ...(axis.always_buckets ?? [])];
  const faults = (axis.fault_buckets ?? []).filter((b) => observed.has(b));
  const outside = [...observed.keys()].filter((b) => !declared.includes(b) && !faults.includes(b)).sort();
  return { declared, faults, outside: fromData ? [] : outside, discovered: fromData ? outside : [], list: [...declared, ...faults, ...outside] };
}

/**
 * The whole grid: every metric, every axis it may cut, every bucket, per arm.
 *
 * `arms` is one entry per reviewer, each holding its own replicates:
 * `{arm, legs: [{run_id, item_ids, records, corpus_version}]}`. CodeRabbit has
 * exactly one leg with `run_id: null`, which is not a missing replicate but an arm
 * that cannot be re-run — and the aggregation is arm-agnostic precisely so that
 * difference lives in the data rather than in a branch.
 *
 * It REFUSES on a caller error (mixed populations, mixed gate states, a repeated run
 * id, a foreign corpus, an unsegmented multi-window population, a record whose item
 * the caller did not declare) and LABELS a data shortfall (items an arm never read,
 * one replicate where K were expected). That split is the one `volume-mix.mjs` draws:
 * the first group means the number would be wrong, the second that it is right about
 * less than a reader may assume.
 */
export function scoreSegmentation({ arms = [], geometry = new Map(), items = new Map(), minN = MIN_N, axisIds = AXIS_IDS, corpusVersion = null, corpusItemIds = [], reviewer = null } = {}) {
  if (!Number.isInteger(minN) || minN < 1) {
    refuse(`min_n must be a positive integer, got ${JSON.stringify(minN)} — a threshold of 0 suppresses nothing and publishes every n=1 cell`);
  }
  const selected = [...new Set(Array.isArray(axisIds) ? axisIds : [])].map((id) => axisFor(id));
  if (selected.length === 0) refuse("no axis selected — a grid with no axis is the ungrouped total wearing a segment label");
  for (const a of selected) if (a.status === "not-computed") refuse(`axis ${a.id} cannot be computed: ${a.reason}`);

  // NORMALISED ONCE, at the entry, and every read below is of the normalised copy.
  // `records` and `item_ids` are iterated in five places; guarding each of them
  // separately is how one gets missed, and the one that was missed iterated a STRING
  // character by character — `for (const r of "abc")` yields three one-letter
  // "records" and buckets them, silently, instead of failing. Absent still means
  // empty (a caller may legitimately pass neither); a non-array is a caller error and
  // is refused by name, because a raw TypeError says nothing about which arm or which
  // replicate was malformed. Nothing the caller owns is mutated (decision 7).
  const armList = (Array.isArray(arms) ? arms : []).map((arm) => ({
    ...arm,
    legs: (Array.isArray(arm?.legs) ? arm.legs : []).map((leg) => ({
      ...leg,
      records: asArray(leg?.records, `${arm?.arm}/${leg?.run_id ?? "(no run id)"} records`),
      item_ids: asArray(leg?.item_ids, `${arm?.arm}/${leg?.run_id ?? "(no run id)"} item_ids`),
    })),
  }));
  const allRecords = armList.flatMap((a) => a.legs.flatMap((l) => l.records));
  const population = assertOnePopulation(allRecords);
  const gateState = assertOneGateState(allRecords);
  assertWindowSegmented(
    allRecords,
    selected.map((a) => a.id),
  );
  for (const arm of armList) {
    assertDistinctLegs(arm.arm, arm.legs);
    for (const leg of arm.legs) {
      assertRunMatchesCorpus(leg.run_id ? { run_id: leg.run_id, corpus_version: leg.corpus_version ?? corpusVersion } : null, corpusVersion);
      const declared = new Set(leg.item_ids);
      const stray = [...new Set(leg.records.map((r) => r?.item_id).filter((id) => !declared.has(id)))];
      if (stray.length > 0) {
        refuse(
          `${arm.arm}/${leg.run_id ?? "(no run id)"} holds findings on ${stray.join(", ")}, which the caller did not list as read — ` +
            `a per-PR median needs the item list to count the items that produced NOTHING, and an undeclared item makes that count wrong in the flattering direction`,
        );
      }
    }
  }

  const cells = [];
  const skipped = [];
  const census = [];
  for (const axis of selected) {
    for (const arm of armList) {
      if (!axis.arms.includes(arm.arm)) {
        census.push({ axis: axis.id, arm: arm.arm, status: "not-applicable", reason: `${axis.id} has no counterpart in the ${arm.arm} arm — ${axis.source}` });
        continue;
      }
      const legs = arm.legs;
      // WHICH BUCKETS EXIST IN THIS DATA, counted in the axis's OWN unit.
      //
      // 🔴 An ITEM axis is read off the item list, not off the records, and this is
      // not symmetry for its own sake: an item the reviewer found nothing in still
      // belongs to its own size and authorship bucket. Reading item buckets off the
      // records alone dropped such an item out of the grid ENTIRELY — its bucket was
      // never observed, so `bucketsFor` emitted no cell for it, so it appeared in no
      // per-PR denominator on that axis and in no census row either. Reachable
      // wherever a fault bucket is involved: an item whose frozen size would not read,
      // or whose provenance is a value this file has not heard of, AND which produced
      // no finding. Both are exactly the cases the fault buckets exist to make visible.
      //
      // Counted in ITEMS for an item axis and in FINDINGS for a finding axis, because
      // one number that pooled the two units would be the unit error this file spends
      // its length on; `observed_unit` names which it is. The item ids are unioned
      // across the legs — one pull request is one observation of its own size however
      // many replicates saw it — which is also what keeps an item that DOES have
      // records from being counted once per record.
      const observed = new Map();
      const sawBucket = (b) => observed.set(b, (observed.get(b) ?? 0) + 1);
      if (axis.unit === "item") {
        for (const id of new Set(legs.flatMap((leg) => leg.item_ids))) sawBucket(bucketOf(axis.id, { item: items.get(id) ?? null }));
      } else {
        for (const leg of legs) for (const r of leg.records) sawBucket(bucketOf(axis.id, { record: r, item: items.get(r.item_id) ?? null }));
      }
      const buckets = bucketsFor(axis, observed);
      census.push({
        axis: axis.id,
        arm: arm.arm,
        status: "computed",
        buckets_declared: buckets.declared,
        buckets_from: axis.buckets_from ?? "vocabulary",
        // The zeros are printed with the rest, because "no `critical` findings" and
        // "we never looked at severity" are different facts and only one of them is
        // a measurement.
        buckets_observed: Object.fromEntries([...observed.entries()].sort()),
        // What the numbers above count. An item axis counts pull requests and a
        // finding axis counts findings, and on this corpus those differ by 20×.
        observed_unit: axis.unit === "item" ? "items" : "findings",
        buckets_discovered: buckets.discovered,
        buckets_outside_vocabulary: buckets.outside,
      });
      for (const bucket of buckets.list) {
        for (const metric of METRICS) {
          const pair = pairing(metric, axis);
          if (!pair.allowed) {
            skipped.push({ metric: metric.id, axis: axis.id, reason: pair.reason });
            continue;
          }
          const perLeg = legs.map((leg) => {
            const inBucket = leg.records.filter((r) => bucketOf(axis.id, { record: r, item: items.get(r.item_id) ?? null }) === bucket);
            // For an ITEM axis the item list narrows too: a per-PR median over size
            // L is a median over the L items, not over all of them.
            const itemIds = axis.unit === "item" ? (leg.item_ids ?? []).filter((id) => bucketOf(axis.id, { item: items.get(id) ?? null }) === bucket) : (leg.item_ids ?? []);
            return { run_id: leg.run_id ?? null, ...figureFor(metric, { records: inBucket, itemIds, geometry, items }) };
          });
          cells.push(
            cellFrom({
              metric: metric.id,
              axis: axis.id,
              bucket,
              arm: arm.arm,
              unit: unitFor(metric, legs.length),
              minN,
              legs: perLeg,
              intervalFor:
                metric.kind === "proportion"
                  ? (k, n) => wilson(k, n)
                  : () => noInterval(`${metric.id} is a median over PRs, not a count over a denominator, so there is no k a Wilson interval could be computed from`),
            }),
          );
        }
      }
    }
  }

  // Deduplicated because one metric/axis pair is skipped once per bucket and arm.
  const skippedPairs = [...new Map(skipped.map((s) => [`${s.metric}${KEY_SEP}${s.axis}`, s])).values()];

  const corpusIds = [...new Set(corpusItemIds)].sort();
  const reasons = [];
  for (const arm of armList) {
    for (const leg of arm.legs) {
      const notRead = corpusIds.filter((id) => !(leg.item_ids ?? []).includes(id));
      if (notRead.length > 0) reasons.push(`${arm.arm}/${leg.run_id ?? "(no run id)"}: ${notRead.length} corpus item(s) not scored (${notRead.join(", ")})`);
    }
    // K=1 is not a coverage gap, and it is not nothing either: the cell's value is
    // then one draw, and per-item volume on this corpus moves by up to 67% between
    // draws of the same reviewer on the same item. So it is a stated shortfall.
    if (arm.arm === "panel" && arm.legs.length < 2) {
      reasons.push(`panel: ${arm.legs.length} replicate — every panel cell is a single draw rather than a median over K, and per-item volume moves by up to 67% between draws of one reviewer on one item`);
    }
  }
  const suppressedCount = cells.filter((c) => c.suppressed).length;

  return {
    schema_version: SCHEMA_VERSION,
    scorer_id: SCORER_ID,
    scope: SCOPE,
    population,
    // `null` means there is no panel arm in this grid — see `assertOneGateState`.
    gate_state: gateState,
    corpus_version: corpusVersion,
    reviewer,
    // Read back per cell by a consumer; repeated here so a caption can never be
    // built from anything else.
    min_n: minN,
    min_n_source: minN === MIN_N ? "spec §4.1 default" : "operator override",
    segment_grammar: "metric=<metric id>/<axis id>=<bucket>/arm=<arm>",
    diff_size_scale: SCOPE_SIZE_SCALE,
    interval_method: `wilson-score, z=${Z_95} (95%)`,
    axes: AXES.map((a) => ({
      id: a.id,
      unit: a.unit ?? null,
      arms: [...a.arms],
      status: a.status ?? (selected.includes(a) ? "computed" : "not-selected"),
      reason: a.reason ?? null,
      scale: a.scale ?? null,
      source: a.source ?? null,
      note: a.note ?? null,
    })),
    metrics: METRICS.map((m) => ({ id: m.id, kind: m.kind, currency: m.currency, spec: m.spec })),
    pairs_not_computed: skippedPairs,
    census,
    grid: {
      cells: cells.length,
      reported: cells.length - suppressedCount,
      // The count a report's own summary is required to carry (§4.1).
      suppressed: suppressedCount,
      suppressed_share: cells.length === 0 ? null : suppressedCount / cells.length,
    },
    comparisons: comparisonsOf(cells),
    completeness: {
      verdict: reasons.length === 0 && corpusIds.length > 0 ? "complete" : "partial",
      reasons,
      corpus_item_count: corpusIds.length,
    },
    cells,
  };
}

/**
 * Where a CROSS-ARM sentence is available, computed rather than left to a reader.
 *
 * §4's deliverable is a comparison — "CodeRabbit's precision on security findings in
 * `code` files is 0.71 (n=17); ours is 0.83 (n=12)" — and a comparison needs BOTH
 * cells reported. With per-arm suppression that is strictly rarer than either arm
 * clearing alone, and it is the number that bounds every claim the report can make,
 * so it is named here instead of being inferred from a table of a hundred rows.
 *
 * `winner` is deliberately absent. Which direction is better is a property of the
 * metric — a high nit ratio is not a virtue — and this file does not own that
 * judgement.
 */
export function comparisonsOf(cells) {
  const byKey = new Map();
  for (const c of Array.isArray(cells) ? cells : []) {
    const key = [c.metric, c.axis, c.bucket].join(KEY_SEP);
    if (!byKey.has(key)) byKey.set(key, { metric: c.metric, axis: c.axis, bucket: c.bucket, arms: {} });
    byKey.get(key).arms[c.arm] = c.suppressed ? { reported: false, n: c.n } : { reported: true, n: c.n, value: c.value };
  }
  return [...byKey.values()]
    .filter((row) => Object.keys(row.arms).length > 1)
    .map((row) => ({ ...row, comparable: Object.values(row.arms).every((a) => a.reported) }))
    .sort((a, b) => a.metric.localeCompare(b.metric) || a.axis.localeCompare(b.axis) || String(a.bucket).localeCompare(String(b.bucket)));
}

// --- the report -------------------------------------------------------------

const num = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");

/** One cell as a line. Measured and withheld are the two states, and neither of
 *  them is blank. */
function cellLine(cell) {
  if (cell.suppressed) return `  ${cell.segment}: WITHHELD n=${cell.n} < ${cell.min_n} (${cell.suppression_basis})`;
  const ci = cell.interval && cell.interval.low !== null ? ` · 95% CI [${num(cell.interval.low)}, ${num(cell.interval.high)}]` : "";
  const k = cell.k === null ? "" : ` (${cell.k}/${cell.n})`;
  // The thinnest leg is printed whenever it differs, so a reader can see that the
  // draw behind this value had more support than the one that nearly withheld it.
  const thin = Number.isFinite(cell.thinnest_replicate_n) && cell.thinnest_replicate_n !== cell.n ? ` · thinnest replicate n=${cell.thinnest_replicate_n}` : "";
  // WHICH draw this is. Two metrics on the same segment can name different
  // replicates — the median is taken per metric — and a reader comparing two rows
  // needs to see that rather than assume one leg produced both.
  const from = cell.value_from_replicate === null ? "" : ` · from ${cell.value_from_replicate}`;
  return `  ${cell.segment}: ${num(cell.value)}${k} · n=${cell.n} ${cell.unit}${ci}${thin}${from}`;
}

/**
 * The result as lines. Pure and exported, so what a reader sees is testable without
 * a store — and so the CLI cannot format a number the library did not compute.
 *
 * EVERY CELL IS PRINTED, withheld ones included. A console view listing only the
 * cells that cleared would be the blank grid this whole file argues against: on a
 * corpus this size the suppressed rows ARE the result, and their count is the
 * headline.
 */
export function renderReport(result) {
  const out = [];
  const g = result.grid;
  out.push(
    `segmentation · corpus ${result.corpus_version ?? "(none)"} · population ${result.population ?? "(none)"} · ` +
      `gate ${result.gate_state ?? "(no panel arm)"} · ${result.completeness.verdict.toUpperCase()}`,
  );
  out.push(`  min_n ${result.min_n} (${result.min_n_source}) · ${g.cells} cell(s): ${g.reported} reported, ${g.suppressed} withheld (${g.suppressed_share === null ? "n/a" : `${(g.suppressed_share * 100).toFixed(1)}%`})`);
  out.push(`  grammar ${result.segment_grammar}`);
  out.push(`  diff size scale ${result.diff_size_scale}`);
  out.push(`  interval ${result.interval_method}`);
  if (result.reviewer) out.push(`  reviewer ${result.reviewer.config_hash ?? "(unstated)"} / ${result.reviewer.panel_sha ?? "(unstated)"}`);
  if (result.min_n !== MIN_N) out.push(`  ! min_n is ${result.min_n}, not the spec's ${MIN_N} — every cell carries the threshold it was judged against`);
  for (const r of result.completeness.reasons) out.push(`  ! ${r}`);
  for (const a of result.axes.filter((x) => x.status === "not-computed")) out.push(`  axis ${a.id}: NOT COMPUTED — ${a.reason}`);
  for (const p of result.pairs_not_computed) out.push(`  pair ${p.metric} × ${p.axis}: not computed — ${p.reason}`);
  for (const c of result.census.filter((x) => x.status === "not-applicable")) out.push(`  axis ${c.axis} on ${c.arm}: not applicable — ${c.reason}`);
  for (const c of result.census.filter((x) => x.status === "computed" && x.buckets_outside_vocabulary.length > 0)) {
    out.push(`  ! axis ${c.axis} on ${c.arm}: ${c.buckets_outside_vocabulary.length} bucket(s) outside the declared vocabulary: ${c.buckets_outside_vocabulary.join(", ")}`);
  }

  // Grouped by axis then metric, because the flat label loses that grouping and a
  // reader comparing two arms on one bucket needs those rows adjacent.
  for (const axisId of [...new Set(result.cells.map((c) => c.axis))]) {
    out.push("");
    out.push(`AXIS ${axisId}`);
    for (const metricId of [...new Set(result.cells.filter((c) => c.axis === axisId).map((c) => c.metric))]) {
      for (const cell of result.cells.filter((c) => c.axis === axisId && c.metric === metricId)) out.push(cellLine(cell));
    }
  }

  const comparable = result.comparisons.filter((c) => c.comparable);
  out.push("");
  out.push(`CROSS-ARM: ${comparable.length} of ${result.comparisons.length} two-arm segment(s) have both arms reported`);
  for (const c of comparable) {
    out.push(`  ${c.metric} · ${c.axis}=${c.bucket}: ${Object.entries(c.arms).map(([arm, a]) => `${arm} ${num(a.value)} (n=${a.n})`).join(" vs ")}`);
  }
  if (comparable.length === 0) out.push("  (none — every two-arm segment has at least one arm below min_n, which is the result rather than a failure to compute)");
  return out;
}

// --- CLI: read a store, print the grid. Writes nothing. ----------------------

const ARM_CHOICES = Object.freeze(["panel", "coderabbit", "both"]);

const USAGE =
  "usage: segmentation.mjs --root <eval-data-root> --corpus-version <v> [--run-id <id> …]\n" +
  "                       [--arm panel|coderabbit|both] [--item <id> …] [--axis <id> …]\n" +
  "                       [--min-n <n>] [--population reported|sampled] [--json]\n" +
  "\n" +
  "The volume/mix metrics, cut by the spec's §4 axes, per arm. A cell below min-n is\n" +
  "WITHHELD: it carries the n and the min_n that decided it and no value at all.\n" +
  "Every proportion carries a Wilson 95% interval. Reads only; writes nothing, spawns\n" +
  "nothing and costs nothing (the CodeRabbit arm makes read-only GitHub API calls).\n" +
  "\n" +
  "--run-id, --item and --axis are REPEATABLE. Each --run-id is one replicate of the\n" +
  "panel arm, and a cell's value is the MEDIAN leg, never the max.\n" +
  `--min-n defaults to ${MIN_N} (spec §4.1); an override is announced beside the grid.\n` +
  "--json prints the score payload to stdout; the grid goes to stderr.\n" +
  "\n" +
  `axes: ${AXIS_IDS.join(", ")}\n` +
  `metrics: ${METRIC_IDS.join(", ")}`;

async function main() {
  const args = parseArgs(process.argv, { booleans: ["json", "help"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const runIds = repeated(process.argv, "run-id");
  const itemFilter = repeated(process.argv, "item");
  const axisFilter = repeated(process.argv, "axis");
  // `--root` is REQUIRED and has no default anywhere in this directory: git history
  // is permanent, so one flag that fell back to a path inside this repository would
  // commit benchmark data into `wafflebase` for good.
  if (!args.root || !args["corpus-version"]) {
    console.error(USAGE);
    process.exit(2);
  }
  const arm = args.arm ?? "both";
  if (!ARM_CHOICES.includes(arm)) {
    console.error(`--arm must be one of ${ARM_CHOICES.join(" | ")}, got ${JSON.stringify(arm)}`);
    process.exit(2);
  }
  const population = args.population ?? "reported";
  if (!POPULATIONS.includes(population)) {
    console.error(`--population must be one of ${POPULATIONS.join(" | ")}, got ${JSON.stringify(population)}`);
    process.exit(2);
  }
  const minN = args["min-n"] === undefined ? MIN_N : Number(args["min-n"]);
  if (!Number.isInteger(minN) || minN < 1) {
    console.error(`--min-n must be a positive integer, got ${JSON.stringify(args["min-n"])}`);
    process.exit(2);
  }
  const wantPanel = arm === "panel" || arm === "both";
  const wantCodeRabbit = arm === "coderabbit" || arm === "both";
  if (wantPanel && runIds.length === 0) {
    console.error("--run-id is required to score the panel arm: a run id names ONE replicate and runs/ must never be globbed (decision 6)");
    process.exit(2);
  }
  if (wantCodeRabbit && population !== "reported") {
    console.error(`population ${JSON.stringify(population)} does not exist in the CodeRabbit arm — pass --arm panel to score it`);
    process.exit(2);
  }

  const { EvalStore } = await import("./store.mjs");
  const store = new EvalStore(args.root);
  const corpus = store.getCorpus(args["corpus-version"]);
  if (corpus === null) {
    console.error(`corpus version ${JSON.stringify(args["corpus-version"])} does not exist under this root`);
    process.exit(1);
  }
  const wanted = corpus.filter((it) => itemFilter.length === 0 || itemFilter.includes(it.id));
  const geometry = new Map();
  const items = new Map();
  for (const it of wanted) {
    const input = store.getCorpusItemInput(it.id);
    // A read path: an item that is not frozen under this root degrades to no
    // geometry, and every localisation and scope answer on it reads
    // `item-unavailable` rather than being silently placed.
    if (input) {
      geometry.set(it.id, itemGeometry(it.id, input));
      items.set(it.id, { item_id: it.id, additions: input.meta?.additions, deletions: input.meta?.deletions, scope: input.meta?.scope, provenance: input.meta?.provenance });
    } else {
      console.error(`  ! ${it.id}: no frozen item under this root — its citations cannot be placed and its size and authorship are unknown`);
      items.set(it.id, { item_id: it.id });
    }
  }

  const arms = [];
  if (wantPanel) {
    const { runRecords } = await import("./adapters/panel.mjs");
    const legs = [];
    for (const runId of runIds) {
      const stored = store.getRun(runId);
      if (!stored) {
        console.error(`run ${JSON.stringify(runId)} does not exist under this root`);
        process.exit(1);
      }
      const records = [];
      const itemIds = [];
      for (const it of wanted) {
        // The envelope is read HERE because the adapter's per-item read does not
        // return it: `status` rides on each RECORD as `panel.item_status`, so an
        // `error` item with zero findings carries it nowhere a scorer can see. An
        // item that is not a real verdict is EXCLUDED rather than counted, because
        // in a per-PR median a failed replay reads as a careful reviewer.
        const item = store.getItem(runId, it.id);
        if (!item) {
          console.error(`  ! ${runId}/${it.id}: not replayed under this run`);
          continue;
        }
        if (item.envelope?.status !== "ok") {
          console.error(`  ! ${runId}/${it.id}: envelope status ${JSON.stringify(item.envelope?.status ?? null)} — excluded, because a failed replay is not a clean review`);
          continue;
        }
        itemIds.push(it.id);
        for (const rd of runRecords(store, runId, { population, itemId: it.id })) records.push(...rd.records);
      }
      legs.push({ run_id: runId, item_ids: itemIds, records, corpus_version: stored.runJson?.corpus_version ?? null });
    }
    arms.push({ arm: "panel", legs });
  }
  if (wantCodeRabbit) {
    const { corpusRecords } = await import("./adapters/coderabbit.mjs");
    const records = [];
    const itemIds = [];
    for (const rd of corpusRecords(store, args["corpus-version"], { itemId: itemFilter.length === 1 ? itemFilter[0] : null })) {
      if (itemFilter.length > 0 && !itemFilter.includes(rd.item_id)) continue;
      // `population_state: "absent"` means an endpoint did not answer. Such an item
      // is not a pull request CodeRabbit was quiet on, so it contributes no zero to
      // any per-PR median.
      if (rd.population_state !== "present") {
        console.error(`  ! ${rd.item_id}: CodeRabbit population is ${rd.population_state} — excluded, because a silent endpoint is not a silent reviewer`);
        continue;
      }
      itemIds.push(rd.item_id);
      records.push(...rd.records);
    }
    arms.push({ arm: "coderabbit", legs: [{ run_id: null, item_ids: itemIds, records, corpus_version: args["corpus-version"] }] });
  }
  if (arms.length === 0) {
    console.error("no arm to score");
    process.exit(1);
  }

  const identified = arms
    .find((a) => a.arm === "panel")
    ?.legs.flatMap((l) => l.records)
    .find((r) => r?.panel?.config_hash);
  const result = scoreSegmentation({
    arms,
    geometry,
    items,
    minN,
    axisIds: axisFilter.length > 0 ? axisFilter : AXIS_IDS,
    corpusVersion: args["corpus-version"],
    corpusItemIds: wanted.map((it) => it.id),
    reviewer: identified ? { config_hash: identified.panel.config_hash ?? null, panel_sha: identified.panel.panel_sha ?? null } : null,
  });
  for (const line of renderReport(result)) console.error(line);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  // A PARTIAL result exits non-zero, so a pipeline cannot quote it as a complete one
  // by ignoring a line of stderr — the rule `volume-mix.mjs` and `reliability.mjs`
  // both follow. SUPPRESSION IS NOT PARTIALITY: a withheld cell is this scorer
  // working as designed, and a grid that is mostly withheld still exits 0.
  process.exitCode = result.completeness.verdict === "complete" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("segmentation failed:", e.message);
    process.exit(1);
  });
}
