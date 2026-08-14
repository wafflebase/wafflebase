// What is asserted here is mostly ONE distinction: a pair that has been DECIDED
// against a class that is FINISHED. A `same` verdict finishes a class on its own; a
// `different` verdict finishes nothing until every one of that class's pairs is
// decided; and `insufficient-basis` is not a decision at all. Get any of those wrong
// and the band narrows further than the evidence justifies — which produces a tighter
// interval, a better-looking report, and a number that is wrong in the flattering
// direction.
//
// The key's own test is a REGRESSION against the store rather than against this
// file's arithmetic: it recomputes a pair key from the two findings inside a real
// record and asserts it equals the 12 hex characters a different program
// (`inspect-maybes.mjs`) filed that record under. A bug at both ends of a round trip
// is invisible to the round trip.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
  ALTERNATE_KEY_FIELDS,
  LABEL_AVAILABILITY,
  LABEL_SOURCES,
  PAIR_VERDICTS,
  SCHEMA_VERSION,
  VERDICT_EFFECT,
  keysOf,
  pairLabelCensus,
  pairLabelKey,
  readPairLabels,
  resolveClasses,
  validatePairLabel,
} from "./pair-labels.mjs";

// --- fixtures ---------------------------------------------------------------

/** A valid gold record, with the boilerplate filled in. Written as an object rather
 *  than through a builder because there IS no builder: this module reads records a
 *  human's tooling wrote, and a fixture built by our own code would test our shape
 *  instead of theirs. */
const label = (over = {}) => ({
  schema: "pair-label",
  schema_version: SCHEMA_VERSION,
  pair_key: "aaaaaaaaaaaa",
  pair_key_at_801: null,
  pair_key_moved: false,
  corpus_version: "cv-1",
  run_id: "run-1",
  item_id: "pr-1",
  verdict: "same",
  verdict_raw: "y",
  label_source: "gold",
  annotators: ["someone"],
  confidence: null,
  confidence_absent_reason: "the worksheet format has no confidence field",
  evidence: null,
  diff_sha256: `sha256:${"1".repeat(64)}`,
  ...over,
});

const DIFF = `sha256:${"1".repeat(64)}`;
const diffShaOf = () => DIFF;

/** Three classes: one shared, one panel-only, one coderabbit-only. The band before
 *  any label is 1/3 with a ceiling of 2/2. */
const CLASSES = [
  { id: "C-both", item: "pr-1", claim: "both" },
  { id: "C-panel", item: "pr-1", claim: "panel-only" },
  { id: "C-cr", item: "pr-1", claim: "coderabbit-only" },
];

const pair = (key, over = {}) => ({ pair_key: key, item: "pr-1", panel_class: "C-panel", coderabbit_class: "C-cr", score: 0.5, ...over });

// --- the key ----------------------------------------------------------------

test("pairLabelKey reproduces the key a REAL stored record was filed under", () => {
  // `058344a36138.json` in the pilot's label store, transcribed here as data. Both
  // sides' file, line and summary are exactly what the annotator saw.
  const panel = {
    file: "packages/frontend/src/app/notes/yorkie-note-store.ts",
    line: 106,
    summary:
      "`undoFloor` is an absolute stack depth compared against a Yorkie stack that can shrink independently (cap eviction / snapshot reset), so undo can silently stop early",
  };
  const coderabbit = {
    file: "packages/frontend/src/app/notes/yorkie-note-store.ts",
    line: 48,
    summary: "Isolate the test-only undo-stack accessor from `canUndo()`.",
  };
  assert.equal(pairLabelKey(panel, coderabbit), "058344a36138");
  // THE ARGUMENT ORDER IS PART OF THE KEY, and getting it backwards fails silently:
  // no throw, no warning, every label simply matches nothing.
  assert.notEqual(pairLabelKey(coderabbit, panel), "058344a36138");
});

