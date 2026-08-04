import { strict as assert } from "node:assert";
import test from "node:test";

import {
  assessExpectation,
  checkExpectationShape,
  checkGround,
  evaluateExpectation,
  resolveExpectationRefs,
  EXPECT_GROUNDS,
  EXPECT_OPS,
} from "./hunt-ui-expect.mjs";

/** A journal entry as the runner emits one. */
const readEntry = (reader, value, ok = true) => ({ action: { type: "read", reader }, ok, value });
const typeEntry = (text, ok = true) => ({ action: { type: "type", text }, ok, value: null });

/** The #343 shape: a mixed-size selection whose sizes must all increase. */
const JOURNAL = [
  readEntry("doc.fontSizes", [11, 18, 32]), // 0
  typeEntry("hello world"), //                 1
  readEntry("sheet.cellValue", "30"), //       2
  readEntry("doc.fontSizes", [11, 18, 32], false), // 3 — the read FAILED
];

const A = (over = {}) => ({
  read: "doc.fontSizes",
  op: "each-greater-than",
  value: "@read:0",
  ground: "A",
  because: "increase must increase every size in the selection",
  ...over,
});

const CHARTER = { docsScope: ["docs/design/**", "packages/cli/README.md"] };

// --- shape ------------------------------------------------------------------

test("checkExpectationShape accepts a well-formed prediction", () => {
  assert.deepEqual(checkExpectationShape(A()), []);
});

test("checkExpectationShape refuses an operator outside the closed set", () => {
  assert.match(checkExpectationShape(A({ op: "looks-wrong" }))[0], /`op` must be one of/);
  assert.match(checkExpectationShape(A({ op: undefined }))[0], /`op` must be one of/);
});

// A model-supplied pattern is code this process would execute, and catastrophic
// backtracking is the obvious hazard. `contains` covers what it was for.
test("EXPECT_OPS has no regex operator", () => {
  for (const banned of ["matches", "regex", "test", "eval"]) {
    assert.equal(EXPECT_OPS.includes(banned), false, `${banned} must not be an operator`);
  }
});

test("checkExpectationShape requires a reader, a value and a reason", () => {
  assert.match(checkExpectationShape(A({ read: "" }))[0], /non-empty reader name/);
  const noValue = { ...A() };
  delete noValue.value;
  assert.match(checkExpectationShape(noValue).join(" "), /`value` is required/);
  assert.match(checkExpectationShape(A({ because: "  " })).join(" "), /`because` must say why/);
});

test("checkExpectationShape requires a source for grounds B and C only", () => {
  assert.match(checkExpectationShape(A({ ground: "B" })).join(" "), /ground B requires `source`/);
  assert.match(checkExpectationShape(A({ ground: "C" })).join(" "), /ground C requires `source`/);
  assert.deepEqual(checkExpectationShape(A({ ground: "D" })), [], "D needs no external source");
  assert.deepEqual(checkExpectationShape(A({ ground: "A" })), [], "A is sourced from the journal");
});

test("checkExpectationShape refuses an unknown ground", () => {
  assert.match(checkExpectationShape(A({ ground: "E" })).join(" "), /`ground` must be one of/);
  assert.deepEqual(EXPECT_GROUNDS, ["A", "B", "C", "D"]);
});

// --- references -------------------------------------------------------------

test("resolveExpectationRefs reads a value back out of the journal", () => {
  const got = resolveExpectationRefs(A(), JOURNAL);
  assert.deepEqual(got.value, [11, 18, 32]);
  assert.deepEqual(got.trace, { kind: "read", index: 0, reader: "doc.fontSizes" });
});

test("resolveExpectationRefs resolves text the agent itself typed", () => {
  const got = resolveExpectationRefs(A({ op: "contains", value: "@input:1", read: "doc.text" }), JOURNAL);
  assert.equal(got.value, "hello world");
  assert.equal(got.trace.kind, "input");
});

test("resolveExpectationRefs passes a literal through untouched", () => {
  // Legal for grounds B/C/D; `checkGround` is what refuses it for A.
  assert.deepEqual(resolveExpectationRefs(A({ value: 42 }), JOURNAL), { value: 42, trace: null });
});

// The honesty property: a model cannot cite a reading that never happened.
test("resolveExpectationRefs refuses a reference to a step that does not exist", () => {
  assert.equal(resolveExpectationRefs(A({ value: "@read:99" }), JOURNAL), null);
  assert.equal(resolveExpectationRefs(A({ value: "@read:0" }), []), null);
});

test("resolveExpectationRefs refuses a reference to the wrong KIND of step", () => {
  // Step 1 is a `type`, not a `read`.
  assert.equal(resolveExpectationRefs(A({ value: "@read:1" }), JOURNAL), null);
  // Step 0 is a `read`, not a `type`.
  assert.equal(resolveExpectationRefs(A({ value: "@input:0" }), JOURNAL), null);
});

