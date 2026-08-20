// IS ANY OF IT TRUE — precision per arm over the labels an adjudicator wrote, plus
// the two questions this corpus can never answer and says so permanently. Spec §3.3.
//
// Every other scorer in this directory measures VOLUME: how much each reviewer says,
// how consistently it says it, what it costs. None of them can say whether a single
// finding is correct, because correctness needs a label — an independent reading of
// the diff — and `labels.mjs` plus `adjudicate.mjs` are where those come from. This
// file is the only consumer of that record, and it computes exactly one kind of thing:
// a ratio of judgements to judgements.
//
// THE FOUR LEVELS, because a precision figure is a ratio over two of them and this
// project's signature failure is a count that crossed a level and kept its old name.
// In two days it published three — pair counts read as finding counts, index entries
// read as records, `same` LABELS read as shared CLASSES — and each was "confirmed" by
// somebody re-dividing the ratio, which validates the arithmetic and says nothing
// about what the numerator counts. So every field here names its level:
//
//   claim            one thing a reviewer said, identified by `finding_key`
//                    (`file::summary`). `distinct_finding_keys` counts these.
//   label            one judgement written to disk about one claim. ONE FILE PER
//                    (arm, key). `labelled_findings` counts these, and it is the
//                    precision DENOMINATOR.
//   defect class     several claims a matcher grouped as one defect. Carried on a
//                    label as `class_id`; NEVER counted here as a claim.
//   reading          one time a human actually read something. `readings` counts
//                    these, via `labelCensus`, and it is what any claim about
//                    INDEPENDENCE has to use — 245 labels written from 245 readings
//                    and 428 written from 245 readings are different datasets.
//
// `readings` is never a denominator here and `labelled_findings` is never called an
// independent judgement count. Both are printed on every cell, always.
//
// THREE WAYS A CELL CAN HAVE NO NUMBER, and pooling them is the scoring bug lesson 6
// names. `suppressed` is a thin denominator; `not-computed` is a judgement nobody has
// made yet; `not-measurable` is a question this corpus cannot answer at all. The
// difference that matters most is the last two: `critical` on the CodeRabbit arm has
// NO denominator — they raised zero criticals across 30 findings — while `major` has
// three. Calling the first one "thin" would describe a missing measurement as a small
// one, and a reader would wait for more labels that can never arrive.
//
// TWO METRICS ARE REFUSED PERMANENTLY, and that is a property of the CORPUS rather
// than a gap in this file. Absolute recall and the miss profile both need
// `true_defects[]` — defects found by something outside both arms, from human review
// or a revert — and the pilot has none. No amount of adjudication produces them,
// because a set built from what reviewers found cannot contain what they missed. They
// are declared in `METRICS` as not computable, `COMPUTABLE_METRICS` filters them out
// before any cell is built, and there is no branch that assigns either a value.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not match findings across the two arms:
// the cross-arm overlap is the complementarity lane's job (`complementarity.mjs`,
// `pair-labels.mjs`), it is an UNRESOLVED BAND today, and a relative-recall point
// computed over it would inherit the band's width invisibly. So relative recall is
// emitted as a BAND with both bounds, from the set-theoretic bounds on a union of two
// sets whose overlap is unknown — which needs no matcher and imports neither module.
// It writes no label, runs no adjudication, adds no report section, and spends
// nothing: it reads a store, computes, prints.

import path from "node:path";
import { fileURLToPath } from "node:url";
// The severity scale comes from the module `labels.mjs` ITSELF validates against —
// `../severity.mjs`, read off its own import line rather than assumed. This directory
// carried a second, byte-identical copy under `vendor/pipeline/` until #830 deleted the
// mirror and #850 returned the pipeline without it, so the path has moved twice in six
// days. The weight vector below is derived from that module's `KNOWN`, and it has to be
// the same list the label validator uses or it would weight a severity no label can
// carry — which is why the import is checked against `labels.mjs` on every rebuild
// rather than copied forward.
import { KNOWN } from "../severity.mjs";
import { parseArgs } from "../gh-checks.mjs";
import { ARMS } from "./finding-record.mjs";
import { LABEL_SOURCES, labelCensus } from "./labels.mjs";
// The suppression threshold and the interval, imported rather than restated. Spec
// §4.1's 5 lives in `segmentation.mjs` and every consumer reads it back per cell; a
// second copy here is how a caption comes to contradict its own table.
import { MIN_N, noInterval, wilson } from "./segmentation.mjs";
import { repeated } from "./reliability.mjs";
import { assertComparableWindow, assertOnePopulation, pin } from "./volume-mix.mjs";

const refuse = (msg) => {
  throw new Error(`validity: ${msg}`);
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/** A caller-supplied list, or `[]` when it was not supplied at all. A non-array is
 *  REFUSED by name rather than coerced, for the reason `segmentation.mjs` gives: a
 *  string iterates character by character and each character is filed as a record. */
const asArray = (value, what) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) refuse(`${what} must be an array, got ${JSON.stringify(value)} — a non-list would be iterated element by element and counted`);
  return value;
};

/** Bumped when a field changes meaning, never when one is added — the rule every
 *  module on this surface states, because every reader downstream is additive. */
export const SCHEMA_VERSION = 1;

/** What this score is filed as. The pair rides IN the payload so a score file and the
 *  directory it lands in cannot disagree about which scorer wrote it; `store.mjs`'s
 *  `validateScore` checks only that they agree, and needs no change to accept this id. */
export const SCORER_ID = "validity-v1";
export const SCOPE = "cross-run";

/**
 * THE FOUR LEVELS, as data rather than as prose, so the payload carries its own
 * dictionary and no reader has to infer which one a number counts.
 *
 * This is here because of decision 28 and the three unit errors that preceded it. A
 * consumer reading `labelled_findings: 30` beside `readings: 24` can tell what each is
 * without opening this file; a consumer reading `n: 30` cannot.
 */
export const LEVELS = Object.freeze({
  claim: "one thing a reviewer said, identified by its finding_key (`file::summary`). Counted as `distinct_finding_keys`",
  label: "one judgement written to disk about one claim — one file per (arm, finding_key). Counted as `labelled_findings`, and it is the precision denominator",
  defect_class: "several claims a matcher grouped as one defect, carried on a label as `class_id`. Never counted here as a claim",
  reading: "one time an adjudicator actually read something. Counted as `readings` (distinct class_id + unbundled), and it is the only level a claim about INDEPENDENCE may use",
});

/**
 * The four states a cell can be in, and the three of them that carry no number.
 *
 *   reported        a value, its numerator, its denominator and its interval.
 *   suppressed      the denominator exists and is below `min_n`. Carries the
 *                   denominator that failed and NO value, NO numerator and NO
 *                   interval — a suppressed cell that still carried its figure would
 *                   be one `jq` away from being quoted.
 *   not-computed    nobody has made the judgement yet, or an input this file needs was
 *                   not supplied. It BECOMES measurable when the work is done, and the
 *                   reason says what work.
 *   not-measurable  the question cannot be answered on this corpus at all. No
 *                   adjudication changes it, because what is missing is a property of
 *                   the corpus rather than of the labelling effort.
 *
 * 🔴 THE LAST TWO ARE NOT INTERCHANGEABLE and neither is `suppressed`. A missing
 * denominator described as a thin one tells a reader to wait for labels that can never
 * arrive; a corpus limit described as a pending judgement does the same thing one level
 * up. Lesson 6 — absent has more than one cause and pooling them is a scoring bug.
 */
export const AVAILABILITY = Object.freeze(["reported", "suppressed", "not-computed", "not-measurable"]);

