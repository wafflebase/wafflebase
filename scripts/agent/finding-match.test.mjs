import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAnchor, anchorIsEmpty, compareAnchors, linesOverlap,
  matchFindings, tokenOverlap, crossArmTokenOverlap, bestMatch, CROSS_ARM_SIMILARITY,
} from "./finding-match.mjs";
import { findingSimilarity, summaryTokens, DEFAULT_SIMILARITY } from "./rounds.mjs";

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
  // The property the name claims, which this test did NOT assert before: the
  // denominator is the SMALLER set, so the longer wording's extra specifics cost
  // nothing. 3 shared, 3 tokens against 9 → 3/3. That is upstream's deliberate
  // choice for one reviewer restating itself, and it is unchanged by this PR.
  assert.equal(tokenOverlap("alpha beta gamma", "alpha beta gamma delta epsilon zeta theta iota kappa"), 1);
});

test("crossArmTokenOverlap: DICE — the denominator is BOTH summaries", () => {
  // The same operands as the row above score 6/12 here. Two different reviewers
  // are not one reviewer restating itself, so a long text covering a short one is
  // the arithmetic of shared vocabulary rather than evidence of agreement.
  const short = "alpha beta gamma";
  const long = "alpha beta gamma delta epsilon zeta theta iota kappa";
  assert.equal(summaryTokens(short).length, 3);
  assert.equal(summaryTokens(long).length, 9);
  assert.equal(crossArmTokenOverlap(short, long), 0.5);
  assert.equal(tokenOverlap(short, long), 1); // and the two DISAGREE, by design
  assert.equal(crossArmTokenOverlap("blank skip breaks minmax aggregation", "blank skip breaks minmax aggregation"), 1);
  assert.equal(crossArmTokenOverlap("", "anything here"), 0);
});

test("crossArmTokenOverlap: padding one side with unrelated words LOWERS the score", () => {
  // With the numerator fixed, containment is CONSTANT in the length of the longer
  // operand — 1.00 for every row below — so a long summary clears the bar on any
  // file whose vocabulary it happens to cover. `harvest.mjs` compares CodeRabbit
  // prose (median 32 significant tokens) against panel summaries (median 14), so
  // this is the shape of its real input rather than a constructed one.
  const a = "alpha beta gamma";
  const near = crossArmTokenOverlap(a, "alpha beta gamma delta");
  const far = crossArmTokenOverlap(a, "alpha beta gamma delta epsilon zeta theta iota kappa lambda sigma");
  assert.ok(near > far, `padding must reduce agreement, got near ${near} far ${far}`);
  assert.ok(far > 0, "and must not collapse to zero — the shared tokens are still shared");
  assert.equal(tokenOverlap(a, "alpha beta gamma delta"), tokenOverlap(a, "alpha beta gamma delta epsilon zeta theta iota kappa lambda sigma"));
});

test("crossArmTokenOverlap: the MIN_SHARED_TOKENS floor still applies under Dice", () => {
  // 2 shared across two 3-token summaries is Dice 4/6 = 0.67 — far over the bar
  // and meaningless. Changing the denominator does not retire the floor.
  assert.equal(crossArmTokenOverlap("alpha beta gamma", "alpha beta delta"), 0);
  assert.equal(crossArmTokenOverlap("alpha beta gamma", "alpha beta gamma"), 1);
});

test("L2 metric is selected by ARM, not by run: same-arm keeps containment @ 0.3", () => {
  // The population `reliability.mjs` scores — one reviewer, two replicates. It is
  // cross-SOURCE (a defect can surface under a different lens on another try) but
  // it is not cross-ARM, and containment is what it was calibrated for. 3 shared
  // of 3 and 9 → containment 1.00 (match), Dice 0.50 (under the cross-arm bar's
  // sibling but scored on a different scale). If this pair ever routes cross-arm,
  // every reliability figure moves.
  const a = { lens: "", file: "a.ts", summary: "alpha beta gamma", evidence: "" };
  const b = { lens: "", file: "a.ts", summary: "alpha beta gamma delta epsilon zeta theta iota kappa", evidence: "" };
  assert.equal(matchFindings(a, b, { crossSource: true, sameArm: true }).verdict, "match");
  assert.match(matchFindings(a, b, { crossSource: true, sameArm: true }).reason, /tokens 1\.00/);
  // and the same pair, cross-arm, scores on the Dice scale instead
  assert.match(matchFindings(a, b, { crossSource: true }).reason, /tokens 0\.50/);
});

