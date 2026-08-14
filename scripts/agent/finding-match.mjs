// Does finding A describe the SAME defect as finding B?
//
// `harvest.mjs` needs this and had no way to ask it. Its CodeRabbit signature
// knew only how MANY blocking findings the panel raised, so it filed every
// CodeRabbit blocker as "the panel missed this" — including the ones the panel
// caught and worded differently. That over-fire is systematic rather than
// random, which is the failure harvest.mjs's own header warns about: noise that
// follows a matcher moves the panel somewhere specific and wrong.
//
// THE SIMILARITY METRIC IS NOT RE-DERIVED HERE. `rounds.mjs` owns it —
// `summaryTokens`, the overlap-over-Jaccard choice, `MIN_SHARED_TOKENS` and the
// 0.3 threshold, all calibrated against PR #564's four real rephrasings of one
// defect. This module imports every one of them. What it ADDS is a location
// signal, which is a different axis from text: the panel's finding schema has no
// line or symbol field, but its `summary`/`evidence` prose leaks both, and
// mining that at scoring time gives sub-file resolution with no run-layer change.
//
// WHY LOCATION IS A DEMOTER AND NEVER A PROMOTER. Measured over 1,249 real pairs
// from 153 captured findings: 55% of ALL pairs share at least one symbol, because
// in a focused PR nearly every finding names the same identifiers. Anchor
// agreement therefore means "same topic", not "same defect". L1 and L2 below use
// anchors to demote a pair to `maybe`; nothing is ever promoted to `match` on
// location alone. Raising the match rate by relaxing that would re-introduce
// exactly the over-fire this module exists to remove.
//
// The same measurement is why there is no hook into `review-panel.mjs ::
// clusterFindings`. As a merge guard the anchor layer blocks 0 of the 39 merges
// clustering performs — of the 45 pairs that clear the text threshold, none
// disagree on anchors. Upstream's clustering is already anchor-consistent, so a
// guard there would be pure surface area on a production gate path.
//
// LAYERS. `matchFindings` → { verdict, score, method, reason }:
//   L0  same-run pairs: `findingSimilarity` unchanged, behind its own (lens,
//       file) gate;
//   L1  the anchor demotion — same file, both sides named symbols, no symbol in
//       common ⇒ almost certainly two defects in one file;
//   L2  cross-source pairs (CodeRabbit / human / a stored label), where the
//       absolute file gate is wrong because two reviewers can blame different
//       files for one defect. A soft location score replaces it.
// A designed L3 (LLM adjudication of the residual `maybe`s) is deliberately
// unbuilt: it costs money per pair, and nothing has yet shown the `maybe` queue
// is worth paying to shrink.
//
// FAIL DIRECTION: ambiguity resolves to `maybe`, never `match`. A false match
// SUPPRESSES a candidate, and a suppressed candidate is a miss nobody can
// recover later; a false `maybe` costs a curator one line of reading.
//
// GROUPING (`groupFindings`) turns those pairwise verdicts into DEFECT CLASSES —
// one underlying problem, with every claim that describes it attached. It is a
// second, harder question and it inherits the fail direction ABOVE with more
// force, because errors compound through a closure: a pairwise verdict is
// auditable (read the pair, disagree), while a group is a claim about a SET, and
// merging always makes the output look tidier the more wrong it gets. So the
// linkage is COMPLETE, never single — see `groupFindings`.

import { createHash } from "node:crypto";
import { findingSimilarity, summaryTokens, DEFAULT_SIMILARITY, MIN_SHARED_TOKENS } from "./rounds.mjs";
import { findingKey } from "./finding-key.mjs";

// Code-ish words that appear inside backticks but identify nothing.
const SYMBOL_STOP = new Set([
  "true", "false", "null", "undefined", "const", "let", "var", "function", "return",
  "this", "new", "await", "async", "void", "string", "number", "boolean", "any",
  "type", "class", "import", "export", "from", "the", "and", "not", "for",
]);

