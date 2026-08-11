import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAnchor, anchorIsEmpty, compareAnchors, linesOverlap,
  matchFindings, tokenOverlap, bestMatch, groupFindings, LINKAGE,
} from "./finding-match.mjs";
import { findingSimilarity } from "./rounds.mjs";
import { findingKey } from "./finding-key.mjs";

test("extractAnchor: pulls backticked symbols from real-shaped evidence", () => {
  // modeled on the pr-521 resolveRange finding
  const a = extractAnchor({
    file: "packages/sheets/src/model/core/coordinates.ts",
    summary: "`resolveRange` throws a raw TypeError on a reference without ':'",
    evidence: "`resolveRange` does `const [fromStr, toStr] = srng.split(':')`; `parsePartialRef(undefined)` dereferences `.replace`",
  });
  const lower = a.symbols.map((s) => s.toLowerCase());
  assert.ok(lower.includes("resolverange"));
  assert.ok(lower.includes("parsepartialref"));
  assert.ok(lower.includes("frompstr") === false); // sanity: made-up token absent
  assert.ok(!lower.includes("const")); // stopword dropped
});

test("extractAnchor: keeps dotted chains whole AND split into segments", () => {
  const a = extractAnchor({ file: "x.ts", summary: "`Sheet.getUsedBounds()` awaits per formula cell", evidence: "" });
  const lower = a.symbols.map((s) => s.toLowerCase());
  assert.ok(lower.includes("sheet.getusedbounds")); // whole chain
  assert.ok(lower.includes("getusedbounds"));        // segment
});

test("extractAnchor: prose call-sites count as symbols", () => {
  const a = extractAnchor({ file: "x.ts", summary: "the diff never updates extractFormulaRanges(), which still parses every token", evidence: "" });
  assert.ok(a.symbols.map((s) => s.toLowerCase()).includes("extractformularanges"));
});

test("extractAnchor: line hints → soft ranges (single and span)", () => {
  const a = extractAnchor({ file: "x.ts", summary: "introduces <Tooltip> at lines ~626-640", evidence: "throws at line 214" });
  assert.deepEqual(a.lines.sort((p, q) => p[0] - q[0]), [[214, 214], [626, 640]]);
});

test("extractAnchor: reads CodeRabbit's `around lines N - M` form", () => {
  // The `🤖 Prompt for AI Agents` block every CodeRabbit finding carries states an
  // exact, GitHub-anchored range. It is the most precise location signal available
  // in a review comment and appears nowhere else in the body, so the harvester
  // feeds the whole comment to the anchor layer specifically to reach it.
  const a = extractAnchor({
    file: "packages/docs/src/view/text-editor.ts",
    summary: "Guard public mutation APIs at the read-only boundary.",
    evidence: "In `@packages/docs/src/view/text-editor.ts` around lines 395 - 397, enforce read-only mode",
  });
  assert.deepEqual(a.lines, [[395, 397]]);
});

test("extractAnchor: path:line suffix contributes a line", () => {
  const a = extractAnchor({ file: "a.ts", summary: "", evidence: "the input parser (input.ts:242) already treats TRUE/FALSE case-insensitively" });
  assert.ok(a.lines.some(([s, e]) => s === 242 && e === 242));
});

test("extractAnchor: names OTHER files but not the finding's own file", () => {
  const a = extractAnchor({
    file: "packages/sheets/src/formula/formula.ts",
    summary: "reconstructed string is fed to extractReferences in calculator.ts",
    evidence: "docs/design/sheets/formula.md claims whole-column highlighting; formula.ts is unchanged",
  });
  assert.ok(a.files.includes("calculator.ts"));
  assert.ok(a.files.includes("docs/design/sheets/formula.md"));
  assert.ok(!a.files.includes("packages/sheets/src/formula/formula.ts")); // own file excluded
});

test("extractAnchor: a backticked PATH is a file, never a bag of symbols", () => {
  // CodeRabbit backticks the file path on every finding. Running the identifier
  // scanner over it as well would mint `packages`/`docs`/`src`/`view` as SYMBOLS,
  // so any two findings under one directory would "share symbols" on tree
  // vocabulary alone — and `symbolOverlap` is read as location evidence.
  const a = extractAnchor({
    file: "",
    summary: "see `@packages/docs/src/view/text-editor.ts` for the guard",
    evidence: "",
  });
  assert.deepEqual(a.symbols, []);
  assert.ok(a.files.includes("packages/docs/src/view/text-editor.ts"));
});

test("extractAnchor: symbols are deduped case-insensitively, original casing kept", () => {
  const a = extractAnchor({ file: "x.ts", summary: "`toRange` then `toRange`", evidence: "`ToRange`" });
  const toRange = a.symbols.filter((s) => s.toLowerCase() === "torange");
  assert.equal(toRange.length, 1);
  assert.equal(toRange[0], "toRange"); // first-seen casing
});

test("anchorIsEmpty: true only when no symbol, line, or extra file", () => {
  assert.equal(anchorIsEmpty(extractAnchor({ file: "x.ts", summary: "a vague prose finding with no code or location", evidence: "" })), true);
  assert.equal(anchorIsEmpty(extractAnchor({ file: "x.ts", summary: "`foo()` bug", evidence: "" })), false);
});

// --- anchor comparison ------------------------------------------------------