/**
 * What is known about the claims a cell's labels could ever have come from, which is
 * what tells `not-computed` from `not-measurable` at a zero denominator.
 *
 *   exhausted  every claim this arm made is already labelled, so no future judgement
 *              can land in this stratum. A zero here is FINAL.
 *   pending    claims remain unlabelled, so this stratum may still fill.
 *   unknown    the arm's claim population was not supplied at all, so nothing can be
 *              said about it — and in particular a label that failed to join must not
 *              be read as an orphan.
 */
export const CLAIM_POPULATIONS = Object.freeze(["exhausted", "pending", "unknown"]);

/**
 * How a label met the claim population it is about — and there are five answers, not
 * two, because the ways a join fails are the ways a precision denominator silently
 * shrinks.
 *
 * 🔴 THIS IS THE MOST LIKELY DEFECT IN THIS FILE and it has already happened once in
 * this repository, one level up: the pair-label store joined by key alone and reported
 * "0 of 349". A silent non-match inflates nothing — it quietly removes a judgement
 * from the denominator, which is why nothing downstream notices and why every one of
 * these five is COUNTED and named rather than filtered away.
 *
 *   joined                 the key is in the arm's claim set and, where the arm has a
 *                          parser vintage, that vintage is the current one. THE ONLY
 *                          status that enters a precision denominator.
 *   unmatched              the key is in no claim this arm made. Either the claim
 *                          population supplied here is not the one the label was
 *                          written against, or the reviewer's wording moved.
 *   stale-parse            the label's `parser_vintage` is not the current parse. A
 *                          CodeRabbit `finding_key` hashes a summary WE parsed out of
 *                          their markdown, and that parser is being corrected, so a
 *                          label written against an older parse cannot be told from a
 *                          current one — which is the entire reason `labels.mjs`
 *                          demands the field on that arm. Reported, never dropped, and
 *                          never pooled into the denominator with current-parse labels.
 *   parse-vintage-unknown  the label carries a vintage and the caller supplied no
 *                          current one to compare it against. The check's INPUT never
 *                          arrived, which is lesson 7 exactly, so the fail direction
 *                          matches `harvestVintage`'s own: unknown is refused, not
 *                          assumed current.
 *   claims-not-supplied    no claim population was given for this arm. Without it
 *                          EVERY label would read `unmatched`, which is a wrong census
 *                          rather than a missing one.
 */
export const JOIN_STATUSES = Object.freeze(["joined", "unmatched", "stale-parse", "parse-vintage-unknown", "claims-not-supplied"]);

/** The one join status a precision denominator may count, pinned against the
 *  vocabulary that owns it so a rename cannot leave this comparison never matching. */
const JOINED = pin("joined", JOIN_STATUSES, "the joinable status");

/** A claim whose severity is not the same in every replicate that raised it. The
 *  panel is replayed K times and a lens may call one claim `major` in one draw and
 *  `minor` in the next; filing such a key under either would make a stated-severity
 *  census that no single replicate produced. Measured on the pilot at K=3: see the
 *  census in the payload rather than a number here, which moves with the runs given. */
const STATED_SEVERITY_VARIES = "stated-severity-varies";

/**
 * The severity weight vector, DERIVED from `KNOWN`'s ordering rather than typed out.
 *
 * `KNOWN` is `critical | major | minor | nit`, most severe first, so
 * `KNOWN.length - index` is 4 | 3 | 2 | 1 — which is exactly spec §3.3's table. Two
 * expressions of one fact, and `assertSeverityWeights` runs at import time so a
 * reorder of `KNOWN` upstream stops this module loading instead of silently
 * reweighting every figure it produces. That is the one failure a derived vector has
 * and a typed one does not, so it is the one the guard is pointed at.
 *
 * Spec §3.3 wants the weights in ONE place so anyone who disagrees can re-run with
 * their own; `scoreValidity` takes a `weights` option for exactly that, and every
 * payload names which of the two it used.
 */
export const SEVERITY_WEIGHTS = Object.freeze(Object.fromEntries(KNOWN.map((s, i) => [s, KNOWN.length - i])));

/** Spec §3.3's table, verbatim, as the thing the derivation is checked against. */
export const SEVERITY_WEIGHTS_SPEC = Object.freeze({ critical: 4, major: 3, minor: 2, nit: 1 });

/** Refuses unless the weights cover exactly `KNOWN` with positive finite numbers, and
 *  — for the default vector — unless they still equal spec §3.3's. Exported so a test
 *  can prove it throws, because a guard nothing can prove fires is decoration. */
export function assertSeverityWeights(weights = SEVERITY_WEIGHTS, { spec = null } = {}) {
  if (!isPlainObject(weights)) refuse(`severity weights must be an object keyed by ${KNOWN.join(" | ")}, got ${JSON.stringify(weights)}`);
  const missing = KNOWN.filter((s) => !Number.isFinite(weights[s]) || weights[s] <= 0);
  if (missing.length > 0) {
    refuse(`severity weights need a positive number for every severity on the scale; ${missing.join(", ")} ${missing.length === 1 ? "does" : "do"} not have one`);
  }
  const extra = Object.keys(weights).filter((s) => !KNOWN.includes(s));
  if (extra.length > 0) refuse(`severity weights name ${extra.join(", ")}, which ${extra.length === 1 ? "is" : "are"} not on the scale ${KNOWN.join(" | ")} — a weight nothing can carry is a weight nobody applied`);
  if (spec) {
    for (const s of KNOWN) {
      if (weights[s] !== spec[s]) {
        refuse(
          `the weight for ${s} is ${weights[s]} but spec §3.3 says ${spec[s]} — the vector is DERIVED from KNOWN's ordering, ` +
            `so a reorder upstream silently reweights every severity-weighted figure. Reconcile the scale with the spec before scoring`,
        );
      }
    }
  }
  return weights;
}

// At import time, which is where `pin` and `assertBucketsDisjoint` put the same class
// of check: a guard that fires when the module loads beats one that never fires.
assertSeverityWeights(SEVERITY_WEIGHTS, { spec: SEVERITY_WEIGHTS_SPEC });

/**
 * Every metric spec §3.3 names, and whether this corpus can carry it.
 *
 * `computable: false` is not "unbuilt". It is a statement about the DATA, it carries
 * the reason a reader needs in order to stop asking, and `COMPUTABLE_METRICS` filters
 * those rows out before a single cell is constructed — so there is no code path from
 * `absolute_recall` to a number, rather than a branch that declines to take one.
 */
export const METRICS = Object.freeze([
  Object.freeze({
    id: "precision",
    computable: true,
    unit: "labelled findings",
    spec: "spec §3.3 — real ÷ (real + not-real), over the findings one arm raised and an adjudicator judged",
  }),
  Object.freeze({
    id: "severity_weighted_precision",
    computable: true,
    unit: "summed severity weight over labelled findings",
    spec: "spec §3.3 — Σ(weight of real claims) ÷ Σ(weight of all claims), weighted by the ANNOTATOR's severity",
  }),
  Object.freeze({
    id: "relative_recall",
    computable: true,
    unit: "confirmed-real findings in the cross-arm union",
    spec: "spec §3.3 — real defects this arm found ÷ all confirmed real defects. A BAND: the union's overlap is unresolved",
  }),
  Object.freeze({
    id: "fp_profile",
    computable: true,
    unit: "false findings, grouped",
    spec: "spec §3.3 — where the wrong claims cluster. Qualitative; every share carries its denominator and is suppressed below min_n",
  }),
  Object.freeze({
    id: "absolute_recall",
    computable: false,
    availability: "not-measurable",
    permanent: true,
    reason:
      "absolute recall needs every real defect the pull request contains, INCLUDING the ones no reviewer raised — the item label's " +
      "`true_defects[]`, populated from human review or a revert. The pilot corpus has none, and a set built from what reviewers " +
      "found cannot contain what they missed. This is a property of the corpus, not a gap in this scorer",
    what_would_change_it: "item labels carrying a non-empty true_defects[] on this corpus, sourced from outside both arms — a corpus-building task, not an adjudication one",
  }),
  Object.freeze({
    id: "miss_profile",
    computable: false,
    availability: "not-measurable",
    permanent: true,
    reason:
      "the miss profile describes the kinds of real defect an arm systematically misses, so it is cut over the same " +
      "`true_defects[]` absolute recall needs — defects found outside both arms, which this corpus does not contain. " +
      "A corpus property, not a gap in this scorer, and it does not become measurable by adjudicating more findings",
    what_would_change_it: "the same corpus property absolute recall needs; neither becomes measurable without it",
  }),
]);

