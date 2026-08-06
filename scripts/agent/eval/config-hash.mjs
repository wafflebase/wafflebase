// config_hash — the stable identity of a reviewer's CONFIGURATION ("which settings").
//
// WHAT IT IS FOR, TODAY. The panel is tuned by changing `lenses.json`: a model, a
// sample count, a reasoning effort, which file classes a lens reads. Nothing in
// this repository can currently answer "what settings produced that review?" — the
// check run records a verdict, not the manifest behind it. `configHash` answers that
// in one string.
//
// IT DOES NOT, ON ITS OWN, ANSWER "was this the same REVIEWER?" — configuration is
// one of the two halves of that, and the file cannot see the other. See "what is out
// of scope" below: the reviewer is the PAIR (config_hash, panelSha). Anywhere in this
// file that two configs are called "the same reviewer", it is shorthand for "identical
// on the configuration axis", holding the panel's code fixed.
//
// THE ONE INVARIANT. Two manifests describing the SAME reviewer behaviour must
// hash the same; two describing DIFFERENT behaviour must hash differently. Both
// halves matter, and they are NOT symmetric:
//
//   - Hashing the SAME when behaviour differs silently merges two reviewers into
//     one population. Nothing fails, nothing is logged, and the error surfaces as
//     a comparison nobody can explain.
//   - Hashing DIFFERENTLY when behaviour is identical splits a population, which
//     shows up immediately as fewer matching results than expected.
//
// So where a normalisation is genuinely uncertain this module FAILS TOWARD
// OVER-SENSITIVITY — the same direction `lensScope` picked in the file being
// fingerprinted ("an omission must fail toward more review"). Every place that
// choice is made is marked OVER-SENSITIVE below, so the list is auditable rather
// than accidental.
//
// HOW THE PANEL'S DEFAULTS GET IN HERE: BY IMPORT, NOT BY COPY. A manifest may
// omit any field and take the panel's default, so the hash has to know those
// defaults — and a hand-copied default that drifts from the panel is EXACTLY the
// false negative this module exists to prevent. `FILE_CLASSES` and
// `sampleCountFor` are therefore imported from `review-panel.mjs` rather than
// mirrored. That import costs one module graph (8 sibling modules, ~13ms) and
// costs NOTHING in dependencies: `ask.mjs` imports the Agent SDK lazily, at its
// one call site, so this module loads and its tests run with no `node_modules`
// present at all. Measured, not assumed — see the task doc.
//
// WHAT IS OUT OF SCOPE, ON PURPOSE. This hashes the LENS COMPOSITION, not the
// panel's code. A new verifier stage or a changed gate leaves the hash identical,
// so `config_hash` alone does NOT establish that two reviews are comparable. The
// second half of that key already exists and is already recorded: `panelSha` in
// every capture's `meta.json` (capture-meta.mjs, #673), whose header settled this
// exact question — a commit sha "is always available, always correct, and a config
// identity can be derived from it later". A `pipeline_version` integer here would
// be a second, weaker source of truth for a fact already recorded correctly, and
// hand-maintained version integers are the drift class this whole module is a fix
// for. **The pooling key is the PAIR (config_hash, panelSha).**

import { createHash } from "node:crypto";
import { FILE_CLASSES, sampleCountFor } from "../review-panel.mjs";

// Bumped on any change to the hash FUNCTION, so a stored hash carries the vintage
// of the algorithm that produced it. @1 was the fork harness's version, which
// omitted `scopeClasses`, `effort` and `maxTurns` and mirrored `samples` by hand.
// A hash computed by @1 and one computed by @2 are never comparable, and without
// this field the only evidence of that is a mismatch nobody can attribute.
//
// Recorded as PROVENANCE, deliberately not hashed: @2 adds keys to the canonical
// form, so an @1 and an @2 hash of the same manifest already differ by
// construction. Feeding the version in as well would add nothing and would make
// every future bump look like a reviewer change.
export const CONFIG_HASH_VERSION = "wafflebase/config-hash@2";

/**
 * Manifest-level keys that ENTER the hash. Anything the panel consumes to produce
 * findings is behaviour-determining; pointers and prose are not.
 */
export const HASHED_CONFIG_FIELDS = Object.freeze(["target", "lenses"]);

/**
 * Manifest-level keys deliberately EXCLUDED, each with the reason it is cosmetic.
 * The reason is data, not a comment, so `config-hash.test.mjs` can require one for
 * every exclusion — a field cannot be dropped from the hash without someone
 * writing down why.
 */
export const COSMETIC_CONFIG_FIELDS = Object.freeze({
  schema_version: "the manifest's own format version; changing it does not change what any lens does",
  config_id: "a human label for the config. Renaming a config does not make it a different reviewer",
  description: "prose for a human reader; never reaches a lens",
  sdk_version: "provenance. Recorded so a result can be attributed, but the SDK build is not part of the manifest's meaning — and hashing it would split every population on a dependency bump",
  captured_at: "when the snapshot was taken. Provenance by definition",
  config_hash: "the output. Hashing it would be circular",
  config_hash_version: "the algorithm's vintage — see CONFIG_HASH_VERSION for why it is provenance and not input",
});

