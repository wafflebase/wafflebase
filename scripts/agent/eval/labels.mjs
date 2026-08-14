// GROUND TRUTH ABOUT THE CODE — the label record, its vocabularies, its paths and
// the refusals that stand between a judgement and the disk.
//
// Every number the benchmark can produce today is about VOLUME: how much each
// reviewer says, how consistently it says it, what it costs. None of them is about
// whether any of it is TRUE, because truth needs a label — an independent reading
// of the diff that says "this finding describes a real defect" or "this claim is
// wrong about the code". Precision, relative recall and the false-positive profile
// are all computed against these records and against nothing else.
//
// THE ONE THING THIS FILE EXISTS TO PREVENT: a label written from the panel's own
// verdict. `labels/ANNOTATION-GUIDE.md` §0 states the rule — "the panel's output is
// the thing we are grading; using it to write the label is circular" — and the
// failure has no symptom. A dataset built by confirming the panel's findings
// produces a precision figure that is higher, publishable, and wrong, with nothing
// in the pipeline able to detect it. So the guard is structural and it stands here,
// in the write path: `adjudication.presented_fields` is checked against
// `BLINDED_FROM_ADJUDICATION`, and a label whose own record says the adjudicator was
// shown the panel's severity is REFUSED rather than stored. `adjudicate.mjs` cannot
// present those fields — it never holds them — and this is the second, independent
// door, for the reason lesson 7 gives: a validator only guards the door it stands
// in, and the door this one stands in is "may these bytes exist".
//
// WHY THE SCHEMA IS HERE AND NOT IN `store.mjs`. The annotation guide says labels
// are stamped by `putFindingLabel` and checked by `store.labelStatus()`. NEITHER
// EXISTS: the only trace in the store is a comment reading "`labelStatus`'s drift
// check (PR 16)", i.e. a deliverable that was planned and never built. Rather than
// add two methods to a module whose other consumers are mid-flight, this follows
// `finding-record.mjs`'s precedent — the schema, its builder, its validator and its
// census in one file, with the store used only for the root and for the corpus item
// the drift guard compares against.
//
// SO THIS VALIDATOR IS THE ONLY DRIFT CHECKER THAT EXISTS. Guide §8 wants the
// item's current `sha256_diff` stamped into `diff_sha256` and expects
// `store.labelStatus()` to report `stale` on a mismatch. With no such function, a
// label written against a diff that no longer exists would silently score the wrong
// code — this project's signature failure, one level up from the code. So
// `validateLabel` REFUSES a mismatch at write time, which is earlier and louder
// than reporting it at read time.

import path from "node:path";
import { BLOCKING, KNOWN } from "../severity.mjs";
import { ARMS } from "./finding-record.mjs";
// The ONE hash helper. `store.mjs`'s own docblock is the instruction: "two hash
// helpers with the same output format is how `sha256_diff` and a label's
// `diff_sha256` come to be computed differently and compare unequal forever."
import { contentSha256 } from "./store.mjs";

/**
 * Bumped when a field changes meaning, never when one is added.
 *
 * ⚠ It starts at 1 even though `labels/2026-07-28-pilot/` already holds seven
 * hand-written finding labels and four item labels. Those carry no
 * `schema_version` at all, so `validateLabel` refuses them, and that is the
 * intended behaviour rather than an oversight: they were written against
 * `2026-07-28-pilot`, a corpus version that no longer exists (the 2026-08-10
 * re-freeze replaced it), and blessing them under a schema they were not written to
 * would re-admit labels whose `diff_sha256` refers to a diff nobody can produce.
 * They are irreplaceable human work and are never rewritten or deleted; they are
 * simply not readable as records of this schema.
 */
export const SCHEMA_VERSION = 1;

/**
 * The two records the guide defines, named in the record itself rather than
 * inferred from its path.
 *
 * `pairs/<pair_key>.json` is a THIRD label type, written by a different session
 * under the same corpus version, and it names itself `pair-label` in the same
 * field. Deliberately not listed here: this module neither writes nor validates
 * pair verdicts, and a vocabulary that named it would imply it did.
 */
export const LABEL_SCHEMAS = Object.freeze(["item-label", "finding-label"]);

/**
 * The trust tier (guide §6), and the field this whole module is most careful with.
 *
 *   gold     a qualified HUMAN read the diff blind and adjudicated. The IAA ceiling
 *            is computed over these, which is why nothing else may be filed as one.
 *   silver   a weaker adjudication — an AI read-through, or several noisy signals
 *            merged — pending human confirmation.
 *   distant  inferred from a natural experiment with no per-item reading (a revert,
 *            an injected bug).
 */
