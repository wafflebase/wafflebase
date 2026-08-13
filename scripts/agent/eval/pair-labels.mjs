// PAIR LABELS: an adjudicated answer to "are these two findings the same defect?",
// as a record definition plus the resolver that turns those answers into counts.
//
// A pair label is NOT the finding-level record `finding-record.mjs` defines. That
// one states a fact about one finding from one arm; this one states a fact about a
// RELATIONSHIP between two findings from different arms, and it has no arm of its
// own. Hence a separate module and a separate key: the two shapes answer different
// questions and a reader must never have to guess which kind of record they hold.
//
// WHY IT EXISTS. `groupFindings` never merges a `maybe` — the fail direction is
// right, because a false match suppresses a candidate and a suppressed candidate is
// a miss nobody recovers — so every undecided cross-arm pair is currently counted as
// TWO unique catches, one per arm. `complementarity.mjs` therefore reports the
// overlap as a BAND rather than a point, and its ceiling is saturated on all three
// pilot replicates: every CodeRabbit-only class has an undecided panel candidate, so
// "24 unique to CodeRabbit" means 24 unresolved pairs and not 24 established misses.
// A label resolves one pair. Enough labels turn the band into a point.
//
// WHAT IT DELIBERATELY DOES NOT DO — and this is the whole of the design:
//
//   IT DOES NOT RE-PARTITION THE PANEL'S OWN CLASSES. A `same` verdict says a
//   CodeRabbit finding and a panel finding are one defect. It does NOT say that two
//   PANEL findings are one defect, even when both are labelled `same` against the
//   one CodeRabbit finding — and that case is not hypothetical: on the pilot's k2
//   replicate, 4 of the 7 CodeRabbit classes a `same` label touches have TWO
//   distinct panel partner classes (5 resolved classes, 8 distinct partners).
//   Closing that under transitivity would merge two panel classes on the strength of
//   a pair nobody adjudicated, and it moves the number: k2's floor reads 6.9% under
//   transitive closure against 6.6% under this rule, because 7 classes leave the
//   denominator instead of 5. `finding-match.mjs` uses COMPLETE linkage precisely to
//   refuse that inference; a label store must not smuggle single linkage in behind
//   it. The matcher owns the panel's partition. Labels resolve pairs.
//
//   IT DOES NOT RE-THRESHOLD THE MATCHER. No `clusterFindings`, no
//   `findingSimilarity`, no `gateFor`, no threshold. Decision 24 stands: lowering
//   the bar to make `maybe` pairs resolve trades this benchmark's error for a worse
//   one in the panel's own harvest path.
//
//   IT DOES NOT WRITE. Reading a label is a scorer's business; making one is a
//   human's. There is no `put`, and the store's `labels/` tree is read-only here.
//
// THE FAILURE MODE THIS FILE IS BUILT AGAINST. A band that narrows more than the
// evidence justifies LOOKS LIKE SUCCESS: a tighter interval is what everyone wants,
// so an off-by-one in "is this class finished?" produces a better-looking report and
// a number that is wrong in the direction that flatters us. Two bugs of exactly that
// shape shipped here in three days, and both were caught by comparing against an
// independently measured figure rather than by a test. So the resolver reports the
// band BEFORE and AFTER with an explicit `ceiling_moved` flag, rather than leaving a
// reader to diff two numbers and hope.

import path from "node:path";
import crypto from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";

/**
 * Bumped when a field changes MEANING, never when one is added. The 23 records on
 * disk already carry fields this module does not read (`worksheet_row`, `reread`,
 * `supersedes`, `rubric_definition`) and they must survive a read unchanged, exactly
 * as the store's envelope validator established for run records.
 */
export const SCHEMA_VERSION = 1;

/** The `schema` discriminator written into every record, so a pair label and a
 *  finding label cannot be confused for one another by a reader holding only one. */
export const PAIR_LABEL_SCHEMA = "pair-label";

/**
 * `labels/<corpus-version>/pairs/<pair_key>.json` — the pair records' own subtree,
 * beside the item- and finding-level ones rather than inside them.
 *
 * ⚠ `store.mjs` owns every OTHER layout constant in this directory
 * (`CORPUS_DIR`, `RUNS_DIR`, `SCORES_DIR`, `REPORTS_DIR`) and has none for
 * `labels/`: the tree exists in the eval store and in `ANNOTATION-GUIDE.md`, but no
 * store method has ever read it — `store.labelStatus()` is named in §8 and was never
 * built. These two literals therefore live here, at the only module that reads the
 * tree. If a future PR adds them to `store.mjs`, IMPORT THEM AND DELETE THESE rather
 * than keeping both: `CAPTURES_SUBDIR`'s own docstring is this repository's warning
 * about the alternative — "written as two independent literals they drift, and the
 * drift is silent in the worst direction".
 */