/**
 * Per-lens keys that ENTER the hash, in canonical (effective-value) form.
 *
 * Named in one exported list because the failure this module keeps having is a
 * field added to `lenses.json` that nobody adds to a hardcoded list. The list is
 * exported so a test can hold it against the REAL `lenses.json` and against the
 * fields `review-panel.mjs` actually reads off a lens; a new field then fails that
 * test until someone classifies it.
 */
export const HASHED_LENS_FIELDS = Object.freeze([
  "id",
  "title",
  "model",
  "samples",
  "gating",
  "needsIssueSpec",
  "appliesWhen",
  "scopeClasses",
  "effort",
  "maxTurns",
  "rubric_sha256",
]);

/**
 * Per-lens keys deliberately EXCLUDED, each with the reason. Same contract as
 * `COSMETIC_CONFIG_FIELDS`: the reason is required, and a test enforces it.
 */
export const COSMETIC_LENS_FIELDS = Object.freeze({
  rubric_path: "a POINTER to the rubric. Its CONTENT is hashed as rubric_sha256, so moving the file is not a reviewer change while editing it is",
  rubric: "the rubric text as `loadLenses` injects it at runtime. Hashed as rubric_sha256 — the same bytes, by their digest",
  rubric_text: "the rubric text as the snapshot inlines it. Same bytes as `rubric`, same reason",
});

/**
 * Absent `effort` normalises to this. Documented as the SDK default in FOUR
 * independent places, all re-checked at upstream/main bb21ff953:
 *
 *   1. review-panel.mjs:1784 — "Omitted = the SDK default (`high`). This is the
 *      panel's main cost dial."
 *   2. ask.mjs `assertEffort` docblock — an unrecognised value "would otherwise be
 *      dropped and the session would run at the default `high`, which is a silent
 *      COST regression".
 *   3. ask.mjs `buildSessionOptions` — "an unset effort takes the SDK default
 *      (`high`) rather than being pinned here".
 *   4. The pinned SDK itself, `sdk.d.ts:1631`: "`'high'` — Deep reasoning
 *      (default)".
 *
 * All four agree, so this is an equivalence and not a guess: `security` (which
 * sets no `effort`) hashes identically to a lens that writes `"high"` out, because
 * they run identically. Had they disagreed, the honest move would have been a
 * distinct sentinel — a documented over-sensitivity that splits a population is
 * recoverable; a guessed equivalence that merges two reviewers is not.
 */
export const DEFAULT_EFFORT = "high";

/** A set of globs/classes, canonicalised: de-duplicated and sorted, so order and
 * repetition in the file never affect identity. */
function canonicalSet(values) {
  return [...new Set(values.map(String))].sort();
}

/**
 * The globs that decide whether a lens RUNS, in the effective form `lensApplies`
 * computes (review-panel.mjs:200):
 *
 *     const globs = lens.appliesWhen ?? ["**"];
 *     if (globs.length === 0 || globs.includes("**")) return true;
 *
 * So absent, empty, and any list CONTAINING `"**"` are all the same reviewer — it
 * runs on everything. Collapsing them here is what stops `["**"]` and
 * `["**", "packages/**"]` from splitting one population in two.
 */
function canonicalAppliesWhen(lens) {
  const declared = lens.appliesWhen;
  if (!Array.isArray(declared) || declared.length === 0) return ["**"];
  const globs = declared.map(String);
  return globs.includes("**") ? ["**"] : canonicalSet(globs);
}

/**
 * The file classes a lens READS, in the effective form `lensScope` computes
 * (review-panel.mjs:345):
 *
 *     new Set(Array.isArray(declared) && declared.length > 0 ? declared : FILE_CLASSES)
 *
 * Absent means EVERYTHING, not nothing — "an omission must fail toward more
 * review, not toward a silently empty diff". Normalising to the panel's effective
 * value is what makes a lens that omits the field hash identically to one that
 * lists all five classes, which it behaves identically to. Hashing the raw absent
 * value instead would fix one divergence and open another of the same shape.
 *
 * OVER-SENSITIVE, knowingly: an unrecognised class (`["banana"]`) is kept rather
 * than intersected with FILE_CLASSES, so it hashes distinctly from any other
 * unrecognised class even though both select no hunks at all. Intersecting would
 * mean modelling `classifyFile`'s whole range here, and the case is a manifest bug
 * nothing else validates either. Splitting a population is the recoverable
 * direction.
 */
function canonicalScopeClasses(lens) {
  const declared = lens.scopeClasses;
  const classes = Array.isArray(declared) && declared.length > 0 ? declared : FILE_CLASSES;
  return canonicalSet(classes);
}

/**
 * One lens reduced to what it makes the reviewer DO. Every default is the panel's
 * own, taken from the panel wherever the panel exposes it, so an omitted field
 * hashes identically to its explicit default.
 */