export const LABEL_SOURCES = Object.freeze(["gold", "silver", "distant"]);

/** Guide §7. NEVER DEFAULTED — see `requireConfidence`. */
export const CONFIDENCE = Object.freeze(["high", "medium", "low"]);

/** Guide §5 — the corpus stratum, so metrics can slice by it. */
export const STRATA = Object.freeze(["benign", "known-defect", "reverted"]);

/** Guide §3 — the correct gate verdict, under the shipped gate's own rule. */
export const VERDICT_LABELS = Object.freeze(["block", "approve", "borderline"]);

/**
 * WHO ACTUALLY READ THE CODE. Two values, and the pair `(mode, annotators)` is
 * checked in both directions.
 *
 * The guide is explicit about the failure: "do not launder an AI read into a human
 * id, or a future IAA pass will treat two AI reads as independent human agreement."
 * That is a silent corruption of the one number the labelled dataset exists to
 * bound, so `mode: "model"` requires every annotator to look like a model id and
 * `mode: "human"` requires that none of them does. A model id under a human mode is
 * the same mistake pointing the other way and is refused too — not because it is
 * dangerous, but because one of the two fields is then wrong and there is no way to
 * tell which.
 */
export const ADJUDICATION_MODES = Object.freeze(["human", "model"]);

/**
 * What the adjudicator did with a pre-filled suggestion.
 *
 * A pre-fill is a TRIAGE PRIOR, never a label. Two AI reviewers agreeing is
 * evidence, and it is also exactly what a shared hallucination looks like — so a
 * suggestion may only ever arrive as something a human confirms or overrides.
 * `accepted-unreviewed` is the value that spells "written without a human
 * decision", and it exists so that state is nameable and therefore refusable:
 * `gold` requires one of the other three.
 */
export const SUGGESTION_OUTCOMES = Object.freeze(["confirmed", "overridden", "accepted-unreviewed", "not-shown"]);

/**
 * WHAT `finding_key` MEANS on a given label, so a future key rule is a value here
 * rather than a silent change of meaning in place.
 *
 * One value today: the panel's own `findingKey(f)` = `` `${file}::${lowercased
 * trimmed summary}` `` (`finding-key.mjs:40`), which is the identity the verifier
 * artifact and `review-lens-stats.json` both carry, so a label joins onto a finding
 * record with no fuzzy matching.
 *
 * ⚠ IT HASHES THE SUMMARY, so a label's key moves when a reviewer's wording is
 * re-parsed. That is a live cost, not a hypothetical — see `parser_vintage`.
 */
export const KEY_BASES = Object.freeze(["finding-key"]);

/**
 * THE FOUR THINGS AN ADJUDICATOR MUST NEVER HAVE BEEN SHOWN, named as a vocabulary
 * so the prohibition is data rather than prose.
 *
 * Guide §0 rule 1 requires reading the diff and deciding for yourself; if panel
 * output must be seen at all, "record your own `is_real` judgement from the CODE,
 * not from whether the panel kept it." Note what is NOT on this list: the CLAIM
 * itself. You cannot judge a claim you cannot read, and hiding it would make the
 * task impossible rather than blind. What must be hidden is the panel's JUDGEMENT
 * of that claim — and each of these four is a way of leaking it:
 *
 *   panel-severity        "the panel called this major" — supplies the answer to
 *                         the annotator's own `severity` field.
 *   verifier-verdict      "the verifier confirmed it" — supplies `is_real` and
 *                         makes V1's confusion matrix a tautology.
 *   gate-outcome          "this blocked the merge" — supplies `verdict_label`.
 *   other-arm-agreement   "CodeRabbit found this too" — the shared-hallucination
 *                         prior, and the one that looks most like evidence.
 *
 * `adjudication.presented_fields` is checked against this set, so a label recording
 * that any of them was on screen is refused. A CLI that shows one and does not say
 * so defeats this, which is why `adjudicate.mjs` builds its payload by allowlist
 * and never holds the fields at all — two doors, on purpose.
 */
export const BLINDED_FROM_ADJUDICATION = Object.freeze([
  "panel-severity",
  "verifier-verdict",
  "gate-outcome",
  "other-arm-agreement",
]);

/** The subdirectory of an eval-data root that labels live under. */
export const LABELS_DIR = "labels";

/**
 * Model-id prefixes, for the `(mode, annotators)` check.
 *
 * DECLARED RATHER THAN INFERRED, and the fail direction is chosen: an id this list
 * does not recognise is refused under `mode: "model"` and accepted under
 * `mode: "human"`. So a model released after this list was written costs a loud
 * refusal ("name it here"), never a silent `gold` label carrying an AI read. Human
 * ids are arbitrary logins and cannot be recognised positively, so the check has to
 * run this way round.
 */