export const LABELS_DIR = "labels";
export const PAIRS_SUBDIR = "pairs";

/**
 * THE THREE VERDICTS, and the third one is not a variant of the second.
 *
 *   same                the two findings are one defect, however differently worded.
 *   different           different defects that happen to share a location.
 *   insufficient-basis  the adjudicator could not tell from the two texts.
 *
 * `insufficient-basis` is a THIRD answer and pooling it with `different` finishes a
 * class that is not finished. It means "I could not tell", not "not a match", so a
 * CodeRabbit class with one `insufficient-basis` pair left is still UNDECIDED and
 * its contribution to the ceiling stands. Treating it as decided would collapse the
 * ceiling on evidence nobody has — the flattering direction, and the single most
 * likely bug in this file. The human used it on 8 of the first 23 labels; the
 * 2026-08-13 re-adjudication then took it to 0 of 23 because every one of those
 * eight was a pair whose CodeRabbit prose a parser had emptied. It is a live
 * verdict with a zero count today, which is exactly when a vocabulary gets quietly
 * dropped, so it is frozen here and tested directly.
 */
export const PAIR_VERDICTS = Object.freeze(["same", "different", "insufficient-basis"]);

/**
 * WHAT EACH VERDICT DOES TO A CLASS — the mapping, in one place, so the three
 * behaviours can never be stated independently of the three verdicts and drift
 * apart. `GATING_BASIS` in `finding-record.mjs` is the same device for the same
 * reason.
 *
 *   shared         the CodeRabbit class merges into its panel partner: it leaves
 *                  the undecided pool AND it lands in `both`. Raises the floor.
 *   decided-apart  this pair is settled and will never merge. Contributes nothing
 *                  on its own — a class is only finished when EVERY one of its
 *                  pairs is decided — and lowers the ceiling when it completes one.
 *   undecided      no information. The pair still counts toward the ceiling.
 */
export const VERDICT_EFFECT = Object.freeze({
  same: "shared",
  different: "decided-apart",
  "insufficient-basis": "undecided",
});

/** The effects, as their own frozen vocabulary, so a consumer can switch on them
 *  without re-deriving the set from the map's values. */
export const VERDICT_EFFECTS = Object.freeze(["shared", "decided-apart", "undecided"]);

/**
 * THE TRUST TIERS, most trusted first — `ANNOTATION-GUIDE.md` §6's vocabulary.
 *
 *   gold     a qualified HUMAN adjudicated. The IAA ceiling is computed over these.
 *   silver   an AI read-through, or noisy signals merged, pending human confirmation.
 *   distant  inferred from a natural experiment with no per-item reading.
 *
 * NEVER POOLED, and the API is what enforces it: `resolveClasses` takes ONE tier and
 * there is no argument that means "all of them", so a pooled band cannot be
 * expressed. That is not fussiness — a silver pair labeler was written for this
 * corpus, FAILED its own pre-registered validation at 17/23, and its 23 verdicts
 * were deliberately kept out of the store for exactly this reason. If they ever land,
 * a reader must be able to see which tier moved which number, and the gold-only band
 * must remain computable.
 */
export const LABEL_SOURCES = Object.freeze(["gold", "silver", "distant"]);

/** The annotator's own certainty, or `null` with a stated reason. `--worksheet` has
 *  no confidence field, so `null` is the honest value for every record written from
 *  one — and inventing a value would launder a fabrication into the highest tier. */
export const CONFIDENCES = Object.freeze(["high", "medium", "low"]);

/**
 * WHY A REPLICATE'S BAND DID OR DID NOT MOVE. Seven states, because "no label
 * changed this number" has six distinct causes and pooling them is the same scoring
 * bug as reading an arm's silence as a zero. Two are set by the scorer, which knows
 * whether a store exists; the other five by `resolveClasses`, which only sees the
 * records handed to it:
 *
 *   not-supplied        the scoring call was made with no label input at all. Every
 *                       caller written before labels existed lands here, and it is a
 *                       fact about the CALL rather than about the store.
 *   no-store            no `labels/<cv>/pairs` directory. Nobody has adjudicated
 *                       anything for this corpus version.
 *   store-empty         the directory exists and holds no usable record.
 *   none-for-replicate  labels exist, but none names this run and none of their keys
 *                       appears in its queue. The pilot's 23 are k2's; k1 and k3 land
 *                       here, and they must not read as "adjudicated, nothing found".
 *   none-matched        labels DO name this replicate, and yet no key matches a live
 *                       undecided pair — every one moved or was promoted. A drift
 *                       signal, not an absence of evidence.
 *   resolved-nothing    labels matched live pairs and no class changed state: all
 *                       `insufficient-basis`, or all on classes that were already
 *                       shared, or `different` verdicts that finished nothing.
 *   resolved            at least one class changed state, so at least one bound moved.
 *
 * The distinction the pilot forces is `none-for-replicate` against
 * `resolved-nothing`. A band that silently reports the same number for a labelled and
 * an unlabelled replicate is the four-availability-states lesson one level up.
 */
