import type { CliConfig } from '../config/config.js';
import { apiV1Base } from './url.js';

/**
 * Print the request that would be sent without executing it.
 *
 * `path` is relative to the workspace-scoped v1 API base; interpolate
 * identifiers into it with `seg()` (`./url.js`), exactly as `HttpClient`
 * encodes them for the real request. The base — workspace segment included —
 * comes from the same builder `HttpClient` fetches through, so the preview
 * cannot drift from the request. That matters because a preview is only worth
 * reading if it is the URL that would actually be sent: an unencoded id would
 * print a request walked out of the workspace base and pointed at an endpoint
 * the command never named, which is the one output an agent is most likely to
 * copy and run.
 *
 * The dot-segment check is the same refusal `seg()` makes, repeated here as
 * the invariant it leaves behind: after encoding, no segment of `path` can be
 * `.` or `..`, so one that is means an id reached this builder raw. Refusing
 * is what `seg()` would have done, and nothing is printed.
 */
export function printDryRun(
  config: CliConfig,
  method: string,
  path: string,
  body?: unknown,
) {
  assertNoDotSegments(path);
  printDryRunUrl(`${apiV1Base(config)}${path}`, method, body);
}

/**
 * The same preview for an endpoint that does not hang off the v1 API base.
 * The API-key management routes live at `/workspaces/:id/api-keys`, so they
 * cannot be expressed as a `printDryRun` path — build their URL with
 * `apiKeysUrl()` (`./url.js`), the builder `HttpClient` itself uses.
 */
export function printDryRunUrl(url: string, method: string, body?: unknown) {
  const output: Record<string, unknown> = {
    dry_run: true,
    method,
    url,
  };
  if (body !== undefined) {
    output.body = body;
  }

  console.log(JSON.stringify(output, null, 2));
}

/** Throw `seg()`'s own error if any segment of `path` is `.` or `..`. */
function assertNoDotSegments(path: string) {
  // The query string is not a path — `?range=A1:C10` is encoded separately
  // and cannot move the request between endpoints.
  for (const part of path.split('?')[0].split('/')) {
    if (part === '.' || part === '..') {
      throw new Error(`Invalid path segment: "${part}"`);
    }
  }
}
