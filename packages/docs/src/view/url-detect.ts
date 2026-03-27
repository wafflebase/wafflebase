const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Check if a URL has a safe protocol (not javascript:, data:, etc.).
 * Returns false for invalid URLs.
 */
export function isSafeUrl(href: string): boolean {
  try {
    const url = new URL(href, 'https://placeholder.invalid');
    return SAFE_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
}

/**
 * Normalize a user-entered URL: add https:// if no protocol is present,
 * and validate against safe protocols. Returns null if unsafe.
 */
export function normalizeLinkUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Add protocol if missing (bare hostnames like "example.com")
  const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  return isSafeUrl(url) ? url : null;
}

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