test("linesOverlap: window-tolerant, never exact equality", () => {
  assert.equal(linesOverlap([[100, 100]], [[108, 108]]), true);  // within the 15-line window
  assert.equal(linesOverlap([[100, 100]], [[200, 200]]), false); // far apart
  assert.equal(linesOverlap([[100, 140]], [[135, 150]]), true);  // ranges genuinely overlap
  assert.equal(linesOverlap([], [[1, 1]]), false);               // nothing to compare
});

test("compareAnchors: symbol containment + null when one side names nothing", () => {
  const a = { symbols: ["resolveRange", "toRange"], lines: [], files: [] };
  const b = { symbols: ["resolveRange"], lines: [], files: [] };
  const c = compareAnchors(a, b);
  assert.equal(c.sharedSymbols, 1);
  assert.equal(c.symbolOverlap, 1);           // containment over the SMALLER set
  assert.equal(compareAnchors(a, { symbols: [], lines: [], files: [] }).symbolOverlap, null);
});

// --- L0 / L1 (same-run) -----------------------------------------------------

const pf = (file, summary, evidence = "", lens = "correctness") => ({ lens, file, summary, evidence });

test("matchFindings L0: two wordings of ONE defect in the same file → match", () => {
  const a = pf("arguments.ts", "blank-skip in `Arguments.iterate` makes MIN/MAX over an all-blank range return #NUM!");
  const b = pf("arguments.ts", "`Arguments.iterate` blank skipping causes MIN and MAX over blank ranges to return #NUM! instead of 0");
  const r = matchFindings(a, b);
  assert.equal(r.verdict, "match");
  assert.ok(r.score >= 0.3);
});

test("matchFindings L0: different file or lens → no (the same-run gate)", () => {
  const a = pf("a.ts", "`foo()` mishandles blank cells returning #NUM!");
  assert.equal(matchFindings(a, pf("b.ts", "`foo()` mishandles blank cells returning #NUM!")).verdict, "no");
  assert.equal(matchFindings(a, pf("a.ts", "`foo()` mishandles blank cells returning #NUM!", "", "security")).verdict, "no");
});

test("matchFindings L1: same file, high token overlap, but DISJOINT anchors → demoted to maybe", () => {
  // Two genuinely different defects that share generic vocabulary in one file.
  const a = pf("plugin.ts", "the relaxation accepts markers and changes paragraph interrupt behaviour for notes", "`isEmptyBulletLine` is the culprit");
  const b = pf("plugin.ts", "the relaxation accepts markers and changes paragraph interrupt behaviour for notes", "`getRuleFn` is the culprit");
  const r = matchFindings(a, b);
  assert.equal(r.verdict, "maybe");
  assert.equal(r.method, "L1-anchor");
  assert.match(r.reason, /share no symbol/);
});

test("matchFindings L1: below the token bar but anchors agree → maybe, not no", () => {
  const a = pf("x.ts", "guard is missing entirely here", "`toggleCheckboxAt` at lines 3837-3841");
  const b = pf("x.ts", "formula cells are silently overwritten by the toggle path", "`toggleCheckboxAt` at line 3840");
  const r = matchFindings(a, b);
  assert.equal(r.verdict, "maybe");
  assert.equal(r.method, "L1-anchor");
});

// --- regressions for the two traps this module is built around --------------

test("regression: a 0 from findingSimilarity is NOT read as 'different file'", () => {
  // `findingSimilarity` returns 0 for two unrelated reasons: the (lens, file) gate
  // failed, or the files match and the summaries share fewer than
  // MIN_SHARED_TOKENS. Inferring the gate from `sim === 0` conflates them and
  // skips the anchor check on the second — which is exactly the case where the
  // anchor is the only evidence there is. The gate is therefore checked directly.
  const a = pf("x.ts", "guard is missing entirely here", "`toggleCheckboxAt` at lines 3837-3841");
  const b = pf("x.ts", "formula cells are silently overwritten by the toggle path", "`toggleCheckboxAt` at line 3840");
  assert.equal(findingSimilarity(a, b), 0);           // same lens+file, under the token floor
  assert.equal(matchFindings(a, b).verdict, "maybe"); // anchors still get a say
});

test("regression: symbolOverlap null means NO EVIDENCE, never disagreement", () => {
  // `null` is "one side named no symbol at all". Only 0 — both named symbols and
  // they share none — is disagreement. Reading null as disagreement would demote
  // every pair where one reviewer wrote prose without backticks.
  const withSyms = pf("x.ts", "`Arguments.iterate` skips blanks so MIN and MAX return the wrong aggregate");
  const noSyms = { file: "x.ts", summary: "iterate skips blanks so MIN and MAX return the wrong aggregate", evidence: "" };
  assert.equal(compareAnchors(extractAnchor(withSyms), extractAnchor(noSyms)).symbolOverlap, null);
  const r = matchFindings(withSyms, noSyms, { crossSource: true });
  assert.equal(r.verdict, "match");
  assert.doesNotMatch(r.reason, /disjoint/);
});