export const MODEL_ID_PREFIXES = Object.freeze(["claude", "gpt", "o1", "o3", "o4", "gemini", "llama", "mistral", "deepseek", "qwen", "grok"]);

/**
 * Same grammar `store.mjs` applies to an item id and a corpus version, and for the
 * same reason: both become PATH SEGMENTS, so both are validated rather than
 * sanitised. Re-stated here rather than imported because it is private there, and
 * the alternative — exporting it — means editing a module another open PR owns.
 * A drift between the two would be caught immediately: a segment this accepts and
 * the store rejects cannot be read back through `getCorpusItemInput`.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256_TEXT = /^sha256:[0-9a-f]{64}$/;
const SHA256_PREFIX = "sha256:";

const refuse = (msg) => {
  throw new Error(`label: ${msg}`);
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/** Does this annotator id name a model rather than a person? See `MODEL_ID_PREFIXES`. */
export function looksLikeModelId(id) {
  const s = String(id ?? "").toLowerCase().trim();
  return MODEL_ID_PREFIXES.some((p) => s === p || s.startsWith(`${p}-`) || s.startsWith(`${p}.`) || s.startsWith(`${p}/`));
}

/**
 * The two halves of a `finding_key`, or `null` when it is not a key at all.
 *
 * `findingKey` IS ALLOWED TO COLLIDE and this is where that is stopped. It returns
 * `` `${file ?? ""}::${summary.toLowerCase().trim()}` ``, and
 * `validateFindingRecord` accepts `summary: ""` (a known unowned defect) — so every
 * empty-summary finding in one file produces the identical key `file::`, and a label
 * written under it silently overwrites another label about a different claim.
 * Refusing the key is the only fix available from this side: the alternative is one
 * file on disk that two findings both believe is theirs.
 *
 * An empty FILE half is different and is allowed. `file` is genuinely absent on
 * some findings (2 of the pilot's 428 panel records), the summary still separates
 * them, and refusing it would make those findings permanently unlabellable — a
 * measurable loss of recall data to prevent a collision that cannot occur.
 */
export function splitFindingKey(key) {
  if (typeof key !== "string") return null;
  const at = key.indexOf("::");
  if (at < 0) return null;
  return { file: key.slice(0, at), summary: key.slice(at + 2) };
}

function requireFindingKey(key) {
  const parts = splitFindingKey(key);
  if (!parts) {
    refuse(`finding_key must contain the "::" separator, got ${JSON.stringify(key)} — it is \`file::summary\`, produced by findingKey()`);
  }
  if (parts.summary.trim() === "") {
    refuse(
      `finding_key ${JSON.stringify(key)} has an EMPTY summary half, so it is the same key for every ` +
        `empty-summary finding in that file — one label would overwrite another silently. Refused rather than written.`,
    );
  }
  return key;
}

function requireSegment(what, value) {
  if (typeof value !== "string" || !SEGMENT.test(value)) {
    refuse(`${what} must match ${SEGMENT.source}, got ${JSON.stringify(value)} — it becomes a path segment`);
  }
  return value;
}

