/**
 * Whether a raw request path is routed by the `/auth` controller.
 *
 * The literal prefix is not enough. Express's router is case-insensitive by
 * default (`case sensitive routing` is off) and matches the percent-decoded
 * path, so `/AUTH/github`, `/Auth/github/callback` and `/%61uth/github` all
 * reach the same handler as `/auth/github` — and a predicate that only knows
 * the lowercase literal spelling would log those requests' query strings in
 * full, which is exactly what the redaction exists to prevent. So the path is
 * decoded, lowercased and its repeated slashes collapsed before the test.
 */
function isAuthPath(path: string): boolean {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Malformed percent escape — Express rejects it, but redact on the raw
    // spelling rather than assume, since erring toward redaction only costs
    // a query string in a log line.
  }
  const normalized = decoded.toLowerCase().replace(/\/{2,}/g, '/');
  return /^\/auth(?:\/|$)/.test(normalized);
}

/**
 * A request URL safe to log.
 *
 * `/auth` query strings carry single-use login secrets — the CLI's `nonce`
 * and PKCE `code_challenge` on the way out, GitHub's `code` and `state` on
 * the way back — and every 4xx there is logged at `warn`, so keeping them
 * would park a replayable login in the access log for anyone who can read
 * it. The path is what the access log is read for; elsewhere the query is
 * kept, since it is the only thing that distinguishes two calls.
 *
 * Exported for its own tests: it is a security control with boundary cases
 * (`/authz` is not `/auth`, `/AUTH` is) that nothing else would catch.
 */
export function logSafeUrl(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const query = url.indexOf('?');
  if (query === -1) return url;
  const path = url.slice(0, query);
  return isAuthPath(path) ? `${path}?<redacted>` : url;
}