test("resolveExpectationRefs refuses a reference to a step that FAILED", () => {
  // Step 3 read nothing, so it cannot be a baseline for anything.
  assert.equal(resolveExpectationRefs(A({ value: "@read:3" }), JOURNAL), null);
});

// --- evaluation -------------------------------------------------------------

test("evaluateExpectation: each-greater-than on the #343 shape", () => {
  const e = A();
  // Every size rose — the prediction held.
  assert.equal(evaluateExpectation(e, [12, 19, 33], [11, 18, 32]).verdict, "held");
  // All collapsed to the minimum — the defect that issue describes.
  const bad = evaluateExpectation(e, [11, 11, 11], [11, 18, 32]);
  assert.equal(bad.verdict, "violated");
  assert.match(bad.detail, /\[11,18,32\] -> \[11,11,11\]/);
  // Unchanged is a violation too: "increase" that did nothing did not increase.
  assert.equal(evaluateExpectation(e, [11, 18, 32], [11, 18, 32]).verdict, "violated");
});

test("evaluateExpectation: equals / not-equals over reader-shaped values", () => {
  const eq = A({ op: "equals", read: "sheet.cellValue" });
  assert.equal(evaluateExpectation(eq, "5", "5").verdict, "held");
  assert.equal(evaluateExpectation(eq, "6", "5").verdict, "violated");
  assert.equal(evaluateExpectation(eq, [1, 2], [1, 2]).verdict, "held", "deep, not reference, equality");
  const ne = A({ op: "not-equals", read: "sheet.cellValue" });
  assert.equal(evaluateExpectation(ne, "6", "5").verdict, "held");
  assert.equal(evaluateExpectation(ne, "5", "5").verdict, "violated");
});

test("evaluateExpectation: contains / not-contains over strings and arrays", () => {
  const c = A({ op: "contains", read: "doc.text" });
  assert.equal(evaluateExpectation(c, "say hello world", "hello").verdict, "held");
  assert.equal(evaluateExpectation(c, "say goodbye", "hello").verdict, "violated");
  assert.equal(evaluateExpectation(c, ["a", "b"], "b").verdict, "held");
  const n = A({ op: "not-contains", read: "doc.text" });
  assert.equal(evaluateExpectation(n, "clean", "undefined").verdict, "held");
  assert.equal(evaluateExpectation(n, "saved by undefined", "undefined").verdict, "violated");
});

// THE load-bearing distinction in this file. A comparison that cannot be carried out
// must never become a defect: collapsing `unevaluable` into `violated` would turn
// every malformed prediction into a report, which is the failure this module exists
// to prevent.
test("evaluateExpectation: an impossible comparison is UNEVALUABLE, never violated", () => {
  // Numbers demanded, a string read.
  assert.equal(evaluateExpectation(A(), "not a number", [11]).verdict, "unevaluable");
  // Numbers demanded, `undefined` read — an unset style is not a number, and
  // treating it as one would make "everything increased" trivially true.
  assert.equal(evaluateExpectation(A(), [12, undefined], [11, 18]).verdict, "unevaluable");
  // The selection changed size, so the two sides are not about the same things.
  assert.equal(evaluateExpectation(A(), [12, 19], [11, 18, 32]).verdict, "unevaluable");
  // `contains` against a number.
  assert.equal(evaluateExpectation(A({ op: "contains" }), 7, "x").verdict, "unevaluable");
  // An operator outside the set cannot be evaluated either.
  assert.equal(evaluateExpectation(A({ op: "nope" }), 1, 1).verdict, "unevaluable");
});

// --- grounding --------------------------------------------------------------

