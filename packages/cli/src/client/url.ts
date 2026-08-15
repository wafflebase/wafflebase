/**
 * One path segment of a request URL.
 *
 * Every id the client interpolates — the workspace, a document id, a tab id,
 * a cell reference — arrives from argv, a config file or a document an agent
 * generated, and `fetch` resolves `.` / `..` in a path per the WHATWG URL
 * rules. Unencoded, `docs delete '../../../../workspaces/w/api-keys/k'`
 * walks the request out of the `/api/v1/workspaces/<ws>` base and issues it —
 * with the session's bearer token and the command's own HTTP method — against
 * an endpoint the command never named. Encoding pins every id to the one
 * segment it was meant to fill.
 *
 * Encoding alone is not enough for `.` and `..`: `encodeURIComponent` leaves
 * a dot untouched, and the URL parser resolves those two segments however
 * they are spelled. No id is ever a dot segment, so they are refused rather
 * than sent.
 *
 * Lives here, not on `HttpClient`, because the URL an id lands in is built in
 * two places: `HttpClient` for the request itself, and `printDryRun` (via the
 * commands, which assemble the previewed path) for `--dry-run`. A preview
 * that skipped this would print a walked-out URL as "the request that would
 * be sent" — the one output an agent is most likely to copy and run.
 */
export function seg(value: string): string {
  if (value === '.' || value === '..') {
    throw new Error(`Invalid path segment: "${value}"`);
  }
  return encodeURIComponent(value);
}