/** The metrics a cell may be built for. `absolute_recall` and `miss_profile` are
 *  declared above and cannot — the same shape `segmentation.mjs` gives `defect_type`. */
export const COMPUTABLE_METRICS = Object.freeze(METRICS.filter((m) => m.computable));
export const METRIC_IDS = Object.freeze(COMPUTABLE_METRICS.map((m) => m.id));

/** The permanently refused metrics, as the payload carries them. Frozen, and the only
 *  place either id appears outside `METRICS`. */
export const PERMANENT_REFUSALS = Object.freeze(
  METRICS.filter((m) => m.computable === false).map((m) =>
    Object.freeze({ metric: m.id, availability: m.availability, permanent: m.permanent, reason: m.reason, what_would_change_it: m.what_would_change_it }),
  ),
);

/** The grammar every cell's `segment` is built to, stated once so a reader never has
 *  to reverse-engineer it from an example. */
export const SEGMENT_GRAMMAR = "metric=<metric id>/arm=<arm>/tier=<label_source>/<stratum basis>=<stratum>";

/** One cell's label, and the tier is IN it: a `gold` precision and a `silver`
 *  precision are two measurements, never one, so they can never share a segment. */
export function segmentLabel({ metric, arm, tier, stratumBasis, stratum }) {
  return `metric=${metric}/arm=${arm}/tier=${tier}/${stratumBasis}=${stratum}`;
}

/**
 * Which of the four states a cell is in, from its denominator and what is known about
 * the claims behind it.
 *
 * Exported and pure so the `critical`-versus-`major` distinction can be tested
 * directly rather than through a whole payload — it is the distinction this file most
 * has to get right, and the one a reader is most likely to collapse.
 */
export function availabilityFor({ labelledFindings, minN = MIN_N, claimPopulation = "unknown" } = {}) {
  if (!Number.isInteger(labelledFindings) || labelledFindings < 0) {
    refuse(`labelled_findings must be a non-negative integer, got ${JSON.stringify(labelledFindings)}`);
  }
  if (!Number.isInteger(minN) || minN < 1) refuse(`min_n must be a positive integer, got ${JSON.stringify(minN)} — a threshold of 0 suppresses nothing and publishes every n=1 cell`);
  if (!CLAIM_POPULATIONS.includes(claimPopulation)) refuse(`claim population must be one of ${CLAIM_POPULATIONS.join(" | ")}, got ${JSON.stringify(claimPopulation)}`);
  if (labelledFindings === 0) {
    // A zero denominator is an ABSENT measurement, never a wide one — the same rule
    // `wilson` states at n=0. Which flavour of absent it is depends entirely on
    // whether another judgement could still land here.
    return claimPopulation === "exhausted" ? "not-measurable" : "not-computed";
  }
  return labelledFindings < minN ? "suppressed" : "reported";
}

// --- the claim population ----------------------------------------------------

/**
 * What one arm CLAIMED, counted at the level a label joins on.
 *
 * `distinct_finding_keys` is the claim level and it is deliberately NOT called a
 * defect-class count. The pilot's panel arm produces 142 · 147 · 139 records over
 * three replicates and 245 defect classes in their union, and those are three
 * different numbers; grouping records into classes is `groupFindings`' job and is not
 * done here, because a label already carries the class it came from and re-deriving it
 * would be a second answer to a question that has one.
 *
 * `by_stated_severity` is THE REVIEWER's severity, named so in the field. It is what
 * makes "CodeRabbit raised zero criticals" a fact about CodeRabbit rather than a fact
 * about how much labelling has been done — and that fact is what a `not-measurable`
 * reason quotes. A key whose severity differs between replicates lands in its own
 * bucket rather than in either.
 */
export function claimCensus(arm, legs) {
  const severities = new Map();
  const keys = new Map();
  let records = 0;
  for (const leg of legs) {
    for (const r of leg.records) {
      if (!nonEmptyString(r?.finding_key)) continue;
      records++;
      if (!severities.has(r.finding_key)) severities.set(r.finding_key, new Set());
      severities.get(r.finding_key).add(r.severity);
      if (!keys.has(r.finding_key)) keys.set(r.finding_key, { finding_key: r.finding_key, item_id: r.item_id ?? null, severity: r.severity, file: r.file ?? null });
    }
  }
  const byStated = Object.fromEntries([...KNOWN, STATED_SEVERITY_VARIES].map((s) => [s, 0]));
  for (const [key, seen] of severities) {
    const bucket = seen.size === 1 ? [...seen][0] : STATED_SEVERITY_VARIES;
    if (Object.hasOwn(byStated, bucket)) byStated[bucket]++;
    if (bucket === STATED_SEVERITY_VARIES) keys.get(key).severity = STATED_SEVERITY_VARIES;
  }
  return {
    arm,
    replicates: legs.length,
    run_ids: legs.map((l) => l.run_id ?? null),
    records,
    distinct_finding_keys: keys.size,
    // Named for what it counts: the reviewer's own word, at the claim level, over
    // distinct keys rather than over records.
    distinct_keys_by_stated_severity: byStated,
    keys,
  };
}

// --- the join ----------------------------------------------------------------

/**
 * Every label placed against the claims of its own arm, with the four ways that fails
 * counted rather than filtered.
 *
 * 🔴 THE VINTAGE IS CHECKED BEFORE THE KEY, and that order is the point. A label
 * written against a different parse of CodeRabbit's markdown may well produce a key
 * that still matches — the parse moved 1 of the pilot's 30 summaries, not all 30 — and
 * admitting it would pool a judgement about text we can no longer reproduce with
 * judgements about current text. `labels.mjs:578` states the rule the field exists for:
 * "a label with no parser vintage cannot be told from a current one." Neither can one
 * with a stale vintage, so it leaves the denominator and appears in the census
 * carrying `key_found` either way — visible rather than absent.
 */
export function joinLabels({ labels = [], claims = null, arm = null, parserVintage = null } = {}) {
  const rows = [];
  for (const label of labels) {
    const row = { finding_key: label.finding_key, item_id: label.item_id, key_found: claims === null ? null : claims.has(label.finding_key), parser_vintage: label.parser_vintage ?? null, status: null };
    if (claims === null) {
      row.status = "claims-not-supplied";
    } else if (nonEmptyString(label.parser_vintage) && !nonEmptyString(parserVintage)) {
      row.status = "parse-vintage-unknown";
    } else if (nonEmptyString(label.parser_vintage) && label.parser_vintage !== parserVintage) {
      row.status = "stale-parse";
    } else if (!row.key_found) {
      row.status = "unmatched";
    } else {
      row.status = JOINED;
    }
    rows.push({ ...row, label, claim: row.key_found && claims ? claims.get(label.finding_key) : null });
  }
  const counts = Object.fromEntries(JOIN_STATUSES.map((s) => [s, 0]));
  for (const r of rows) counts[r.status]++;
  return {
    arm,
    counts,
    // The keys that did NOT join, listed rather than summarised: "12 unmatched" is a
    // number somebody has to investigate blind, and the investigation starts from the
    // keys. Capped nowhere — an unmatched label is rare by construction and a silent
    // truncation here is the failure this whole function exists to prevent.
    unmatched_keys: rows.filter((r) => r.status === "unmatched").map((r) => ({ item_id: r.item_id, finding_key: r.finding_key })),
    stale_parse_keys: rows.filter((r) => r.status === "stale-parse").map((r) => ({ item_id: r.item_id, finding_key: r.finding_key, parser_vintage: r.parser_vintage })),
    rows,
  };
}

