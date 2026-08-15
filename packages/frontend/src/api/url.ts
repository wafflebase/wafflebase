/**
 * One path segment of a request URL.
 *
 * The same rule the CLI enforces in `packages/cli/src/client/url.ts`, applied
 * to the browser client: every id interpolated into a route — a document id, a
 * folder id, a workspace id — is pinned to the one segment it was meant to
 * fill. Unencoded, an id carrying `/` or `..` walks the request onto an
 * endpoint the caller never named, and `fetchWithAuth` sends it with the
 * user's session attached. Ids here normally come back from the server, but
 * "normally" is not an access-control boundary: they also arrive from the URL
 * bar, from pasted links, and from imported content.
 *
 * `encodeURIComponent` escapes `/`, `\`, `:`, `#`, `?` and `%`, which covers
 * every separator — but not a bare dot, and the URL parser resolves `.` / `..`
 * however they are spelled. No id is ever a dot segment, so those are refused
 * rather than sent.
 */
export function seg(value: string): string {
  if (value === "." || value === "..") {
    throw new Error(`Invalid path segment: "${value}"`);
  }
  return encodeURIComponent(value);
}