test("regression: anchors can DEMOTE but never PROMOTE — a shared symbol is not a match", () => {
  // Measured over 1,249 real pairs, 55% share at least one symbol: in a focused PR
  // nearly every finding names the same identifiers. Two distinct defects that
  // both touch `parseARef`, with no summary vocabulary in common, must not merge.
  // Keying the gate on `max(tokens, symbolOverlap)` would match them at 1.00,
  // because symbolOverlap is 1.0 whenever both sides name one symbol and it is
  // the same one.
  const a = pf("formula.ts", "`parseARef` is called without a guard on the row index");
  const b = { file: "formula.ts", summary: "the dependants map enumerates populated cells on each recalculation", evidence: "`parseARef` appears here too" };
  assert.equal(tokenOverlap(a.summary, b.summary), 0);
  assert.equal(compareAnchors(extractAnchor(a), extractAnchor(b)).symbolOverlap, 1);
  assert.equal(matchFindings(a, b, { crossSource: true }).verdict, "maybe");
});

test("regression: the MIN_SHARED_TOKENS floor survives into tokenOverlap", () => {
  // Two shared words out of a six-token summary is 0.33 — over DEFAULT_SIMILARITY,
  // and meaningless. The floor is what makes 0.3 mean what it was calibrated to
  // mean, and cross-source summaries (a CodeRabbit title is ~6 tokens) are exactly
  // where summaries get short enough for it to matter.
  assert.equal(tokenOverlap("guard mutation boundary", "guard mutation elsewhere"), 0);
  assert.ok(tokenOverlap("guard mutation boundary apis", "guard mutation boundary elsewhere") > 0);
});

// --- L2 (cross-source) ------------------------------------------------------

test("matchFindings L2: cross-source, DIFFERENT files, same defect → match via evidence-named file", () => {
  // Our panel blames arguments.ts; the other source blames functions-statistical.ts
  // but names arguments.ts in its prose. The absolute file gate would score this 0.
  const panel = pf("packages/sheets/src/formula/arguments.ts",
    "blank-skip in `Arguments.iterate` makes MIN/MAX over an all-blank range return #NUM!");
  const other = {
    file: "packages/sheets/src/formula/functions-statistical.ts",
    summary: "MIN/MAX over an all-blank range returns #NUM! — blank-skip in `Arguments.iterate`",
    evidence: "root cause lives in packages/sheets/src/formula/arguments.ts",
  };
  assert.equal(matchFindings(panel, other).verdict, "no"); // same-run gate rejects (different file)
  const r = matchFindings(panel, other, { crossSource: true });
  assert.equal(r.verdict, "match");
  assert.equal(r.method, "L2-xsource");
});

test("matchFindings L2: never matches on text alone — no location tie and no shared symbol → no", () => {
  const a = pf("a.ts", "the validation guard is missing so invalid input is accepted downstream");
  const b = { file: "totally/other.ts", summary: "the validation guard is missing so invalid input is accepted downstream", evidence: "" };
  const r = matchFindings(a, b, { crossSource: true });
  assert.equal(r.verdict, "no");
  assert.match(r.reason, /no location tie/);
});

test("matchFindings L2: same file but only weak content agreement → maybe (adjudication queue)", () => {
  const a = pf("plugin.ts", "`isEmptyBulletLine` has no 4-space indent ceiling");
  const b = { file: "plugin.ts", summary: "nitpick about `isEmptyBulletLine` markers", evidence: "at line 214" };
  const r = matchFindings(a, b, { crossSource: true });
  assert.ok(r.verdict === "maybe" || r.verdict === "match"); // shares a symbol + file
  assert.equal(r.method, "L2-xsource");
});

test("matchFindings L2: an empty file on one side is ABSENT, not equal", () => {
  // A panel finding can carry no `file` (the infra-record shape). Two empty
  // strings must not read as "the same file" and hand the pair a location score
  // of 1 it has not earned.
  const a = pf("", "the paste path mutates the store while the editor is read-only");
  const b = { file: "", summary: "the paste path mutates the store while the editor is read-only", evidence: "" };
  assert.equal(matchFindings(a, b, { crossSource: true }).verdict, "no");
});

test("matchFindings: basename agreement counts as a partial location tie", () => {
  const a = pf("packages/sheets/src/formula/arguments.ts", "`Arguments.iterate` blank skip breaks MIN and MAX aggregation");
  const b = { file: "arguments.ts", summary: "`Arguments.iterate` blank skip breaks MIN and MAX aggregation", evidence: "" };
  assert.equal(matchFindings(a, b, { crossSource: true }).verdict, "match");
});

test("matchFindings: missing operand → no, never a throw", () => {
  assert.equal(matchFindings(null, pf("a.ts", "x")).verdict, "no");
  assert.equal(matchFindings(pf("a.ts", "x"), undefined).verdict, "no");
});

test("tokenOverlap: containment over the smaller summary; empty → 0", () => {
  assert.equal(tokenOverlap("blank skip breaks minmax aggregation", "blank skip breaks minmax aggregation"), 1);
  assert.equal(tokenOverlap("", "anything here"), 0);
});

test("bestMatch: each CANDIDATE is judged on its OWN anchor, not the needle's", () => {
  // `bestMatch` mines the needle's anchor once and reuses it across candidates.
  // Reusing it for the CANDIDATE too would make every candidate look like it
  // agreed with the needle on symbols, which is a promotion on location alone —
  // the one thing the anchor layer must never do. Same summary on all three, so
  // the only thing separating them is whose symbols each one names.
  const summary = "the paste handler bypasses the read only guard on the editor surface";
  const needle = { lens: "", file: "a.ts", summary, evidence: "`alphaHelper()` is the culprit" };
  const disagrees = { lens: "", file: "a.ts", summary, evidence: "`betaHelper()` is the culprit" };
  const agrees = { lens: "", file: "a.ts", summary, evidence: "`alphaHelper()` again" };
  assert.equal(bestMatch(needle, [disagrees], { crossSource: true }).result.verdict, "maybe");
  assert.equal(bestMatch(needle, [agrees], { crossSource: true }).result.verdict, "match");
  // and the disagreeing candidate must not outrank the agreeing one
  assert.equal(bestMatch(needle, [disagrees, agrees], { crossSource: true }).index, 1);
});

