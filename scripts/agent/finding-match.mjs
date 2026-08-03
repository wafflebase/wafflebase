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

import { findingSimilarity, summaryTokens, DEFAULT_SIMILARITY, MIN_SHARED_TOKENS } from "./rounds.mjs";

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
 * `opts.crossSource` (default false) selects the gate. Within one panel run both
 * operands are panel-shaped and the absolute (lens, file) gate is right, so L0/L1
 * apply. Across sources it is wrong — CodeRabbit has no lens, and two reviewers
 * can blame different files for one defect — so L2's soft gate applies instead.
 * `opts.threshold` overrides the token bar.
 *
 * Verdicts: `match` (confident), `maybe` (plausible — emit, flagged for a human),
 * `no`. Conservative by construction: ambiguity yields `maybe`.
 */
export function matchFindings(a, b, opts = {}) {
  if (!a || !b) return res("no", 0, "guard", "missing operand");
  const crossSource = opts.crossSource === true;
  const threshold = opts.threshold ?? DEFAULT_SIMILARITY;

  const anA = extractAnchor(a);
  const anB = extractAnchor(b);
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
  const tokens = tokenOverlap(a.summary, b.summary);
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
 * Best match for `needle` among `candidates`. Returns
 * `{ index, candidate, result }` for the highest-scoring non-`no` pair, or null
 * when every candidate is a `no`.
 *
 * Ties break toward `match` over `maybe`, then higher score — so a caller can
 * treat `result.verdict === "maybe"` as "emit this, flagged for a human".
 */
export function bestMatch(needle, candidates, opts = {}) {
  let best = null;
  (candidates ?? []).forEach((candidate, index) => {
    const result = matchFindings(needle, candidate, opts);
    if (result.verdict === "no") return;
    const rank = (r) => (r.verdict === "match" ? 1 : 0) * 10 + r.score;
    if (!best || rank(result) > rank(best.result)) best = { index, candidate, result };
  });
  return best;
}
