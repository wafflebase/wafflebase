// The label is the one record in this benchmark whose being wrong cannot be caught
// downstream. A wrong finding record makes a scorer disagree with the panel's own
// artifact; a wrong LABEL makes every validity metric agree with itself and be false.
// So most of what is asserted here is refusals — the combinations that must never
// reach disk — and each one names the guide section or the failure it comes from.
//
// Nothing here calls a model, spawns anything, or touches the filesystem.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { BLOCKING, KNOWN } from "../vendor/pipeline/severity.mjs";
import { ARMS } from "./finding-record.mjs";
import {
  ADJUDICATION_MODES,
  BLINDED_FROM_ADJUDICATION,
  CONFIDENCE,
  KEY_BASES,
  LABELS_DIR,
  LABEL_SCHEMAS,
  LABEL_SOURCES,
  MODEL_ID_PREFIXES,
  SCHEMA_VERSION,
  STRATA,
  SUGGESTION_OUTCOMES,
  VERDICT_LABELS,
  armKeyOf,
  buildFindingLabel,
  buildItemLabel,
  labelCensus,
  labelPathFor,
  looksLikeModelId,
  splitFindingKey,
  validateLabel,
} from "./labels.mjs";

const DIFF_SHA = `sha256:${"a".repeat(64)}`;
const OTHER_SHA = `sha256:${"b".repeat(64)}`;
const KEY = "packages/sheets/src/formula/arguments.ts::blank-skip makes min/max return #num!";

/** The blinded basis every honest label carries: the claim, never the verdict on it. */
const basis = (over = {}) => ({
  mode: "human",
  suggestion: null,
  suggestion_outcome: "not-shown",
  presented_fields: ["item", "file", "line", "claim", "reviewer-prose"],
  withheld_fields: [...BLINDED_FROM_ADJUDICATION],
  ...over,
});

const finding = (over = {}) =>
  buildFindingLabel({
    corpusVersion: "2026-08-10-pilot-reviewed",
    itemId: "pr-605",
    arm: "panel",
    findingKey: KEY,
    isReal: true,
    severity: "major",
    labelSource: "gold",
    annotators: ["dlgpdmsly2"],
    adjudication: basis(),
    confidence: "medium",
    evidence: "read arguments.ts:120-140; the blank-skip is there",
    diffSha256: DIFF_SHA,
    ...over,
  });

const item = (over = {}) =>
  buildItemLabel({
    corpusVersion: "2026-08-10-pilot-reviewed",
    itemId: "pr-605",
    verdictLabel: "approve",
    trueDefects: [],
    stratum: "benign",
    labelSource: "gold",
    annotators: ["dlgpdmsly2"],
    adjudication: basis(),
    confidence: "medium",
    evidence: "read the whole diff; tests cover the new path",
    diffSha256: DIFF_SHA,
    ...over,
  });

const throws = (fn, re) => assert.throws(fn, (e) => re.test(e.message), `expected a refusal matching ${re}`);

// --- the vocabularies --------------------------------------------------------

test("every vocabulary is frozen, and severity is severity.mjs's own scale", () => {
  for (const v of [LABEL_SCHEMAS, LABEL_SOURCES, CONFIDENCE, STRATA, VERDICT_LABELS, ADJUDICATION_MODES, SUGGESTION_OUTCOMES, KEY_BASES, BLINDED_FROM_ADJUDICATION, MODEL_ID_PREFIXES]) {
    assert.ok(Object.isFrozen(v), `${JSON.stringify(v)} must be frozen`);
  }
  assert.deepEqual([...LABEL_SOURCES], ["gold", "silver", "distant"]);
  assert.deepEqual([...CONFIDENCE], ["high", "medium", "low"]);
  assert.deepEqual([...STRATA], ["benign", "known-defect", "reverted"]);
  assert.deepEqual([...VERDICT_LABELS], ["block", "approve", "borderline"]);
  // NOT a second scale. The gate's own definition of what blocks is the one a
  // `verdict_label` has to agree with, so a label's severity has to come from there.
  for (const s of KNOWN) assert.doesNotThrow(() => finding({ severity: s }));
  throws(() => finding({ severity: "trivial" }), /severity must be one of/);
});