test("🔴 a pair carrying NO arm or run must route CROSS-ARM, never same-arm", () => {
  // THE TRAP THIS ASSERTION EXISTS FOR. `harvest.mjs` compares through
  // `attributeToPanel`, whose `neutral()` helper carries only lens/file/summary/
  // evidence — no `arm`, no `run`. Any implementation that infers same-arm from
  // `a.arm === b.arm` evaluates `undefined === undefined`, gets `true`, and hands
  // the one production cross-arm caller the containment metric. Nothing throws,
  // every other test stays green, and the change's entire measured effect
  // disappears. So: field-less pairs get Dice.
  const a = { lens: "", file: "a.ts", summary: "alpha beta gamma", evidence: "" };
  const b = { lens: "", file: "a.ts", summary: "alpha beta gamma delta epsilon zeta theta iota kappa", evidence: "" };
  assert.equal(a.arm, undefined);
  assert.equal(b.arm, undefined);
  // Dice would be 0.50; containment would be 1.00. Reading the reason is what
  // distinguishes them, because both clear their own bar and both say `match`.
  assert.match(matchFindings(a, b, { crossSource: true }).reason, /tokens 0\.50/);
  assert.doesNotMatch(matchFindings(a, b, { crossSource: true }).reason, /tokens 1\.00/);
});

test("the cross-arm bar BINDS from both sides — 0.214 is a maybe, 0.231 is a match", () => {
  // Pins the constant by its consequences rather than by restating its value,
  // which is the one assertion shape that would pass whatever the number became.
  // Loosening to 0.20 promotes the first pair; tightening to 0.25 demotes the
  // second and costs one of the six known cross-arm matches on the pilot corpus.
  assert.ok(CROSS_ARM_SIMILARITY < DEFAULT_SIMILARITY);
  const shared = "alpha beta gamma";
  const aOnly = "delta epsilon zeta theta iota kappa omega sigma tau upsilon";
  const bOnly = "phi chi psi omicron lambda rho mercury venus mars jupiter";

  const lo1 = { lens: "", file: "a.ts", summary: `${shared} ${aOnly}`, evidence: "" };
  const lo2 = { lens: "", file: "a.ts", summary: `${shared} ${bOnly} saturn neptune`, evidence: "" };
  const tLo = crossArmTokenOverlap(lo1.summary, lo2.summary); // 6/28
  assert.ok(tLo > 0.21 && tLo < CROSS_ARM_SIMILARITY, `expected ~0.214 under the bar, got ${tLo}`);
  assert.equal(matchFindings(lo1, lo2, { crossSource: true }).verdict, "maybe");

  const hi2 = { lens: "", file: "a.ts", summary: `${shared} ${bOnly}`, evidence: "" };
  const tHi = crossArmTokenOverlap(lo1.summary, hi2.summary); // 6/26
  assert.ok(tHi >= CROSS_ARM_SIMILARITY && tHi < 0.24, `expected ~0.231 over the bar, got ${tHi}`);
  assert.equal(matchFindings(lo1, hi2, { crossSource: true }).verdict, "match");
});

test("the SAME-RUN path keeps findingSimilarity's containment — this change does not reach it", () => {
  // Upstream's reasoning still holds within one run, and it is the same reasoning
  // that keeps `tokenOverlap` on the same-arm L2 path: one reviewer restates one
  // defect at different levels of detail, and containment refuses to penalise the
  // longer wording for its extra specifics.
  const a = { lens: "correctness", file: "a.ts", summary: "alpha beta gamma", evidence: "" };
  const b = { lens: "correctness", file: "a.ts", summary: "alpha beta gamma delta epsilon zeta theta iota kappa", evidence: "" };
  assert.equal(findingSimilarity(a, b), 1);
  assert.equal(crossArmTokenOverlap(a.summary, b.summary), 0.5);
  assert.equal(matchFindings(a, b).verdict, "match");
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