function requireEnum(what, value, vocabulary) {
  if (!vocabulary.includes(value)) {
    refuse(`${what} must be one of ${vocabulary.join(" | ")}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * `confidence` is REQUIRED and has no default, which is a deliberate departure from
 * every other optional field here.
 *
 * Guide §7: "absence-of-defect is inherently harder to prove than presence — a
 * `benign` label over a large diff should rarely be `high` without tests or a
 * captured clean verdict backing it." A default would land on whichever value the
 * code picked, for hundreds of labels, and `high` is the value a hurried default
 * tends to be. So there is no default at all: the annotator states it or the label
 * is not written.
 */
function requireConfidence(value) {
  if (value === undefined || value === null) {
    refuse(`confidence is required and has no default — say high | medium | low; absence of a defect is harder to prove than presence`);
  }
  return requireEnum("confidence", value, CONFIDENCE);
}

/**
 * Everything about WHO adjudicated and WHAT THEY SAW, validated as one object
 * because the fields only mean anything together.
 */
function validateAdjudication(a, { labelSource }) {
  if (!isPlainObject(a)) {
    refuse(`adjudication must be an object recording who judged and what they saw, got ${JSON.stringify(a)}`);
  }
  requireEnum("adjudication.mode", a.mode, ADJUDICATION_MODES);
  requireEnum("adjudication.suggestion_outcome", a.suggestion_outcome, SUGGESTION_OUTCOMES);
  for (const field of ["presented_fields", "withheld_fields"]) {
    if (!(Array.isArray(a[field]) && a[field].length > 0 && a[field].every(nonEmptyString))) {
      refuse(`adjudication.${field} must be a non-empty array of strings — what was on screen is part of the label, not a detail of the tool`);
    }
  }
  // The write-path half of the blinding guard. A label that ADMITS the panel's
  // verdict was on screen is refused, so the circular dataset cannot be stored even
  // by a tool that was honest about producing one.
  const leaked = a.presented_fields.filter((f) => BLINDED_FROM_ADJUDICATION.includes(f));
  if (leaked.length > 0) {
    refuse(
      `adjudication.presented_fields names ${leaked.join(", ")} — the panel's own judgement of a claim may never be ` +
        `shown to the adjudicator, because a label produced by confirming it grades the panel against itself`,
    );
  }
  if (labelSource === "gold") {
    // Two independent doors on one failure: a model read filed as gold, and a
    // pre-fill accepted with nobody looking. Either alone would let a `silver`
    // judgement sit behind the tier the IAA ceiling is computed over.
    if (a.mode !== "human") {
      refuse(`label_source "gold" requires adjudication.mode "human", got ${JSON.stringify(a.mode)} — an AI read-through is silver even when confident (guide §6)`);
    }
    if (a.suggestion_outcome === "accepted-unreviewed") {
      refuse(`label_source "gold" cannot carry suggestion_outcome "accepted-unreviewed" — a pre-fill nobody confirmed is a triage prior, not a human adjudication`);
    }
  }
  return a;
}

function validateAnnotators(annotators, { mode }) {
  if (!(Array.isArray(annotators) && annotators.length > 0 && annotators.every(nonEmptyString))) {
    refuse(`annotators must be a non-empty array of ids — a label nobody is attributed to cannot be weighed against a second annotator`);
  }
  const modelish = annotators.filter((id) => looksLikeModelId(id));
  if (mode === "model" && modelish.length !== annotators.length) {
    const human = annotators.filter((id) => !looksLikeModelId(id));
    refuse(
      `adjudication.mode "model" but annotators names ${human.join(", ")}, which is not a recognised model id — ` +
        `attribute an AI read to the model that produced it. Laundering it into a human id makes a future IAA pass ` +
        `treat two AI reads as independent human agreement (guide §7)`,
    );
  }
  if (mode === "human" && modelish.length > 0) {
    refuse(`adjudication.mode "human" but annotators names the model id(s) ${modelish.join(", ")} — one of the two fields is wrong and there is no way to tell which`);
  }
  return annotators;
}

/**
 * The drift guard (guide §8), and the only one that will exist.
 *
 * `itemMeta` is the corpus item's `meta.json`. When it is supplied the label's
 * `diff_sha256` must equal its `sha256_diff` — a label written against a diff that
 * has since been re-extracted scores code that no longer exists, and it does so
 * silently, which is lesson 1 exactly. When it is NOT supplied the field is still
 * required to be present and well-formed: a label with no drift stamp can never be
 * checked later, so it is refused at the only moment the stamp is obtainable.
 */
function validateDiffSha(label, itemMeta) {
  if (!SHA256_TEXT.test(String(label.diff_sha256 ?? ""))) {
    refuse(`diff_sha256 must be "sha256:<64 hex>", got ${JSON.stringify(label.diff_sha256)} — it is the drift guard and an unstamped label can never be checked`);
  }
  if (itemMeta === undefined || itemMeta === null) return;
  if (!isPlainObject(itemMeta)) refuse(`itemMeta must be a corpus item's meta.json object, got ${JSON.stringify(itemMeta)}`);
  if (itemMeta.id !== label.item_id) {
    refuse(`itemMeta.id ${JSON.stringify(itemMeta.id)} is not this label's item ${JSON.stringify(label.item_id)} — checking drift against the wrong item proves nothing`);
  }
  if (itemMeta.sha256_diff !== label.diff_sha256) {
    refuse(
      `diff_sha256 ${label.diff_sha256} does not match ${label.item_id}'s current sha256_diff ${itemMeta.sha256_diff} — ` +
        `the diff was re-extracted after this label was written, so the label is STALE. Re-adjudicate against the current diff ` +
        `and overwrite it; scoring it would grade code that is no longer in the corpus`,
    );
  }
}

