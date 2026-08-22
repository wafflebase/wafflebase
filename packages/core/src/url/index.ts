/**
 * Shared URL-safety primitives.
 *
 * Previously duplicated across the engine packages (Docs and Sheets each
 * carried their own `isSafeUrl`/`SAFE_PROTOCOLS`, which had already begun to
 * diverge). Hoisted here so every renderer/exporter gates hyperlinks against
 * the same protocol allowlist — and, since the same argument applies to the
 * request URLs the clients build, so that the CLI and the browser client pin
 * path segments with one implementation rather than two copies.
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

/**
 * One path segment of a request URL.
 *
 * Every id a client interpolates into a route — a workspace, a document id, a
 * tab id, a cell reference — arrives from argv, a config file, the URL bar, a
 * pasted link or a document an agent generated, and the URL parser resolves
 * `.` / `..` in a path per the WHATWG rules. Unencoded, an id carrying `/` or
 * `..` walks the request out of its base and issues it — with the caller's
 * session or bearer token, and the command's own HTTP method — against an
 * endpoint nobody named. Encoding pins every id to the one segment it was
 * meant to fill.
 *
 * Encoding alone is not enough for `.` and `..`: `encodeURIComponent` leaves a
 * bare dot untouched, and the parser resolves those two segments however they
 * are spelled. No id is ever a dot segment, so they are refused rather than
 * sent.
 *
 * Lives here rather than on either client, because both build such URLs — the
 * CLI in `HttpClient` and in `printDryRun`'s `--dry-run` preview, the browser
 * in every `packages/frontend/src/api` module — and a rule enforced by two
 * copies is a rule that drifts.
 */
export function seg(value: string): string {
  if (value === '.' || value === '..') {
    throw new Error(`Invalid path segment: "${value}"`);
  }
  return encodeURIComponent(value);
}