// --- one cell ----------------------------------------------------------------

/** Why a denominator is thin, in the LABEL domain. `segmentation.mjs`'s
 *  `suppressionBasis` answers the same question about replicate legs, and its wording
 *  ("no replicate contributed this segment") would be a false sentence here: a label
 *  stratum has no replicates. Two levels, two functions, rather than one string that
 *  is true in one of them. */
function thinReason(labelledFindings, minN, { arm, stratum }) {
  return `${labelledFindings} labelled finding(s) on the ${arm} arm in ${stratum} — below min_n ${minN}, so the ratio is withheld rather than printed`;
}

/**
 * One precision cell, from the labels that fall in it.
 *
 * WHAT A SUPPRESSED CELL CARRIES: its denominator, and nothing else. No value, no
 * numerator, no interval — `segmentation.mjs` learned that the hard way and the reason
 * generalises: a payload is a file anybody can read, so "withheld" has to mean the
 * number is not in it.
 *
 * WHAT EVERY CELL CARRIES, in all four states: `labelled_findings` and `readings`
 * both, because a precision over 428 labels written from 245 readings is a different
 * claim from one over 428 independent judgements, and only one of the two numbers can
 * tell a reader which they are holding.
 *
 * 🔴 `real_findings` AND `labelled_findings` COME FROM ONE CENSUS, and the invariant
 * below refuses if they do not add up. `segmentation.mjs` published `0.833 (25/17)` on
 * real data by taking a numerator and a denominator from two different replicates;
 * nothing threw and nothing was blank. The check is a refusal for that reason.
 */
export function precisionCell({ metric = "precision", arm, tier, stratumBasis, stratum, labels = [], minN = MIN_N, claimPopulation = "unknown", weights = SEVERITY_WEIGHTS, reason = null } = {}) {
  const segment = segmentLabel({ metric, arm, tier, stratumBasis, stratum });
  // 🔴 THE DOOR `absolute_recall` AND `miss_profile` CANNOT COME THROUGH. `METRICS`
  // declares them not computable and `METRIC_IDS` is derived from that declaration, so
  // this refusal is the declaration made load-bearing: there is no argument to this
  // function that produces a figure for either, rather than a branch that declines to.
  if (!METRIC_IDS.includes(metric)) {
    const row = METRICS.find((m) => m.id === metric);
    refuse(
      `${segment}: no cell may be built for ${JSON.stringify(metric)}` +
        (row ? ` — ${row.reason}` : ` — known metrics are ${METRIC_IDS.join(", ")}`),
    );
  }
  assertOneTier(labels, { arm, tier });
  const census = labelCensus(labels);
  const labelled = census.n;
  const real = census.is_real.true;
  if (real + census.is_real.false !== labelled) {
    refuse(
      `${segment}: ${labelled} label(s) but ${real} real + ${census.is_real.false} not-real — a label whose is_real is neither ` +
        `true nor false cannot exist (labels.mjs refuses it), so a denominator that does not add up means the two came from different sets`,
    );
  }
  const availability = availabilityFor({ labelledFindings: labelled, minN, claimPopulation });
  const base = {
    segment,
    metric,
    arm,
    label_source: tier,
    stratum_basis: stratumBasis,
    stratum,
    availability,
    min_n: minN,
    // The two levels, always both, always named. Never `n`.
    labelled_findings: labelled,
    readings: census.readings,
    bundled_labels: census.bundled,
    // What the denominator counts, spelled out on the cell rather than in a legend.
    denominator_level: LEVELS.label,
    // `unclear` has no representation in the record: `is_real` is a boolean and
    // `labels.mjs` refuses anything else because "it is the core judgement and has no
    // 'probably'". Spec §3.3's formula excludes `unclear` and reports its count, so the
    // count is reported here as a structural zero with its reason rather than omitted
    // and left to look like nobody checked.
    unclear_findings: 0,
    unclear_basis: "the label schema has no `unclear` state — is_real is boolean and refuses anything else — so the spec's excluded-unclear count is structurally zero rather than measured",
    confidence: { ...census.confidence },
  };
  if (availability !== "reported") {
    return {
      ...base,
      reason:
        reason ??
        (availability === "suppressed"
          ? thinReason(labelled, minN, { arm, stratum })
          : `no labelled finding on the ${arm} arm in ${stratum}`),
    };
  }
  if (metric === "severity_weighted_precision") {
    // A weight SUM is not a count, and the field names say so. Reporting it as `k`
    // beside an `n` of labels would be two levels in one ratio — the error this file
    // spends its length on.
    let realWeight = 0;
    let allWeight = 0;
    for (const l of labels) {
      const w = weights[l.severity];
      if (!Number.isFinite(w)) refuse(`${segment}: no weight for severity ${JSON.stringify(l.severity)} — the vector covers ${KNOWN.join(" | ")}`);
      allWeight += w;
      if (l.is_real === true) realWeight += w;
    }
    return {
      ...base,
      value: allWeight === 0 ? null : realWeight / allWeight,
      real_weight_sum: realWeight,
      labelled_weight_sum: allWeight,
      real_findings: real,
      weight_basis: "the ANNOTATOR's own severity, never the reviewer's — weighting by the severity the arm claimed would let an arm set the weight of its own errors",
      // A weighted ratio has no integer numerator, so there is no k a Wilson interval
      // could be computed from. Stated on the cell rather than left absent.
      interval: noInterval("severity-weighted precision is a ratio of weight sums, not k successes in n trials, so no Wilson interval exists for it"),
    };
  }
  return {
    ...base,
    value: real / labelled,
    real_findings: real,
    interval: wilson(real, labelled),
  };
}

// --- relative recall ---------------------------------------------------------

/**
 * Relative recall as a BAND, from the only bounds available without resolving the
 * cross-arm overlap.
 *
 * Spec §3.3: "real defects this arm found ÷ all confirmed real defects". The
 * denominator is the union of the two arms' confirmed-real sets, and NOBODY KNOWS THE
 * OVERLAP — `complementarity.mjs` computes candidate pairs and the pair labels that
 * would resolve them are a separate lane's work (#829). Today "24 unique to CodeRabbit"
 * means 24 UNRESOLVED pairs, so any point estimate over that union inherits a width it
 * does not print.
 *
 * So the union is bounded set-theoretically instead, which needs no matcher and imports
 * neither of that lane's modules:
 *
 *   union_low  = max(a, b)   every defect one arm confirmed, the other confirmed too
 *   union_high = a + b       the two arms confirmed disjoint sets
 *
 * and the recall band follows, inverted, because a bigger union is a smaller share:
 *
 *   low  = a / union_high        high = a / union_low
 *
 * 🔴 ONE ARM ALONE PRODUCES 1.0 BY CONSTRUCTION and that is refused rather than
 * printed. With no labelled finding on the other arm the union IS this arm's own set,
 * the band collapses to [1, 1], and the sentence "our panel found 100% of confirmed
 * defects" would be true of the arithmetic and false about the world. It is the
 * tautology this whole metric is most likely to publish, so it is `not-computed` with
 * the reason, and the reason names the missing labels.
 */
