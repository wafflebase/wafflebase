// packages/docs/src/spell/tokenize.ts

export interface WordToken {
  start: number;
  end: number;
  word: string;
}

// A run of letters (any script), digits, apostrophes/hyphens kept internal.
const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}''\-]*/gu;

// Pre-scan patterns — matched spans are excluded before word tokenisation.
// URLs: http(s):// or www. prefix followed by non-whitespace chars.
// Emails: local@domain.tld (no whitespace or @ in either part).
const PRESCAN_RE =
  /(?:https?:\/\/|www\.)\S+|[^\s@]+@[^\s@]+\.[^\s@]+/g;

const HAS_LETTER_RE = /\p{L}/u;
const HAS_DIGIT_RE = /\p{N}/u;

type Range = [number, number]; // [inclusive-start, exclusive-end]

function buildSkipRanges(text: string): Range[] {
  const ranges: Range[] = [];
  for (const m of text.matchAll(PRESCAN_RE)) {
    ranges.push([m.index!, m.index! + m[0].length]);
  }
  return ranges;
}

function inSkipRange(start: number, end: number, ranges: Range[]): boolean {
  return ranges.some(([rs, re]) => start >= rs && end <= re);
}

function isSkippable(word: string): boolean {
  if (word.length < 2) return true;
  // pure number (no letters)
  if (!HAS_LETTER_RE.test(word)) return true;
  // alnum mix containing a digit (e.g. h2o, v2) — treat as non-word
  if (HAS_DIGIT_RE.test(word)) return true;
  // all-caps acronym, length >= 2 (only meaningful for cased scripts)
  if (word === word.toUpperCase() && word !== word.toLowerCase()) return true;
  return false;
}

/** Emit checkable word tokens with static skip rules applied. */
export function tokenizeWords(text: string): WordToken[] {
  const skipRanges = buildSkipRanges(text);
  const out: WordToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const word = m[0];
    const start = m.index!;
    const end = start + word.length;
    if (inSkipRange(start, end, skipRanges)) continue;
    if (isSkippable(word)) continue;
    out.push({ start, end, word });
  }
  return out;
}
