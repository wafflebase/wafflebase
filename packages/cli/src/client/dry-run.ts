import type { CliConfig } from '../config/config.js';
import { apiV1Base } from './url.js';

/**
 * Print the request that would be sent without executing it.
 *
 * `path` is relative to the workspace-scoped v1 API base; interpolate
 * identifiers into it with `seg()` (`./url.js`). The base — workspace segment
 * included — comes from the same builder `HttpClient` fetches through, so the
 * preview cannot drift from the request.
 */
export function printDryRun(
  config: CliConfig,
  method: string,
  path: string,
  body?: unknown,
) {
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