export function relativeRecallBand({ arm, tier, real, otherArm, otherReal, minN = MIN_N, otherLabelled = 0 } = {}) {
  const base = {
    metric: "relative_recall",
    segment: segmentLabel({ metric: "relative_recall", arm, tier, stratumBasis: "stratum", stratum: "all" }),
    arm,
    label_source: tier,
    other_arm: otherArm,
    real_findings: real,
    other_arm_real_findings: otherReal,
    min_n: minN,
    overlap_resolved: false,
    // Named at the level it counts: confirmed-real FINDINGS across two arms, not
    // defect classes — nothing here has grouped a cross-arm pair into one defect.
    denominator_level: "confirmed-real findings in the union of the two arms' labelled sets; the union's overlap is unresolved, so it is a band rather than a number",
    bound_basis: "union_low = max(a, b) when every defect either arm confirmed the other confirmed too; union_high = a + b when the two sets are disjoint. Resolving the cross-arm pairs narrows the band; nothing here resolves them",
  };
  if (otherLabelled === 0) {
    return {
      ...base,
      availability: "not-computed",
      reason:
        `the ${otherArm} arm has no labelled finding, so the union of confirmed defects is this arm's own set and the band ` +
        `collapses to [1, 1] — a relative recall of 1.0 that is a property of the labelling rather than of the reviewer. ` +
        `Label the ${otherArm} arm and the denominator becomes a real one`,
    };
  }
  if (real + otherReal === 0) {
    return { ...base, availability: "not-computed", reason: "no labelled finding on either arm was judged real, so the union of confirmed defects is empty and there is no denominator" };
  }
  const unionLow = Math.max(real, otherReal);
  const unionHigh = real + otherReal;
  if (unionLow < minN) {
    return {
      ...base,
      availability: "suppressed",
      union_low: unionLow,
      union_high: unionHigh,
      reason: `the union of confirmed defects is between ${unionLow} and ${unionHigh}, and its lower bound is below min_n ${minN} — the weakest supported end of the band decides, so no share is printed`,
    };
  }
  return {
    ...base,
    availability: "reported",
    union_low: unionLow,
    union_high: unionHigh,
    // BOTH bounds, always. There is no `value` key on purpose: a point is exactly what
    // this metric may not publish today.
    low: real / unionHigh,
    high: real / unionLow,
  };
}

// --- the false-positive profile ----------------------------------------------

/**
 * Where an arm's wrong claims cluster, cut by the axes the payload already carries.
 *
 * Spec §3.3: "its false positives are all nits" is a very different verdict from "its
 * false positives are all criticals". The cut is qualitative and the COUNT of false
 * findings in a group is printed at any size — a count is not a proportion and
 * withholding it would delete the profile itself. What follows the min-n rule is the
 * SHARE, which is a proportion and carries its denominator.
 *
 * Four axes, and two of them are severities that must never be confused: the
 * annotator's own judgement of how bad the defect is, and the word the reviewer used
 * when raising it. Both are in the payload under names that say which is which.
 */
export function fpProfile({ arm, tier, joined = [], minN = MIN_N, claimPopulation = "unknown" } = {}) {
  const axes = [
    { id: "annotator_severity", of: (row) => row.label.severity, note: "the adjudicator's own severity for the defect they judged" },
    { id: "stated_severity", of: (row) => row.claim?.severity ?? "claim-unavailable", note: "the severity the REVIEWER put on the claim, read off the joined finding record" },
    { id: "confidence", of: (row) => row.label.confidence, note: "how sure the adjudicator was — a false-positive profile resting on low-confidence judgements is a different object" },
    { id: "item", of: (row) => row.label.item_id, note: "the pull request the claim was raised on" },
  ];
  const groups = [];
  for (const axis of axes) {
    const buckets = new Map();
    for (const row of joined) {
      const bucket = axis.of(row);
      if (!buckets.has(bucket)) buckets.set(bucket, { labelled: 0, real: 0, notReal: 0 });
      const b = buckets.get(bucket);
      b.labelled++;
      if (row.label.is_real === true) b.real++;
      else b.notReal++;
    }
    for (const [bucket, b] of [...buckets.entries()].sort((x, y) => String(x[0]).localeCompare(String(y[0])))) {
      const availability = availabilityFor({ labelledFindings: b.labelled, minN, claimPopulation });
      groups.push({
        arm,
        label_source: tier,
        axis: axis.id,
        axis_note: axis.note,
        bucket,
        // Always printed: a count of wrong claims is the qualitative content this
        // profile exists to carry, and it is not a proportion.
        false_findings: b.notReal,
        labelled_findings: b.labelled,
        min_n: minN,
        share_availability: availability,
        ...(availability === "reported" ? { false_share: b.notReal / b.labelled, interval: wilson(b.notReal, b.labelled) } : { reason: thinReason(b.labelled, minN, { arm, stratum: `${axis.id}=${bucket}` }) }),
      });
    }
  }
  return groups;
}

// --- the whole score ---------------------------------------------------------

/**
 * Precision and its neighbours, per arm and per label tier, over one corpus version.
 *
 * `arms` is one entry per reviewer, each holding the legs whose findings its labels
 * were written against: `{arm, legs: [{run_id, records}]}`. The panel arm's labels are
 * adjudicated over ALL K replicates at once — `adjudicate.mjs` queues them together
 * because bundling is what makes the job 245 judgements instead of 428 — so the legs
 * given here must be the same set, or keys that exist in a replicate nobody supplied
 * will read `unmatched`. That is exactly why the join census is in the payload.
 *
 * 🔴 TIERS ARE NEVER POOLED. A `gold` precision and a `silver` precision are two
 * measurements of different things — one is a qualified human reading the diff blind,
 * the other an AI read-through pending confirmation — so the tier is part of every
 * cell's key and there is no cell that spans two. `assertOneTier` refuses if one ever
 * does.
 *
 * It REFUSES on a caller error (a label from another corpus version, an unknown arm, a
 * record about code our arm never reviewed) and LABELS a data shortfall (no labels at
 * all, an arm with no claim population, an unreadable label, a stale parse). That split
 * is `volume-mix.mjs`'s: the first group means the number would be wrong, the second
 * that it is right about less than a reader may assume.
 */