test("the four things an adjudicator must never have seen are named as data", () => {
  // Prose in a docblock cannot be checked by a validator. This list can.
  assert.deepEqual([...BLINDED_FROM_ADJUDICATION], ["panel-severity", "verifier-verdict", "gate-outcome", "other-arm-agreement"]);
});

// --- the drift guard (S8) ----------------------------------------------------

test("a label whose diff_sha256 disagrees with the item's meta.json is REFUSED", () => {
  // Guide §8 expects `store.labelStatus()` to report `stale`. That function does not
  // exist, so this validator is the only drift checker there is — and it refuses at
  // write time rather than reporting at read time, because a label written against a
  // diff that no longer exists scores the wrong code silently.
  const meta = { id: "pr-605", sha256_diff: OTHER_SHA };
  throws(() => validateLabel(finding(), { itemMeta: meta }), /does not match pr-605's current sha256_diff/);
  assert.doesNotThrow(() => validateLabel(finding(), { itemMeta: { id: "pr-605", sha256_diff: DIFF_SHA } }));
});

test("a label with no drift stamp at all is refused, and so is one checked against the wrong item", () => {
  throws(() => finding({ diffSha256: undefined }), /diff_sha256 must be "sha256:<64 hex>"/);
  throws(() => finding({ diffSha256: "deadbeef" }), /diff_sha256 must be "sha256:<64 hex>"/);
  throws(() => validateLabel(finding(), { itemMeta: { id: "pr-471", sha256_diff: DIFF_SHA } }), /is not this label's item/);
});

// --- the key (S6) -----------------------------------------------------------

test("an empty finding_key summary is refused rather than written", () => {
  // `findingKey` returns `file::` for an empty summary and `validateFindingRecord`
  // accepts `summary: ""`, so every empty-summary finding in one file shares a key —
  // and one label would silently overwrite another about a different claim.
  throws(() => finding({ findingKey: "packages/a.ts::" }), /EMPTY summary half/);
  throws(() => finding({ findingKey: "packages/a.ts::   " }), /EMPTY summary half/);
  throws(() => finding({ findingKey: "" }), /must contain the "::" separator/);
  throws(() => finding({ findingKey: "no-separator-here" }), /must contain the "::" separator/);
});

test("an empty FILE half is allowed, because it does not collide and the findings are real", () => {
  // 2 of the pilot's 428 panel records carry no file. Refusing them would make those
  // findings permanently unlabellable to prevent a collision that cannot happen.
  assert.doesNotThrow(() => finding({ findingKey: "::a summary with no file" }));
  assert.deepEqual(splitFindingKey("a.ts::b"), { file: "a.ts", summary: "b" });
  assert.equal(splitFindingKey("nope"), null);
});

// --- the tier (S5) ----------------------------------------------------------

test("an AI read-through cannot be filed as gold", () => {
  // Guide §6: "reserving `gold` for human adjudication is what keeps the IAA ceiling
  // trustworthy." A model read is silver even when confident.
  throws(
    () => finding({ labelSource: "gold", adjudication: basis({ mode: "model" }), annotators: ["claude-opus-4-8"] }),
    /label_source "gold" requires adjudication.mode "human"/,
  );
  assert.doesNotThrow(() => finding({ labelSource: "silver", adjudication: basis({ mode: "model" }), annotators: ["claude-opus-4-8"] }));
});

test("a pre-fill nobody confirmed cannot be gold, even from a human session", () => {
  throws(
    () => finding({ adjudication: basis({ suggestion_outcome: "accepted-unreviewed" }) }),
    /cannot carry suggestion_outcome "accepted-unreviewed"/,
  );
  // Confirmed or overridden IS a human decision, and stays gold.
  for (const outcome of ["confirmed", "overridden", "not-shown"]) {
    assert.doesNotThrow(() => finding({ adjudication: basis({ suggestion_outcome: outcome }) }));
  }
});

test("annotators cannot launder an AI read into a human id, or the reverse", () => {
  // Guide §7 names the consequence exactly: "a future IAA pass will treat two AI reads
  // as independent human agreement."
  throws(
    () => finding({ labelSource: "silver", adjudication: basis({ mode: "model" }), annotators: ["dlgpdmsly2"] }),
    /not a recognised model id/,
  );
  throws(() => finding({ annotators: ["claude-opus-5"] }), /mode "human" but annotators names the model id/);
  throws(() => finding({ annotators: [] }), /annotators must be a non-empty array/);
  throws(() => finding({ annotators: ["  "] }), /annotators must be a non-empty array/);
});

test("looksLikeModelId recognises a model and not a login", () => {
  for (const id of ["claude-opus-5", "CLAUDE-OPUS-5", "gpt-5", "gemini-2.5-pro", "claude"]) assert.ok(looksLikeModelId(id), id);
  for (const id of ["dlgpdmsly2", "claudia-smith", "gptolemy", "", null]) assert.ok(!looksLikeModelId(id), JSON.stringify(id));
});

// --- what was on screen -----------------------------------------------------

test("a label admitting the panel's verdict was on screen is refused", () => {
  // The write-path half of the blinding guard. `adjudicate.mjs` cannot present these
  // fields because it never holds them; this door catches a label produced by
  // something that did.
  for (const leak of BLINDED_FROM_ADJUDICATION) {
    throws(() => finding({ adjudication: basis({ presented_fields: ["claim", leak] }) }), new RegExp(`presented_fields names ${leak}`));
  }
});

test("presented_fields and withheld_fields are required, not optional colour", () => {
  throws(() => finding({ adjudication: basis({ presented_fields: [] }) }), /presented_fields must be a non-empty array/);
  throws(() => finding({ adjudication: basis({ withheld_fields: undefined }) }), /withheld_fields must be a non-empty array/);
  throws(() => finding({ adjudication: null }), /adjudication must be an object/);
  throws(() => finding({ adjudication: basis({ mode: "committee" }) }), /adjudication.mode must be one of/);
});

// --- confidence (S9) --------------------------------------------------------

test("confidence has NO default — least of all high", () => {
  // Absence of a defect is harder to prove than presence (guide §7), and a default
  // would answer this for hundreds of labels at once.
  throws(() => finding({ confidence: undefined }), /confidence is required and has no default/);
  throws(() => finding({ confidence: null }), /confidence is required and has no default/);
  throws(() => finding({ confidence: "quite" }), /confidence must be one of/);
});

test("a benign item at high confidence must name what backs it", () => {
  throws(
    () => item({ stratum: "benign", confidence: "high", evidence: null, notes: null }),
    /needs evidence or notes naming what backs it/,
  );
  assert.doesNotThrow(() => item({ stratum: "benign", confidence: "high", evidence: "verify:self green; the new path has tests" }));
  // Not forbidden at other strata: claiming a defect IS present is a positive claim.
  assert.doesNotThrow(() => item({ stratum: "known-defect", verdictLabel: "block", primaryDefectClass: "correctness", confidence: "high", evidence: null, notes: null, trueDefects: [{ file: "a.ts", severity: "major", description: "off-by-one" }] }));
});

// --- the finding record -----------------------------------------------------

test("a finding label carries arm, because the guide's record is panel-only", () => {
  // Guide §1.2 reads "truth about one specific finding THE PANEL raised", and
  // precision, relative recall and the FP profile are all two-armed.
  for (const arm of ARMS) {
    const l = finding({ arm, parserVintage: arm === "coderabbit" ? "harvest.mjs@sha256:1" : null });
    assert.equal(l.arm, arm);
  }
  throws(() => finding({ arm: "human" }), /arm must be one of panel \| coderabbit/);
});

test("a coderabbit label needs a parser vintage and a panel label does not (S3)", () => {
  // `finding_key` hashes a summary WE parsed out of CodeRabbit's markdown, and #801
  // rewrites 38 of 1588 inline titles. The vintage makes a stale key detectable.
  throws(() => finding({ arm: "coderabbit" }), /a coderabbit label needs parser_vintage/);
  assert.equal(finding({ arm: "coderabbit", parserVintage: "harvest.mjs@sha256:abc" }).parser_vintage, "harvest.mjs@sha256:abc");
  assert.equal(finding({ arm: "panel" }).parser_vintage, null);
});

test("should_verifier_keep mirrors is_real, and an unexplained divergence is refused", () => {
  assert.equal(finding({ isReal: true }).should_verifier_keep, true);
  assert.equal(finding({ isReal: false, notes: "hallucination" }).should_verifier_keep, false);
  throws(() => finding({ isReal: true, shouldVerifierKeep: false }), /diverges from is_real/);
  assert.doesNotThrow(() => finding({ isReal: true, shouldVerifierKeep: false, notes: "real but so far out of scope the verifier should drop it" }));
});

test("is_real has no third value", () => {
  throws(() => finding({ isReal: null }), /is_real must be true or false/);
  throws(() => finding({ isReal: "maybe" }), /is_real must be true or false/);
});

test("class_members must contain the label's own key", () => {
  // Bundle provenance is what stops a later IAA pass reading 3 labels from 1 reading
  // as 3 independent readings. A member list this finding is not in is not its
  // provenance.
  assert.doesNotThrow(() => finding({ classId: "D-1", classMembers: [KEY, "b.ts::other"] }));
  throws(() => finding({ classId: "D-1", classMembers: ["b.ts::other"] }), /class_members must be null or contain/);
  assert.equal(finding().class_members, null);
});

// --- the item record --------------------------------------------------------

test("verdict_label must agree with true_defects, under the shipped gate's own rule", () => {
  // The gate is APPROVE iff zero real critical/major defects (`severity.mjs`), so
  // `block` ⟺ at least one blocking true_defect. Guide §3 calls the other combination
  // a contradiction — and V3 would score it as the panel's error.
  const major = [{ file: "a.ts", line_range: [1, 2], severity: "major", kind: "correctness", description: "off-by-one on the common path" }];
  const nit = [{ file: "a.ts", severity: "nit", description: "name reads oddly" }];
  throws(() => item({ verdictLabel: "block", primaryDefectClass: "correctness", trueDefects: [] }), /with no critical\/major true_defect/);
  throws(() => item({ verdictLabel: "block", primaryDefectClass: "correctness", trueDefects: nit }), /with no critical\/major true_defect/);
  throws(() => item({ verdictLabel: "approve", trueDefects: major }), /beside 1 critical\/major true_defect/);
  assert.doesNotThrow(() => item({ verdictLabel: "block", primaryDefectClass: "correctness", stratum: "known-defect", trueDefects: major }));
  assert.doesNotThrow(() => item({ verdictLabel: "approve", trueDefects: nit }));
  // Every blocking severity, so the rule can never be narrowed to `major` alone.
  for (const severity of [...BLOCKING]) {
    assert.doesNotThrow(() => item({ verdictLabel: "block", primaryDefectClass: "correctness", stratum: "known-defect", trueDefects: [{ file: "a.ts", severity, description: "x" }] }));
  }
});

test("primary_defect_class is null on approve, and borderline must say what the tension is", () => {
  throws(() => item({ verdictLabel: "approve", primaryDefectClass: "correctness" }), /primary_defect_class must be null when verdict_label is "approve"/);
  throws(() => item({ verdictLabel: "borderline", notes: null }), /requires notes saying what the tension is/);
  assert.doesNotThrow(() => item({ verdictLabel: "borderline", notes: "major-vs-minor on an unlikely path" }));
});

test("true_defects entries are validated, including the ones with no line", () => {
  throws(() => item({ trueDefects: undefined }), /true_defects must be an array/);
  throws(() => item({ verdictLabel: "block", primaryDefectClass: "x", stratum: "known-defect", trueDefects: [{ file: "a.ts", severity: "major", description: "" }] }), /description must say what is wrong/);
  throws(() => item({ verdictLabel: "block", primaryDefectClass: "x", stratum: "known-defect", trueDefects: [{ file: "a.ts", severity: "urgent", description: "x" }] }), /severity must be one of/);
  throws(() => item({ verdictLabel: "block", primaryDefectClass: "x", stratum: "known-defect", trueDefects: [{ file: "a.ts", severity: "major", description: "x", line_range: [9, 2] }] }), /line_range must be \[start, end\]/);
  throws(() => item({ verdictLabel: "block", primaryDefectClass: "x", stratum: "known-defect", trueDefects: [{ file: "a.ts", severity: "major", description: "x", line_range: [0, 2] }] }), /line_range must be \[start, end\]/);
  // A missing test and an absent guard are not line-localizable; the guide says use
  // the range of the code that should have changed, or none.
  assert.doesNotThrow(() => item({ verdictLabel: "block", primaryDefectClass: "x", stratum: "known-defect", trueDefects: [{ file: "a.ts", severity: "major", description: "no test covers the new branch", line_range: null }] }));
});

test("[] true_defects is the affirmative claim, and it survives the round trip", () => {
  const l = item();
  assert.deepEqual(l.true_defects, []);
  assert.equal(l.schema, "item-label");
  assert.doesNotThrow(() => validateLabel(JSON.parse(JSON.stringify(l))));
});

// --- shape rules ------------------------------------------------------------

test("the schema version is pinned and an old hand-written label is not silently re-blessed", () => {
  assert.equal(SCHEMA_VERSION, 1);
  throws(() => validateLabel({ ...finding(), schema_version: 2 }), /schema_version must be 1/);
  // The seven labels under the retired 2026-07-28-pilot carry no schema_version at
  // all. Refusing them is intended: their diff_sha256 refers to a diff nobody can
  // produce, and they are never rewritten or deleted.
  const historical = { item_id: "pr-521", corpus_version: "2026-07-28-pilot", finding_key: KEY, is_real: true };
  throws(() => validateLabel(historical), /schema must be one of/);
});

test("validateLabel WIDENS: an unknown field survives rather than being rejected", () => {
  // `validateCorpusItem`'s convention, and the one the finding adapters broke twice: a
  // validator may demand fields, never decide the full list. A field the annotation
  // guide adds tomorrow must not need this file edited first.
  const widened = { ...finding(), future_guide_field: { added: "later" } };
  assert.doesNotThrow(() => validateLabel(widened));
  assert.deepEqual(validateLabel(widened).future_guide_field, { added: "later" });
});

test("an id that would become a path segment is validated, not sanitised", () => {
  for (const bad of ["../escape", "pr/605", ".hidden", ""]) {
    throws(() => finding({ itemId: bad }), /item_id must match/);
    throws(() => finding({ corpusVersion: bad }), /corpus_version must match/);
  }
});

// --- paths ------------------------------------------------------------------

test("a finding label's filename is sha256(finding_key), as the store's own files are", () => {
  // Regression fixture from the real store: `labels/2026-07-28-pilot/findings/pr-521/`
  // holds seven files and every filename is the bare hex of sha256 over the key. The
  // rule is the guide's; this pins that we compute it the same way, through
  // `store.mjs`'s `contentSha256` rather than a second hash helper.
  const key = "packages/sheets/src/formula/arguments.ts::possibly missing imports for symbols newly used in the diff (`issrng` in arguments.ts, `range` in cell-index.ts / readonly.ts), which would break the build";
  const expected = "4cde6497a3c9ca4b0f4a86b0af47027d081a5e2800956a0ad024c841c1c99188";
  assert.equal(createHash("sha256").update(key, "utf8").digest("hex"), expected, "the fixture itself");
  const p = labelPathFor({ root: "/eval", corpusVersion: "2026-07-28-pilot", schema: "finding-label", itemId: "pr-521", arm: "panel", findingKey: key });
  assert.equal(path.basename(p), `${expected}.json`);
  assert.equal(p, path.join("/eval", LABELS_DIR, "2026-07-28-pilot", "findings", "pr-521", "panel", `${expected}.json`));
});

test("the two arms get two key spaces, so an identical claim from both is two labels", () => {
  // `findingKey` is (file, summary) and says nothing about who raised the claim. One
  // path for both would carry an `arm` field that is wrong for one of them, and
  // per-arm precision would read one arm's judgement as the other's.
  const args = { root: "/eval", corpusVersion: "cv", schema: "finding-label", itemId: "pr-1", findingKey: KEY };
  assert.notEqual(labelPathFor({ ...args, arm: "panel" }), labelPathFor({ ...args, arm: "coderabbit" }));
  throws(() => labelPathFor({ ...args }), /arm must be one of/);
});

test("an item label sits beside the corpus item id, and a path needs a root", () => {
  assert.equal(
    labelPathFor({ root: "/eval", corpusVersion: "cv", schema: "item-label", itemId: "pr-471" }),
    path.join("/eval", LABELS_DIR, "cv", "pr-471.json"),
  );
  throws(() => labelPathFor({ corpusVersion: "cv", schema: "item-label", itemId: "pr-1" }), /root directory is required and has no default/);
  throws(() => labelPathFor({ root: "/eval", corpusVersion: "cv", schema: "pair-label", itemId: "pr-1" }), /schema must be one of/);
  throws(() => labelPathFor({ root: "/eval", corpusVersion: "../..", schema: "item-label", itemId: "pr-1" }), /corpus_version must match/);
});

test("armKeyOf is what 'already labelled' means", () => {
  assert.equal(armKeyOf("panel", KEY), `panel/${KEY}`);
  assert.notEqual(armKeyOf("panel", KEY), armKeyOf("coderabbit", KEY));
});

// --- census -----------------------------------------------------------------

test("the census carries its n, and tells readings apart from labels", () => {
  // 245 labels from 245 readings and 428 labels from 245 readings are different
  // datasets, and only one of them has 428 independent judgements.
  const bundled = ["a.ts::one", "a.ts::two", "a.ts::three"].map((k) => finding({ findingKey: k, classId: "D-9", classMembers: ["a.ts::one", "a.ts::two", "a.ts::three"] }));
  const solo = finding({ findingKey: "b.ts::alone", itemId: "pr-471" });
  const c = labelCensus([...bundled, solo, item()]);
  assert.equal(c.n, 5);
  assert.equal(c.schema["finding-label"], 4);
  assert.equal(c.schema["item-label"], 1);
  assert.equal(c.bundled, 3);
  assert.equal(c.readings, 2 + 1, "one bundle + one solo finding + one item");
  assert.equal(c.label_source.gold, 5);
  assert.equal(c.arm.panel, 4);
  assert.equal(c.is_real.true, 4);
  assert.equal(c.verdict_label.approve, 1);
  assert.equal(c.mode.human, 5);
  assert.equal(c.items, 2);
});

test("the census degrades over junk rather than throwing", () => {
  const c = labelCensus([null, 7, "x", finding()]);
  assert.equal(c.n, 1);
  assert.equal(labelCensus(undefined).n, 0);
});