const CODE_EXT = "ts|tsx|js|jsx|mjs|cjs|json|css|scss|md|mdx|html|yml|yaml";
const PATH_RE = new RegExp(`\\b[\\w./-]*[\\w-]+\\.(?:${CODE_EXT})\\b`, "g");
// `line 214`, `lines 626-640`, `lines ~626–640` (en/em dashes tolerated). Also
// matches CodeRabbit's `around lines 395 - 397`, which is the most precise
// location signal available anywhere in a review comment.
const LINES_RE = /\blines?\s*~?\s*(\d+)\s*(?:[-–—]\s*~?\s*(\d+))?/gi;
// a path/symbol suffixed with a line: `formula.ts:1054`, `foo.ts#L88`
const SUFFIX_LINE_RE = new RegExp(`(?:${CODE_EXT})[:#]L?(\\d+)\\b`, "gi");
// a backtick-quoted span (its inside is treated as code)
const BACKTICK_RE = /`([^`]+)`/g;
// an identifier that is being CALLED, in prose: `foo(` / `Foo.bar(`
const CALL_RE = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
// a bare identifier token (used only inside backticked code)
const IDENT_RE = /[A-Za-z_$][\w$]*/g;

const isSignalIdent = (s) => s.length >= 3 && !SYMBOL_STOP.has(s.toLowerCase()) && !/^\d/.test(s);

/**
 * Location anchor mined from a finding's `summary` + `evidence`:
 *   { symbols: string[], lines: [start,end][], files: string[] }
 * - symbols: identifiers from backticked code spans and prose call-sites
 *   (dotted chains kept whole AND split, so `Sheet.getUsedBounds` yields the chain
 *   plus `getUsedBounds`). Deduped case-insensitively, original casing preserved.
 * - lines: soft ranges; a single `line N` becomes [N,N]. Never compared for exact
 *   equality downstream — LLM line numbers drift, so the matcher uses a window.
 * - files: paths named in the prose (BESIDES finding.file), the cross-source
 *   file-disagreement signal for L2.
 */
export function extractAnchor(finding) {
  const text = `${finding?.summary ?? ""}\n${finding?.evidence ?? ""}`;

  const symbols = new Map(); // lowercased → original (first seen)
  const addSym = (s) => { if (isSignalIdent(s)) { const k = s.toLowerCase(); if (!symbols.has(k)) symbols.set(k, s); } };

  // symbols from backticked code spans, MINUS any path inside them.
  //
  // A backticked path is a LOCATION and `PATH_RE` below already records it in
  // `files`. Letting IDENT_RE loose on it too mints its segments as symbols —
  // `packages`, `docs`, `src`, `view` out of
  // `` `@packages/docs/src/view/text-editor.ts` `` — so any two findings under one
  // directory would "share symbols" on tree vocabulary alone. That is not a
  // harmless extra signal: `symbolOverlap` feeds L2's content score, so it can
  // manufacture a `match`, and a false match suppresses a candidate silently.
  // CodeRabbit's `🤖 Prompt for AI Agents` block backticks the file path on every
  // finding, which is what makes this reachable rather than theoretical.
  for (const m of text.matchAll(BACKTICK_RE)) {
    for (const id of m[1].replace(PATH_RE, " ").matchAll(IDENT_RE)) addSym(id[0]);
  }
  // symbols from prose call-sites: keep the whole dotted chain and each segment
  for (const m of text.matchAll(CALL_RE)) {
    addSym(m[1]);
    if (m[1].includes(".")) for (const seg of m[1].split(".")) addSym(seg);
  }

  // line hints
  const lines = [];
  for (const m of text.matchAll(LINES_RE)) {
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
    if (Number.isFinite(a)) lines.push([Math.min(a, b), Math.max(a, b)]);
  }
  for (const m of text.matchAll(SUFFIX_LINE_RE)) {
    const n = Number(m[1]); if (Number.isFinite(n)) lines.push([n, n]);
  }

  // file paths named in the prose (excluding the finding's own file)
  const own = String(finding?.file ?? "");
  const files = new Set();
  for (const m of text.matchAll(PATH_RE)) if (m[0] !== own) files.add(m[0]);

  return {
    symbols: [...symbols.values()],
    lines: dedupeRanges(lines),
    files: [...files],
  };
}

function dedupeRanges(ranges) {
  const seen = new Set();
  const out = [];
  for (const r of ranges) { const k = `${r[0]}:${r[1]}`; if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}

/** True when the anchor carries no usable location signal → the matcher must fall
 *  back to L0 (file + token overlap) for this finding. */
export function anchorIsEmpty(anchor) {
  return !anchor || (anchor.symbols.length === 0 && anchor.lines.length === 0 && anchor.files.length === 0);
}

// --- anchor comparison ------------------------------------------------------

const lowerSet = (xs) => new Set((xs ?? []).map((s) => s.toLowerCase()));

export const LINE_WINDOW = 15;

/** Line ranges overlap within a tolerance window. LLM line numbers drift, so this
 *  is deliberately a window, never equality. */
export function linesOverlap(a, b, window = LINE_WINDOW) {
  for (const [s1, e1] of a ?? []) {
    for (const [s2, e2] of b ?? []) {
      if (s1 - window <= e2 && s2 - window <= e1) return true;
    }
  }
  return false;
}

/**
 * How the two anchors relate: { sharedSymbols, symbolOverlap, lineHit }.
 *
 * `symbolOverlap` is a containment coefficient over symbols — the same
 * overlap-over-Jaccard rationale as `findingSimilarity`, since one side routinely
 * names far more symbols than the other.
 *
 * It is `null`, NOT 0, when either side named no symbol at all. That distinction
 * is load-bearing everywhere it is read: `null` means "no evidence either way"
 * and 0 means "both sides named symbols and they share none", which is the only
 * shape that counts as disagreement.
 */
export function compareAnchors(a, b) {
  const A = lowerSet(a?.symbols); const B = lowerSet(b?.symbols);
  let shared = 0;
  for (const s of A) if (B.has(s)) shared++;
  const denom = Math.min(A.size, B.size);
  return {
    sharedSymbols: shared,
    symbolOverlap: denom === 0 ? null : shared / denom,
    lineHit: linesOverlap(a?.lines, b?.lines),
  };
}

// --- the layered matcher ----------------------------------------------------

const trim = (s) => String(s ?? "").trim();
const res = (verdict, score, method, reason, extra = {}) => ({ verdict, score, method, reason, ...extra });

/**
 * The token bar for CROSS-ARM pairs, which is the only population
 * `crossArmTokenOverlap` scores. Separate from `DEFAULT_SIMILARITY` because the
 * two functions no longer compute the same quantity: carrying 0.3 onto the Dice
 * scale would silently tighten cross-arm matching rather than leaving it alone.
 *
 * Dice rescales by `2·min/(|a|+|b|)`, so the faithful translation of 0.3 depends
 * on operand shape — and the two cross-arm callers sit close together:
 *
 *   complementarity.mjs   panel 14 vs CR title 7    factor 0.67    0.30 -> 0.20
 *   harvest.mjs           panel 14 vs CR prose 32   factor 0.61    0.30 -> 0.18
 *
 * 0.22 is the value in that region which holds the title-shaped caller EXACTLY
 * (2 false matches and 6 of 6 true, the same as containment @ 0.30) while taking
 * the prose-shaped caller's gain. It sits above the 0.231 cliff where the
 * title-shaped caller starts losing true matches, with margin.
 *
 * ⚠ IT IS NOT CALIBRATED IN THE SENSE `DEFAULT_SIMILARITY` IS. That one had four
 * hand-read rephrasings of one defect behind it. This one was chosen against a
 * strong negative set (3608 known non-matches) and a positive set of SIX that the
 * metric being replaced selected. Calibrating it properly needs adjudicated pairs.
 *
 * Same-arm pairs never reach this constant — they keep `DEFAULT_SIMILARITY`, so
 * `reliability.mjs` is byte-for-byte unaffected by this file's change.
 */
export const CROSS_ARM_SIMILARITY = 0.22;

/** Do the two findings tie to a location at all? Exact same file = 1; a file named
 *  in the other's evidence, or a basename tie across different depths = 0.6; else
 *  0. An empty `file` on either side scores 0 — absent, not equal. */
function locationScore(a, b, anA, anB) {
  const fa = trim(a.file); const fb = trim(b.file);
  if (fa && fb && fa === fb) return 1;
  const namedByB = fa && (anB.files ?? []).some((f) => f === fa || fa.endsWith(`/${f}`) || f.endsWith(`/${fa}`));
  const namedByA = fb && (anA.files ?? []).some((f) => f === fb || fb.endsWith(`/${f}`) || f.endsWith(`/${fb}`));
  if (namedByA || namedByB) return 0.6;
  // basename agreement (packages/x/foo.ts vs foo.ts) — different depth, same file
  const base = (p) => p.split("/").pop();
  if (fa && fb && base(fa) === base(fb)) return 0.6;
  return 0;
}

/**
 * Decide whether two findings describe the same defect.
 *
 * `opts.crossSource` (default false) selects the GATE. Within one panel run both
 * operands are panel-shaped and the absolute (lens, file) gate is right, so L0/L1
 * apply. Across sources it is wrong — CodeRabbit has no lens, and two reviewers
 * can blame different files for one defect — so L2's soft gate applies instead.
 *
 * `opts.sameArm` (default false) selects the METRIC, and it is a different
 * question from the gate: two replicates of the panel are cross-SOURCE (a defect
 * can surface under another lens on another try) but they are still one reviewer
 * restating itself, which is the population containment was calibrated for. So
 * L2 pairs score with `tokenOverlap` when `sameArm` and `crossArmTokenOverlap`
 * otherwise. **Absent defaults to cross-arm** — see `matchAnchored` for why that
 * direction is the only safe one.
 *
 * `opts.threshold` overrides the token bar on either path.
 *
 * Verdicts: `match` (confident), `maybe` (plausible — emit, flagged for a human),
 * `no`. Conservative by construction: ambiguity yields `maybe`.
 */
export function matchFindings(a, b, opts = {}) {
  if (!a || !b) return res("no", 0, "guard", "missing operand");
  return matchAnchored(a, b, extractAnchor(a), extractAnchor(b), opts);
}

/**
 * `matchFindings` with the two anchors already mined. Same decision, same
 * output — the split exists only so a caller comparing N findings pairwise pays
 * for N anchor extractions instead of N².
 *
 * `extractAnchor` runs six regexes over `summary` + `evidence`, and the panel
 * posts a median of 30 findings per pull request before lenses and samples
 * multiply it, so the pairwise path is where that cost lands. `matchFindings`
 * keeps its signature and its guard; nothing outside this file has to know the
 * split happened.
 *
 * NOT exported: an anchor that did not come from `extractAnchor(a)` would make
 * the verdict disagree with `matchFindings(a, b)` on the same operands, and a
 * matcher with two answers for one pair is worse than a slow one.
 */
function matchAnchored(a, b, anA, anB, opts = {}) {
  const crossSource = opts.crossSource === true;
  // 🔴 ABSENT MEANS CROSS-ARM, and this default is load-bearing rather than tidy.
  //
  // It is read from `opts`, never off the findings. `harvest.mjs` compares through
  // `attributeToPanel`, whose `neutral()` helper carries only lens/file/summary/
  // evidence — no `arm`, no `run`. Inferring "same arm" from `a.arm === b.arm`
  // there would compare `undefined === undefined`, get `true`, hand the panel-vs-
  // CodeRabbit comparison the same-arm metric, and delete this change's entire
  // effect at its only production caller. Nothing would fail; the numbers would
  // just quietly go back. So absent provenance falls to cross-arm, which is the
  // stricter of the two and the one that cannot silently restore the old
  // behaviour. `gateFor` makes the same choice for the same reason.
  const sameArm = opts.sameArm === true;
  // Two metrics, two bars, selected by ARM rather than by run. See `tokenOverlap`
  // (one reviewer restating itself) and `crossArmTokenOverlap` (two reviewers).
  // An explicit `opts.threshold` still overrides either — a caller passing a
  // number means that number.
  const threshold = opts.threshold ?? (crossSource && !sameArm ? CROSS_ARM_SIMILARITY : DEFAULT_SIMILARITY);

  const cmp = compareAnchors(anA, anB);

  // ---- same-run path: L0 similarity, then the L1 anchor gate ----------------
  if (!crossSource) {
    // The (lens, file) gate is checked HERE rather than inferred from a 0 score:
    // `findingSimilarity` returns 0 both for "gate failed" and for "same file but
    // under MIN_SHARED_TOKENS", and those must not be conflated. The first is a
    // structural no; the second is inconclusive, and its anchors may still agree
    // decisively. Reading `sim === 0` as "different file" would skip the anchor
    // check on exactly the pairs that need it.
    if (trim(a.lens) !== trim(b.lens) || trim(a.file) !== trim(b.file)) {
      return res("no", 0, "L0-similarity", "different lens or file (same-run gate)", { anchor: cmp });
    }
    const sim = findingSimilarity(a, b);

    // L1 — same file and both sides named symbols, but they share NONE: almost
    // certainly two different defects in one file. Demote rather than drop, since
    // a rephrasing can legitimately name different helpers.
    const disjoint = cmp.symbolOverlap === 0 && !cmp.lineHit;
    if (sim >= threshold) {
      return disjoint
        ? res("maybe", sim, "L1-anchor", `token overlap ${sim.toFixed(2)} but anchors share no symbol — likely distinct defects in one file`, { anchor: cmp })
        : res("match", sim, "L0-similarity", `token overlap ${sim.toFixed(2)} ≥ ${threshold}${cmp.sharedSymbols ? `, ${cmp.sharedSymbols} shared symbol(s)` : ""}`, { anchor: cmp });
    }
    // below the token bar but anchors agree strongly → worth a look, not a match
    if (cmp.lineHit || (cmp.symbolOverlap != null && cmp.symbolOverlap >= 0.5)) {
      return res("maybe", sim, "L1-anchor", `token overlap ${sim.toFixed(2)} < ${threshold} but anchors agree`, { anchor: cmp });
    }
    return res("no", sim, "L0-similarity", `token overlap ${sim.toFixed(2)} < ${threshold}`, { anchor: cmp });
  }

  // ---- cross-source path: L2 soft location gate ----------------------------
  const loc = locationScore(a, b, anA, anB);
  // THE GATE STRUCTURE IS IDENTICAL FOR BOTH; only the metric and its bar differ.
  // That is what keeps `reliability.mjs` — whose pairs are same-arm across
  // replicates — reproducing its published figures exactly.
  const tokens = sameArm ? tokenOverlap(a.summary, b.summary) : crossArmTokenOverlap(a.summary, b.summary);
  // Reported strength of the pair. `symbolOverlap` may raise the SCORE, but it may
  // not decide the verdict — see the match condition below.
  const content = Math.max(tokens, cmp.symbolOverlap ?? 0);
  const anchorsAgree = cmp.lineHit || cmp.sharedSymbols > 0;
  // Anchors DISAGREE only when both sides named symbols and share none. A null
  // `symbolOverlap` means one side named nothing — no evidence either way, which
  // must not be read as disagreement. Same null-vs-zero distinction as the L0 gate.
  const anchorsDisagree = cmp.symbolOverlap === 0 && !cmp.lineHit;

  // Never match on text alone across sources: no location tie AND no anchor
  // agreement ⇒ no. This is the floodgate a file-only matcher opens — one
  // CodeRabbit comment matched 40 panel findings on file co-location alone.
  if (loc === 0 && !anchorsAgree) {
    return res("no", 0, "L2-xsource", "no location tie and no shared anchor symbol", { anchor: cmp });
  }
  // Combined score: location and content must BOTH contribute.
  const score = 0.5 * Math.max(loc, anchorsAgree ? 0.6 : 0) + 0.5 * content;
  // The bar is TOKEN overlap, not `content`. Scoring the gate on
  // `max(tokens, symbolOverlap)` would let a single shared identifier carry a pair
  // to `match` with zero textual agreement — `symbolOverlap` is 1.0 whenever both
  // sides name exactly one symbol and it is the same one. That is promotion on
  // location alone, which is the one thing the anchor layer must never do: 55% of
  // real pairs share a symbol, so it would merge distinct defects that happen to
  // touch the same helper, and in `harvest.mjs` a false match SUPPRESSES a
  // candidate. Anchors keep their veto (`anchorsDisagree`) and their contribution
  // to the reported score; they do not get a vote on clearing the bar.
  if (loc >= 0.6 && tokens >= threshold && !anchorsDisagree) {
    return res("match", score, "L2-xsource",
      `location ${loc}, tokens ${tokens.toFixed(2)}${anchorsAgree ? ", shared anchor" : ""}`, { anchor: cmp });
  }
  const why = anchorsDisagree ? "anchors name disjoint symbols" : `location ${loc}, content ${content.toFixed(2)}`;
  return res("maybe", score, "L2-xsource", `partial evidence (${why}) — needs adjudication`, { anchor: cmp });
}

/**
 * Token containment between two free-text summaries, with no (lens, file) gate —
 * the part of `findingSimilarity` that survives a cross-source comparison.
 *
 * ONE ARM RESTATING ITSELF. Containment divides by the SMALLER token set, and
 * upstream's reason for that is specific: "the panel restates one defect at
 * different levels of detail, and Jaccard penalises the extra specifics in the
 * longer wording, which is precisely the wrong behaviour here." That is an
 * argument about ONE REVIEWER wording the same defect twice — which is exactly
 * the same-arm population, whether the two wordings come from one run or from two
 * replicates. It is NOT an argument about two different reviewers; see
 * `crossArmTokenOverlap` for why, and `gateFor` for which pair gets which.
 *
 * `MIN_SHARED_TOKENS` is imported rather than dropped, and that matters here more
 * than it does upstream. The constant encodes `findingSimilarity`'s calibration
 * note — real same-defect pairs share 7-17 tokens, real different-defect pairs at
 * most 1 — and it is the guard against a high ratio computed off a tiny numerator.
 * Cross-source operands are exactly where summaries get short: a CodeRabbit title
 * is ~6 significant tokens, at which length two incidentally shared words clear a
 * 0.3 containment bar. Keeping the floor keeps the threshold meaning what it was
 * calibrated to mean.
 */
export function tokenOverlap(s1, s2) {
  const ta = summaryTokens(s1); const tb = summaryTokens(s2);
  if (ta.length === 0 || tb.length === 0) return 0;
  const B = new Set(tb);
  let shared = 0;
  for (const t of ta) if (B.has(t)) shared++;
  if (shared < MIN_SHARED_TOKENS) return 0;
  return shared / Math.min(ta.length, tb.length);
}

/**
 * The same question across TWO DIFFERENT REVIEWERS, where containment's rationale
 * does not hold and its arithmetic actively misleads.
 *
 * DICE, because containment is BLIND TO THE LONGER OPERAND. With the numerator
 * fixed, `shared / min(|a|, |b|)` does not move as the other side grows:
 *
 *   |a| = 6, 3 shared     |b| = 6    |b| = 12   |b| = 24   |b| = 48
 *   containment              0.50       0.50       0.50       0.50   <- blind
 *   dice                     0.50       0.33       0.20       0.11
 *
 * Between two reviewers there is no "one of them restated itself at more length",
 * so a long text covering a short one is not evidence of agreement — it is the
 * arithmetic of covering a file's shared vocabulary. Both live cross-arm callers
 * are asymmetric, in OPPOSITE directions, and containment divides by whichever
 * side happens to be shorter in each:
 *
 *   harvest.mjs           panel summary 14 tokens vs CodeRabbit PROSE 32
 *   complementarity.mjs   panel summary 14 tokens vs CodeRabbit TITLE 7
 *
 * ⚠ The prose side is easy to miss by reading `attributeToPanel` alone: its
 * `neutral()` helper reads `f.summary`, but `harvest.mjs`'s call site has already
 * put `finding.detail` INTO that field ("Prose for the token comparison, the whole
 * body for the anchor layer"). The field is named `summary` and holds the prose.
 *
 * WHY IT IS WORTH CHANGING. `harvest.mjs` uses the verdict to decide when one
 * reviewer's finding restates another's, and a match SUPPRESSES the candidate — a
 * false one deletes a real finding from the corpus with no later pass able to
 * recover it, while a false non-match files a duplicate a curator strikes out in
 * one line. Measured over 3608 pairs drawn from DIFFERENT pull requests, so every
 * pair is a known non-match, plus the 6 pairs the incumbent metric calls `match`:
 *
 *                                       false matches   true matches kept
 *   TITLE  containment @ 0.30 (before)      2/3608             6/6
 *   TITLE  dice        @ 0.22 (after)       2/3608             6/6
 *   PROSE  containment @ 0.30 (before)     16/3608             4/6
 *   PROSE  dice        @ 0.22 (after)       1/3608             3/6
 *
 * ⚠ The right-hand column is 6 pairs deep and CIRCULAR — those 6 were selected by
 * containment. It shows recall is not silently destroyed; it is not a recall
 * measurement, and no labelled positive set exists for this comparison.
 *
 * The floor is kept for the same reason as above: two shared tokens across two
 * three-token summaries is Dice 0.67, over any bar here and meaningless.
 */
export function crossArmTokenOverlap(s1, s2) {
  const ta = summaryTokens(s1); const tb = summaryTokens(s2);
  if (ta.length === 0 || tb.length === 0) return 0;
  const B = new Set(tb);
  let shared = 0;
  for (const t of ta) if (B.has(t)) shared++;
  if (shared < MIN_SHARED_TOKENS) return 0;
  return (2 * shared) / (ta.length + tb.length);
}

/**
 * Best match for `needle` among `candidates`. Returns
 * `{ index, candidate, result }` for the highest-scoring non-`no` pair, or null
 * when every candidate is a `no`.
 *
 * Ties break toward `match` over `maybe`, then higher score — so a caller can
 * treat `result.verdict === "maybe"` as "emit this, flagged for a human".
 *
 * The needle's anchor is mined ONCE rather than once per candidate. `harvest.mjs`
 * calls this with every panel blocker on the pull request as candidates, so the
 * old shape re-derived the same anchor from the same CodeRabbit comment body for
 * each one. Behaviour is unchanged — `extractAnchor` is pure.
 */
export function bestMatch(needle, candidates, opts = {}) {
  let best = null;
  const anN = needle ? extractAnchor(needle) : null;
  (candidates ?? []).forEach((candidate, index) => {
    const result =
      !needle || !candidate
        ? res("no", 0, "guard", "missing operand")
        : matchAnchored(needle, candidate, anN, extractAnchor(candidate), opts);
    if (result.verdict === "no") return;
    const rank = (r) => (r.verdict === "match" ? 1 : 0) * 10 + r.score;
    if (!best || rank(result) > rank(best.result)) best = { index, candidate, result };
  });
  return best;
}

// --- grouping: pairwise verdicts → defect classes ---------------------------
//
// WHY THIS IS NOT A LOOP OVER `matchFindings`. `match` is not transitive: A~B and
// B~C can both be `match` while A~C is `no`, because the relation is token
// CONTAINMENT over the smaller summary and containment does not compose. Taking
// the transitive closure (single linkage) therefore grows one chain at a time
// until a whole pull request is one "defect", and nothing goes red while it
// happens — the row count just falls, which reads as success.

// Field separator for every hash preimage and partition key below. A character
// no finding can contain, so ["a", "b"] and ["a b"] can never digest alike.
const NUL = "\u0000";
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * How a group is allowed to grow. COMPLETE: two groups merge only when EVERY
 * cross pair between them is `match`, so every pair inside a group is itself a
 * `match` and a curator auditing any two members is auditing the whole claim.
 *
 * Single linkage was rejected on the module's own fail direction rather than on
 * taste. Under single linkage the group asserts something no pair witnesses —
 * "A and C are one defect" holds only via B — and the error is unrecoverable
 * downstream: two claims merged into one class credit one arm with the other's
 * catch, and the report says one defect where there were two. Complete linkage
 * fails the other way, into more classes than there are defects, which costs a
 * curator a second look. That asymmetry is the whole argument.
 *
 * It is recorded in `stats.linkage` and mixed into every group id, so a future
 * change of policy cannot quietly reuse the old ids for differently-shaped
 * groups.
 */
export const LINKAGE = "complete";

/**
 * The one arm whose findings carry a real `lens`, and therefore the only
 * population the same-run (lens, file) gate is right for.
 *
 * Named here rather than imported from `eval/finding-record.mjs`'s `ARMS`, and
 * the direction is the reason: `harvest.mjs` imports this file, so importing the
 * benchmark's vocabulary here would drag `eval/` into the harvester's graph. The
 * benchmark may read the panel's modules; the panel's must not read the
 * benchmark's.
 */
const LENSED_ARM = "panel";

/** `item_id` (a finding record), `item`, or a bare `pr` number. `null` means the
 *  finding does not say which pull request it is about — see `groupFindings`,
 *  which refuses to group it with anything rather than guessing. */
function defaultItemOf(f) {
  if (typeof f.item_id === "string" && f.item_id.trim() !== "") return f.item_id.trim();
  if (typeof f.item === "string" && f.item.trim() !== "") return f.item.trim();
  if (typeof f.pr === "number" && Number.isFinite(f.pr)) return `pr-${f.pr}`;
  if (typeof f.pr === "string" && f.pr.trim() !== "") return `pr-${f.pr.trim()}`;
  return null;
}
const defaultArmOf = (f) => (typeof f.arm === "string" && f.arm.trim() !== "" ? f.arm.trim() : null);
const defaultRunOf = (f) => {
  const r = f.run_id ?? f.runId;
  return typeof r === "string" && r.trim() !== "" ? r.trim() : null;
};

/**
 * Which lens produced the finding — the field the same-run gate compares, and
 * the one this function did not read for its first two consumers.
 *
 * TOP LEVEL FIRST, THEN THE LENSED ARM'S NAMESPACE, and the second half is the
 * whole point. A normalised finding record keeps the lens at
 * `record.panel.lens`, deliberately: it is in `ARM_ONLY_FIELDS` because a panel
 * lens is meaningless on a CodeRabbit record, and hoisting it would make the
 * record's top level lie about what every arm can fill. So a caller handing this
 * function records unmodified had `lens: undefined` on BOTH sides of every pair,
 * `trim(undefined) !== trim(undefined)` is FALSE, and the absolute (lens, file)
 * gate at `matchAnchored` — and `findingSimilarity`'s own copy of it — silently
 * degraded to file-only. Nothing threw and nothing logged; the grouping just
 * merged findings from different lenses and reported fewer, tidier classes.
 * Measured on the pilot's three replicates that was 20, 20 and 29 classes
 * collapsed that should not have been.
 *
 * The arm namespace is read by `LENSED_ARM` rather than by a literal, so the one
 * arm whose lens is real stays named in one place. CodeRabbit's `lens` is a
 * category→lens guess of ours and is never consulted here — `gateFor` already
 * routes every CodeRabbit pair to L2, which does not read a lens at all.
 *
 * `null` means UNREADABLE, which is not "the two lenses agree". The two cases
 * are indistinguishable at the gate, so `stats.gate.lens_unreadable` counts the
 * same-run pairs where it happened.
 */
function defaultLensOf(f) {
  if (typeof f.lens === "string" && f.lens.trim() !== "") return f.lens.trim();
  const armed = f[LENSED_ARM];
  if (armed && typeof armed === "object" && typeof armed.lens === "string" && armed.lens.trim() !== "") {
    return armed.lens.trim();
  }
  return null;
}

/**
 * The tuple grouping's behaviour actually depends on, hashed.
 *
 * NOT a second `findingKey`, and the difference matters. `findingKey` is the
 * panel's IDENTITY rule — file plus lowercased summary — and it deliberately
 * cannot tell two observations of one text apart, which is exactly what a group
 * id has to do: two findings with the same file and summary but disjoint
 * evidence are demoted to `maybe` by L1 and stay in two classes, and two classes
 * that print the same id are one class as far as any reader is concerned. So the
 * digest covers every field the matcher reads (`lens`, `file`, `summary`,
 * `evidence`) plus the provenance that selects the gate, and `findingKey` is
 * carried on each member UNCHANGED for anything that must agree with
 * `dedupeFindings`.
 *
 * It doubles as the canonical sort key. Two members with equal digests are
 * interchangeable for every decision this file makes, which is what makes the
 * merge order — and therefore the output — independent of input order.
 */
function contentDigest(node) {
  // The OPERAND, not the raw finding: the matcher is handed `node.operand`, so
  // that is what "every field the matcher reads" means. Reading `node.finding`
  // here instead would leave a lens resolved out of the arm namespace out of the
  // digest, and two findings on one file under different lenses — which the gate
  // now correctly keeps in two classes — would digest identically and collide on
  // an id, taking the occurrence suffix for a difference that is not arbitrary.
  const f = node.operand;
  return sha256hex(
    [
      node.item ?? "",
      node.arm ?? "",
      node.run ?? "",
      trim(f.lens),
      trim(f.file),
      String(f.summary ?? ""),
      String(f.evidence ?? ""),
    ].join(NUL),
  );
}

/** Content-derived, so re-running produces the same ids and a score quoted in a
 *  report stays re-derivable. A counter would not: insert one finding upstream
 *  and every id after it shifts. */
function defectClassId(item, digests) {
  return `D-${sha256hex([item ?? "", LINKAGE, ...[...digests].sort()].join(NUL)).slice(0, 16)}`;
}

/**
 * Which gate this PAIR needs — decided per pair, never once per call.
 *
 * A single defect class routinely holds both kinds at once: two panel findings
 * from one replay (same-run) and a CodeRabbit comment beside them (cross-source).
 * Choosing one `crossSource` for a whole grouping run therefore applies the wrong
 * rule to some fraction of the pairs, and NOTHING FAILS when it does — the
 * verdicts are all plausible, just wrong.
 *
 * The same-run gate is right for exactly one population: two findings from one
 * run of the lensed panel. A second replicate is not that population — the same
 * defect can surface under a different lens on a different try, and the absolute
 * lens gate would score it 0. Neither is CodeRabbit-vs-CodeRabbit: its `lens` is
 * a category→lens guess of OURS, so gating on it would partition one reviewer's
 * comments by our own annotation.
 *
 * When provenance is unreadable the pair falls back to `opts.crossSource`
 * (default `false`, matching `matchFindings`) and is counted in
 * `stats.gate.defaulted`. That direction is the safe one and it is measurable
 * rather than argued: the same-run gate rejects every different-lens and
 * different-file pair outright, so its `match` set is a SUBSET of L2's. Guessing
 * it costs merges we could have made; guessing L2 costs merges we should not
 * have, and only the second kind is unrecoverable.
 */
function gateFor(x, y, fallbackCrossSource) {
  // Unreadable provenance ⇒ CROSS-ARM as well as the fallback gate. Absent must
  // never read as "the same arm": that is the direction which silently restores
  // containment on a panel-vs-CodeRabbit pair, and `matchAnchored` makes the same
  // choice for the same reason.
  if (x.arm === null || y.arm === null) return { crossSource: fallbackCrossSource, sameArm: false, derived: false };
  // THREE CASES, NAMED. Same arm and same run is L0's population. Same arm across
  // runs is a replicate of ONE reviewer — L2's gate, but containment's metric,
  // because "one reviewer restated itself at more length" is exactly what
  // containment refuses to penalise. Different arms is two reviewers, where that
  // rationale does not apply at all.
  const sameArm = x.arm === y.arm;
  const sameRun = sameArm && x.arm === LENSED_ARM && x.run !== null && x.run === y.run;
  return { crossSource: !sameRun, sameArm, derived: true };
}

/**
 * Collapse findings into DEFECT CLASSES — one underlying problem, with the claims
 * that describe it attached (spec §2.2).
 *
 * `findings` is any mix of arms, runs and pull requests. Returns
 * `{ groups, links, stats }`, and the three are one answer:
 *
 *   groups  every finding, in exactly one class. A class of one is a first-class
 *           row, not a leftover — it is either a unique catch or a miss, which is
 *           the most interesting thing in the dataset. Empty input yields an empty
 *           group set, because an arm that found nothing is a TRUE NEGATIVE.
 *   links   every non-`no` pair whose endpoints ended in DIFFERENT classes: the
 *           `maybe`s, and the `match`es complete linkage declined to act on (with
 *           `blocked_by` naming the pair that stopped it). This is where the
 *           policy's cost is made visible instead of being implied by an absence.
 *   stats   the denominators, the gate census, and `intra_group_non_match`, which
 *           is 0 for any sound grouping and is the number that goes red if the
 *           linkage check is ever weakened.
 *
 * FOUR ACCESSORS, all injectable and all with a default that reads a normalised
 * finding record as well as a bare finding: `itemOf`, `armOf`, `runOf` and
 * `lensOf`. The first three select WHICH gate a pair gets (`gateFor`); the fourth
 * feeds the same-run gate's left half, and it was missing — see `defaultLensOf`
 * for what that cost. An accessor that throws is caught, recorded in
 * `stats.accessor_failures`, and treated as an unreadable value.
 *
 * WHAT IT NEVER DOES:
 *
 * - **Merge across pull requests.** Two items are two subjects; a class spanning
 *   them is not a defect. `opts.itemOf` reads the item and a finding that does not
 *   say which one it belongs to is grouped with NOTHING — attribution is never
 *   inferred, and `stats.unattributed` says how often that happened. Pass
 *   `{ item: "pr-549" }` when the caller knows and the findings do not.
 * - **Filter.** No severity floor, no `after-window` drop, no de-duplication of
 *   the input. The rule tags; a scorer chooses. Two entries for one object are two
 *   observations and both appear.
 * - **Narrow.** Each member carries the WHOLE finding (a copy, so nothing here can
 *   mutate a caller's array), never a rebuilt field list. `lane`, `novelty`,
 *   `gate_state`, `window`, `severity` and everything a later round annotates
 *   survive whether or not this file has heard of them. Upstream fixed this exact
 *   bug once in `normalizeFindings` and three copies of it outlived the fix.
 * - **Promote a `maybe`.** A `maybe` never merges. It becomes a link, so the
 *   candidate reaches a curator and nothing is suppressed.
 * - **Merge on no evidence.** One rule (G0, below) is stricter here than in
 *   `matchFindings`, and it is the only divergence: two findings with no tokens
 *   and no anchor score 1.00 against each other through
 *   `findingSimilarity`'s placeholder fallback, and grouping refuses it.
 *
 * Cost is O(n²) matcher calls but only O(n) anchor extractions — `extractAnchor`
 * is the expensive half and it runs once per finding, which
 * `stats.anchors_extracted` states so the property is checkable rather than
 * claimed.
 */
export function groupFindings(findings, opts = {}) {
  const input = Array.isArray(findings) ? findings : [];
  const itemOf =
    typeof opts.itemOf === "function" ? opts.itemOf : opts.item != null ? () => String(opts.item) : defaultItemOf;
  const armOf = typeof opts.armOf === "function" ? opts.armOf : defaultArmOf;
  const runOf = typeof opts.runOf === "function" ? opts.runOf : defaultRunOf;
  const lensOf = typeof opts.lensOf === "function" ? opts.lensOf : defaultLensOf;
  const fallbackCrossSource = opts.crossSource === true;

  const nodes = [];
  const skipped = [];
  const accessorFailures = [];
  // An injected accessor is caller code and this is a read path, so a throw is
  // caught and REPORTED rather than allowed to take the whole grouping down —
  // and rather than swallowed, which is the failure this project keeps naming.
  const read = (fn, f, index, which) => {
    try {
      return fn(f);
    } catch (err) {
      accessorFailures.push({ index, accessor: which, message: String(err?.message ?? err) });
      return null;
    }
  };

  input.forEach((finding, index) => {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      // Not a finding, so not a defect class. Recorded with its index rather than
      // dropped in silence: `matchFindings` guards its operands and returns `no`,
      // and a grouping that inherited that guard without counting would report a
      // clean run over an array half full of nulls. `findingKey` is deliberately
      // un-guarded upstream, so this check is also what keeps it from throwing.
      skipped.push({ index, reason: `not a finding object: ${finding === null ? "null" : typeof finding}` });
      return;
    }
    const rawItem = read(itemOf, finding, index, "itemOf");
    const item =
      typeof rawItem === "string" && rawItem.trim() !== ""
        ? rawItem.trim()
        : typeof rawItem === "number" && Number.isFinite(rawItem)
          ? String(rawItem)
          : null;
    const rawLens = read(lensOf, finding, index, "lensOf");
    const node = {
      index,
      item,
      arm: read(armOf, finding, index, "armOf"),
      run: read(runOf, finding, index, "runOf"),
      lens: typeof rawLens === "string" && rawLens.trim() !== "" ? rawLens.trim() : null,
      // Shallow copy. The caller's object is never touched, and `index` is kept
      // so a caller can still line a member up with the array it passed in.
      finding: { ...finding },
      key: findingKey(finding),
      anchor: extractAnchor(finding),
    };
    // THE OPERAND THE MATCHER SEES, which is the finding itself unless `lensOf`
    // resolved a lens the finding does not carry at the top level.
    //
    // The lens is not passed to `matchAnchored` as a gate parameter, and the
    // reason is the one that keeps the anchor out of the exported surface a few
    // hundred lines up: a matcher with two answers for one pair is worse than a
    // slow one. `matchFindings(operand, other)` returns exactly what the grouping
    // saw, so any verdict here is reproducible by hand from the member it names.
    // A `lensA`/`lensB` option would also have fixed only ONE of the two gates —
    // `findingSimilarity` in `rounds.mjs` re-checks the lens itself and reads it
    // off its operand, so it would have stayed lens-blind.
    //
    // Built once per finding, and only when it differs, so the common case (a
    // finding that already carries `lens`) allocates nothing and the copy that
    // reaches a caller in `members[].finding` is untouched — the resolved lens is
    // reported beside `arm` and `run` on the member instead of being written into
    // someone else's finding shape.
    node.operand = node.lens !== null && node.lens !== trim(finding.lens) ? { ...node.finding, lens: node.lens } : node.finding;
    // Computed once per finding for the same reason the anchor is: `summaryTokens`
    // is another regex pass, and G0 below would otherwise ask the question n²
    // times. `anchorIsEmpty` is the exported predicate for the second half.
    node.contentless = summaryTokens(finding.summary).length === 0 && anchorIsEmpty(node.anchor);
    node.digest = contentDigest(node);
    nodes.push(node);
  });

  // Partition FIRST, so a cross-item pair is never even compared. A finding with
  // no item gets a partition of its own, keyed by its position: it can be grouped
  // with nothing, which is the recoverable direction. Merging two pull requests'
  // findings into one class is not recoverable by anything downstream.
  const partitions = new Map();
  let unattributed = 0;
  nodes.forEach((n, pos) => {
    if (n.item === null) unattributed++;
    const key = n.item === null ? `${NUL}unattributed:${pos}` : n.item;
    if (!partitions.has(key)) partitions.set(key, []);
    partitions.get(key).push(pos);
  });

  const pairs = [];
  const verdictAt = new Map(); // "i:j" (i < j, positions in `nodes`) → pair
  const gateCensus = { "same-run": 0, "cross-source": 0, defaulted: 0, lens_unreadable: 0 };
  const tally = { compared: 0, match: 0, maybe: 0, no: 0 };
  let noEvidencePairs = 0;
  for (const positions of partitions.values()) {
    for (let x = 0; x < positions.length; x++) {
      for (let y = x + 1; y < positions.length; y++) {
        const i = positions[x];
        const j = positions[y];
        const gate = gateFor(nodes[i], nodes[j], fallbackCrossSource);
        let result = matchAnchored(nodes[i].operand, nodes[j].operand, nodes[i].anchor, nodes[j].anchor, {
          crossSource: gate.crossSource,
          sameArm: gate.sameArm,
          threshold: opts.threshold,
        });
        // G0 — THE ONE PLACE GROUPING IS STRICTER THAN `matchFindings`, deliberately.
        //
        // `findingSimilarity` falls back to exact case-insensitive text equality
        // when either token set degenerates to empty, "so a placeholder still
        // matches itself across rounds rather than scoring 0". That is right for
        // the question `rounds.mjs` asks — is this round a repeat? — and wrong for
        // this one. Two findings with no tokens and no anchor score 1.00 against
        // each other because "" equals "", so every contentless finding on a pull
        // request collapses into ONE class that then reads as N reviewers agreeing
        // on a defect. There is no defect and there was never any evidence.
        //
        // Demoted to `no` rather than `maybe` because `maybe` claims PARTIAL
        // evidence and would mint one adjudication candidate per pair out of
        // nothing — 190 of them for 20 such findings. Each stays its own class, so
        // nothing is lost; `stats.no_evidence_pairs` is how the case stays visible.
        // The divergence from `matchFindings` on the same pair is intentional and
        // one-directional: grouping never merges where the matcher would not.
        if (result.verdict === "match" && nodes[i].contentless && nodes[j].contentless) {
          result = res("no", 0, "G0-no-evidence", "neither finding carries a token or an anchor — no evidence of anything, let alone of one defect", {
            anchor: result.anchor,
          });
          noEvidencePairs++;
        }
        gateCensus[gate.crossSource ? "cross-source" : "same-run"]++;
        if (!gate.derived) gateCensus.defaulted++;
        // THE ASSERTION THIS WHOLE ACCESSOR EXISTS FOR — same job as `defaulted`
        // beside it, one level down. An absent lens and two EQUAL lenses are
        // indistinguishable at the gate: both make `trim(a.lens) !== trim(b.lens)`
        // false, so the pair proceeds on the file check alone and produces a
        // perfectly reasonable-looking verdict. Only counted on the same-run path,
        // because L2 never reads a lens and counting there would be noise.
        //
        // Counted, not thrown: this is a read path in merged code, and the fail
        // direction here is the module's — degrade to fewer merges and SAY SO,
        // never abort a caller's scoring run. Non-zero means a caller is passing
        // findings whose lens this file cannot see, and their same-run gate is
        // running as file-only.
        if (!gate.crossSource && (nodes[i].lens === null || nodes[j].lens === null)) gateCensus.lens_unreadable++;
        tally.compared++;
        tally[result.verdict]++;
        const pair = { i, j, result, crossSource: gate.crossSource, gateDerived: gate.derived };
        pairs.push(pair);
        verdictAt.set(`${i}:${j}`, pair);
      }
    }
  }
  const pairAt = (i, j) => verdictAt.get(i < j ? `${i}:${j}` : `${j}:${i}`);
  const verdictOf = (i, j) => pairAt(i, j)?.result.verdict ?? "no";

  // --- complete linkage -----------------------------------------------------
  //
  // Greedy over the `match` pairs in a CONTENT-DERIVED order — strongest score
  // first, ties broken by the two member digests — merging two groups only when
  // every cross pair between them is `match`. Nothing in that sentence mentions
  // the input array, which is the whole proof of order independence: the pair
  // list, its sort key and the merge test are all functions of the findings
  // themselves. A greedy first-match-wins loop over the input would pass every
  // sorted fixture and produce different groups on a shuffle.
  //
  // One pass suffices because completeness is MONOTONE: merging never makes a
  // blocked merge possible, it can only block one that was possible. So there is
  // nothing a second round would find.
  const parent = nodes.map((_, i) => i);
  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const membersOf = new Map(nodes.map((_, i) => [i, [i]]));
  const ordered = pairs
    .filter((p) => p.result.verdict === "match")
    .sort((p, q) => {
      if (q.result.score !== p.result.score) return q.result.score - p.result.score;
      const [pa, pb] = [nodes[p.i].digest, nodes[p.j].digest].sort();
      const [qa, qb] = [nodes[q.i].digest, nodes[q.j].digest].sort();
      return pa === qa ? pb.localeCompare(qb) : pa.localeCompare(qa);
    });
  for (const pair of ordered) {
    const ri = find(pair.i);
    const rj = find(pair.j);
    if (ri === rj) continue;
    const gi = membersOf.get(ri);
    const gj = membersOf.get(rj);
    let complete = true;
    for (const a of gi) {
      for (const b of gj) {
        if (verdictOf(a, b) !== "match") {
          complete = false;
          break;
        }
      }
      if (!complete) break;
    }
    if (!complete) continue;
    parent[rj] = ri;
    membersOf.set(ri, gi.concat(gj));
    membersOf.delete(rj);
  }

  // --- build the classes ----------------------------------------------------
  const groupIdAt = new Map(); // root → id
  const groups = [];
  // Two classes CAN digest alike, and the id has to stay unique anyway.
  //
  // It needs byte-identical findings that the matcher nonetheless refuses to
  // merge, which sounds impossible and is not: cross-source, an empty `file`
  // scores `locationScore` 0 (absent, not equal), so two copies of one finding
  // reach `maybe` on anchor agreement alone and stay two classes. G0 does the
  // same for two identical contentless ones. Both then hash to one id.
  //
  // That is not cosmetic. `candidatesOf` below is keyed BY id, so colliding
  // classes pool their links and each ends up listing ITSELF as a candidate.
  //
  // The fix is an occurrence suffix, NOT the input index: putting `index` in the
  // preimage would make the id depend on input order and renumber every class
  // when a finding is inserted upstream, which is the one thing a content-derived
  // id exists to prevent. Colliding classes are by definition indistinguishable —
  // equal digests mean equal `(item, arm, run, lens, file, summary, evidence)` —
  // so which of them takes the suffix is arbitrary and unobservable, while the set
  // of ids and the content under each stays identical under any permutation.
  const idSeen = new Map();
  let idCollisions = 0;
  for (const [root, positions] of membersOf) {
    const members = positions.map((pos) => nodes[pos]).sort((a, b) => a.digest.localeCompare(b.digest));
    const item = members[0].item;
    const base = defectClassId(
      item,
      members.map((m) => m.digest),
    );
    const seen = idSeen.get(base) ?? 0;
    idSeen.set(base, seen + 1);
    // A base id is always `D-` plus exactly 16 hex, so a suffixed one cannot
    // collide with some other class's base id.
    const id = seen === 0 ? base : `${base}-${seen + 1}`;
    if (seen > 0) idCollisions++;
    groupIdAt.set(root, id);
    // The weakest evidence holding the class together, so a reader can judge the
    // merge without re-running the matcher. Under complete linkage its verdict is
    // always `match`; anything else means the linkage check was bypassed.
    let weakest = null;
    for (let x = 0; x < positions.length; x++) {
      for (let y = x + 1; y < positions.length; y++) {
        const pair = pairAt(positions[x], positions[y]);
        if (!pair) continue;
        if (weakest === null || pair.result.score < weakest.score) {
          weakest = {
            a: nodes[pair.i].digest,
            b: nodes[pair.j].digest,
            verdict: pair.result.verdict,
            score: pair.result.score,
            method: pair.result.method,
            reason: pair.result.reason,
            cross_source: pair.crossSource,
          };
        }
      }
    }
    groups.push({
      id,
      item,
      size: members.length,
      // Sorted, deduped, `null` dropped — a class spanning both arms is the
      // agreement case and a class with one is the unique-catch candidate.
      arms: [...new Set(members.map((m) => m.arm).filter((a) => a !== null))].sort(),
      // Arm identity lives HERE and nowhere above, so the blinded view §2.2
      // requires is `group.members.map((m) => m.finding)` — derivable from this
      // output without re-deriving the groups.
      members: members.map((m) => ({
        index: m.index,
        digest: m.digest,
        key: m.key,
        item: m.item,
        arm: m.arm,
        run: m.run,
        // The lens the gate compared, reported for the same reason `arm` and
        // `run` are: they are what `gateFor` and the same-run gate READ, and a
        // reader asking why two same-file findings stayed apart cannot answer it
        // from the finding alone when the lens came out of the arm namespace.
        // `null` is unreadable, and `stats.gate.lens_unreadable` says how much of
        // the run that cost.
        lens: m.lens,
        finding: m.finding,
      })),
      pair_count: (members.length * (members.length - 1)) / 2,
      weakest_pair: weakest,
      candidates: [], // filled below, once every group has an id
    });
  }

  // --- links: everything the grouping did NOT act on ------------------------
  //
  // A `maybe` is here by policy — it must never merge, and it must never vanish
  // either. A `match` is here when complete linkage declined it, which is the one
  // place this policy loses information relative to single linkage, so it is
  // stated with the pair that blocked it rather than left to be inferred.
  const links = [];
  let intraGroupNonMatch = 0;
  for (const pair of pairs) {
    const ri = find(pair.i);
    const rj = find(pair.j);
    if (ri === rj) {
      if (pair.result.verdict !== "match") intraGroupNonMatch++;
      continue;
    }
    if (pair.result.verdict === "no") continue;
    const [a, b] =
      nodes[pair.i].digest.localeCompare(nodes[pair.j].digest) <= 0 ? [pair.i, pair.j] : [pair.j, pair.i];
    let blockedBy = null;
    if (pair.result.verdict === "match") {
      const left = [...membersOf.get(find(a))].sort((p, q) => nodes[p].digest.localeCompare(nodes[q].digest));
      const right = [...membersOf.get(find(b))].sort((p, q) => nodes[p].digest.localeCompare(nodes[q].digest));
      outer: for (const p of left) {
        for (const q of right) {
          const v = verdictOf(p, q);
          if (v !== "match") {
            blockedBy = { a: nodes[p].digest, b: nodes[q].digest, verdict: v };
            break outer;
          }
        }
      }
    }
    links.push({
      verdict: pair.result.verdict,
      groups: [groupIdAt.get(find(a)), groupIdAt.get(find(b))],
      members: [nodes[a].digest, nodes[b].digest],
      keys: [nodes[a].key, nodes[b].key],
      score: pair.result.score,
      method: pair.result.method,
      reason: pair.result.reason,
      cross_source: pair.crossSource,
      // Only ever set on a `match`: the pair that made the two classes
      // incompatible under complete linkage. `null` on a `maybe`, which was never
      // a merge candidate in the first place.
      blocked_by: blockedBy,
    });
  }
  links.sort((p, q) =>
    p.groups[0] !== q.groups[0]
      ? p.groups[0].localeCompare(q.groups[0])
      : p.groups[1] !== q.groups[1]
        ? p.groups[1].localeCompare(q.groups[1])
        : p.members[0] !== q.members[0]
          ? p.members[0].localeCompare(q.members[0])
          : p.members[1].localeCompare(q.members[1]),
  );

  const candidatesOf = new Map();
  for (const link of links) {
    for (const [self, other] of [
      [link.groups[0], link.groups[1]],
      [link.groups[1], link.groups[0]],
    ]) {
      if (!candidatesOf.has(self)) candidatesOf.set(self, new Set());
      candidatesOf.get(self).add(other);
    }
  }
  for (const group of groups) group.candidates = [...(candidatesOf.get(group.id) ?? [])].sort();
  groups.sort((p, q) =>
    String(p.item ?? "") !== String(q.item ?? "")
      ? String(p.item ?? "").localeCompare(String(q.item ?? ""))
      : p.id.localeCompare(q.id),
  );

  return {
    groups,
    links,
    stats: {
      linkage: LINKAGE,
      n: input.length,
      grouped: nodes.length,
      // Dropped inputs, with their positions. No silent truncation.
      skipped,
      accessor_failures: accessorFailures,
      // Findings that named no pull request, and were therefore grouped with
      // nothing. Non-zero means the caller should pass `item` or `itemOf`.
      unattributed,
      // Pull requests seen, NOT counting the one-finding partitions the
      // unattributed are parked in — those are not items, they are the absence
      // of one, and pooling them here would make "how many PRs is this?" grow
      // with the number of findings nobody could attribute.
      items: new Set(nodes.filter((n) => n.item !== null).map((n) => n.item)).size,
      groups: groups.length,
      singletons: groups.filter((g) => g.size === 1).length,
      largest: groups.reduce((max, g) => Math.max(max, g.size), 0),
      pairs: tally,
      // Pairs G0 refused: both sides carried no token and no anchor, so
      // `findingSimilarity`'s placeholder fallback would have scored them 1.00.
      // Counted separately because they are inside `pairs.no` and would otherwise
      // be indistinguishable from a real disagreement.
      no_evidence_pairs: noEvidencePairs,
      // Classes that digested alike and took an occurrence suffix. Non-zero means
      // the input held byte-identical findings the matcher declined to merge —
      // worth a look at the input, but the ids are still unique.
      id_collisions: idCollisions,
      // Which rule each pair got, plus the two ways that choice can be running on
      // less than it should: `defaulted` (provenance unreadable, so the gate was
      // guessed) and `lens_unreadable` (same-run pair, lens unreadable on at least
      // one side, so the (lens, file) gate ran as file-only). Both are subsets of
      // the two counts above them, and both are silent without this line.
      gate: gateCensus,
      links: {
        maybe: links.filter((l) => l.verdict === "maybe").length,
        match_held_apart: links.filter((l) => l.verdict === "match").length,
      },
      // One per finding, not one per pair — the whole point of `matchAnchored`.
      anchors_extracted: nodes.length,
      // The invariant, computed from the pair table rather than from the merge
      // code's own bookkeeping: complete linkage means every pair INSIDE a class
      // is a `match`, so this is 0 for any sound grouping. It is the assertion
      // that turns silent over-merging into a number a caller can refuse on.
      intra_group_non_match: intraGroupNonMatch,
    },
  };
}