function validateTrueDefects(defects) {
  if (!Array.isArray(defects)) {
    refuse(`true_defects must be an array — [] is the affirmative claim "I read the diff and found no real defect", which is a label; a missing field is not`);
  }
  defects.forEach((d, i) => {
    if (!isPlainObject(d)) refuse(`true_defects[${i}] must be an object, got ${JSON.stringify(d)}`);
    if (!(d.file === null || typeof d.file === "string")) refuse(`true_defects[${i}].file must be a string or null, got ${JSON.stringify(d.file)}`);
    requireEnum(`true_defects[${i}].severity`, d.severity, KNOWN);
    if (!nonEmptyString(d.description)) {
      refuse(`true_defects[${i}].description must say what is wrong and why it is a defect, got ${JSON.stringify(d.description)}`);
    }
    if (d.line_range !== null && d.line_range !== undefined) {
      const r = d.line_range;
      const ok = Array.isArray(r) && r.length === 2 && r.every((n) => Number.isInteger(n) && n >= 1) && r[1] >= r[0];
      if (!ok) refuse(`true_defects[${i}].line_range must be [start, end] in the diff's new-file line numbers with end >= start >= 1, got ${JSON.stringify(r)}`);
    }
  });
  return defects;
}

/**
 * One judgement about one finding → one record. Guide §1.2, widened by `arm`.
 *
 * ⚠ THE GUIDE'S FINDING RECORD IS PANEL-ONLY — §1.2 reads "truth about one specific
 * finding THE PANEL raised" — and the headline metrics are all two-armed. Precision,
 * relative recall and the false-positive profile each need CodeRabbit's findings
 * labelled too, and the guide predates the two-arm design so it has no shape for
 * them. `arm` is that shape, and its vocabulary is `finding-record.mjs`'s frozen
 * `ARMS` rather than a second list.
 *
 * `severity` IS THE ANNOTATOR'S OWN, never the panel's, and the scale is
 * `severity.mjs`'s `KNOWN` — imported, not restated, because the gate's own
 * definition of what blocks is the one a `verdict_label` has to agree with.
 *
 * Refuses rather than degrades. This is the write path, and the house rule for it is
 * absolute: read paths degrade to fewer records, the single write path refuses on
 * any doubt.
 */
export function buildFindingLabel({
  corpusVersion,
  itemId,
  arm,
  findingKey: key,
  keyBasis = "finding-key",
  parserVintage = null,
  isReal,
  shouldVerifierKeep,
  severity,
  kind = null,
  labelSource,
  annotators,
  adjudication,
  confidence,
  evidence = null,
  notes = null,
  diffSha256,
  classId = null,
  classMembers = null,
} = {}) {
  requireSegment("corpus_version", corpusVersion);
  requireSegment("item_id", itemId);
  requireEnum("arm", arm, ARMS);
  requireFindingKey(key);
  requireEnum("key_basis", keyBasis, KEY_BASES);
  if (typeof isReal !== "boolean") {
    refuse(`is_real must be true or false, got ${JSON.stringify(isReal)} — it is the core judgement and has no "probably"`);
  }
  const keep = typeof shouldVerifierKeep === "boolean" ? shouldVerifierKeep : isReal;
  requireEnum("severity", severity, KNOWN);
  requireEnum("label_source", labelSource, LABEL_SOURCES);
  const label = {
    schema: "finding-label",
    schema_version: SCHEMA_VERSION,
    corpus_version: corpusVersion,
    item_id: itemId,
    arm,
    finding_key: key,
    key_basis: keyBasis,
    // Which parse of the reviewer's own words produced that key. See
    // `validateLabel` for why it is required on one arm and refused on the other.
    parser_vintage: nonEmptyString(parserVintage) ? parserVintage : null,
    is_real: isReal,
    should_verifier_keep: keep,
    severity,
    kind: nonEmptyString(kind) ? kind : null,
    label_source: labelSource,
    annotators: Array.isArray(annotators) ? [...annotators] : annotators,
    adjudication,
    confidence: requireConfidence(confidence),
    evidence: nonEmptyString(evidence) ? evidence : null,
    notes: nonEmptyString(notes) ? notes : null,
    diff_sha256: diffSha256,
    // Bundle provenance: this judgement was made once, over these keys. Carried on
    // every member so a later IAA pass cannot mistake N labels from one reading for
    // N independent readings — the same non-independence the guide warns about for
    // annotator ids, one unit up.
    class_id: nonEmptyString(classId) ? classId : null,
    class_members: Array.isArray(classMembers) && classMembers.length > 0 ? [...classMembers] : null,
  };
  return validateLabel(label);
}

/**
 * The PR-level verdict truth (guide §1.1), which feeds gate validity (V3).
 *
 * `true_defects[]` is the part that cannot be derived from anything the panel
 * produced: it lists every real defect the pull request contains INCLUDING the ones
 * no reviewer found, and those are what recall is measured against. That is why
 * this record is never computed from finding labels — a set built from findings
 * cannot contain a miss.
 */