export const LABEL_AVAILABILITY = Object.freeze([
  "not-supplied",
  "no-store",
  "store-empty",
  "none-for-replicate",
  "none-matched",
  "resolved-nothing",
  "resolved",
]);

/**
 * EVERY FIELD THIS CONSUMER WILL INDEX A PAIR KEY UNDER, named and frozen.
 *
 * A pair key is content-derived, so re-parsing a finding's TEXT moves it.
 * `wafflebase#801` repaired a CodeRabbit title (`/node_modules/` → a real sentence)
 * and 6 of the first 23 keys changed, so a record carries both its original
 * `pair_key` and the `pair_key_at_801` its content hashes to now. A consumer keyed on
 * one vintage silently finds nothing for the other: measured on k2 at `main`, 5 of
 * the 22 labels that match a live pair match ONLY through the alternate field, and
 * those 5 include 4 `same` verdicts — a third of the floor's movement.
 *
 * So this is a LIST rather than one field, and the next re-parse adds a line here
 * instead of needing a grep for every place a key is looked up.
 */
export const ALTERNATE_KEY_FIELDS = Object.freeze(["pair_key_at_801"]);

const refuse = (msg) => {
  throw new Error(`pair label: ${msg}`);
};

const KEY = /^[0-9a-f]{12}$/;
const SHA256_TEXT = /^sha256:[0-9a-f]{64}$/;

/**
 * THE PAIR'S IDENTITY — `sha256(file|line|summary of the panel side ‖ the same of
 * the CodeRabbit side)`, truncated to 12 hex.
 *
 * Row numbers are stable only within one identical invocation (`--min-score`
 * renumbers everything), so "pair 3 = same" rots immediately. This hashes the
 * content both sides were actually judged on, which is the property a label store
 * needs: a verdict keyed by the two findings' text, so a later pass READS the label
 * instead of re-asking.
 *
 * DELIBERATELY NOT `finding-match.mjs`'s `contentDigest`. That one keys a single
 * finding and is the matcher's business — it already moved once when #780 widened the
 * operand it reads. A human's verdict must not be lost because the matcher was
 * refactored, so the label's key depends on nothing but the two findings' own text.
 *
 * ⚠ THE ARGUMENT ORDER IS PART OF THE KEY. Panel side first. The 23 records on disk
 * were keyed that way by `inspect-maybes.mjs`, and swapping the arguments produces a
 * different hash and therefore silently zero matches — a clean-looking run in which
 * no label does anything.
 */
export function pairLabelKey(panelFinding, coderabbitFinding) {
  // Whitespace is COLLAPSED, not just trimmed: a summary re-flowed across lines by a
  // renderer is the same sentence, and treating it as a different one would strand
  // the label on a pair nobody can find again.
  const side = (f) => {
    const o = f && typeof f === "object" ? f : {};
    return `${o.file ?? ""}|${o.line ?? ""}|${String(o.summary ?? "").replace(/\s+/g, " ").trim()}`;
  };
  return crypto.createHash("sha256").update(`${side(panelFinding)}||${side(coderabbitFinding)}`).digest("hex").slice(0, 12);
}

/** Every key a label may be found under: its own, plus each alternate vintage that
 *  differs from it. Sorted and deduped so two runs index identically. */
export function keysOf(label) {
  const keys = [label?.pair_key, ...ALTERNATE_KEY_FIELDS.map((f) => label?.[f])];
  return [...new Set(keys.filter((k) => typeof k === "string" && KEY.test(k)))].sort();
}

/**
 * Everything that must be true of a record before any number may rest on it.
 *
 * STRICT, and it throws — the same choice `validateFindingRecord` made and for the
 * same reason: this guards a derivation rather than a write, so a malformed record
 * reaching the resolver costs a wrong number rather than a corrupt file. The read
 * path in `readPairLabels` catches it and files the record as invalid, which is how
 * "the store holds 23 labels and 22 are usable" stays sayable.
 *
 * `diff_sha256` is REQUIRED rather than optional, and that is the load-bearing
 * choice here. It is the only drift guard a pair label has — `store.labelStatus()` is
 * named in `ANNOTATION-GUIDE.md` §8 and was never built — so a record without it
 * cannot be checked against the corpus at all. An optional guard input is not a
 * guard: `assertEffort` failed not because its rule was wrong but because the field
 * it read stopped arriving.
 */
