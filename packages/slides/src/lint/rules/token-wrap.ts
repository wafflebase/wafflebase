/**
 * `token-wrap` — a line break that splits text which reads as one unit.
 *
 * Read off the same layout the canvas paints (`layoutText`, so autofit and
 * the deck pre-scale apply), a wrap is reported when a line boundary falls
 * inside:
 *
 * - a short bracketed group — `(58 / 174)`, `[n = 12]` — of at most 24
 *   characters between the brackets (a long parenthetical aside may wrap);
 * - a ratio of two numbers — `58 / 174`;
 * - a word that carries a digit — `1,234`, `24%`, `87건`, `$4.2M`,
 *   `v0.7.26` — broken mid-word, which the layout does when the word is
 *   wider than the line or at a style change inside it.
 *
 * Found building a real deck: "(58 / 174)" wrapped between "(58 /" and
 * "174)". `warning`: the fix (widen the box, shorten the line, or keep the
 * group on one line) is always cheap. An explicit line break (`\n`) is
 * the author's and never counted.
 */
import type { Slide } from '../../model/presentation';
import {
  hasText,
  layoutText,
  type DeckContext,
  type PlacedElement,
} from '../context';
import type { Finding } from '../types';

/** Longest bracket content still read as one token. */
const MAX_BRACKET_CONTENT = 24;

const BRACKETED = [
  new RegExp(`\\([^()\\[\\]\\n]{1,${MAX_BRACKET_CONTENT}}\\)`, 'g'),
  new RegExp(`\\[[^()\\[\\]\\n]{1,${MAX_BRACKET_CONTENT}}\\]`, 'g'),
];
const RATIO = /\d[\d.,]*[ \t]*\/[ \t]*\d[\d.,]*/g;

type Span = { start: number; end: number };

/** A block's text as laid out, and the offsets where each wrapped line starts. */
function blockLines(lines: { runs: { text: string }[] }[]): { text: string; breaks: number[] } {
  let text = '';
  const breaks: number[] = [];
  lines.forEach((line, i) => {
    if (i > 0) breaks.push(text.length);
    for (const run of line.runs) text += run.text;
  });
  return { text, breaks };
}

function tokenSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const re of [...BRACKETED, RATIO]) {
    for (const m of text.matchAll(re)) {
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return spans;
}

/** The whitespace-free word around offset `at`, when `at` falls inside one. */
function wordAround(text: string, at: number): Span | undefined {
  if (at <= 0 || at >= text.length) return undefined;
  if (/\s/.test(text[at - 1]) || /\s/.test(text[at])) return undefined;
  let start = at;
  let end = at;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { start, end };
}

/** The longest token a line break at `at` splits, if any. */
function splitToken(text: string, spans: Span[], at: number): Span | undefined {
  let best: Span | undefined;
  const word = wordAround(text, at);
  const candidates = word && /\d/.test(text.slice(word.start, word.end)) ? [...spans, word] : spans;
  for (const s of candidates) {
    if (s.start < at && at < s.end && (!best || s.end - s.start > best.end - best.start)) {
      best = s;
    }
  }
  return best;
}

export function checkTokenWrap(
  slide: Slide,
  slideIndex: number,
  placed: PlacedElement[],
  ctx: DeckContext,
): Finding[] {
  const findings: Finding[] = [];
  for (const p of placed) {
    if (!hasText(p.el)) continue;
    const tl = layoutText(p.el, ctx);
    if (!tl) continue;
    let hit: { token: string; before: string; after: string } | undefined;
    for (const lb of tl.layout.blocks) {
      const { text, breaks } = blockLines(lb.lines);
      if (breaks.length === 0) continue;
      const spans = tokenSpans(text);
      for (const at of breaks) {
        // A line that ends in an explicit break is the author's, not a wrap.
        if (text[at - 1] === '\n') continue;
        const s = splitToken(text, spans, at);
        if (!s) continue;
        hit = {
          token: text.slice(s.start, s.end),
          before: text.slice(s.start, at).trimEnd(),
          after: text.slice(at, s.end),
        };
        break;
      }
      if (hit) break;
    }
    if (!hit) continue;
    findings.push({
      rule: 'token-wrap',
      severity: 'warning',
      slideId: slide.id,
      slideIndex,
      elementId: p.el.id,
      message: `line break splits "${hit.token}" into "${hit.before}" / "${hit.after}"; widen the box or keep it on one line`,
    });
  }
  return findings;
}
