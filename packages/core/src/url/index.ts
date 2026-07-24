/**
 * Shared URL-safety primitive.
 *
 * Previously duplicated across the engine packages (Docs and Sheets each
 * carried their own `isSafeUrl`/`SAFE_PROTOCOLS`, which had already begun to
 * diverge). Hoisted here so every renderer/exporter gates hyperlinks against
 * the same protocol allowlist.
 */

/**
 * Protocols considered safe to render as clickable links. Excludes
 * `javascript:`, `data:`, `blob:`, `file:`, etc.
 */
export const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Check if a URL has a safe protocol (not `javascript:`, `data:`, etc.).
 *
 * Returns `false` for invalid or relative URLs — callers must pass an
 * absolute URL with an explicit scheme (normalize schemeless input first).
 */
export function isSafeUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return SAFE_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
}
