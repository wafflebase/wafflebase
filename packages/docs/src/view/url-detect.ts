/**
 * Detects a URL token immediately before the given cursor offset.
 * Scans backward from cursorOffset to find the start of the current word
 * (delimited by space or newline), then checks if it matches an http(s) URL.
 */
export function detectUrlBeforeCursor(
  text: string,
  cursorOffset: number,
): { start: number; end: number; url: string } | null {
  if (cursorOffset <= 0) return null;

  // Scan backward from cursorOffset to find word start
  let start = cursorOffset;
  while (start > 0 && text[start - 1] !== ' ' && text[start - 1] !== '\n') {
    start--;
  }

  const token = text.slice(start, cursorOffset);
  if (/^https?:\/\/.+/.test(token)) {
    return { start, end: cursorOffset, url: token };
  }

  return null;
}
