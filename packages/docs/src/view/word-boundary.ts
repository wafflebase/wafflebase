/**
 * Word-boundary detection for cursor navigation and text selection.
 *
 * Follows the same convention as most word processors:
 * - Words are sequences of alphanumeric/underscore characters
 * - Punctuation forms its own boundary group
 * - Whitespace is skipped
 * - CJK characters are each treated as individual words
 */

/**
 * Character categories for word-boundary logic.
 */
const enum CharCategory {
  Whitespace,
  Word,
  Punctuation,
  CJK,
}

/**
 * CJK Unified Ideographs and common CJK ranges.
 */
function isCJK(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||   // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) ||   // CJK Extension A
    (code >= 0xac00 && code <= 0xd7af) ||   // Hangul Syllables
    (code >= 0x3040 && code <= 0x309f) ||   // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) ||   // Katakana
    (code >= 0xff00 && code <= 0xffef)      // Fullwidth Forms
  );
}

function categorize(ch: string): CharCategory {
  if (/\s/.test(ch)) return CharCategory.Whitespace;
  const code = ch.codePointAt(0)!;
  if (isCJK(code)) return CharCategory.CJK;
  if (/[\p{L}\p{M}\p{N}]/u.test(ch)) return CharCategory.Word;
  return CharCategory.Punctuation;
}

/**
 * Find the offset of the next word boundary (moving right).
 * Matches the behaviour of Ctrl+Right / Option+Right in most editors:
 * skip the current word (or whitespace), then stop at the start of the next word.
 */
export function findNextWordBoundary(text: string, offset: number): number {
  const len = text.length;
  if (offset >= len) return len;

  let i = offset;
  const startCat = categorize(text[i]);

  // CJK: each character is its own word
  if (startCat === CharCategory.CJK) {
    i++;
  } else if (startCat === CharCategory.Whitespace) {
    // Skip whitespace, then stop at start of next word
    while (i < len && categorize(text[i]) === CharCategory.Whitespace) i++;
    return i;
  } else {
    // Skip same-category characters (word or punctuation run)
    while (i < len && categorize(text[i]) === startCat) i++;
  }

  // Skip trailing whitespace
  while (i < len && categorize(text[i]) === CharCategory.Whitespace) i++;

  return i;
}

/**
 * Find the offset of the previous word boundary (moving left).
 * Matches the behaviour of Ctrl+Left / Option+Left in most editors:
 * skip whitespace backwards, then skip the word backwards.
 */
export function findPrevWordBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;

  let i = offset;

  // Skip whitespace backwards
  while (i > 0 && categorize(text[i - 1]) === CharCategory.Whitespace) i--;

  if (i === 0) return 0;

  const cat = categorize(text[i - 1]);

  // CJK: each character is its own word
  if (cat === CharCategory.CJK) {
    return i - 1;
  }

  // Skip same-category characters backwards
  while (i > 0 && categorize(text[i - 1]) === cat) i--;

  return i;
}

/**
 * Find word boundaries around a position (for double-click selection).
 * Returns [start, end] of the word at the given offset.
 */
export function getWordRange(text: string, offset: number): [number, number] {
  if (text.length === 0) return [0, 0];

  // Clamp offset
  const pos = Math.min(offset, text.length - 1);
  const ch = text[pos];

  // If clicking on whitespace, select the whitespace run
  const cat = categorize(ch);

  if (cat === CharCategory.CJK) {
    return [pos, pos + 1];
  }

  // Expand left
  let start = pos;
  while (start > 0 && categorize(text[start - 1]) === cat) start--;

  // Expand right
  let end = pos;
  while (end < text.length && categorize(text[end]) === cat) end++;

  return [start, end];
}