export function validatePairLabel(label) {
  const L = label;
  if (L === null || typeof L !== "object" || Array.isArray(L)) refuse(`a record must be a JSON object, got ${JSON.stringify(L)}`);
  if (L.schema !== PAIR_LABEL_SCHEMA) {
    refuse(`schema must be ${JSON.stringify(PAIR_LABEL_SCHEMA)}, got ${JSON.stringify(L.schema)} — an item or finding label is a different record and must not be read as a pair verdict`);
  }
  if (L.schema_version !== SCHEMA_VERSION) refuse(`schema_version must be ${SCHEMA_VERSION}, got ${JSON.stringify(L.schema_version)}`);
  if (typeof L.pair_key !== "string" || !KEY.test(L.pair_key)) {
    refuse(`pair_key must be 12 lowercase hex characters, got ${JSON.stringify(L.pair_key)}`);
  }
  for (const field of ALTERNATE_KEY_FIELDS) {
    const v = L[field];
    if (!(v === undefined || v === null || (typeof v === "string" && KEY.test(v)))) {
      refuse(`${field} must be 12 lowercase hex characters or null, got ${JSON.stringify(v)} — it is indexed beside pair_key, so a malformed one loses the label silently`);
    }
  }
  if (!PAIR_VERDICTS.includes(L.verdict)) {
    refuse(`verdict must be one of ${PAIR_VERDICTS.join(" | ")}, got ${JSON.stringify(L.verdict)} — "insufficient-basis" is a third answer, not a spelling of "different"`);
  }
  if (!LABEL_SOURCES.includes(L.label_source)) {
    refuse(`label_source must be one of ${LABEL_SOURCES.join(" | ")}, got ${JSON.stringify(L.label_source)} — the tier decides which band a verdict may enter and there is no default`);
  }
  if (!(Array.isArray(L.annotators) && L.annotators.length > 0 && L.annotators.every((a) => typeof a === "string" && a.trim() !== ""))) {
    refuse(`annotators must be a non-empty array of non-empty strings, got ${JSON.stringify(L.annotators)} — an AI read laundered into a human id would make a future IAA pass treat two AI reads as human agreement`);
  }
  for (const field of ["corpus_version", "item_id"]) {
    if (typeof L[field] !== "string" || L[field].trim() === "") refuse(`${field} must be a non-empty string, got ${JSON.stringify(L[field])}`);
  }
  if (!(L.run_id === null || L.run_id === undefined || (typeof L.run_id === "string" && L.run_id.trim() !== ""))) {
    refuse(`run_id must be a non-empty string or null, got ${JSON.stringify(L.run_id)} — "" would read as a run whose id nobody wrote down`);
  }
  if (typeof L.diff_sha256 !== "string" || !SHA256_TEXT.test(L.diff_sha256)) {
    refuse(
      `diff_sha256 must be sha256:<64 hex>, got ${JSON.stringify(L.diff_sha256)} — it is the only drift guard a pair label carries ` +
        `(store.labelStatus() is named in ANNOTATION-GUIDE §8 and does not exist), so a record without it is one nothing can check`,
    );
  }
  // `null` is a legitimate value and an unexplained `null` is not: the worksheet
  // format has no confidence field, and saying so is what keeps "no value existed"
  // apart from "nobody wrote one down".
  if (!(L.confidence === null || L.confidence === undefined || CONFIDENCES.includes(L.confidence))) {
    refuse(`confidence must be one of ${CONFIDENCES.join(" | ")} or null, got ${JSON.stringify(L.confidence)}`);
  }
  if ((L.confidence === null || L.confidence === undefined) && !(typeof L.confidence_absent_reason === "string" && L.confidence_absent_reason.trim() !== "")) {
    refuse(`confidence is null and confidence_absent_reason is ${JSON.stringify(L.confidence_absent_reason)} — absence has more than one cause and the record must say which`);
  }
  return L;
}

/**
 * Every pair label filed for a corpus version. A READ PATH, so it degrades to fewer
 * records and never throws — but it COUNTS everything it dropped, with the reason and
 * the filename, because a label silently missing from a band is a floor that reads
 * lower than the evidence supports.
 *
 * Degrading is safe in exactly this direction and it is worth saying why: a label
 * this function drops can only cost a resolution, so the band it produces is wider
 * than the truth rather than narrower. The one condition that is NOT safe to degrade
 * on — a label written against a diff that no longer exists — is refused instead, in
 * `resolveClasses`, where the corpus's hashes are in scope.
 */