test("checkGround: ground A traced to the journal is eligible", () => {
  const got = checkGround(A(), { journal: JOURNAL, charter: CHARTER });
  assert.equal(got.eligible, true);
  assert.match(got.why, /traced to journal read #0/);
});

// The single most important rejection here. `ground: "A"` is a claim the model
// makes; a literal means the baseline came from its own belief about how the app
// ought to behave, which is exactly what "the app contradicts itself" must exclude.
test("checkGround: ground A REFUSES a literal value", () => {
  const got = checkGround(A({ value: [11, 18, 32] }), { journal: JOURNAL, charter: CHARTER });
  assert.equal(got.eligible, false);
  assert.match(got.why, /requires `value` to be an @read:\/@input: reference/);
});

test("checkGround: ground A refuses a reference that does not resolve", () => {
  for (const value of ["@read:99", "@read:1", "@read:3"]) {
    const got = checkGround(A({ value }), { journal: JOURNAL, charter: CHARTER });
    assert.equal(got.eligible, false, `${value} must not be eligible`);
    assert.match(got.why, /does not resolve/);
  }
});

// A cross-reader comparison "violates" on almost any input — doc.blockCount was
// never going to equal sheet.cellValue — so it is a category error, not a
// self-contradiction. Still expressible at B/C/D, where something external backs it.
test("checkGround: ground A refuses a reference to a DIFFERENT reader", () => {
  const got = checkGround(A({ read: "doc.blockCount", value: "@read:2" }), { journal: JOURNAL, charter: CHARTER });
  assert.equal(got.eligible, false);
  assert.match(got.why, /different readers are not a self-contradiction/);
});

test("checkGround: ground B needs a citation that locates a line, in docsScope", () => {
  const ok = checkGround(A({ ground: "B", source: "docs/design/cli.md:707" }), { journal: JOURNAL, charter: CHARTER });
  assert.equal(ok.eligible, true);
  // A bare filename locates nothing.
  assert.equal(checkGround(A({ ground: "B", source: "cli.md" }), { journal: JOURNAL, charter: CHARTER }).eligible, false);
  // In-shape but outside the charter's documentation scope.
  const outOfScope = checkGround(A({ ground: "B", source: "packages/cli/src/output/formatter.ts:44" }), {
    journal: JOURNAL,
    charter: CHARTER,
  });
  assert.equal(outOfScope.eligible, false);
  assert.match(outOfScope.why, /outside this charter's docsScope/);
});

test("checkGround: ground C requires the quote to be ON THE PAGE", () => {
  const snapshot = '- button "Increase font size"\n- spinbutton "Font size": "11"';
  const ok = checkGround(A({ ground: "C", source: 'button "Increase font size"' }), { journal: JOURNAL, snapshot, charter: CHARTER });
  assert.equal(ok.eligible, true);
  // A quote the model invented is not in the snapshot.
  const invented = checkGround(A({ ground: "C", source: 'button "Make text bigger"' }), { journal: JOURNAL, snapshot, charter: CHARTER });
  assert.equal(invented.eligible, false);
  assert.match(invented.why, /does not appear in the page snapshot/);
  // And an empty snapshot cannot support any quote.
  assert.equal(checkGround(A({ ground: "C", source: "x" }), { journal: JOURNAL, snapshot: "", charter: CHARTER }).eligible, false);
});

test("checkGround: ground D is NEVER eligible", () => {
  // Well-formed, perfectly plausible, and still not reportable — this is where
  // "Ctrl+Z should undo" lives, and it is sourced from nothing but the model's
  // prior about other software.
  const got = checkGround(A({ ground: "D", value: "@read:0" }), { journal: JOURNAL, charter: CHARTER });
  assert.equal(got.eligible, false);
  assert.match(got.why, /never eligible/);
});

// --- the whole protocol -----------------------------------------------------

test("assessExpectation: a grounded violation is a candidate", () => {
  const got = assessExpectation(A(), [11, 11, 11], { journal: JOURNAL, charter: CHARTER });
  assert.equal(got.verdict, "violated");
  assert.equal(got.eligible, true);
  assert.deepEqual(got.trace, { kind: "read", index: 0, reader: "doc.fontSizes" });
});

test("assessExpectation: a prediction that HELD is never a candidate", () => {
  const got = assessExpectation(A(), [12, 19, 33], { journal: JOURNAL, charter: CHARTER });
  assert.equal(got.verdict, "held");
  assert.equal(got.eligible, false);
});

test("assessExpectation: an ungrounded violation is not a candidate", () => {
  // Really did behave unexpectedly — and the basis is a convention, so it is logged
  // and forgotten rather than reported.
  const got = assessExpectation(A({ ground: "D" }), [11, 11, 11], { journal: JOURNAL, charter: CHARTER });
  assert.equal(got.verdict, "violated", "the mismatch is still recorded");
  assert.equal(got.eligible, false, "but it cannot become a report");
});

test("assessExpectation: the ground is checked AFTER the comparison", () => {
  // So the log can distinguish "predicted wrongly" from "predicted on a basis we do
  // not accept". A ground-D prediction that HELD reports `held`, not the ground.
  assert.equal(assessExpectation(A({ ground: "D" }), [12, 19, 33], { journal: JOURNAL, charter: CHARTER }).why, "prediction held");
});

test("assessExpectation: malformed and unresolvable predictions are unevaluable, not violations", () => {
  const malformed = assessExpectation(A({ op: "vibes" }), [1], { journal: JOURNAL, charter: CHARTER });
  assert.equal(malformed.verdict, "unevaluable");
  assert.equal(malformed.eligible, false);
  assert.match(malformed.why, /malformed prediction/);

  const dangling = assessExpectation(A({ value: "@read:99" }), [1], { journal: JOURNAL, charter: CHARTER });
  assert.equal(dangling.verdict, "unevaluable");
  assert.equal(dangling.eligible, false);
  assert.match(dangling.why, /does not resolve/);
});

test("assessExpectation: no ground can make an unevaluable comparison reportable", () => {
  for (const ground of EXPECT_GROUNDS) {
    const e = ground === "A" ? A() : A({ ground, source: "docs/design/cli.md:1", value: "@read:0" });
    const got = assessExpectation(e, "not a number", { journal: JOURNAL, snapshot: "docs/design/cli.md:1", charter: CHARTER });
    assert.equal(got.verdict, "unevaluable", `ground ${ground}`);
    assert.equal(got.eligible, false, `ground ${ground} must not be eligible on an unevaluable comparison`);
  }
});
