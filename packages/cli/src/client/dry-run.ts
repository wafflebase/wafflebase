import type { CliConfig } from '../config/config.js';
import { seg } from './url.js';

/**
 * Print the request that would be sent without executing it.
 *
 * `path` is the part below `/api/v1/workspaces/<ws>`, already assembled by
 * the command — and its ids must already have gone through `seg()` there,
 * exactly as `HttpClient` encodes them for the real request. A preview is
 * only worth reading if it is the URL that would actually be sent: an
 * unencoded id would print a request walked out of the workspace base and
 * pointed at an endpoint the command never named, which is the one output an
 * agent is most likely to copy and run.
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

  const server = config.server.replace(/\/$/, '');
  const url = `${server}/api/v1/workspaces/${seg(config.workspace)}${path}`;

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