export function buildItemLabel({
  corpusVersion,
  itemId,
  verdictLabel,
  primaryDefectClass = null,
  trueDefects,
  stratum,
  labelSource,
  annotators,
  adjudication,
  confidence,
  evidence = null,
  notes = null,
  diffSha256,
} = {}) {
  requireSegment("corpus_version", corpusVersion);
  requireSegment("item_id", itemId);
  requireEnum("verdict_label", verdictLabel, VERDICT_LABELS);
  requireEnum("stratum", stratum, STRATA);
  requireEnum("label_source", labelSource, LABEL_SOURCES);
  const label = {
    schema: "item-label",
    schema_version: SCHEMA_VERSION,
    item_id: itemId,
    corpus_version: corpusVersion,
    verdict_label: verdictLabel,
    primary_defect_class: nonEmptyString(primaryDefectClass) ? primaryDefectClass : null,
    true_defects: Array.isArray(trueDefects) ? trueDefects.map((d) => ({ ...d })) : trueDefects,
    stratum,
    label_source: labelSource,
    annotators: Array.isArray(annotators) ? [...annotators] : annotators,
    adjudication,
    confidence: requireConfidence(confidence),
    evidence: nonEmptyString(evidence) ? evidence : null,
    notes: nonEmptyString(notes) ? notes : null,
    diff_sha256: diffSha256,
  };
  return validateLabel(label);
}

/**
 * Everything that must be true of a label before it may be written.
 *
 * Strict, and it throws. Two expressions of one schema — this and the builders —
 * and the point of running both is that a future edit to one has to survive the
 * other, which is `finding-record.mjs`'s reasoning and holds here for a record
 * whose cost of being wrong is a wrong precision figure.
 *
 * WIDENS, NEVER NARROWS on unknown fields: a field the annotation guide adds
 * tomorrow survives a validator that has never heard of it. A validator is allowed
 * to demand fields, never to decide the full list — `store.mjs`'s
 * `validateCorpusItem` established that and it is the convention the finding
 * adapters broke twice.
 *
 * `itemMeta`, when given, turns on the drift check. It is optional only because a
 * caller may legitimately validate a label's SHAPE without a store to hand (a test,
 * a hand-edited file); the CLI always passes it, and the field itself is required
 * either way.
 */