export function scoreValidity({
  arms = [],
  labels = [],
  unreadable = [],
  corpusVersion = null,
  minN = MIN_N,
  parserVintage = null,
  weights = null,
} = {}) {
  if (!Number.isInteger(minN) || minN < 1) {
    refuse(`min_n must be a positive integer, got ${JSON.stringify(minN)} — a threshold of 0 suppresses nothing and publishes every n=1 cell`);
  }
  const weightVector = weights === null ? SEVERITY_WEIGHTS : assertSeverityWeights(weights);
  const labelList = asArray(labels, "labels");
  const unreadableList = asArray(unreadable, "unreadable");
  for (const l of labelList) {
    if (!isPlainObject(l)) refuse(`every label must be an object, got ${JSON.stringify(l)}`);
    if (l.schema !== "finding-label") refuse(`this scorer reads finding labels only, got schema ${JSON.stringify(l.schema)} — an item label answers a different question (the gate's verdict) and pooling the two would count a PR verdict as a finding judgement`);
    if (!ARMS.includes(l.arm)) refuse(`label ${JSON.stringify(l.finding_key)} names arm ${JSON.stringify(l.arm)}, which is not one of ${ARMS.join(" | ")}`);
    if (!LABEL_SOURCES.includes(l.label_source)) refuse(`label ${JSON.stringify(l.finding_key)} names label_source ${JSON.stringify(l.label_source)}, which is not one of ${LABEL_SOURCES.join(" | ")}`);
    // A label from another corpus version scores a diff that is not the one being
    // measured. The write path already refuses a stale `diff_sha256`; this is the
    // reader's half, and it refuses rather than degrading because the label would
    // otherwise land in a denominator about different code.
    if (corpusVersion !== null && l.corpus_version !== corpusVersion) {
      refuse(`label ${JSON.stringify(l.finding_key)} is filed under corpus version ${JSON.stringify(l.corpus_version)} but this score is for ${JSON.stringify(corpusVersion)} — the two are about different diffs`);
    }
  }

  // NORMALISED ONCE, at the entry, for the reason `segmentation.mjs` gives: a
  // non-array iterated element by element is a wrong census rather than an error.
  const armList = asArray(arms, "arms").map((a) => {
    if (!ARMS.includes(a?.arm)) refuse(`arm must be one of ${ARMS.join(" | ")}, got ${JSON.stringify(a?.arm)}`);
    return { arm: a.arm, legs: asArray(a.legs, `${a.arm} legs`).map((leg) => ({ run_id: leg?.run_id ?? null, records: asArray(leg?.records, `${a.arm}/${leg?.run_id ?? "(no run id)"} records`) })) };
  });
  const allRecords = armList.flatMap((a) => a.legs.flatMap((l) => l.records));
  const population = assertOnePopulation(allRecords);
  // A CodeRabbit finding about code our arm never reviewed is not comparable with one
  // about the reviewed snapshot, and a precision cell pooling the two would describe
  // two different diffs. Asserted rather than segmented, exactly as `volume-mix.mjs`
  // does — segmenting on window is the segmentation engine's job.
  assertComparableWindow(allRecords);

  // EVERY ARM THAT EITHER SUPPLIED CLAIMS OR HAS A LABEL. An arm whose labels exist and
  // whose claims were not supplied must still appear, or its judgements vanish from the
  // payload entirely — the silent-shrink failure, one level above the join.
  const armIds = [...new Set([...armList.map((a) => a.arm), ...labelList.map((l) => l.arm)])].sort();
  const censusByArm = new Map(armList.map((a) => [a.arm, claimCensus(a.arm, a.legs)]));

  const armRows = [];
  const cells = [];
  const recall = [];
  const profile = [];
  const reasons = [];
  const realByArmTier = new Map();

  for (const armId of armIds) {
    const claims = censusByArm.get(armId) ?? null;
    const armLabels = labelList.filter((l) => l.arm === armId);
    const join = joinLabels({ labels: armLabels, claims: claims ? claims.keys : null, arm: armId, parserVintage });
    const joined = join.rows.filter((r) => r.status === JOINED);
    const labelledKeys = new Set(joined.map((r) => r.finding_key));
    const unlabelledClaims = claims === null ? null : claims.distinct_finding_keys - labelledKeys.size;
    // Which of the three the zero-denominator branch gets. `exhausted` is the only one
    // that turns a zero into `not-measurable`, so it is the only one that must be
    // earned: every claim this arm made carries a judgement already.
    const claimPopulation = claims === null ? "unknown" : unlabelledClaims === 0 && claims.distinct_finding_keys > 0 ? "exhausted" : "pending";
    // EVERY TIER THAT HAS A LABEL ON THIS ARM, not every tier that joined. An arm whose
    // labels are all stale-parse still gets its cells, each carrying a denominator of
    // zero and the join census that explains it — which is what "reported as unmatched,
    // rather than absent" means at the metric level rather than only in the census.
    const tiers = [...new Set(armLabels.map((l) => l.label_source))].sort((a, b) => LABEL_SOURCES.indexOf(a) - LABEL_SOURCES.indexOf(b));

    armRows.push({
      arm: armId,
      claims_supplied: claims !== null,
      claims: claims === null ? null : { replicates: claims.replicates, run_ids: claims.run_ids, records: claims.records, distinct_finding_keys: claims.distinct_finding_keys, distinct_keys_by_stated_severity: claims.distinct_keys_by_stated_severity },
      labels: armLabels.length,
      join: { counts: join.counts, unmatched_keys: join.unmatched_keys, stale_parse_keys: join.stale_parse_keys },
      claim_population: claimPopulation,
      unlabelled_claims: unlabelledClaims,
      // The tier census, per arm, whether or not a cell was built for it: a tier with
      // no label is a fact about the labelling effort and belongs in the payload.
      label_sources: Object.fromEntries(LABEL_SOURCES.map((t) => [t, armLabels.filter((l) => l.label_source === t).length])),
      tiers_scored: tiers,
    });

    if (claims === null) {
      reasons.push(`${armId}: no claim population supplied, so its ${armLabels.length} label(s) could not be placed and no precision is computed for it`);
    }
    if (join.counts.unmatched > 0) {
      reasons.push(`${armId}: ${join.counts.unmatched} label(s) match no claim in the population supplied (${join.unmatched_keys.slice(0, 5).map((u) => u.finding_key).join(" · ")}${join.unmatched_keys.length > 5 ? " · …" : ""}) — either a different replicate set or a reviewer's wording moved`);
    }
    if (join.counts["stale-parse"] > 0) {
      reasons.push(`${armId}: ${join.counts["stale-parse"]} label(s) carry a parser vintage that is not the current parse — reported, and out of every denominator, because a stale key cannot be told from a current one`);
    }
    if (join.counts["parse-vintage-unknown"] > 0) {
      reasons.push(`${armId}: ${join.counts["parse-vintage-unknown"]} label(s) carry a parser vintage and no current vintage was supplied to compare it against — unknown is refused rather than assumed current`);
    }
    if (claims !== null && unlabelledClaims > 0) {
      reasons.push(`${armId}: ${unlabelledClaims} of ${claims.distinct_finding_keys} distinct claim(s) carry no label, so every zero-denominator cell on this arm is not-computed rather than not-measurable`);
    }

    for (const tier of tiers) {
      const tierRows = joined.filter((r) => r.label.label_source === tier);
      const tierLabels = tierRows.map((r) => r.label);
      realByArmTier.set(`${armId}/${tier}`, { real: tierLabels.filter((l) => l.is_real === true).length, labelled: tierLabels.length });
      // Why a whole-arm cell has no denominator, when it has none. The tier exists —
      // labels were written under it — so the zero is about the JOIN rather than about
      // the labelling, and the reason has to say which.
      const noneJoined =
        tierLabels.length > 0
          ? null
          : `${armLabels.filter((l) => l.label_source === tier).length} ${tier} label(s) exist on the ${armId} arm and none of them joined the claim population supplied — see this arm's join census`;

      cells.push(precisionCell({ metric: "precision", arm: armId, tier, stratumBasis: "stratum", stratum: "all", labels: tierLabels, minN, claimPopulation, weights: weightVector, reason: noneJoined }));
      cells.push(precisionCell({ metric: "severity_weighted_precision", arm: armId, tier, stratumBasis: "stratum", stratum: "all", labels: tierLabels, minN, claimPopulation, weights: weightVector, reason: noneJoined }));

      // 🔴 THE STRATA ARE THE ANNOTATOR'S SEVERITY, not the reviewer's, and the basis
      // is in the cell's own segment label. Cutting precision by the severity the arm
      // CLAIMED would let an arm choose which stratum its errors land in; the
      // annotator's judgement is the truth side of the ratio and is the one that
      // stratifies it. The reviewer's distribution is in the claim census beside it,
      // where it belongs, and is quoted in the reasons below.
      for (const severity of KNOWN) {
        const inStratum = tierLabels.filter((l) => l.severity === severity);
        const stated = claims?.distinct_keys_by_stated_severity?.[severity] ?? null;
        cells.push(
          precisionCell({
            metric: "precision",
            arm: armId,
            tier,
            stratumBasis: "annotator-severity",
            stratum: severity,
            labels: inStratum,
            minN,
            claimPopulation,
            weights: weightVector,
            reason:
              inStratum.length === 0
                ? claimPopulation === "exhausted"
                  ? `every one of ${armId}'s ${claims.distinct_finding_keys} distinct claim(s) on this corpus is labelled and none was judged ${severity}` +
                    (stated === 0 ? `, and the arm raised no finding it called ${severity} either — so no denominator for this stratum exists on this corpus` : `, so no denominator for this stratum exists on this corpus`)
                  : `no label on the ${armId} arm judges a finding ${severity} yet` + (claims === null ? " and the arm's claim population was not supplied" : `; ${unlabelledClaims} claim(s) remain unlabelled and one may still land here`)
                : null,
          }),
        );
      }

      profile.push(...fpProfile({ arm: armId, tier, joined: tierRows, minN, claimPopulation }));
    }
  }

  // Relative recall, per tier, over the two arms' confirmed-real sets. Tiers are not
  // pooled here either: a union built from a gold set and a silver one is a denominator
  // whose members were judged to two different standards.
  const tiersSeen = [...new Set([...realByArmTier.keys()].map((k) => k.split("/")[1]))].sort((a, b) => LABEL_SOURCES.indexOf(a) - LABEL_SOURCES.indexOf(b));
  for (const tier of tiersSeen) {
    for (const armId of ARMS) {
      const mine = realByArmTier.get(`${armId}/${tier}`);
      if (!mine) continue;
      const otherArm = ARMS.find((a) => a !== armId);
      const theirs = realByArmTier.get(`${otherArm}/${tier}`) ?? { real: 0, labelled: 0 };
      recall.push(relativeRecallBand({ arm: armId, tier, real: mine.real, otherArm, otherReal: theirs.real, otherLabelled: theirs.labelled, minN }));
    }
  }

  if (labelList.length === 0) reasons.push("no finding label exists for this corpus version, so every figure is not-computed — the honest result of a store nobody has adjudicated yet");
  if (unreadableList.length > 0) {
    // COUNTED, never skipped. An unreadable label is a judgement that was made and
    // cannot be re-asked, so it shrinks the denominator and has to be visible where the
    // denominator is.
    reasons.push(`${unreadableList.length} label file(s) could not be read, and each is a judgement that was made and cannot be recovered from this file: ${unreadableList.map((u) => u.path).slice(0, 5).join(" · ")}${unreadableList.length > 5 ? " · …" : ""}`);
  }

  return {
    schema_version: SCHEMA_VERSION,
    scorer_id: SCORER_ID,
    scope: SCOPE,
    corpus_version: corpusVersion,
    population,
    min_n: minN,
    min_n_source: minN === MIN_N ? "spec §4.1 default, imported from segmentation.mjs" : "operator override",
    levels: LEVELS,
    segment_grammar: SEGMENT_GRAMMAR,
    availability_vocabulary: [...AVAILABILITY],
    severity_weights: { ...weightVector },
    severity_weights_source: weights === null ? "derived from severity.mjs KNOWN's ordering, checked against spec §3.3's 4/3/2/1 at import" : "operator override",
    parse_vintage: {
      current: parserVintage,
      // What happens when the check's input never arrives, stated rather than implied.
      basis: parserVintage === null ? "not supplied — a label carrying a parser vintage cannot be checked, and is refused rather than assumed current" : "the content hash of the module whose output a CodeRabbit finding_key hashes",
    },
    labels: {
      total: labelList.length,
      unreadable: unreadableList,
      unreadable_count: unreadableList.length,
      // The house census, over every label read, carrying `n` AND `readings` for the
      // whole set the same way each cell does for its own slice.
      census: labelCensus(labelList),
    },
    metrics: METRICS.map((m) => ({ id: m.id, computable: m.computable, unit: m.unit ?? null, spec: m.spec ?? null, availability: m.availability ?? null, reason: m.reason ?? null })),
    refusals: PERMANENT_REFUSALS.map((r) => ({ ...r })),
    arms: armRows,
    cells,
    relative_recall: recall,
    fp_profile: profile,
    completeness: {
      verdict: reasons.length === 0 && labelList.length > 0 ? "complete" : "partial",
      reasons,
    },
  };
}

