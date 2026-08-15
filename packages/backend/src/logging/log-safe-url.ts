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
 * Query parameters that grant something, wherever they appear.
 *
 * `/auth` is not the only route that takes a credential on the query string:
 * `GET /documents/:id/file?token=` reads an anonymous share-link token, which
 * is the whole of that document's access control, and every 4xx is logged at
 * `warn`. Names are matched case-insensitively; the list is deliberately
 * broad, because a parameter wrongly on it costs one unreadable log line and
 * one wrongly off it parks a live credential in the access log.
 */
const SENSITIVE_PARAMS = new Set([
  'token',
  'share_token',
  'sharetoken',
  'code',
  'state',
  'nonce',
  'code_challenge',
  'code_verifier',
  'cli_confirm',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'password',
  'signature',
  'sig',
]);

const REDACTED = '<redacted>';

/**
 * The query string with every granting parameter's *value* replaced, keeping
 * the names — which is what makes an access log worth reading.
 */
function redactParams(query: string): string {
  // Split by hand rather than through `URLSearchParams`: re-serializing would
  // percent-encode the marker itself and rewrite every untouched parameter,
  // and an access log is read by eye.
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const rawName = pair.slice(0, eq);
      let name = rawName.replace(/\+/g, ' ');
      try {
        name = decodeURIComponent(name);
      } catch {
        // Undecodable name — compare on the raw spelling instead.
      }
      return SENSITIVE_PARAMS.has(name.toLowerCase())
        ? `${rawName}=${REDACTED}`
        : pair;
    })
    .join('&');
}

/**
 * A request URL safe to log.
 *
 * `/auth` query strings carry single-use login secrets — the CLI's `nonce`
 * and PKCE `code_challenge` on the way out, GitHub's `code` and `state` on
 * the way back — and every 4xx there is logged at `warn`, so keeping them
 * would park a replayable login in the access log for anyone who can read
 * it. The whole query goes there, since the path is what that log is read
 * for. Elsewhere the query is kept — it is the only thing that distinguishes
 * two calls — minus the value of any parameter that grants access on its own.
 *
 * Exported for its own tests: it is a security control with boundary cases
 * (`/authz` is not `/auth`, `/AUTH` is) that nothing else would catch.
 */
export function logSafeUrl(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const query = url.indexOf('?');
  if (query === -1) return url;
  const path = url.slice(0, query);
  if (isAuthPath(path)) return `${path}?${REDACTED}`;

  try {
    return `${path}?${redactParams(url.slice(query + 1))}`;
  } catch {
    // Unparseable query — redact it whole rather than log it whole.
    return `${path}?${REDACTED}`;
  }
}