test("bestMatch: a null candidate is a `no`, never a throw", () => {
  const needle = { lens: "", file: "a.ts", summary: "the retry loop never resets its backoff between attempts" };
  assert.equal(bestMatch(needle, [null, undefined]), null);
  assert.equal(bestMatch(null, [needle]), null);
});

test("bestMatch: picks the strongest candidate and prefers match over maybe", () => {
  const needle = pf("a.ts", "`resolveRange` throws a raw TypeError on a reference without a colon");
  const candidates = [
    pf("a.ts", "completely unrelated rendering glitch in the toolbar widget"),
    pf("a.ts", "`resolveRange` raises a raw TypeError for a reference lacking a colon"),
  ];
  const best = bestMatch(needle, candidates);
  assert.equal(best.index, 1);
  assert.equal(best.result.verdict, "match");
  // nothing plausible at all → null
  assert.equal(bestMatch(needle, [pf("z.ts", "unrelated")]), null);
});

// --- grouping: defect classes ------------------------------------------------
//
// The fixtures below are deliberately constructed rather than sampled, because
// every one of them is a way this class of code produces garbage that no test
// notices: an over-merged group destroys information nothing downstream can
// recover, and merging always makes the output SMALLER, which reads as success.

/** A panel finding, attributed and provenanced, so the per-pair gate is derivable. */
const gf = (file, summary, evidence = "", extra = {}) => ({
  lens: "correctness",
  file,
  summary,
  evidence,
  item_id: "pr-548",
  arm: "panel",
  run_id: "run-1",
  ...extra,
});

/** A~B and B~C are both `match`; A~C is `no`. Verified pairwise in the first test
 *  below rather than assumed, so a change to the similarity metric reddens the
 *  premise instead of quietly turning this into a different fixture. */
const CHAIN = {
  a: gf("editor.ts", "the paste handler bypasses the read only guard on the editor surface"),
  b: gf("editor.ts", "the paste handler bypasses the clipboard sanitiser before insertion"),
  c: gf("editor.ts", "the clipboard sanitiser strips attributes before insertion into the model"),
};

const idsOf = (r) => r.groups.map((g) => g.id);
const shapeOf = (r) => r.groups.map((g) => [g.id, g.members.map((m) => m.finding.summary).sort()]);

test("groupFindings: the A~B~C fixture really is a chain — match, match, no", () => {
  assert.equal(matchFindings(CHAIN.a, CHAIN.b).verdict, "match");
  assert.equal(matchFindings(CHAIN.b, CHAIN.c).verdict, "match");
  assert.equal(matchFindings(CHAIN.a, CHAIN.c).verdict, "no");
});

test("groupFindings LINKAGE: complete, so an A~B~C chain does NOT become one class", () => {
  // Single linkage (transitive closure) would answer 1 group of 3 here, and that
  // is the failure this policy exists to prevent: the class would assert "A and C
  // are one defect" when the matcher says they are not, and no pair witnesses it.
  const r = groupFindings([CHAIN.a, CHAIN.b, CHAIN.c]);
  assert.equal(LINKAGE, "complete");
  assert.equal(r.stats.linkage, LINKAGE);
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groups.map((g) => g.size).sort(), [1, 2]);
  // B~C is the stronger pair (0.57 vs 0.43), so it merges first and A is left out.
  const pair = r.groups.find((g) => g.size === 2);
  assert.deepEqual(
    pair.members.map((m) => m.finding.summary).sort(),
    [CHAIN.b.summary, CHAIN.c.summary].sort(),
  );
});

test("groupFindings LINKAGE: the match complete linkage DECLINED is recorded, not lost", () => {
  // This is the one place complete linkage loses information relative to single
  // linkage, so it may not be implied by an absence. A~B is a real `match` and it
  // has to reach a reader, together with the pair that blocked the merge.
  const r = groupFindings([CHAIN.a, CHAIN.b, CHAIN.c]);
  const held = r.links.filter((l) => l.verdict === "match");
  assert.equal(held.length, 1);
  assert.equal(r.stats.links.match_held_apart, 1);
  assert.deepEqual(held[0].keys.sort(), [findingKey(CHAIN.a), findingKey(CHAIN.b)].sort());
  assert.notEqual(held[0].groups[0], held[0].groups[1]);
  // …and it names WHICH pair stopped it, which is the A~C `no`.
  assert.ok(held[0].blocked_by, "a held-apart match must say what blocked it");
  assert.equal(held[0].blocked_by.verdict, "no");
});