/** One cell's labels must all be one tier, because the tier is part of its key. A
 *  refusal rather than a silent pool: a precision over a gold and a silver judgement
 *  is a number about neither standard. */
export function assertOneTier(labels, { arm, tier } = {}) {
  const seen = [...new Set((Array.isArray(labels) ? labels : []).map((l) => l?.label_source))];
  if (seen.length > 1) {
    refuse(`${arm}/${tier}: labels span the tiers ${seen.join(", ")} — a gold precision and a silver precision are two measurements, and pooling them produces one that describes neither`);
  }
  return seen[0] ?? null;
}

// --- the report --------------------------------------------------------------

const num = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");

/**
 * One cell as a line, and the four states read differently ON PURPOSE.
 *
 * A withheld cell prints `n < min_n`; a not-measurable one prints no denominator
 * language at all, because "n=0 < 5" would describe a question this corpus cannot
 * answer as a sample that is merely small. That difference is the whole reason the
 * vocabulary has four values instead of two, and it is asserted by a test.
 */
export function cellLine(cell) {
  const levels = `${cell.labelled_findings} labelled finding(s) · ${cell.readings} reading(s)`;
  if (cell.availability === "reported") {
    const ci = cell.interval && cell.interval.low !== null ? ` · 95% CI [${num(cell.interval.low)}, ${num(cell.interval.high)}]` : "";
    const k = cell.metric === "severity_weighted_precision" ? ` (weight ${cell.real_weight_sum}/${cell.labelled_weight_sum})` : ` (${cell.real_findings}/${cell.labelled_findings})`;
    return `  ${cell.segment}: ${num(cell.value)}${k} · ${levels}${ci}`;
  }
  if (cell.availability === "suppressed") return `  ${cell.segment}: WITHHELD ${cell.labelled_findings} < min_n ${cell.min_n} · ${cell.readings} reading(s) — ${cell.reason}`;
  if (cell.availability === "not-measurable") return `  ${cell.segment}: NOT MEASURABLE — ${cell.reason}`;
  return `  ${cell.segment}: NOT COMPUTED — ${cell.reason}`;
}

/**
 * The result as lines. Pure and exported, so what a reader sees is testable without a
 * store — and so the CLI cannot format a number the library did not compute.
 *
 * EVERY CELL IS PRINTED, including the ones with no number. On a store with no labels
 * the absent cells ARE the result, and a console view listing only what cleared would
 * report an empty grid as a clean one.
 */