test("pairLabelKey collapses whitespace, so a re-flowed summary keeps its label", () => {
  const a = { file: "a.ts", line: 1, summary: "one   two\nthree " };
  const b = { file: "a.ts", line: 1, summary: "one two three" };
  assert.equal(pairLabelKey(a, { file: "b.ts", line: 2, summary: "x" }), pairLabelKey(b, { file: "b.ts", line: 2, summary: "x" }));
  // A missing file and a missing line are distinct from empty ones only in so far as
  // they hash the same; what matters is that they do not throw.
  assert.match(pairLabelKey({}, {}), /^[0-9a-f]{12}$/);
});

test("keysOf indexes every vintage a key may be found under, deduped", () => {
  assert.deepEqual(keysOf(label({ pair_key: "aaaaaaaaaaaa", pair_key_at_801: "bbbbbbbbbbbb" })), ["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  assert.deepEqual(keysOf(label({ pair_key: "aaaaaaaaaaaa", pair_key_at_801: "aaaaaaaaaaaa" })), ["aaaaaaaaaaaa"]);
  assert.deepEqual(keysOf(label({ pair_key_at_801: null })), ["aaaaaaaaaaaa"]);
  // Every alternate field is read, so adding a vintage to the list is the only edit
  // a re-parse needs.
  assert.ok(ALTERNATE_KEY_FIELDS.includes("pair_key_at_801"));
});

// --- the vocabulary ---------------------------------------------------------

test("the three verdicts each have their own effect, and insufficient-basis is not a decision", () => {
  assert.deepEqual([...PAIR_VERDICTS].sort(), ["different", "insufficient-basis", "same"]);
  assert.equal(VERDICT_EFFECT.same, "shared");
  assert.equal(VERDICT_EFFECT.different, "decided-apart");
  // The assertion that matters: pooling this with `different` would finish classes
  // that are not finished.
  assert.equal(VERDICT_EFFECT["insufficient-basis"], "undecided");
  assert.notEqual(VERDICT_EFFECT["insufficient-basis"], VERDICT_EFFECT.different);
  assert.equal(new Set(Object.values(VERDICT_EFFECT)).size, 3, "three verdicts, three behaviours");
});

// --- the validator ----------------------------------------------------------

test("validatePairLabel accepts a well-formed gold record", () => {
  assert.equal(validatePairLabel(label()).verdict, "same");
  // Unknown fields SURVIVE. The 23 records on disk carry `worksheet_row`, `reread`,
  // `supersedes` and `rubric_definition`, none of which this module reads.
  const wide = validatePairLabel(label({ worksheet_row: 11, supersedes: { verdict: "different" } }));
  assert.equal(wide.worksheet_row, 11);
});

test("validatePairLabel refuses every way a record could quietly mean something else", () => {
  const cases = [
    [{ schema: "finding-label" }, /schema must be/, "an item or finding label read as a pair verdict"],
    [{ schema_version: 2 }, /schema_version must be 1/, "a future shape"],
    [{ pair_key: "058344A36138" }, /pair_key must be 12 lowercase hex/, "uppercase would index under a key nothing produces"],
    [{ pair_key: "abc" }, /pair_key must be 12 lowercase hex/, "a truncated key"],
    [{ pair_key_at_801: "zzz" }, /pair_key_at_801 must be 12 lowercase hex/, "a malformed alternate loses the label silently"],
    [{ verdict: "unsure" }, /verdict must be one of/, "the worksheet's raw vocabulary, unmapped"],
    [{ verdict: "maybe" }, /verdict must be one of/, "the matcher's vocabulary, not the adjudicator's"],
    [{ label_source: "human" }, /label_source must be one of/, "a tier outside the three"],
    [{ label_source: undefined }, /label_source must be one of/, "no tier at all — there is no default"],
    [{ annotators: [] }, /annotators must be a non-empty array/, "a verdict nobody is attributed with"],
    [{ annotators: "dlgpdmsly2" }, /annotators must be a non-empty array/, "a string is not a list of annotators"],
    [{ item_id: "" }, /item_id must be a non-empty string/, "a label nobody can join to an item"],
    [{ run_id: "" }, /run_id must be a non-empty string or null/, "an empty run id reads as a run nobody wrote down"],
    [{ diff_sha256: undefined }, /diff_sha256 must be sha256/, "the only drift guard a pair label has"],
    [{ diff_sha256: "8c30f3a8" }, /diff_sha256 must be sha256/, "a bare hex prefix is not the store's format"],
    [{ confidence: "certain" }, /confidence must be one of/, "a confidence outside the scale"],
    [{ confidence: null, confidence_absent_reason: "" }, /confidence_absent_reason/, "an unexplained absence"],
  ];
  for (const [over, pattern, why] of cases) {
    assert.throws(() => validatePairLabel(label(over)), pattern, why);
  }
  for (const notARecord of [null, undefined, [], "x", 3]) {
    assert.throws(() => validatePairLabel(notARecord), /must be a JSON object/);
  }
});

// --- the read path ----------------------------------------------------------

test("readPairLabels degrades to fewer records, and says exactly what it dropped", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pair-labels-read-"));
  try {
    // No `labels/` tree at all: the ordinary state of a store nobody has adjudicated.
    const empty = readPairLabels(root, "cv-1");
    assert.equal(empty.present, false);
    assert.deepEqual(empty.labels, []);

    const dir = path.join(root, "labels", "cv-1", "pairs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "aaaaaaaaaaaa.json"), JSON.stringify(label()));
    writeFileSync(path.join(dir, "bbbbbbbbbbbb.json"), "{not json");
    writeFileSync(path.join(dir, "cccccccccccc.json"), JSON.stringify(label({ pair_key: "cccccccccccc", verdict: "unsure" })));
    writeFileSync(path.join(dir, "notes.md"), "ignored");

    const got = readPairLabels(root, "cv-1");
    assert.equal(got.present, true);
    assert.equal(got.labels.length, 1, "one usable record");
    assert.equal(got.unreadable.length, 1);
    assert.equal(got.unreadable[0].file, "bbbbbbbbbbbb.json");
    assert.equal(got.invalid.length, 1);
    assert.match(got.invalid[0].reason, /verdict must be one of/);
    // NO SILENT TRUNCATION: "the store holds 3 records and 1 is usable" has to be
    // sayable from the return value alone, because a label missing from a band is a
    // floor that reads lower than the evidence supports.
    assert.equal(got.labels.length + got.unreadable.length + got.invalid.length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readPairLabels rejects a record filed under one corpus version and claiming another", () => {
  // The record is well-formed — `validatePairLabel` passes it, because one record on
  // its own cannot say which directory it came out of. Only the reader knows that.
  //
  // It matters because of what happens WITHOUT this check: the misfiled record reaches
  // the drift guard, its `diff_sha256` is compared against an item of the same id in a
  // different corpus, and the whole scoring run aborts talking about a diff hash. The
  // cause is a file in the wrong directory and the error would never mention one.
  const root = mkdtempSync(path.join(os.tmpdir(), "pair-labels-cv-"));
  try {
    const dir = path.join(root, "labels", "cv-1", "pairs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "aaaaaaaaaaaa.json"), JSON.stringify(label()));
    writeFileSync(path.join(dir, "dddddddddddd.json"), JSON.stringify(label({ pair_key: "dddddddddddd", corpus_version: "cv-2" })));

    const got = readPairLabels(root, "cv-1");
    assert.equal(got.labels.length, 1, "only the record that belongs to this corpus");
    assert.equal(got.invalid.length, 1);
    assert.equal(got.invalid[0].file, "dddddddddddd.json");
    assert.match(got.invalid[0].reason, /corpus_version is "cv-2" but this record is filed under "cv-1"/);
    // The validator itself is unchanged: the record is refused for where it sits, not
    // for what it says, and it validates fine on its own.
    assert.equal(validatePairLabel(label({ corpus_version: "cv-2" })).corpus_version, "cv-2");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- the arithmetic: what a partial label set may and may not move -----------

test("a `same` verdict raises the floor and leaves the ceiling EXACTLY where it was", () => {
  // THE CENTRAL PROPERTY, and the one an implementation is most likely to get wrong
  // in the flattering direction. The CodeRabbit-only class has two undecided pairs;
  // one is labelled `same`. That makes the class shared — so the floor moves — while
  // the ceiling's numerator gains exactly what its denominator loses.
  const pairs = [pair("aaaaaaaaaaaa"), pair("dddddddddddd")];
  const r = resolveClasses({ classes: CLASSES, pairs, labels: [label()], diffShaOf, runId: "run-1" });
  assert.equal(r.availability, "resolved");
  assert.equal(r.resolution.coderabbit_only_resolved_same, 1);
  assert.equal(r.band.before.jaccard, 1 / 3);
  assert.equal(r.band.after.jaccard, 2 / 2, "both=2 over classes=2");
  assert.equal(r.band.floor_moved, true);
  assert.equal(r.band.before.jaccard_upper_bound, r.band.after.jaccard_upper_bound);
  assert.equal(r.band.ceiling_moved, false, "a `same` verdict cannot move the ceiling");
});

test("a class is UNFINISHED while one of its pairs is undecided, so neither bound moves", () => {
  // One `different` verdict on one of the class's two pairs resolves nothing: the
  // other pair could still be the match.
  const pairs = [pair("aaaaaaaaaaaa"), pair("dddddddddddd")];
  const r = resolveClasses({ classes: CLASSES, pairs, labels: [label({ verdict: "different" })], diffShaOf, runId: "run-1" });
  assert.equal(r.resolution.coderabbit_only_finished_apart, 0);
  assert.equal(r.resolution.coderabbit_only_still_undecided, 1);
  assert.equal(r.band.floor_moved, false);
  assert.equal(r.band.ceiling_moved, false);
  assert.equal(r.availability, "resolved-nothing", "a verdict that finished nothing is not the same as no verdict");
  assert.equal(r.resolution.still_undecided[0].decided, 1, "the work done is still counted");
  assert.equal(r.resolution.still_undecided[0].unlabelled, 1);
});

test("a FINISHED class lowers the ceiling and leaves the floor alone", () => {
  // Both of the class's pairs are `different`, so it can never become shared: it
  // leaves the undecided pool without entering `both`. This is the only movement that
  // narrows the band from the top, and it is the mirror image of the `same` case.
  const pairs = [pair("aaaaaaaaaaaa"), pair("dddddddddddd")];
  const labels = [label({ verdict: "different" }), label({ pair_key: "dddddddddddd", verdict: "different" })];
  const r = resolveClasses({ classes: CLASSES, pairs, labels, diffShaOf, runId: "run-1" });
  assert.equal(r.resolution.coderabbit_only_finished_apart, 1);
  assert.equal(r.resolution.coderabbit_only_still_undecided, 0);
  assert.equal(r.band.after.jaccard, 1 / 3, "the floor is untouched");
  assert.equal(r.band.floor_moved, false);
  assert.equal(r.band.before.jaccard_upper_bound, 2 / 2);
  assert.equal(r.band.after.jaccard_upper_bound, 1 / 3, "with nothing undecided the band is a point");
  assert.equal(r.band.ceiling_moved, true);
});

test("a class held open SOLELY by `insufficient-basis` is UNFINISHED", () => {
  // S2, as a test. One pair is `different`, the other is `insufficient-basis` — "I
  // could not tell", not "not a match". Pooling the two verdicts would finish this
  // class and collapse the ceiling on evidence nobody has.
  const pairs = [pair("aaaaaaaaaaaa"), pair("dddddddddddd")];
  const labels = [label({ verdict: "different" }), label({ pair_key: "dddddddddddd", verdict: "insufficient-basis" })];
  const r = resolveClasses({ classes: CLASSES, pairs, labels, diffShaOf, runId: "run-1" });
  assert.equal(r.resolution.coderabbit_only_finished_apart, 0, "insufficient-basis does not finish a class");
  assert.equal(r.resolution.coderabbit_only_still_undecided, 1);
  assert.equal(r.resolution.still_undecided[0].held_open_by_insufficient_basis, 1);
  assert.equal(r.resolution.still_undecided[0].unlabelled, 0, "both pairs carry a verdict; one of them just is not a decision");
  assert.equal(r.band.ceiling_moved, false);
  assert.equal(r.band.after.jaccard_upper_bound, r.band.before.jaccard_upper_bound);
});

test("a `same` verdict on a class BOTH arms already claim moves nothing", () => {
  // S3. The class is in `both` already, so crediting the verdict again would
  // double-count one class into the floor. The resolver keys off the class's CURRENT
  // claim, never off the label's existence — measured on k2, 4 of 22 applied labels
  // are of this kind.
  const pairs = [pair("aaaaaaaaaaaa", { coderabbit_class: "C-both" })];
  const r = resolveClasses({ classes: CLASSES, pairs, labels: [label()], diffShaOf, runId: "run-1" });
  assert.equal(r.labels.applied, 1, "the label was read");
  assert.equal(r.resolution.coderabbit_only_resolved_same, 0, "and it resolved nothing");
  assert.equal(r.resolution.labels_on_already_shared_class, 1);
  assert.equal(r.band.floor_moved, false);
  assert.equal(r.band.ceiling_moved, false);
  assert.equal(r.availability, "resolved-nothing");
});

test("one CodeRabbit class `same` with TWO panel classes costs the denominator ONE class, not two", () => {
  // The panel's own partition is the MATCHER's. Two panel findings both labelled
  // `same` against one CodeRabbit finding does not make those two panel findings one
  // defect — nobody adjudicated that pair — so closing it under transitivity would
  // narrow the band on evidence that does not exist. Measured on k2: 6.6% under this
  // rule against 6.9% under transitive closure.
  const classes = [...CLASSES, { id: "C-panel-2", item: "pr-1", claim: "panel-only" }];
  const pairs = [pair("aaaaaaaaaaaa"), pair("dddddddddddd", { panel_class: "C-panel-2" })];
  const labels = [label(), label({ pair_key: "dddddddddddd" })];
  const r = resolveClasses({ classes, pairs, labels, diffShaOf, runId: "run-1" });
  assert.equal(r.resolution.coderabbit_only_resolved_same, 1);
  assert.equal(r.resolution.panel_classes_newly_shared, 1, "one panel class becomes shared, not two");
  assert.equal(r.band.before.classes, 4);
  assert.equal(r.band.after.classes, 3, "4 - 1, not 4 - 2");
  assert.equal(r.band.after.both, 2);
  assert.equal(r.resolution.fanout.length, 1);
  assert.deepEqual(r.resolution.fanout[0].panel_partners, ["C-panel", "C-panel-2"]);
});

test("two CodeRabbit classes `same` with ONE panel class make it shared ONCE", () => {
  // The mirror of the case above, and the reason the numerator and the denominator
  // are counted separately: two classes leave the union, and the panel class they
  // both join becomes shared once.
  const classes = [...CLASSES, { id: "C-cr-2", item: "pr-1", claim: "coderabbit-only" }];
  const pairs = [pair("aaaaaaaaaaaa"), pair("dddddddddddd", { coderabbit_class: "C-cr-2" })];
  const labels = [label(), label({ pair_key: "dddddddddddd" })];
  const r = resolveClasses({ classes, pairs, labels, diffShaOf, runId: "run-1" });
  assert.equal(r.resolution.coderabbit_only_resolved_same, 2);
  assert.equal(r.resolution.panel_classes_newly_shared, 1);
  assert.equal(r.band.before.classes, 4);
  assert.equal(r.band.after.classes, 2, "both CodeRabbit classes leave the union");
  assert.equal(r.band.after.both, 2, "the panel class is shared once, not twice");
});

test("a `same` verdict whose panel partner is ALREADY shared removes a class without adding to `both`", () => {
  // The CodeRabbit class joins a class that is already in `both`, so the denominator
  // falls and the numerator does not. Preferring an already-shared partner when a
  // verdict names several is the direction that does not inflate the floor.
  const pairs = [pair("aaaaaaaaaaaa", { panel_class: "C-both" })];
  const r = resolveClasses({ classes: CLASSES, pairs, labels: [label()], diffShaOf, runId: "run-1" });
  assert.equal(r.resolution.coderabbit_only_resolved_same, 1);
  assert.equal(r.resolution.panel_classes_newly_shared, 0);
  assert.equal(r.band.after.both, 1);
  assert.equal(r.band.after.classes, 2);
  assert.equal(r.band.after.jaccard, 1 / 2);
});

test("when a verdict names several panel partners, an ALREADY-SHARED one wins", () => {
  // Found by mutation testing: with one partner the preference is unobservable,
  // because there is nothing to prefer. It is observable only when a `same` verdict
  // names two panel classes of DIFFERENT claim — and then the choice decides whether
  // the floor's numerator gains, so it is the flattering-direction branch.
  //
  // ⚠ THE CLASS IDS ARE CHOSEN SO SORT ORDER IS ADVERSE. Partners are sorted for
  // determinism, so an id like `C-both` would come first anyway and the test would
  // pass with the preference deleted. `C-apanel` sorts BEFORE `C-both`: renaming these
  // for tidiness would silently stop this test from testing anything.
  const classes = [
    { id: "C-both", item: "pr-1", claim: "both" },
    { id: "C-apanel", item: "pr-1", claim: "panel-only" },
    { id: "C-cr", item: "pr-1", claim: "coderabbit-only" },
  ];
  const pairs = [pair("aaaaaaaaaaaa", { panel_class: "C-apanel" }), pair("dddddddddddd", { panel_class: "C-both" })];
  const labels = [label(), label({ pair_key: "dddddddddddd" })];
  const r = resolveClasses({ classes, pairs, labels, diffShaOf, runId: "run-1" });
  assert.equal(r.resolution.coderabbit_only_resolved_same, 1);
  assert.equal(r.resolution.resolved[0].panel_class, "C-both", "the already-shared partner is chosen, not the first by id");
  assert.equal(r.resolution.panel_classes_newly_shared, 0, "so the numerator does not gain");
  assert.equal(r.band.after.both, 1);
  assert.equal(r.band.after.classes, 2);
  assert.equal(r.band.after.jaccard, 1 / 2);
});

// --- provenance, tiers and drift --------------------------------------------

test("the band is computable from gold ALONE, and a silver verdict never enters it", () => {
  // S5. A silver pair labeler exists for this corpus and FAILED its own validation at
  // 17/23. If those verdicts ever land in the store, the gold band must be unchanged
  // and the silver one visible beside it — never averaged into one number.
  const pairs = [pair("aaaaaaaaaaaa"), pair("dddddddddddd")];
  const labels = [label({ verdict: "different" }), label({ pair_key: "dddddddddddd", label_source: "silver", annotators: ["claude-opus-5"], verdict: "same" })];
  const gold = resolveClasses({ classes: CLASSES, pairs, labels, diffShaOf, runId: "run-1", tier: "gold" });
  assert.equal(gold.labels.in_tier, 1);
  assert.deepEqual(gold.labels.other_tiers, { silver: 1 });
  assert.equal(gold.band.floor_moved, false, "the silver `same` did not raise the gold floor");
  const silver = resolveClasses({ classes: CLASSES, pairs, labels, diffShaOf, runId: "run-1", tier: "silver" });
  assert.equal(silver.band.floor_moved, true, "and it does raise the silver one, reported separately");
  assert.equal(silver.tier, "silver");
  // There is no argument that means "every tier", so a pooled band is unspellable.
  assert.throws(() => resolveClasses({ classes: CLASSES, pairs, labels, diffShaOf, tier: "all" }), /there is no value meaning "every tier"/);
  assert.deepEqual([...LABEL_SOURCES], ["gold", "silver", "distant"]);
});

test("two labels of one tier disagreeing about one live pair is refused, not won by file order", () => {
  const pairs = [pair("aaaaaaaaaaaa")];
  // The second record's ALTERNATE key collides with the first's primary one — the
  // shape #801 made possible, and the reason both fields are indexed.
  const labels = [label({ verdict: "same" }), label({ pair_key: "eeeeeeeeeeee", pair_key_at_801: "aaaaaaaaaaaa", verdict: "different" })];
  assert.throws(() => resolveClasses({ classes: CLASSES, pairs, labels, diffShaOf, runId: "run-1" }), /carry two gold labels with different verdicts/);
  // Agreeing duplicates are not an error: there is one answer, filed twice.
  const agreeing = [label({ verdict: "same" }), label({ pair_key: "eeeeeeeeeeee", pair_key_at_801: "aaaaaaaaaaaa", verdict: "same" })];
  assert.equal(resolveClasses({ classes: CLASSES, pairs, labels: agreeing, diffShaOf, runId: "run-1" }).labels.applied, 1);
});

test("a label whose diff_sha256 disagrees with the corpus item is REFUSED, not skipped", () => {
  // S6, and the reason it refuses rather than degrades: a stale label means the item
  // was re-extracted after the adjudication, so the verdict is about code the store
  // no longer holds. Dropping it would score the REST of that item's labels against a
  // diff nobody adjudicated, silently.
  const pairs = [pair("aaaaaaaaaaaa")];
  const stale = [label({ diff_sha256: `sha256:${"9".repeat(64)}` })];
  assert.throws(
    () => resolveClasses({ classes: CLASSES, pairs, labels: stale, diffShaOf, runId: "run-1" }),
    /adjudicated against a diff this corpus no longer holds/,
  );
  // A label naming an item the corpus does not contain cannot be checked at all,
  // which is the same doubt and the same refusal.
  assert.throws(() => resolveClasses({ classes: CLASSES, pairs, labels: [label()], diffShaOf: () => null, runId: "run-1" }), /no diff hash for this item/);
});

test("the drift guard's input is REQUIRED, because a guard whose input never arrives never fires", () => {
  // Lesson 7, applied to this file's own check: `assertEffort` did not fail because
  // its rule was wrong, it failed because the field it read stopped arriving.
  assert.throws(() => resolveClasses({ classes: CLASSES, pairs: [pair("aaaaaaaaaaaa")], labels: [label()] }), /diffShaOf must be a function/);
  assert.throws(() => resolveClasses({ classes: CLASSES, pairs: [], labels: [], diffShaOf: "yes" }), /diffShaOf must be a function/);
});

test("a label matching no live pair is REPORTED with its provenance, never dropped", () => {
  // S7. #801 rewrote CodeRabbit summaries, so a key can move — and a pair can also be
  // PROMOTED out of the undecided queue into a real match. The queue alone cannot say
  // which happened, so the record's own provenance is carried through.
  const pairs = [pair("dddddddddddd")];
  const r = resolveClasses({ classes: CLASSES, pairs, labels: [label({ pair_key_moved: true, still_maybe_at_801: false })], diffShaOf, runId: "run-1" });
  assert.equal(r.labels.applied, 0);
  assert.equal(r.labels.unmatched.length, 1);
  assert.equal(r.labels.unmatched[0].pair_key, "aaaaaaaaaaaa");
  assert.equal(r.labels.unmatched[0].pair_key_moved, true);
  assert.equal(r.labels.unmatched[0].still_maybe_at_801, false);
  assert.equal(r.labels.unmatched[0].item_in_frame, true);
  assert.equal(r.availability, "none-matched", "labels name this run and none matched — a drift signal, not an absence");
});

test("a label found under its ALTERNATE key counts, and says which vintage matched", () => {
  // Measured on k2: 5 of the 22 applied labels match only through `pair_key_at_801`,
  // and 4 of those 5 are `same` verdicts — a third of the floor's movement.
  const pairs = [pair("bbbbbbbbbbbb")];
  const r = resolveClasses({ classes: CLASSES, pairs, labels: [label({ pair_key_at_801: "bbbbbbbbbbbb", pair_key_moved: true })], diffShaOf, runId: "run-1" });
  assert.equal(r.labels.applied, 1);
  assert.deepEqual(r.labels.via, { pair_key_at_801: 1 });
  assert.equal(r.resolution.coderabbit_only_resolved_same, 1);
});

test("the four ways a band does not move are four different states", () => {
  // S4. A band that reports the same number for a labelled and an unlabelled
  // replicate is the four-availability-states lesson one level up, so each cause is
  // its own value rather than one "no labels here".
  const pairs = [pair("aaaaaaaaaaaa")];
  const base = { classes: CLASSES, pairs, diffShaOf, runId: "run-1" };
  assert.equal(resolveClasses({ ...base, labels: [] }).availability, "store-empty");
  // Labels exist, none in this tier: the pilot's k1 and k3 shape.
  assert.equal(resolveClasses({ ...base, labels: [label({ label_source: "silver", annotators: ["m"] })] }).availability, "none-for-replicate");
  // A label adjudicated on another run whose key is not in this queue either.
  assert.equal(resolveClasses({ ...base, labels: [label({ run_id: "run-2", pair_key: "ffffffffffff" })] }).availability, "none-for-replicate");
  // Named this run, matched nothing: drift.
  assert.equal(resolveClasses({ ...base, labels: [label({ pair_key: "ffffffffffff" })] }).availability, "none-matched");
  // Matched, and resolved nothing.
  assert.equal(resolveClasses({ ...base, labels: [label({ verdict: "insufficient-basis" })] }).availability, "resolved-nothing");
  assert.equal(resolveClasses({ ...base, labels: [label()] }).availability, "resolved");
  for (const state of ["store-empty", "none-for-replicate", "none-matched", "resolved-nothing", "resolved"]) {
    assert.ok(LABEL_AVAILABILITY.includes(state), `${state} is in the declared vocabulary`);
  }
});

test("a verdict adjudicated on another draw is applied and COUNTED as such", () => {
  // The key is content-derived, so a verdict about two texts holds for any replicate
  // that produced the same two texts — but a reader must be able to see that the
  // adjudication was made elsewhere. On the pilot this is 0, because k1 and k3
  // reworded every labelled finding.
  const pairs = [pair("aaaaaaaaaaaa")];
  const r = resolveClasses({ classes: CLASSES, pairs, labels: [label({ run_id: "run-2" })], diffShaOf, runId: "run-1" });
  assert.equal(r.labels.applied, 1);
  assert.equal(r.labels.cross_replicate, 1);
  assert.equal(resolveClasses({ classes: CLASSES, pairs, labels: [label()], diffShaOf, runId: "run-1" }).labels.cross_replicate, 0);
});

test("a CodeRabbit-only class with no undecided pair is not `finished` by labelling", () => {
  // It was never in the undecided pool, so nothing can remove it from one. Counting
  // it as finished would lower the ceiling for a class no verdict touched.
  const pairs = [];
  const r = resolveClasses({ classes: CLASSES, pairs, labels: [label()], diffShaOf, runId: "run-1" });
  assert.equal(r.resolution.coderabbit_only_finished_apart, 0);
  assert.equal(r.resolution.coderabbit_only_still_undecided, 0);
  assert.equal(r.band.before.jaccard, r.band.after.jaccard);
  assert.equal(r.band.before.jaccard_upper_bound, 1 / 3, "with no undecided pair the band was already a point");
});

// --- the census -------------------------------------------------------------

test("pairLabelCensus counts every tier including the empty ones, and the provenance flags", () => {
  const labels = [
    label(),
    label({ pair_key: "bbbbbbbbbbbb", verdict: "different" }),
    label({ pair_key: "cccccccccccc", verdict: "insufficient-basis", pair_key_moved: true, needs_readjudication: true }),
    label({ pair_key: "dddddddddddd", label_source: "silver", annotators: ["claude-opus-5"], supersedes: { verdict: "same" } }),
  ];
  const c = pairLabelCensus(labels);
  assert.equal(c.n, 4);
  assert.deepEqual(c.by_verdict, { different: 1, "insufficient-basis": 1, same: 2 });
  assert.deepEqual(c.by_source, { gold: 3, silver: 1 });
  // `distant: 0` is a fact about the store; a missing key would be a fact about this
  // function, and a reader cannot tell those apart from an absence.
  assert.equal(c.by_tier.distant.n, 0);
  assert.equal(c.by_tier.gold.n, 3);
  assert.equal(c.keys_moved, 1);
  assert.equal(c.needs_readjudication, 1);
  assert.equal(c.superseded, 1);
  assert.equal(c.confidence_absent, 4);
  assert.deepEqual(c.annotators, ["claude-opus-5", "someone"]);
  assert.deepEqual(pairLabelCensus(null), pairLabelCensus([]), "a read path degrades");
});