test("groupFindings: order independence — a shuffle yields identical groups AND identical ids", () => {
  // A greedy first-match-wins loop over the input passes on a sorted fixture and
  // fails here. The permutations are fixed rather than random so a failure is
  // reproducible from the test name alone.
  const findings = [
    CHAIN.a,
    CHAIN.b,
    CHAIN.c,
    gf("other.ts", "the autosave timer keeps firing after the document is disposed"),
    gf("other.ts", "the autosave timer is never cleared once the document has been disposed"),
  ];
  const base = groupFindings(findings);
  const permutations = [
    [4, 3, 2, 1, 0],
    [2, 0, 4, 1, 3],
    [1, 4, 0, 3, 2],
    [3, 1, 2, 4, 0],
  ];
  for (const order of permutations) {
    const shuffled = groupFindings(order.map((i) => findings[i]));
    assert.deepEqual(idsOf(shuffled), idsOf(base), `ids moved under permutation ${order.join("")}`);
    assert.deepEqual(shapeOf(shuffled), shapeOf(base), `membership moved under permutation ${order.join("")}`);
    assert.deepEqual(
      shuffled.links.map((l) => [l.verdict, l.groups]),
      base.links.map((l) => [l.verdict, l.groups]),
      `links moved under permutation ${order.join("")}`,
    );
  }
});

test("groupFindings: ids are content-derived, so a re-run reproduces them and a counter would not", () => {
  const a = groupFindings([CHAIN.a, CHAIN.b, CHAIN.c]);
  const b = groupFindings([CHAIN.a, CHAIN.b, CHAIN.c]);
  assert.deepEqual(idsOf(a), idsOf(b));
  assert.ok(idsOf(a).every((id) => /^D-[0-9a-f]{16}$/.test(id)), `not a content hash: ${idsOf(a)}`);
  // Inserting an unrelated finding must not renumber the classes that already
  // existed — the property a counter cannot have, and the one that makes a score
  // quoted in a report re-derivable.
  const widened = groupFindings([gf("zzz.ts", "an unrelated finding about the icon sprite sheet"), CHAIN.a, CHAIN.b, CHAIN.c]);
  for (const id of idsOf(a)) assert.ok(widened.groups.some((g) => g.id === id), `class ${id} was renumbered`);
});

test("groupFindings: two classes with the same findingKey but disjoint evidence get DIFFERENT ids", () => {
  // `findingKey` is file plus lowercased summary — identity, not similarity, and
  // it deliberately cannot tell two observations of one text apart. L1 demotes
  // this pair to `maybe` on disjoint anchors, so they stay two classes; hashing
  // the id over `findingKey` alone would print one id for both and a reader would
  // see one class where there are two.
  const summary = "the relaxation accepts markers and changes paragraph interrupt behaviour for notes";
  const x = gf("plugin.ts", summary, "`isEmptyBulletLine` is the culprit");
  const y = gf("plugin.ts", summary, "`getRuleFn` is the culprit");
  assert.equal(findingKey(x), findingKey(y));
  assert.equal(matchFindings(x, y).verdict, "maybe");
  const r = groupFindings([x, y]);
  assert.equal(r.groups.length, 2);
  assert.notEqual(r.groups[0].id, r.groups[1].id);
});

test("groupFindings: two classes that DIGEST alike still get distinct ids", () => {
  // Byte-identical findings the matcher refuses to merge are not a hypothetical.
  // Cross-source with an empty `file`, `locationScore` is 0 — absent, not equal —
  // so two copies of one finding reach `maybe` on anchor agreement alone and stay
  // two classes, then hash to one id. `candidatesOf` is keyed BY id, so the
  // collision made each class list ITSELF as a candidate link.
  //
  // The suffix is an occurrence counter and NOT the input index: an index in the
  // preimage would make the id depend on input order, which is what the two tests
  // above exist to prevent.
  const f = {
    item_id: "pr-548",
    arm: "coderabbit",
    run_id: null,
    lens: "",
    file: "",
    summary: "`resolveRange` throws a raw TypeError on a reference without a colon",
    evidence: "",
  };
  assert.equal(matchFindings(f, { ...f }, { crossSource: true }).verdict, "maybe");
  const r = groupFindings([f, { ...f }]);
  assert.equal(r.groups.length, 2);
  assert.notEqual(r.groups[0].id, r.groups[1].id, "two classes must never share an id");
  assert.equal(r.stats.id_collisions, 1);
  assert.ok(/^D-[0-9a-f]{16}-2$/.test(r.groups[1].id), `unexpected suffix: ${r.groups[1].id}`);
  // no class may list itself as a candidate for merging with itself
  for (const g of r.groups) assert.ok(!g.candidates.includes(g.id), "a class linked to itself");
  // two identical CONTENTLESS findings reach the same place through G0
  const blank = { item_id: "pr-548", arm: "coderabbit", run_id: null };
  const b = groupFindings([blank, { ...blank }]);
  assert.equal(b.groups.length, 2);
  assert.notEqual(b.groups[0].id, b.groups[1].id);
  // …and a run with no collisions says so
  assert.equal(groupFindings([CHAIN.a, CHAIN.b, CHAIN.c]).stats.id_collisions, 0);
});

test("groupFindings MAYBE: never merges, always becomes a link the curator can see", () => {
  const summary = "the relaxation accepts markers and changes paragraph interrupt behaviour for notes";
  const r = groupFindings([
    gf("plugin.ts", summary, "`isEmptyBulletLine` is the culprit"),
    gf("plugin.ts", summary, "`getRuleFn` is the culprit"),
    gf("plugin.ts", summary, "`resolveIndent` is the culprit"),
  ]);
  assert.equal(r.stats.pairs.maybe, 3);
  assert.equal(r.stats.pairs.match, 0);
  // n singletons plus recorded edges — never one blob.
  assert.equal(r.groups.length, 3);
  assert.ok(r.groups.every((g) => g.size === 1));
  assert.equal(r.links.length, 3);
  assert.ok(r.links.every((l) => l.verdict === "maybe"));
  // …and each class points at the classes it might belong with, so the candidate
  // is reachable from the group a reader is holding.
  assert.ok(r.groups.every((g) => g.candidates.length === 2));
});