export function renderReport(result) {
  const out = [];
  out.push(`validity · corpus ${result.corpus_version ?? "(none)"} · ${result.labels.total} label(s) · ${result.completeness.verdict.toUpperCase()}`);
  out.push(`  min_n ${result.min_n} (${result.min_n_source}) · weights ${KNOWN.map((s) => `${s}=${result.severity_weights[s]}`).join(" ")} (${result.severity_weights_source})`);
  out.push(`  grammar ${result.segment_grammar}`);
  out.push(`  levels: label=${result.labels.census.n} · readings=${result.labels.census.readings} · bundled=${result.labels.census.bundled}`);
  out.push(`  parse vintage ${result.parse_vintage.current ?? "(unknown)"} — ${result.parse_vintage.basis}`);
  for (const r of result.completeness.reasons) out.push(`  ! ${r}`);
  for (const a of result.arms) {
    const c = a.claims;
    out.push("");
    out.push(
      `  arm ${a.arm}: ${a.labels} label(s) · claims ${c === null ? "NOT SUPPLIED" : `${c.distinct_finding_keys} distinct key(s) over ${c.records} record(s) in ${c.replicates} replicate(s)`}` +
        ` · population ${a.claim_population}`,
    );
    if (c !== null) out.push(`    claims by STATED severity (the reviewer's own word): ${Object.entries(c.distinct_keys_by_stated_severity).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    out.push(`    join: ${JSON.stringify(a.join.counts)}`);
    out.push(`    tiers: ${Object.entries(a.label_sources).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }
  out.push("");
  for (const cell of result.cells) out.push(cellLine(cell));
  for (const r of result.relative_recall) {
    out.push(
      r.availability === "reported"
        ? `  ${r.segment}: BAND [${num(r.low)}, ${num(r.high)}] · ${r.real_findings} confirmed real here, ${r.other_arm_real_findings} on ${r.other_arm} · union ${r.union_low}–${r.union_high}`
        : `  ${r.segment}: ${r.availability === "suppressed" ? "WITHHELD" : "NOT COMPUTED"} — ${r.reason}`,
    );
  }
  for (const g of result.fp_profile) {
    out.push(
      `  fp ${g.arm}/${g.label_source}/${g.axis}=${g.bucket}: ${g.false_findings} false of ${g.labelled_findings} labelled` +
        (g.share_availability === "reported" ? ` · share ${num(g.false_share)}` : ` · share ${g.share_availability.toUpperCase()}`),
    );
  }
  out.push("");
  for (const r of result.refusals) out.push(`  ${r.metric}: NOT MEASURABLE, permanently — ${r.reason}`);
  return out;
}

// --- CLI: read a store, print the figures. Writes nothing. -------------------

const ARM_CHOICES = Object.freeze(["panel", "coderabbit", "both"]);

const USAGE =
  "usage: validity.mjs --root <eval-data-root> --corpus-version <v>\n" +
  "                    [--arm panel|coderabbit|both] [--run-id <id> …] [--item <id> …]\n" +
  "                    [--min-n <n>] [--json]\n" +
  "\n" +
  "Precision per arm over the finding labels an adjudicator wrote, plus severity-weighted\n" +
  "precision, a relative-recall BAND and the false-positive profile. Absolute recall and\n" +
  "the miss profile are refused permanently: they need defects found outside both arms.\n" +
  "Reads only; writes nothing, spawns nothing, adjudicates nothing and costs nothing (the\n" +
  "CodeRabbit arm makes read-only GitHub API calls to rebuild its claim population).\n" +
  "\n" +
  "--run-id is REPEATABLE and must name the SAME replicates the labels were adjudicated\n" +
  "over: adjudicate.mjs queues all K at once, so a label may be about a claim only one\n" +
  "replicate raised. Supplying fewer shows up as unmatched labels rather than as a\n" +
  "quietly smaller denominator.\n" +
  `--min-n defaults to ${MIN_N} (spec §4.1); an override is announced beside the figures.\n` +
  "--json prints the score payload to stdout; the report goes to stderr.";

async function main() {
  const args = parseArgs(process.argv, { booleans: ["json", "help"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  // `--root` is REQUIRED and has no default anywhere in this directory: git history is
  // permanent, so one flag that fell back to a path inside this repository would commit
  // benchmark data into `wafflebase` for good.
  if (!args.root || !args["corpus-version"]) {
    console.error(USAGE);
    process.exit(2);
  }
  const arm = args.arm ?? "both";
  if (!ARM_CHOICES.includes(arm)) {
    console.error(`--arm must be one of ${ARM_CHOICES.join(" | ")}, got ${JSON.stringify(arm)}`);
    process.exit(2);
  }
  const minN = args["min-n"] === undefined ? MIN_N : Number(args["min-n"]);
  if (!Number.isInteger(minN) || minN < 1) {
    console.error(`--min-n must be a positive integer, got ${JSON.stringify(args["min-n"])}`);
    process.exit(2);
  }
  // REPEATABLE, and `parseArgs` keeps only the last occurrence of a flag — a run list
  // silently truncated to its last entry is a claim population that lost two thirds of
  // its replicates, and every label about the missing ones then reads `unmatched`.
  // `reliability.mjs` already exports this reader and `segmentation.mjs` already uses
  // it; a second copy is how two CLIs come to disagree about what `--run-id x --run-id y`
  // means.
  const runIds = repeated(process.argv, "run-id");
  const itemFilter = repeated(process.argv, "item");
  const wantPanel = arm === "panel" || arm === "both";
  const wantCodeRabbit = arm === "coderabbit" || arm === "both";
  if (wantPanel && runIds.length === 0) {
    console.error("--run-id is required to place the panel arm's labels: a run id names ONE replicate and runs/ must never be globbed (decision 6)");
    process.exit(2);
  }

  const { EvalStore } = await import("./store.mjs");
  const store = new EvalStore(args.root);
  const corpus = store.getCorpus(args["corpus-version"]);
  if (corpus === null) {
    console.error(`corpus version ${JSON.stringify(args["corpus-version"])} does not exist under this root`);
    process.exit(1);
  }

  // The labels, and the READER THAT ALREADY EXISTS. `readFindingLabels` enumerates the
  // arm directories, validates each file with the same schema a scorer would, and
  // returns the unreadable ones counted rather than skipped. Re-implementing it here
  // would be a second answer to "which labels exist".
  const { readFindingLabels, harvestVintage } = await import("./adjudicate.mjs");
  const read = readFindingLabels(args.root, args["corpus-version"]);
  for (const u of read.unreadable) console.error(`  ! unreadable label ${u.path}: ${u.reason}`);
  const labels = itemFilter.length === 0 ? read.labels : read.labels.filter((l) => itemFilter.includes(l.item_id));

  const arms = [];
  if (wantPanel) {
    const { runRecords } = await import("./adapters/panel.mjs");
    const legs = [];
    for (const runId of runIds) {
      if (!store.getRun(runId)) {
        console.error(`run ${JSON.stringify(runId)} does not exist under this root`);
        process.exit(1);
      }
      const records = [];
      for (const it of corpus) {
        if (itemFilter.length > 0 && !itemFilter.includes(it.id)) continue;
        const item = store.getItem(runId, it.id);
        // An item that produced no real verdict raised no claim anybody could have
        // labelled, and it is excluded rather than counted as a silent reviewer — the
        // rule every scorer on this surface follows.
        if (!item || item.envelope?.status !== "ok") {
          console.error(`  ! ${runId}/${it.id}: envelope status ${JSON.stringify(item?.envelope?.status ?? null)} — excluded from the claim population`);
          continue;
        }
        // `population: "reported"` because that is what `adjudicate.mjs` queues, so it
        // is the population the labels are about.
        for (const rd of runRecords(store, runId, { population: "reported", itemId: it.id })) records.push(...rd.records);
      }
      legs.push({ run_id: runId, records });
    }
    arms.push({ arm: "panel", legs });
  }
  if (wantCodeRabbit) {
    const { corpusRecords } = await import("./adapters/coderabbit.mjs");
    const records = [];
    for (const rd of corpusRecords(store, args["corpus-version"], { itemId: itemFilter.length === 1 ? itemFilter[0] : null })) {
      if (itemFilter.length > 0 && !itemFilter.includes(rd.item_id)) continue;
      if (rd.population_state !== "present") {
        console.error(`  ! ${rd.item_id}: CodeRabbit population is ${rd.population_state} — excluded, because a silent endpoint is not a silent reviewer`);
        continue;
      }
      records.push(...rd.records);
    }
    arms.push({ arm: "coderabbit", legs: [{ run_id: null, records }] });
  }

  const result = scoreValidity({
    arms,
    labels,
    unreadable: read.unreadable,
    corpusVersion: args["corpus-version"],
    minN,
    // The vintage of the parser that produced the CodeRabbit keys in THIS process,
    // computed at the CLI and handed in as data: the library stays pure and its tests
    // need no file system, which is the split `adapters/coderabbit.mjs` draws around
    // its own network read.
    parserVintage: harvestVintage(),
  });
  for (const line of renderReport(result)) console.error(line);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  // A PARTIAL result exits non-zero, so a pipeline cannot quote it as a complete one by
  // ignoring a line of stderr. WITHHELD IS NOT PARTIAL — a suppressed cell is this
  // scorer working as designed — but a store with no labels is, and today that is what
  // the exit code says.
  process.exitCode = result.completeness.verdict === "complete" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("validity failed:", e.message);
    process.exit(1);
  });
}
