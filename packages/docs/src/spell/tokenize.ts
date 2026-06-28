// packages/docs/src/spell/tokenize.ts

export interface WordToken {
  start: number;
  end: number;
  word: string;
}

// A run of letters (any script), digits, apostrophes/hyphens kept internal.
const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}''\-]*/gu;

// Pre-scan patterns — matched spans mark URL/email tokens so that their
// constituent words are suppressed by the spell-checker.
//
// Both arms exclude commas and semicolons from their character classes so
// that "https://a.com,nextword" or "me@x.io,nextword" stops the span at
// the comma and does NOT absorb the following real word.
//
// buildSkipRanges() additionally strips trailing prose-punctuation characters
// (e.g. a sentence-ending period or closing paren) from each matched span
// before recording its range, preventing a URL like "https://a.com." from
// suppressing a following word that shares no whitespace separator.
const PRESCAN_RE =
  /(?:https?:\/\/|www\.)[^\s,;]+|[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/g;

// Prose punctuation that may trail a URL/email but is not part of it.
const TRAILING_PUNCT_RE = /[.,;:!?)}\]'"]+$/;

const HAS_LETTER_RE = /\p{L}/u;
const HAS_DIGIT_RE = /\p{N}/u;

type Range = [number, number]; // [inclusive-start, exclusive-end]

function buildSkipRanges(text: string): Range[] {
  const ranges: Range[] = [];
  for (const m of text.matchAll(PRESCAN_RE)) {
    // Strip trailing prose punctuation (e.g. "https://a.com." → "https://a.com")
    // so that sentence-ending characters after a URL are not part of the skip span.
    const trimmed = m[0].replace(TRAILING_PUNCT_RE, '');
    const start = m.index!;
    ranges.push([start, start + trimmed.length]);
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