test("groupFindings: every pair INSIDE a class is a match — the over-merge assertion", () => {
  // `intra_group_non_match` is computed from the pair table, not from the merge
  // loop's own bookkeeping, so it is an independent check rather than a round trip
  // against itself. It is 0 for any sound grouping, and it is what goes red if the
  // completeness test is ever weakened to single linkage.
  const summary = "the relaxation accepts markers and changes paragraph interrupt behaviour for notes";
  for (const input of [
    [CHAIN.a, CHAIN.b, CHAIN.c],
    [gf("plugin.ts", summary, "`isEmptyBulletLine` x"), gf("plugin.ts", summary, "`getRuleFn` y")],
    [],
  ]) {
    const r = groupFindings(input);
    assert.equal(r.stats.intra_group_non_match, 0);
    for (const g of r.groups) {
      if (g.size === 1) assert.equal(g.weakest_pair, null);
      else assert.equal(g.weakest_pair.verdict, "match");
    }
  }
});

test("groupFindings: zero findings is a TRUE NEGATIVE — an empty group set, never an error", () => {
  for (const empty of [[], null, undefined, "not an array"]) {
    const r = groupFindings(empty);
    assert.deepEqual(r.groups, []);
    assert.deepEqual(r.links, []);
    assert.equal(r.stats.groups, 0);
    assert.equal(r.stats.pairs.compared, 0);
  }
});

test("groupFindings: one finding is one class, and a singleton is a row rather than a leftover", () => {
  const r = groupFindings([CHAIN.a]);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].size, 1);
  assert.equal(r.stats.singletons, 1);
  assert.equal(r.stats.pairs.compared, 0);
  // The finding survives into the output: a lone finding is a unique catch or a
  // miss, which is the most interesting row in the dataset and the one a filter
  // would delete.
  assert.equal(r.groups[0].members[0].finding.summary, CHAIN.a.summary);
});

test("groupFindings: every finding identical → ONE class of n, not n classes", () => {
  const r = groupFindings([CHAIN.a, { ...CHAIN.a }, { ...CHAIN.a }, { ...CHAIN.a }]);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].size, 4);
  assert.equal(r.stats.largest, 4);
  assert.equal(r.stats.intra_group_non_match, 0);
});

test("groupFindings: the SAME object twice is two observations, and both survive", () => {
  // Identity versus equality. Grouping never de-duplicates its input — two entries
  // in, two members out — because "how many times was this raised?" is a question
  // a scorer asks and cannot ask of an input this function already collapsed.
  const one = gf("a.ts", "the retry loop never resets its backoff between attempts");
  const r = groupFindings([one, one]);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].size, 2);
  assert.deepEqual(
    r.groups[0].members.map((m) => m.index),
    [0, 1],
  );
});

test("groupFindings: null and undefined entries are skipped WITH their index, never silently", () => {
  // `findingKey` is deliberately un-guarded upstream, so an unguarded grouping
  // would throw here rather than degrade. A guard that drops without counting is
  // the other failure: a clean-looking run over an array half full of nulls.
  const r = groupFindings([CHAIN.a, null, undefined, 42, [], CHAIN.b]);
  assert.equal(r.stats.n, 6);
  assert.equal(r.stats.grouped, 2);
  assert.deepEqual(
    r.stats.skipped.map((s) => s.index),
    [1, 2, 3, 4],
  );
  assert.ok(r.stats.skipped.every((s) => typeof s.reason === "string" && s.reason !== ""));
  assert.equal(r.groups.length, 1); // A and B still match each other
});

test("groupFindings: contentless findings do NOT collapse into one class (G0)", () => {
  // `findingSimilarity` falls back to exact text equality when both token sets are
  // empty, so "" scores 1.00 against "" and the pair reads as a match. Left alone,
  // every contentless finding on a pull request becomes ONE defect class that then
  // reads as several reviewers agreeing. This is the single place grouping is
  // stricter than `matchFindings`, and it is deliberate.
  const blanks = [
    { item_id: "pr-548", arm: "panel", run_id: "run-1" },
    { item_id: "pr-548", arm: "panel", run_id: "run-1", file: "", summary: "" },
    { item_id: "pr-548", arm: "panel", run_id: "run-1", summary: "   " },
  ];
  assert.equal(matchFindings(blanks[0], blanks[1]).verdict, "match"); // the matcher still says so
  const r = groupFindings(blanks);
  assert.equal(r.groups.length, 3);
  assert.equal(r.stats.no_evidence_pairs, 3);
  assert.equal(r.stats.pairs.match, 0);
  assert.equal(r.stats.links.maybe, 0); // no evidence is not partial evidence
});

test("groupFindings: a finding with no file still groups on its prose", () => {
  // The infra-record shape carries no `file`. It must not be excluded from
  // grouping, and two of them must not tie on `"" === ""` alone — location never
  // promotes, so the merge here has to come from the summary.
  const x = gf("", "the autosave timer keeps firing after the document is disposed");
  const y = gf("", "the autosave timer is never cleared once the document has been disposed");
  const r = groupFindings([x, y]);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].size, 2);
  const unrelated = groupFindings([x, gf("", "the icon sprite sheet is fetched twice on every cold start")]);
  assert.equal(unrelated.groups.length, 2);
});

