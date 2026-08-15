/**
 * One path segment of a request URL.
 *
 * The rule itself lives in `@wafflebase/core/url` — the shared home for URL
 * safety primitives — because the CLI client builds the same kind of URL from
 * the same kind of id, and two copies of a security rule drift. Re-exported
 * here so every `src/api` module keeps importing it from the client layer it
 * belongs to.
 *
 * Ids here normally come back from the server, but "normally" is not an
 * access-control boundary: they also arrive from the URL bar, from pasted
 * links, and from imported content, and `fetchWithAuth` sends the request with
 * the user's session attached.
 */
export { seg } from "@wafflebase/core/url";