export function readPairLabels(root, corpusVersion) {
  const dir = typeof root === "string" && typeof corpusVersion === "string" ? path.join(root, LABELS_DIR, corpusVersion, PAIRS_SUBDIR) : null;
  const out = { dir, present: false, labels: [], unreadable: [], invalid: [] };
  if (dir === null || !existsSync(dir)) return out;
  out.present = true;
  let entries = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch (e) {
    out.unreadable.push({ file: null, reason: `the pairs directory could not be listed: ${e.message}` });
    return out;
  }
  for (const file of entries) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    } catch (e) {
      out.unreadable.push({ file, reason: e.message });
      continue;
    }
    try {
      out.labels.push(validatePairLabel(parsed));
    } catch (e) {
      out.invalid.push({ file, reason: e.message });
    }
  }
  return out;
}

/** `{key: n}` over a list, sorted keys so two runs print identically. */
function tally(items, pick) {
  const out = {};
  for (const it of items) {
    const k = pick(it);
    if (k === undefined || k === null) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** A share with its denominator attached, or `null` when there is no denominator —
 *  `0/0 → 0.000` reads as a measurement and is what an unwritten branch looks like. */
const share = (num, den) => (den > 0 ? num / den : null);

/**
 * WHAT IS IN THE LABEL STORE, as a census rather than a metric. Every proportion
 * carries its `n`, and the breakdowns that decide whether a band is quotable —
 * tier, verdict, and how many records are flagged for re-adjudication — are counted
 * apart rather than summed into one "labels: 23".
 */
export function pairLabelCensus(labels) {
  const list = (Array.isArray(labels) ? labels : []).filter((L) => L && typeof L === "object");
  const byTier = {};
  for (const tier of LABEL_SOURCES) {
    const mine = list.filter((L) => L.label_source === tier);
    // Reported for every tier including the empty ones: "0 silver" is a fact about
    // the store and a missing key is a fact about this function.
    byTier[tier] = { n: mine.length, by_verdict: tally(mine, (L) => L.verdict) };
  }
  return {
    n: list.length,
    by_verdict: tally(list, (L) => L.verdict),
    by_source: tally(list, (L) => L.label_source),
    by_tier: byTier,
    by_item: tally(list, (L) => L.item_id),
    by_run: tally(list, (L) => L.run_id ?? "(none)"),
    by_rubric: tally(list, (L) => L.rubric ?? "(unstated)"),
    // Provenance a reader needs before quoting a band, not decoration. #801 rewrote
    // CodeRabbit summaries, so a key that moved and a verdict made against text a
    // parser had emptied are both recorded on the record itself.
    keys_moved: list.filter((L) => L.pair_key_moved === true).length,
    needs_readjudication: list.filter((L) => L.needs_readjudication === true).length,
    superseded: list.filter((L) => L.supersedes && typeof L.supersedes === "object").length,
    confidence_absent: list.filter((L) => L.confidence === null || L.confidence === undefined).length,
    annotators: [...new Set(list.flatMap((L) => (Array.isArray(L.annotators) ? L.annotators : [])))].sort(),
  };
}

/** The band, given the four counts it is computed from. One helper, so the floor and
 *  the ceiling cannot be written with two different conventions — which is how a
 *  numerator and a denominator come to describe different populations. */
function bandOf({ both, classes, undecided }) {
  // The ceiling assumes every still-undecided CodeRabbit class merges. Merging one
  // adds it to `both` AND removes a class from the union, which is why the same `m`
  // appears in both terms — `complementarity.mjs`'s own arithmetic, kept identical
  // here so the labelled band and the unlabelled one are comparable.
  const ceilingBoth = both + undecided;
  const ceilingClasses = classes - undecided;
  return {
    both,
    classes,
    jaccard: share(both, classes),
    both_upper_bound: ceilingBoth,
    classes_at_ceiling: ceilingClasses,
    jaccard_upper_bound: share(ceilingBoth, ceilingClasses),
  };
}

/**
 * THE ARITHMETIC. Labels in, a band out, plus every count a reader needs to see why
 * it moved. Pure: no store, no network, no clock — the corpus's diff hashes arrive
 * through the injected `diffShaOf`.
 *
 * `opts`:
 *   classes    REQUIRED. `[{ id, item, claim }]` — the SCORED class rows, `claim`
 *              from `complementarity.mjs`'s `CLAIMS`.
 *   pairs      REQUIRED. One row per UNDECIDED cross-arm pair:
 *              `{ pair_key, panel_class, coderabbit_class, item, score }`.
 *   labels     the tier-agnostic list; this call uses one tier of it.
 *   diffShaOf  REQUIRED function `itemId -> "sha256:…" | null`. The drift guard's
 *              input, and required for the reason the guard exists.
 *   tier       ONE of `LABEL_SOURCES`, default `gold`. There is no "all tiers"
 *              value, by design — see `LABEL_SOURCES`.
 *   runId      the replicate being scored, for the availability states and for
 *              counting verdicts adjudicated on a different draw.
 *
 * A CLASS IS FINISHED ONLY WHEN EVERY ONE OF ITS PAIRS IS DECIDED, and that is the
 * rule the ceiling turns on. One `different` verdict on one of a class's ~14 pairs
 * resolves nothing, because any of the other 13 could still be the match. Measured
 * on the pilot: the 23 gold labels touch 12 CodeRabbit findings owning 175 pairs and
 * finish NONE of them, so on today's label set three floors move and no ceiling does.
 * A ceiling that moves here is the bug this module is most likely to ship.
 */
export function resolveClasses(opts = {}) {
  const { classes, pairs, labels = [], diffShaOf, runId = null, tier = "gold" } = opts;
  if (!LABEL_SOURCES.includes(tier)) {
    refuse(`tier must be one of ${LABEL_SOURCES.join(" | ")}, got ${JSON.stringify(tier)} — there is no value meaning "every tier", because a band computed over pooled tiers cannot say which tier moved it`);
  }
  if (!Array.isArray(classes)) refuse(`classes must be an array of { id, item, claim } rows, got ${JSON.stringify(classes)}`);
  if (!Array.isArray(pairs)) refuse(`pairs must be an array of { pair_key, panel_class, coderabbit_class } rows, got ${JSON.stringify(pairs)}`);
  if (typeof diffShaOf !== "function") {
    refuse(
      `diffShaOf must be a function itemId -> "sha256:<64 hex>" | null, got ${JSON.stringify(diffShaOf)} — it is the drift guard's ` +
        `only input, and a guard whose input never arrives is one that never fires`,
    );
  }

  const claimOf = new Map(classes.map((c) => [c.id, c.claim]));
  const itemsInFrame = new Set(classes.map((c) => c.item));
  const crOnly = classes.filter((c) => c.claim === "coderabbit-only");
  const both = classes.filter((c) => c.claim === "both").length;
  const scoredClasses = classes.filter((c) => c.claim === "both" || c.claim === "panel-only" || c.claim === "coderabbit-only").length;

  const supplied = (Array.isArray(labels) ? labels : []).filter((L) => L && typeof L === "object");

  // --- the drift guard, before any arithmetic --------------------------------
  //
  // REFUSED, not skipped, and over EVERY supplied label rather than only the ones
  // this replicate would use. A `diff_sha256` that disagrees with the corpus means
  // the item was re-extracted since the adjudication, so the verdict was made about
  // code that is no longer in the store — and that is true of the whole label set
  // for that item, not just of the pairs that happen to match today. Dropping such a
  // label would score the remaining ones against a diff nobody adjudicated, silently.
  const drift = [];
  for (const L of supplied) {
    const expected = diffShaOf(L.item_id);
    if (expected === null || expected === undefined) {
      drift.push(`${L.pair_key} (${L.item_id}): the corpus has no diff hash for this item — the label names an item this corpus version does not contain`);
    } else if (expected !== L.diff_sha256) {
      drift.push(`${L.pair_key} (${L.item_id}): label diff_sha256 ${L.diff_sha256} but the corpus item is ${expected}`);
    }
  }
  if (drift.length > 0) {
    refuse(
      `${drift.length} of ${supplied.length} label(s) were adjudicated against a diff this corpus no longer holds:\n  ` +
        drift.join("\n  ") +
        `\nRe-adjudicate them against the current item (ANNOTATION-GUIDE §8) or score a corpus version they match. ` +
        `They are refused rather than skipped because a band computed over the rest would rest on a mixture of two diffs with nothing in the output saying so`,
    );
  }

  const inTier = supplied.filter((L) => L.label_source === tier);
  const otherTiers = tally(supplied.filter((L) => L.label_source !== tier), (L) => L.label_source);

  // --- index every key each label may be found under -------------------------
  const byKey = new Map();
  const collisions = [];
  for (const L of inTier) {
    for (const key of keysOf(L)) {
      const prior = byKey.get(key);
      if (prior && prior.verdict !== L.verdict) {
        // Two records claiming one live pair with two answers. Not resolvable here
        // and not silently winnable by file order: whichever the resolver picked
        // would move a published number on an arbitrary tiebreak.
        collisions.push({ key, verdicts: [prior.verdict, L.verdict].sort(), pair_keys: [prior.pair_key, L.pair_key].sort() });
        continue;
      }
      if (!prior) byKey.set(key, L);
    }
  }
  if (collisions.length > 0) {
    refuse(
      `${collisions.length} pair key(s) carry two ${tier} labels with different verdicts (first: ${collisions[0].key} → ${collisions[0].verdicts.join(" vs ")}, ` +
        `from records ${collisions[0].pair_keys.join(" and ")}) — one pair has one verdict, and a key indexed under two of them makes the band depend on which file was read first`,
    );
  }

  // --- match the labels against this replicate's live undecided pairs ---------
  const applied = [];
  const usedKeys = new Set();
  for (const p of pairs) {
    const L = byKey.get(p.pair_key);
    if (!L) continue;
    usedKeys.add(L.pair_key);
    applied.push({
      pair_key: p.pair_key,
      // Which vintage of the key matched. 5 of k2's 22 match only through the
      // alternate, so this is the number that says whether indexing both was
      // load-bearing on this data — rather than a claim in a comment.
      via: L.pair_key === p.pair_key ? "pair_key" : ALTERNATE_KEY_FIELDS.find((f) => L[f] === p.pair_key) ?? "unknown",
      verdict: L.verdict,
      effect: VERDICT_EFFECT[L.verdict],
      label_run_id: L.run_id ?? null,
      item: p.item,
      panel_class: p.panel_class,
      coderabbit_class: p.coderabbit_class,
      score: p.score ?? null,
    });
  }
  // REPORTED, never dropped. A label whose key is in no live pair has two possible
  // causes and the queue alone cannot separate them: the pair was PROMOTED to a real
  // match (so its class is already shared and the label is simply redundant), or a
  // finding's text was re-parsed and the key moved again. The record's own
  // `pair_key_moved` / `still_maybe_at_801` provenance is carried through so a reader
  // can tell which — on k2 today the single unmatched label is the promoted kind.
  const unmatched = inTier
    .filter((L) => !usedKeys.has(L.pair_key))
    .map((L) => ({
      pair_key: L.pair_key,
      keys: keysOf(L),
      verdict: L.verdict,
      item: L.item_id,
      item_in_frame: itemsInFrame.has(L.item_id),
      label_run_id: L.run_id ?? null,
      pair_key_moved: L.pair_key_moved === true,
      still_maybe_at_801: L.still_maybe_at_801 ?? null,
      reason: "no undecided cross-arm pair in this replicate carries any of the label's keys",
    }));

  // --- resolve the CodeRabbit-only classes ------------------------------------
  const verdictAt = new Map(applied.map((a) => [a.pair_key, a.verdict]));
  const pairsByCr = new Map();
  for (const p of pairs) {
    const list = pairsByCr.get(p.coderabbit_class) ?? [];
    list.push(p);
    pairsByCr.set(p.coderabbit_class, list);
  }

  const resolved = [];
  const finishedApart = [];
  const stillUndecided = [];
  for (const c of crOnly) {
    const mine = pairsByCr.get(c.id) ?? [];
    // A CodeRabbit-only class with no undecided pair at all was never in the pool and
    // cannot leave it. It is not "finished by labelling" and must not be counted as
    // though a verdict had done something.
    if (mine.length === 0) continue;
    const sames = mine.filter((p) => verdictAt.get(p.pair_key) === "same");
    if (sames.length > 0) {
      // ONE confirmed match makes the class shared, whatever its other pairs say —
      // which is exactly why a partial label set raises the floor and leaves the
      // ceiling alone. The partner is chosen deterministically, and an
      // already-shared partner WINS: joining a class that is already `both` moves the
      // class out of the denominator without adding to the numerator, and preferring
      // it is the direction that does not inflate the floor.
      const partners = [...new Set(sames.map((p) => p.panel_class))].sort();
      const shared = partners.filter((id) => claimOf.get(id) === "both");
      const partner = shared.length > 0 ? shared[0] : partners[0];
      resolved.push({
        coderabbit_class: c.id,
        item: c.item,
        panel_class: partner,
        panel_class_claim: claimOf.get(partner) ?? null,
        // Every partner a `same` verdict named, not just the chosen one. When there
        // is more than one, the panel's own classes stay APART (see the header): the
        // class count falls by one, not by the number of partners.
        panel_partners: partners,
        pair_keys: sames.map((p) => p.pair_key).sort(),
        decided_pairs: mine.filter((p) => VERDICT_EFFECT[verdictAt.get(p.pair_key)] !== undefined && VERDICT_EFFECT[verdictAt.get(p.pair_key)] !== "undecided").length,
        pairs: mine.length,
      });
      continue;
    }
    // FINISHED only when every pair is decided. `insufficient-basis` is not a
    // decision, so a class held open by one of them stays undecided — the check is
    // written on the effect rather than on the verdict so a fourth verdict cannot be
    // added upstream and quietly count as decided here.
    const undecidedPairs = mine.filter((p) => VERDICT_EFFECT[verdictAt.get(p.pair_key)] !== "decided-apart");
    if (undecidedPairs.length === 0) {
      finishedApart.push({ coderabbit_class: c.id, item: c.item, pairs: mine.length });
    } else {
      stillUndecided.push({
        coderabbit_class: c.id,
        item: c.item,
        pairs: mine.length,
        decided: mine.length - undecidedPairs.length,
        held_open_by_insufficient_basis: undecidedPairs.filter((p) => verdictAt.get(p.pair_key) === "insufficient-basis").length,
        unlabelled: undecidedPairs.filter((p) => !verdictAt.has(p.pair_key)).length,
      });
    }
  }

  // A `same` verdict on a class that is ALREADY shared moves neither bound, and
  // counting it would double-count a class into the floor. 6 of the first 23 gold
  // labels sit on such classes (2 distinct classes on k2 today), so this is the
  // common case rather than a corner: the resolver keys off the class's CURRENT
  // claim, never off the label's existence.
  const onAlreadyShared = applied.filter((a) => a.verdict === "same" && claimOf.get(a.coderabbit_class) === "both");

  // The numerator gains one per PANEL class that newly becomes shared — deduped,
  // because two CodeRabbit classes resolving into ONE panel class make that panel
  // class shared once, not twice. The denominator loses one per resolved CodeRabbit
  // class. Both counts are needed and they are not the same number.
  const newlyShared = new Set(resolved.filter((r) => r.panel_class_claim === "panel-only").map((r) => r.panel_class));
  const undecidedBefore = new Set(pairs.filter((p) => claimOf.get(p.coderabbit_class) === "coderabbit-only").map((p) => p.coderabbit_class)).size;
  const before = bandOf({ both, classes: scoredClasses, undecided: undecidedBefore });
  const after = bandOf({
    both: both + newlyShared.size,
    classes: scoredClasses - resolved.length,
    undecided: stillUndecided.length,
  });

  // A class changed state iff a bound could have moved. `resolved-nothing` is
  // therefore not "the labels were useless" — it is "the labels were about pairs
  // whose classes this band already accounted for", which is a different sentence and
  // the one S3's six already-shared labels make true.
  const moved = resolved.length > 0 || finishedApart.length > 0;
  const namesThisRun = inTier.some((L) => (L.run_id ?? null) === runId);
  const availability = supplied.length === 0
    ? // The pure function cannot tell an absent directory from an empty one; the
      // scorer that read the store refines this to `no-store` when it knows.
      "store-empty"
    : inTier.length === 0
      ? "none-for-replicate"
      : applied.length === 0
        ? namesThisRun
          ? "none-matched"
          : "none-for-replicate"
        : moved
          ? "resolved"
          : "resolved-nothing";

  return {
    tier,
    availability,
    run_id: runId,
    labels: {
      supplied: supplied.length,
      in_tier: inTier.length,
      other_tiers: otherTiers,
      applied: applied.length,
      by_verdict: tally(applied, (a) => a.verdict),
      via: tally(applied, (a) => a.via),
      // A verdict adjudicated on another draw of the same corpus. The key is
      // content-derived, so a label transfers to any replicate whose pair carries
      // the same two texts — sound, because the question "are these two findings one
      // defect?" is about the text and not about which draw emitted it. Counted
      // rather than assumed: on the pilot it is 0, because k1 and k3 reworded every
      // labelled finding, which is the same finding-level churn the reliability
      // scorer measures.
      cross_replicate: applied.filter((a) => a.label_run_id !== null && a.label_run_id !== runId).length,
      unmatched,
    },
    resolution: {
      coderabbit_only_resolved_same: resolved.length,
      coderabbit_only_finished_apart: finishedApart.length,
      coderabbit_only_still_undecided: stillUndecided.length,
      panel_classes_newly_shared: newlyShared.size,
      labels_on_already_shared_class: onAlreadyShared.length,
      // Where the panel's partition was deliberately left alone. Each entry is a
      // CodeRabbit class a `same` verdict tied to more than one panel class; under
      // transitive closure these would collapse the denominator further.
      fanout: resolved.filter((r) => r.panel_partners.length > 1).map((r) => ({ coderabbit_class: r.coderabbit_class, panel_partners: r.panel_partners })),
      resolved,
      finished_apart: finishedApart,
      still_undecided: stillUndecided,
    },
    band: {
      before,
      after,
      floor_moved: before.jaccard !== after.jaccard,
      // THE CHECK, as a field rather than as an exercise for the reader. On a partial
      // label set this must be false: a `same` verdict adds to the ceiling's
      // numerator exactly what it removes from its denominator, so the ceiling
      // cannot move until a class is FINISHED. A true here on a label set that
      // finished nothing is a bug in this file.
      ceiling_moved: before.jaccard_upper_bound !== after.jaccard_upper_bound,
    },
  };
}