export function validateLabel(label, { itemMeta = null } = {}) {
  if (!isPlainObject(label)) refuse(`a label must be a JSON object, got ${JSON.stringify(label)}`);
  requireEnum("schema", label.schema, LABEL_SCHEMAS);
  if (label.schema_version !== SCHEMA_VERSION) {
    refuse(`schema_version must be ${SCHEMA_VERSION}, got ${JSON.stringify(label.schema_version)}`);
  }
  requireSegment("item_id", label.item_id);
  requireSegment("corpus_version", label.corpus_version);
  requireEnum("label_source", label.label_source, LABEL_SOURCES);
  validateAdjudication(label.adjudication, { labelSource: label.label_source });
  validateAnnotators(label.annotators, { mode: label.adjudication.mode });
  requireConfidence(label.confidence);
  for (const field of ["evidence", "notes"]) {
    if (!(label[field] === null || typeof label[field] === "string")) {
      refuse(`${field} must be a string or null, got ${JSON.stringify(label[field])}`);
    }
  }
  validateDiffSha(label, itemMeta);

  if (label.schema === "finding-label") {
    requireEnum("arm", label.arm, ARMS);
    requireFindingKey(label.finding_key);
    requireEnum("key_basis", label.key_basis, KEY_BASES);
    for (const field of ["is_real", "should_verifier_keep"]) {
      if (typeof label[field] !== "boolean") refuse(`${field} must be true or false, got ${JSON.stringify(label[field])}`);
    }
    requireEnum("severity", label.severity, KNOWN);
    // Guide §2: `should_verifier_keep` normally MIRRORS `is_real`, and diverges only
    // in a deliberate edge case — "when it diverges from `is_real`, `notes` must
    // explain why". An unexplained divergence is indistinguishable from a typo, and
    // it lands in V1's confusion matrix either way.
    if (label.should_verifier_keep !== label.is_real && !nonEmptyString(label.notes)) {
      refuse(
        `should_verifier_keep ${label.should_verifier_keep} diverges from is_real ${label.is_real} with no notes — ` +
          `the divergence is a deliberate edge case (guide §2) and an unexplained one reads as a mistake`,
      );
    }
    // A CodeRabbit `finding_key` hashes a summary WE parsed out of its markdown, and
    // that parse is being corrected: #801 repairs 38 of 1588 inline titles and
    // restores 200 emptied details, which moves 1 of the pilot's 30 corpus records'
    // summaries. So a CodeRabbit label carries the vintage of the parser that
    // produced its key, and a stale key becomes DETECTABLE by comparison instead of
    // being an orphan nobody can explain. Our own findings are unaffected — the
    // panel writes its summary itself and nothing downstream rewrites it — so
    // demanding the field there would record a vintage that means nothing.
    if (label.arm === "coderabbit" && !nonEmptyString(label.parser_vintage)) {
      refuse(
        `a coderabbit label needs parser_vintage — its finding_key hashes a summary we parsed out of CodeRabbit's markdown, ` +
          `and that parser is being corrected, so a label with no parser vintage cannot be told from a current one`,
      );
    }
    if (!(label.class_members === null || (Array.isArray(label.class_members) && label.class_members.includes(label.finding_key)))) {
      refuse(`class_members must be null or contain this label's own finding_key — a bundle this finding is not in is not this finding's provenance`);
    }
    return label;
  }

  // --- item label -----------------------------------------------------------
  requireEnum("verdict_label", label.verdict_label, VERDICT_LABELS);
  requireEnum("stratum", label.stratum, STRATA);
  validateTrueDefects(label.true_defects);
  // THE GATE, AS A PURE FUNCTION, applied to the annotator's own defect set: the
  // shipped rule is APPROVE iff the PR has zero real critical/major defects, so
  // `block` ⟺ at least one blocking `true_defect`. Guide §3 calls the other
  // combination a contradiction, and it is: an `approve` beside a major defect means
  // one of the two fields is wrong and V3 would score the disagreement as the
  // panel's error. `BLOCKING` is imported from `severity.mjs` so this can never
  // drift from what actually stops a merge.
  const blocking = label.true_defects.filter((d) => BLOCKING.has(d.severity));
  if (label.verdict_label === "block" && blocking.length === 0) {
    refuse(`verdict_label "block" with no critical/major true_defect — the shipped gate blocks on exactly that, so name the defect or label it approve/borderline`);
  }
  if (label.verdict_label === "approve" && blocking.length > 0) {
    refuse(
      `verdict_label "approve" beside ${blocking.length} critical/major true_defect(s) — under the shipped gate that is a contradiction (guide §3); ` +
        `fix one or the other, or use "borderline" and say what the tension is in notes`,
    );
  }
  // Guide §1.1: `primary_defect_class` is `null` when `approve`. A dominant defect
  // kind on a PR with no blocking defect is a claim about nothing.
  if (label.verdict_label === "approve" && label.primary_defect_class !== null) {
    refuse(`primary_defect_class must be null when verdict_label is "approve", got ${JSON.stringify(label.primary_defect_class)}`);
  }
  // Guide §3: `borderline` items are excluded from strict scoring and reported
  // separately, which is only useful if the record says what the tension was.
  if (label.verdict_label === "borderline" && !nonEmptyString(label.notes)) {
    refuse(`verdict_label "borderline" requires notes saying what the tension is (guide §3) — it is excluded from strict scoring and reported separately`);
  }
  // Guide §7, stated as a requirement rather than as advice: a `benign` label is a
  // claim that something is ABSENT over a whole diff, and absence is harder to prove
  // than presence. `high` is not forbidden — it is allowed only with the backing
  // written down, which is what "rarely `high` without tests or a captured clean
  // verdict backing it" means operationally.
  if (label.stratum === "benign" && label.confidence === "high" && !nonEmptyString(label.evidence) && !nonEmptyString(label.notes)) {
    refuse(
      `a benign item at confidence "high" needs evidence or notes naming what backs it (tests, a captured clean verdict) — ` +
        `absence of a defect over a whole diff is harder to prove than presence (guide §7)`,
    );
  }
  return label;
}

/**
 * A label's identity WITHIN a corpus version: the arm plus the finding key.
 *
 * Both halves are load-bearing. `findingKey` is `(file, summary)` and nothing in it
 * says who raised the claim, so two arms can produce the identical key for the
 * identical wording — and a single label then carries an `arm` field that is wrong
 * for one of them, while per-arm precision silently reads one arm's judgement as the
 * other's. One helper, used by the path builder and by the resume check, so the two
 * cannot disagree about what "already labelled" means.
 */
export function armKeyOf(arm, findingKey) {
  return `${arm}/${findingKey}`;
}