test("groupFindings: two arms blaming DIFFERENT files still collapse into one class", () => {
  // L2's whole reason for existing, at the group level: one defect class with one
  // claim per arm, which is what makes a single adjudication credit both (§2.2).
  const panel = gf(
    "packages/sheets/src/formula/arguments.ts",
    "blank-skip in `Arguments.iterate` makes MIN/MAX over an all-blank range return #NUM!",
  );
  const coderabbit = {
    item_id: "pr-548",
    arm: "coderabbit",
    run_id: null,
    lens: "",
    file: "packages/sheets/src/formula/functions-statistical.ts",
    summary: "MIN/MAX over an all-blank range returns #NUM! — blank-skip in `Arguments.iterate`",
    evidence: "root cause lives in packages/sheets/src/formula/arguments.ts",
  };
  const r = groupFindings([panel, coderabbit]);
  assert.equal(r.groups.length, 1);
  assert.deepEqual(r.groups[0].arms, ["coderabbit", "panel"]);
  assert.equal(r.groups[0].weakest_pair.cross_source, true);
});

test("groupFindings: the blinded claim view is derivable from the output, without re-grouping", () => {
  // §2.2: arm identity is stripped before adjudication. That is only free if the
  // arm lives on the MEMBER and nowhere the claim text does, so a caller can drop
  // one field rather than re-derive the classes from scratch.
  const panel = gf("a.ts", "the paste handler bypasses the read only guard on the editor surface");
  const coderabbit = {
    item_id: "pr-548",
    arm: "coderabbit",
    run_id: null,
    lens: "",
    file: "a.ts",
    summary: "the paste handler bypasses the read only guard on the editor surface entirely",
    evidence: "",
  };
  const r = groupFindings([panel, coderabbit]);
  assert.equal(r.groups.length, 1);
  const blinded = r.groups[0].members.map((m) => ({ file: m.finding.file, summary: m.finding.summary }));
  assert.equal(blinded.length, 2);
  assert.ok(blinded.every((c) => !("arm" in c) && !("run_id" in c) && !("lens" in c)));
});

test("groupFindings: findings from DIFFERENT pull requests never share a class", () => {
  // Two items are two subjects. Byte-identical findings on two PRs are two
  // defects, and a class spanning them is not a defect at all.
  const onA = gf("a.ts", "the retry loop never resets its backoff between attempts", "", { item_id: "pr-101" });
  const onB = gf("a.ts", "the retry loop never resets its backoff between attempts", "", { item_id: "pr-202" });
  assert.equal(matchFindings(onA, onB).verdict, "match"); // the matcher would merge them
  const r = groupFindings([onA, onB]);
  assert.equal(r.groups.length, 2);
  assert.equal(r.stats.items, 2);
  assert.equal(r.stats.pairs.compared, 0); // never even compared
  assert.notEqual(r.groups[0].id, r.groups[1].id); // the item is in the id preimage
  assert.deepEqual(r.groups.map((g) => g.item).sort(), ["pr-101", "pr-202"]);
});

test("groupFindings: a finding that names no pull request is grouped with NOTHING, and counted", () => {
  // Attribution is never inferred. Pooling unattributable findings is the
  // unrecoverable direction; a singleton costs a look. `opts.item` is the way a
  // caller who knows says so.
  const bare = (summary) => ({ lens: "correctness", file: "a.ts", summary, evidence: "" });
  const two = [
    bare("the retry loop never resets its backoff between attempts"),
    bare("the retry loop fails to reset backoff between successive attempts"),
  ];
  const loose = groupFindings(two);
  assert.equal(loose.stats.unattributed, 2);
  assert.equal(loose.stats.items, 0);
  assert.equal(loose.groups.length, 2);
  assert.equal(loose.stats.pairs.compared, 0);
  const told = groupFindings(two, { item: "pr-548" });
  assert.equal(told.stats.unattributed, 0);
  assert.equal(told.groups.length, 1);
});

test("groupFindings GATE: derived per pair from arm and run, never chosen once per call", () => {
  // One class routinely holds both kinds. Picking one `crossSource` for the whole
  // run applies the wrong rule to half the pairs and nothing fails when it does.
  const sameRun = gf("a.ts", "alpha");
  const replicate = gf("a.ts", "alpha", "", { run_id: "run-2" });
  const cr = { item_id: "pr-548", arm: "coderabbit", run_id: null, lens: "", file: "a.ts", summary: "alpha", evidence: "" };

  // panel/run-1 × panel/run-1 → the (lens, file) gate is right
  assert.deepEqual(groupFindings([sameRun, gf("a.ts", "beta")]).stats.gate, {
    "same-run": 1,
    "cross-source": 0,
    defaulted: 0,
  });
  // a second replicate is NOT one run: the same defect can surface under another lens
  assert.equal(groupFindings([sameRun, replicate]).stats.gate["cross-source"], 1);
  // CodeRabbit has no lens of its own, so CodeRabbit × CodeRabbit is cross-source too
  assert.equal(groupFindings([cr, { ...cr, summary: "beta" }]).stats.gate["cross-source"], 1);
  // …and a mixed class gets BOTH gates inside one call
  const mixed = groupFindings([sameRun, gf("a.ts", "beta"), cr]);
  assert.equal(mixed.stats.gate["same-run"], 1);
  assert.equal(mixed.stats.gate["cross-source"], 2);
});

