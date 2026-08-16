import type { CliConfig } from '../config/config.js';

/**
 * Encode one path segment of a previewed URL.
 *
 * A dry run is only useful if it prints the request that would actually be
 * sent, so every identifier interpolated into a preview path goes through
 * this — the same `encodeURIComponent` `HttpClient` applies before it fetches.
 * Without it a `doc-id` of `../../other` would print a URL that differs from
 * the one the live command sends.
 */
export function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Print the request that would be sent without executing it.
 *
 * `path` is relative to the workspace-scoped v1 API base; interpolate
 * identifiers into it with `seg()`.
 */
export function printDryRun(
  config: CliConfig,
  method: string,
  path: string,
  body?: unknown,
) {
  const server = config.server.replace(/\/$/, '');
  printDryRunUrl(
    `${server}/api/v1/workspaces/${config.workspace}${path}`,
    method,
    body,
  );
}

/**
 * The same preview for an endpoint that does not hang off the v1 API base.
 * The API-key management routes live at `/workspaces/:id/api-keys`, so they
 * cannot be expressed as a `printDryRun` path.
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