/**
 * Where a label lives, absolutely.
 *
 *   item     `labels/<cv>/<item>.json`                                  — guide §1.1
 *   finding  `labels/<cv>/findings/<item>/<arm>/<sha256(finding_key)>.json`
 *
 * THE FILENAME IS THE BARE HEX of `sha256(finding_key)`, which is the guide's own
 * rule, verified against the store: all seven hand-written finding labels under
 * `2026-07-28-pilot/findings/pr-521/` reproduce their filename exactly. Hashing
 * rather than escaping is what makes a key containing `/` safe as one path segment.
 *
 * ⚠ THE `<arm>` SEGMENT IS AN ADDITION TO THE GUIDE'S LAYOUT, and it is the same
 * widening `arm` is on the record. §1.2 defines a finding label as truth about "one
 * specific finding THE PANEL raised", so the guide's path has one key space; with two
 * arms it needs two, or the collision above is unrepresentable rather than avoided.
 * The consequence is stated rather than hidden: a panel label written under the
 * guide's exact path is at `findings/<item>/<hash>.json` and this builder puts it at
 * `findings/<item>/panel/<hash>.json`. Nothing reads the old location — the seven
 * that exist are under a retired corpus version and are never rewritten.
 *
 * `pairs/` under the same corpus version belongs to a different label type and a
 * different session. Nothing here reads or writes it.
 */
export function labelPathFor({ root, corpusVersion, schema, itemId, arm, findingKey: key } = {}) {
  if (!nonEmptyString(root)) {
    refuse(
      `a root directory is required and has no default — git history is permanent, so a forgotten one that fell back ` +
        `to a path inside this repository would commit label data into wafflebase for good`,
    );
  }
  requireEnum("schema", schema, LABEL_SCHEMAS);
  requireSegment("corpus_version", corpusVersion);
  requireSegment("item_id", itemId);
  const base = path.join(path.resolve(root), LABELS_DIR, corpusVersion);
  if (schema === "item-label") return path.join(base, `${itemId}.json`);
  requireEnum("arm", arm, ARMS);
  const hex = contentSha256(requireFindingKey(key)).slice(SHA256_PREFIX.length);
  return path.join(base, "findings", itemId, arm, `${hex}.json`);
}

/**
 * How many labels of each kind, tier, arm and verdict — plus how much of the set is
 * `gold`, which is the only tier the IAA ceiling may be computed over.
 *
 * A census, not a metric: it computes no precision, no recall and no agreement.
 * It carries its own `n`, per the house rule that no proportion is ever reported
 * without its denominator, and `bundled_from` is here because 245 labels written
 * from 245 readings and 428 labels written from 245 readings are different datasets
 * and only one of them has 428 independent judgements.
 */
export function labelCensus(labels) {
  const out = {
    n: 0,
    schema: Object.fromEntries(LABEL_SCHEMAS.map((s) => [s, 0])),
    label_source: Object.fromEntries(LABEL_SOURCES.map((s) => [s, 0])),
    arm: Object.fromEntries(ARMS.map((a) => [a, 0])),
    confidence: Object.fromEntries(CONFIDENCE.map((c) => [c, 0])),
    is_real: { true: 0, false: 0 },
    verdict_label: Object.fromEntries(VERDICT_LABELS.map((v) => [v, 0])),
    mode: Object.fromEntries(ADJUDICATION_MODES.map((m) => [m, 0])),
    items: 0,
    bundled: 0,
    readings: 0,
  };
  const items = new Set();
  const classes = new Set();
  let unbundled = 0;
  for (const l of Array.isArray(labels) ? labels : []) {
    if (!isPlainObject(l)) continue;
    out.n++;
    if (Object.hasOwn(out.schema, l.schema)) out.schema[l.schema]++;
    if (Object.hasOwn(out.label_source, l.label_source)) out.label_source[l.label_source]++;
    if (Object.hasOwn(out.arm, l.arm)) out.arm[l.arm]++;
    if (Object.hasOwn(out.confidence, l.confidence)) out.confidence[l.confidence]++;
    if (typeof l.is_real === "boolean") out.is_real[String(l.is_real)]++;
    if (Object.hasOwn(out.verdict_label, l.verdict_label)) out.verdict_label[l.verdict_label]++;
    if (isPlainObject(l.adjudication) && Object.hasOwn(out.mode, l.adjudication.mode)) out.mode[l.adjudication.mode]++;
    if (nonEmptyString(l.item_id)) items.add(l.item_id);
    if (nonEmptyString(l.class_id)) {
      out.bundled++;
      classes.add(l.class_id);
    } else unbundled++;
  }
  out.items = items.size;
  // How many times a human actually read something, as against how many records
  // that reading produced.
  out.readings = classes.size + unbundled;
  return out;
}
