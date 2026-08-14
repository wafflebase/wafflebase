import { strict as assert } from "node:assert";
import test from "node:test";

import {
  assessExpectation,
  checkExpectationShape,
  checkGround,
  evaluateExpectation,
  boundValue,
  isUnusableValue,
  MAX_VALUE_CHARS,
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
  // `atIndex` supplied because A()'s default op asserts a change, and the window for
  // that is only checkable when the predicting step is known. The tool always passes it.
  const got = checkGround(A(), { journal: JOURNAL, charter: CHARTER, atIndex: 1 });
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
  const got = assessExpectation(A(), [11, 11, 11], { journal: JOURNAL, charter: CHARTER, atIndex: 1 });
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

// --- review findings, each pinned -------------------------------------------

// The contract the runner's `boundValue` docblock asserted and nothing implemented.
// An oversized read against a resolved ground-A baseline produced `violated` and an
// ELIGIBLE candidate: a false finding built from a value the runner had already said
// it could not measure.
test("REGRESSION: an oversized/unserializable marker is unevaluable, never a verdict", () => {
  const marker = { __oversized: true, chars: 25_000 };
  assert.equal(isUnusableValue(marker), true);
  assert.equal(isUnusableValue({ __unserializable: true }), true);
  assert.equal(isUnusableValue([11, 18, 32]), false);
  assert.equal(isUnusableValue(null), false, "null is a legitimate reader value, not a marker");

  // Either side unusable → no comparison, whatever the operator.
  for (const op of EXPECT_OPS) {
    assert.equal(evaluateExpectation(A({ op }), marker, [11, 18, 32]).verdict, "unevaluable", `actual, ${op}`);
    assert.equal(evaluateExpectation(A({ op }), [11, 18, 32], marker).verdict, "unevaluable", `baseline, ${op}`);
  }
  // Two markers previously reported `held` for equals — worse than a false violation,
  // because it hid a real difference.
  assert.equal(evaluateExpectation(A({ op: "equals" }), marker, marker).verdict, "unevaluable");
  assert.equal(evaluateExpectation(A({ op: "not-equals" }), marker, marker).verdict, "unevaluable");

  // And end to end: not eligible, so it cannot become a report.
  const got = assessExpectation(A(), marker, { journal: JOURNAL, charter: CHARTER });
  assert.equal(got.verdict, "unevaluable");
  assert.equal(got.eligible, false);
});

test("REGRESSION: a marker can never serve as a @read baseline", () => {
  const journal = [{ action: { type: "read", reader: "doc.fontSizes" }, ok: true, value: { __oversized: true, chars: 9 } }];
  assert.equal(resolveExpectationRefs(A(), journal), null);
});

// The runner emits `actualError` when the prediction read throws, and nothing consumed
// it — so a browser failure surfaced as `actual: null`, compared cleanly to a resolved
// baseline, and became an eligible candidate. Infrastructure manufacturing a report.
test("REGRESSION: a failed prediction read is unevaluable, not a violation", () => {
  const got = assessExpectation(A({ op: "equals", read: "sheet.cellValue" }), null, {
    journal: JOURNAL,
    charter: CHARTER,
    actualError: "hunt bridge is not installed",
  });
  assert.equal(got.verdict, "unevaluable");
  assert.equal(got.eligible, false);
  assert.match(got.why, /prediction read failed/);
});

// The discriminator is `actualError`, NOT `actual === null`. Null is a real reading —
// an empty cell, an absent selection — and treating it as unevaluable would blind the
// hunter to every defect about emptiness.
test("a legitimate null reading is still judged", () => {
  const journal = [{ action: { type: "read", reader: "sheet.cellValue" }, ok: true, value: "10" }];
  const e = { read: "sheet.cellValue", op: "equals", value: "@read:0", ground: "A", because: "x" };
  const got = assessExpectation(e, null, { journal, charter: CHARTER });
  assert.equal(got.verdict, "violated", "cell went from 10 to empty — that is a real observation");
  assert.equal(got.eligible, true);
});

// A `read` action carrying `not-equals @read:<its own index>` compares a reading to
// itself, so it violated every time while passing every grounding check — traceable,
// same-reader, and deterministic on replay.
test("REGRESSION: a reference must point BEFORE the predicting action", () => {
  const e = { read: "doc.text", op: "not-equals", value: "@read:0", ground: "A", because: "x" };
  const journal = [{ action: { type: "read", reader: "doc.text", expect: e }, ok: true, value: "hello" }];

  // Self-reference: refused once the caller says which step is predicting.
  assert.equal(resolveExpectationRefs(e, journal, { atIndex: 0 }), null);
  const selfRef = assessExpectation(e, "hello", { journal, charter: CHARTER, atIndex: 0 });
  assert.equal(selfRef.eligible, false);
  assert.match(selfRef.why, /EARLIER/);

  // A forward reference is refused too.
  assert.equal(resolveExpectationRefs({ ...e, value: "@read:5" }, journal, { atIndex: 2 }), null);

  // A PRESENT but malformed index must not wave the check through. It used to: the
  // guard tested `!Number.isInteger(atIndex)`, which is true for "0" and 0.5, so a
  // caller with an off-by-one in its own bookkeeping silently re-enabled the
  // self-reference generator. Only absence means "cannot check".
  for (const bad of ["0", 0.5, Number.NaN, -1, {}, []]) {
    assert.equal(
      resolveExpectationRefs(e, journal, { atIndex: bad }),
      null,
      `atIndex ${JSON.stringify(bad) ?? String(bad)} must not resolve`,
    );
    const assessed = assessExpectation(e, "hello", { journal, charter: CHARTER, atIndex: bad });
    assert.equal(assessed.eligible, false, `atIndex ${String(bad)} must not be eligible`);
  }
  // Absent still means "the caller cannot say", which stays permissive by design —
  // the orchestrator is what must pass it.
  assert.ok(resolveExpectationRefs(e, journal, { atIndex: null }));
  assert.ok(resolveExpectationRefs(e, journal, {}));
  // And a genuinely earlier one still resolves.
  const later = [...journal, { action: { type: "key", key: "x" }, ok: true, value: null }];
  assert.ok(resolveExpectationRefs(e, later, { atIndex: 1 }));
});

test("contains does not coerce a non-string expectation", () => {
  // String({}) is "[object Object]", which then genuinely "was not present" — turning
  // a malformed prediction into a violation.
  const e = A({ op: "contains", read: "doc.text" });
  assert.equal(evaluateExpectation(e, "some text", { a: 1 }).verdict, "unevaluable");
  assert.equal(evaluateExpectation(e, "some text", 42).verdict, "unevaluable");
  assert.equal(evaluateExpectation(e, "some text", "text").verdict, "held");
});

test("each-* over an empty list is unevaluable, not a vacuous pass", () => {
  // [].every(...) is true, so this used to report `held` while asserting nothing.
  assert.equal(evaluateExpectation(A(), [], []).verdict, "unevaluable");
});

test("sameValue is key-order independent and keeps undefined distinct from null", () => {
  const e = A({ op: "equals", read: "doc.styleSummary" });
  // Reader-assembled objects need not agree on key order between runs.
  assert.equal(evaluateExpectation(e, { bold: true, fontSize: 11 }, { fontSize: 11, bold: true }).verdict, "held");
  // An unset style and a present-null are different observations.
  assert.equal(evaluateExpectation(e, { fontSize: undefined }, { fontSize: null }).verdict, "violated");
});

test("ground B bounds its source and rejects traversal", () => {
  const long = `${"a".repeat(400)}.md:1`;
  const bounded = checkGround(A({ ground: "B", source: long }), { journal: JOURNAL, charter: CHARTER });
  assert.equal(bounded.eligible, false);
  assert.match(bounded.why, /chars; keep it under/);

  const traversal = checkGround(A({ ground: "B", source: "docs/design/../../etc/passwd:1" }), {
    journal: JOURNAL,
    charter: CHARTER,
  });
  assert.equal(traversal.eligible, false);
  assert.match(traversal.why, /must not contain/);
});

test("the ground-C quote ceiling is enforced", () => {
  const quote = "x".repeat(201);
  const got = checkGround(A({ ground: "C", source: quote }), { journal: JOURNAL, snapshot: quote, charter: CHARTER });
  assert.equal(got.eligible, false);
  assert.match(got.why, /keep it under 200/);
});

test("an @input-based ground A is eligible", () => {
  // The other half of ground A: the app should reflect what the agent typed.
  const e = { read: "doc.text", op: "contains", value: "@input:1", ground: "A", because: "typed text appears" };
  const got = assessExpectation(e, "before hello world after", { journal: JOURNAL, charter: CHARTER, atIndex: 4 });
  assert.equal(got.verdict, "held");
  const violated = assessExpectation(e, "nothing landed", { journal: JOURNAL, charter: CHARTER, atIndex: 4 });
  assert.equal(violated.verdict, "violated");
  assert.equal(violated.eligible, true);
});

test("checkExpectationShape requires args to be an array", () => {
  assert.match(checkExpectationShape(A({ args: "A1" })).join(" "), /`args` must be an array/);
  assert.deepEqual(checkExpectationShape(A({ args: ["A1"] })), []);
});

// --- boundValue: the producer half of the marker contract --------------------

// Untestable while it lived in the Playwright driver (importing that boots Vite), which
// is how it came to promise a behaviour the protocol did not implement.
test("boundValue keeps a normal value exactly as-is", () => {
  for (const v of [[11, 18, 32], "hello", 42, true, null, { a: 1 }]) {
    assert.deepEqual(boundValue(v), v);
  }
});

test("boundValue normalises undefined to null", () => {
  // JSON.stringify(undefined) is undefined, which would drop the field entirely and
  // make "the reader returned nothing" indistinguishable from "there was no read".
  assert.equal(boundValue(undefined), null);
});

test("boundValue substitutes a marker rather than truncating", () => {
  const big = "x".repeat(MAX_VALUE_CHARS + 1);
  const got = boundValue(big);
  assert.equal(got.__oversized, true);
  assert.ok(got.chars > MAX_VALUE_CHARS);
  // The point of the marker: nothing downstream can mistake it for the value.
  assert.equal(isUnusableValue(got), true);
  assert.equal(typeof got === "string", false, "a shortened string would compare wrongly");
});

test("boundValue marks an unserializable value instead of throwing", () => {
  const circular = {};
  circular.self = circular;
  const got = boundValue(circular);
  assert.deepEqual(got, { __unserializable: true });
  assert.equal(isUnusableValue(got), true);
});

test("boundValue's markers round-trip to unevaluable, end to end", () => {
  // The contract that was asserted in prose and implemented nowhere: what the producer
  // emits, the evaluator must refuse to judge.
  const big = boundValue("y".repeat(MAX_VALUE_CHARS + 1));
  const journal = [{ action: { type: "read", reader: "doc.text" }, ok: true, value: "small" }];
  const e = { read: "doc.text", op: "equals", value: "@read:0", ground: "A", because: "x" };
  const got = assessExpectation(e, big, { journal, charter: CHARTER, atIndex: 1 });
  assert.equal(got.verdict, "unevaluable");
  assert.equal(got.eligible, false);
});

// --- an assertion of CHANGE needs something that could have changed it ----------

// The `atIndex` rule stops a prediction citing its own step. It did not stop the same
// generator spread across two: read, read again, predict `not-equals` against the first.
// A live session produced exactly that within four actions and it reported GROUNDED.
test("REGRESSION: ground A refuses a change assertion with no acting step", () => {
  const journal = [
    { action: { type: "read", reader: "doc.text" }, ok: true, value: "same" }, // 0
    { action: { type: "read", reader: "doc.text" }, ok: true, value: "same" }, // 1  <- predicting
  ];
  const e = { read: "doc.text", op: "not-equals", value: "@read:0", ground: "A", because: "vacuous" };
  const got = assessExpectation(e, "same", { journal, charter: CHARTER, atIndex: 1 });
  assert.equal(got.verdict, "violated", "the comparison genuinely failed");
  assert.equal(got.eligible, false, "but nothing could have caused the change it asserts");
  assert.match(got.why, /could have caused one/);
});

test("ground A allows a change assertion when an acting step is in the window", () => {
  // The PREDICTING action is usually the change: "I click, and expect the sizes to
  // differ". The window is inclusive of it for exactly this reason.
  const journal = [
    { action: { type: "read", reader: "doc.fontSizes" }, ok: true, value: [11, 18, 32] },
    { action: { type: "click", target: { role: "button", name: "Increase font size" } }, ok: true, value: null },
  ];
  const e = { read: "doc.fontSizes", op: "not-equals", value: "@read:0", ground: "A", because: "click changes sizes" };
  const got = assessExpectation(e, [11, 18, 32], { journal, charter: CHARTER, atIndex: 1 });
  assert.equal(got.verdict, "violated");
  assert.equal(got.eligible, true);
});

test("every change-asserting operator is covered, and the value-asserting ones are not", () => {
  const journal = [
    { action: { type: "read", reader: "doc.fontSizes" }, ok: true, value: [11, 18] },
    { action: { type: "read", reader: "doc.fontSizes" }, ok: true, value: [11, 18] },
  ];
  const at = { journal, charter: CHARTER, atIndex: 1 };
  const e = (op) => ({ read: "doc.fontSizes", op, value: "@read:0", ground: "A", because: "x" });

  // Vacuously violated when nothing happened — all must be refused.
  for (const op of ["not-equals", "each-greater-than", "each-less-than"]) {
    assert.equal(assessExpectation(e(op), [11, 18], at).eligible, false, `${op} must be refused`);
  }
  // `equals` is safe by construction: an unchanged value simply satisfies it, so the
  // rule must not fire and cost a legitimate observation.
  assert.equal(assessExpectation(e("equals"), [11, 18], at).verdict, "held");
  // And when it genuinely differs with no acting step, that IS reportable — the value
  // changed on its own, which is a real self-contradiction.
  assert.equal(assessExpectation(e("equals"), [99, 99], at).eligible, true);
});

test("a change assertion is refused when the window cannot be established", () => {
  // Fails closed: a check that cannot run is not a check that passed.
  const journal = [{ action: { type: "read", reader: "doc.text" }, ok: true, value: "a" }];
  const e = { read: "doc.text", op: "not-equals", value: "@read:0", ground: "A", because: "x" };
  // Same value, so `not-equals` genuinely violates and the ground check is reached.
  const got = assessExpectation(e, "a", { journal, charter: CHARTER });
  assert.equal(got.verdict, "violated");
  assert.equal(got.eligible, false);
  assert.match(got.why, /which step is predicting/);
});

test("an @input baseline is grounded by the typing action itself", () => {
  // The window starts AT the baseline, so `type` at the referenced index counts.
  const journal = [
    { action: { type: "type", text: "hello" }, ok: true, value: null },
    { action: { type: "key", key: "Enter" }, ok: true, value: null },
  ];
  const e = { read: "doc.text", op: "not-contains", value: "@input:0", ground: "A", because: "text should have landed" };
  // `not-contains` violates when the text IS there — "I typed it and it is present"
  // is the held case, so the reportable one is the opposite.
  const got = assessExpectation(e, "hello is right there", { journal, charter: CHARTER, atIndex: 1 });
  assert.equal(got.verdict, "violated");
  assert.equal(got.eligible, true);
});