test("groupFindings GATE: unreadable provenance falls back to the TIGHTER rule, and says so", () => {
  // The same-run gate rejects every different-lens and different-file pair
  // outright, so its match set is a subset of L2's. Guessing it costs merges we
  // could have made; guessing L2 costs merges we should not have, and only the
  // second kind is unrecoverable. `defaulted` is how a caller notices.
  const noArm = (file, summary, lens) => ({ lens, file, summary, evidence: "", item_id: "pr-548" });
  const r = groupFindings([
    noArm("a.ts", "the paste handler bypasses the read only guard on the editor surface", "correctness"),
    noArm("b.ts", "the paste handler bypasses the read only guard on the editor surface", "security"),
  ]);
  assert.equal(r.stats.gate.defaulted, 1);
  assert.equal(r.stats.gate["same-run"], 1);
  assert.equal(r.groups.length, 2); // the tight gate rejects a different lens AND file
  // …and a caller who knows better can still say so, which is the loose direction
  const loosened = groupFindings(
    [
      noArm("a.ts", "the paste handler bypasses the read only guard on the editor surface", "correctness"),
      noArm("a.ts", "the paste handler bypasses the read only guard on the editor surface", "security"),
    ],
    { crossSource: true },
  );
  assert.equal(loosened.stats.gate["cross-source"], 1);
  assert.equal(loosened.groups.length, 1);
});

test("groupFindings WIDENS: a member carries the whole finding, and the input is never mutated", () => {
  // Decision 7, and the bug that has shipped four times here. Every field a later
  // round annotates has to survive whether or not this file has heard of it.
  const rich = gf("a.ts", "the retry loop never resets its backoff between attempts", "", {
    lane: "blocking",
    novelty: { origin: "new" },
    gate_state: "on",
    window: "in-window",
    severity: "major",
    gating: "gates",
    somethingInventedLater: { deep: true },
  });
  const frozen = JSON.parse(JSON.stringify(rich));
  const r = groupFindings([rich]);
  const carried = r.groups[0].members[0].finding;
  for (const field of ["lane", "novelty", "gate_state", "window", "severity", "gating", "somethingInventedLater"]) {
    assert.deepEqual(carried[field], rich[field], `${field} was dropped`);
  }
  // a copy, so a caller mutating the output cannot corrupt its own array…
  carried.lane = "backlog";
  assert.equal(rich.lane, "blocking");
  // …and grouping mutated nothing on the way in
  assert.deepEqual(rich, frozen);
});

test("groupFindings GROUPS, it does not FILTER: nothing is dropped for severity or window", () => {
  // The rule tags; a scorer chooses. An `after-window` nit is a row here.
  const findings = [
    gf("a.ts", "the retry loop never resets its backoff between attempts", "", { severity: "nit", window: "after-window" }),
    gf("b.ts", "the icon sprite sheet is fetched twice on every cold start", "", { severity: "critical", lane: "backlog" }),
    gf("c.ts", "the tooltip renders behind the modal overlay on narrow viewports", "", { severity: "minor" }),
  ];
  const r = groupFindings(findings);
  assert.equal(r.stats.grouped, 3);
  assert.equal(r.groups.length, 3);
  assert.deepEqual(
    r.groups.flatMap((g) => g.members.map((m) => m.finding.severity)).sort(),
    ["critical", "minor", "nit"],
  );
});

test("groupFindings: an accessor that throws is reported, and the run still completes", () => {
  const r = groupFindings([CHAIN.a, CHAIN.b], {
    itemOf: (f) => {
      if (f.summary === CHAIN.b.summary) throw new Error("no item column");
      return "pr-548";
    },
  });
  assert.equal(r.stats.accessor_failures.length, 1);
  assert.equal(r.stats.accessor_failures[0].accessor, "itemOf");
  assert.equal(r.stats.unattributed, 1);
  assert.equal(r.groups.length, 2); // the unattributable one is grouped with nothing
});

test("groupFindings: 200+ findings — anchors are extracted ONCE per finding, not once per pair", () => {
  // `extractAnchor` runs six regexes over `summary` + `evidence`, and the panel
  // posts a median of 30 findings per pull request before lenses and samples
  // multiply it. At n=210 the pairwise path asks 21,945 questions; the naive shape
  // would mine 43,890 anchors for 210 findings.
  const many = [];
  for (let i = 0; i < 210; i++) {
    many.push(
      gf(
        `pkg/file-${i % 17}.ts`,
        `finding ${i}: the ${i % 5 === 0 ? "retry" : "cache"} path drops record ${i} when the queue drains early`,
        `\`handler${i % 11}\` at lines ${i * 3} - ${i * 3 + 4}`,
      ),
    );
  }
  const r = groupFindings(many);
  assert.equal(r.stats.grouped, 210);
  assert.equal(r.stats.anchors_extracted, 210);
  assert.equal(r.stats.pairs.compared, (210 * 209) / 2);
  assert.equal(r.stats.intra_group_non_match, 0);
  // every finding lands in exactly one class, and none is lost on the way
  assert.equal(
    r.groups.reduce((n, g) => n + g.size, 0),
    210,
  );
});