function normalizeLens(l) {
  const lens = l || {};
  return {
    id: String(lens.id ?? ""),
    title: String(lens.title ?? ""),
    // OVER-SENSITIVE: absent normalises to "", which is NOT the SDK's default
    // model — the SDK does not publish one, so there is no value to normalise to.
    // A lens omitting `model` therefore hashes differently from one naming
    // whatever the SDK would have picked. Splitting, not merging.
    model: String(lens.model ?? ""),
    // The panel's OWN function, imported rather than mirrored. The fork's copy
    // (`Math.max(1, Number(lens.samples) || 2)`) agreed on the default of 2 and
    // still diverged on two inputs, both splitting a population: `2.5` hashed as
    // 2.5 while the panel floors it to 2, and `1e999` hashed as Infinity while the
    // panel rejects non-finite values back to 2. `sampleCountFor` is exported
    // precisely because "three call sites have to agree EXACTLY"; this is the
    // fourth.
    samples: sampleCountFor(lens),
    // `gating` is a STRING in the manifest and a BOOLEAN in effect. Both consumers
    // collapse it the same way — review-panel.mjs:2410 and
    // agent-review-panel.yml:847 both compute
    // `String(lens.gating ?? "blocking") === "blocking"` — so "advisory" and a
    // typo'd "blockign" are the same reviewer, and hashing the raw string would
    // split them. Canonicalised under its manifest key so the hashed-field list
    // stays readable against `lenses.json`.
    gating: String(lens.gating ?? "blocking") === "blocking",
    // Read as a truthiness test at review-panel.mjs:1686 (`lens.needsIssueSpec &&
    // issue`), so absent, false, 0 and "" are one reviewer.
    needsIssueSpec: !!lens.needsIssueSpec,
    appliesWhen: canonicalAppliesWhen(lens),
    scopeClasses: canonicalScopeClasses(lens),
    // See DEFAULT_EFFORT. Anything present passes through as written, including a
    // value `assertEffort` would reject: the panel refuses to start on an invalid
    // effort, so there is no behaviour for it to be equivalent TO. Deliberately no
    // validation here — this is a read path, and read paths in this codebase do not
    // throw. `buildConfig` is the write path and it does validate.
    effort: lens.effort === undefined ? DEFAULT_EFFORT : String(lens.effort),
    // A turn ceiling is behaviour-determining and was missing from the hash
    // entirely. It is not hypothetical: capping `docs` at 8 turns made it die on
    // `error_max_turns`, which fails a BLOCKING lens closed and pages a human
    // (review-panel.mjs:1773-1782). No lens sets one today, which is exactly why
    // it went unnoticed — a field absent from `lenses.json` is invisible to a
    // guard that only reads `lenses.json`, so the guard also reads the panel.
    //
    // `Number.isFinite(...) ? … : null` mirrors `buildSessionOptions`'s own
    // predicate: only a finite number reaches the SDK, so `"8"`, null and absent
    // are one reviewer (the SDK default), represented by the sentinel `null`
    // because the SDK publishes no numeric default to normalise to.
    maxTurns: Number.isFinite(lens.maxTurns) ? lens.maxTurns : null,
    rubric_sha256: String(lens.rubric_sha256 ?? ""),
  };
}

/** Recursively sort object keys (arrays keep their order — callers pre-sort any
 * array that is semantically a set). Produces a canonical, stable ordering. */
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
    return out;
  }
  return v;
}

/**
 * Compare two lens ids by CODE UNIT, deterministically.
 *
 * NOT `localeCompare`. Its default collation comes from the runtime environment —
 * ICU data plus `LC_ALL`/`LANG` — so it is a different function on two machines, and
 * a hash whose sort order depends on the machine is a hash that splits a population
 * for no behavioural reason. Measured, not theorised: one manifest with lenses `ch`
 * and `hz` sorts `[ch, hz]` under `en-US` and `[hz, ch]` under `cs-CZ` (Czech
 * collates `ch` as a single letter after `h`), giving two different `config_hash`
 * values for the same reviewer. CI runs one locale and a laptop another, so the
 * disagreement would surface as results that will not pool, with nothing anywhere
 * saying why.
 */
function compareLensId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The canonical string hashed for identity — behaviour-determining fields only,
 * lenses sorted by id, keys sorted recursively, no whitespace. */
export function canonicalConfig(manifest) {
  const m = manifest || {};
  const lenses = (Array.isArray(m.lenses) ? m.lenses : [])
    .map(normalizeLens)
    .sort(compareLensId); // lens order in the file never affects identity
  return JSON.stringify(sortKeysDeep({ target: String(m.target ?? ""), lenses }));
}

export function sha256Hex(str) {
  return createHash("sha256").update(String(str ?? ""), "utf8").digest("hex");
}

/** Identity of a reviewer's CONFIGURATION: "sha256:<hex>" over canonicalConfig. Pair
 * it with `panelSha` to identify the reviewer — see the header. */
export function configHash(manifest) {
  return `sha256:${sha256Hex(canonicalConfig(manifest))}`;
}

/** Content hash of a rubric (or any text): "sha256:<hex>". Used for
 * lens.rubric_sha256 so config identity reacts to rubric wording changes. */
export function contentHash(text) {
  return `sha256:${sha256Hex(text)}`;
}
