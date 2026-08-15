/**
 * One path segment of a request URL.
 *
 * The rule itself lives in `@wafflebase/core/url` — the shared home for URL
 * safety primitives — because the browser client builds the same kind of URL
 * from the same kind of id, and two copies of a security rule drift.
 *
 * Re-exported here rather than imported directly at each call site because the
 * URL an id lands in is built in two places in this package: `HttpClient` for
 * the request itself, and `printDryRun` (via the commands, which assemble the
 * previewed path) for `--dry-run`. A preview that skipped this would print a
 * walked-out URL as "the request that would be sent" — the one output an agent
 * is most likely to copy and run.
 */
export { seg } from '@wafflebase/core/url';
