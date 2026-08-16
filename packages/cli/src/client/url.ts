import type { CliConfig } from '../config/config.js';

/**
 * The segments the WHATWG URL parser resolves away instead of keeping.
 *
 * `encodeURIComponent` escapes `/` and `?` but *not* `.`, and the URL spec
 * defines a dot segment as `.`, `..`, `%2e`, `.%2e`, `%2e.` or `%2e%2e`
 * (ASCII case-insensitive) — so percent-encoding cannot smuggle a literal
 * `..` through as data: `fetch` pops a path segment either way. An
 * identifier that is exactly a dot segment therefore has to be refused,
 * not escaped.
 */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/**
 * Encode one path segment of a request (or previewed request) URL.
 *
 * Identifiers reach the CLI straight from argv, the environment, or a YAML
 * profile, and are interpolated into a URL string that `fetch` parses with
 * the WHATWG parser. Unescaped, a `/` or `?` in an id would retarget the
 * credentialed request off the workspace prefix; a `..` would pop a segment
 * — e.g. `api-keys revoke ..` would become `DELETE /workspaces/<ws>/`, the
 * route that deletes the whole workspace. Escaping handles the first,
 * rejection the second.
 *
 * This is the single definition used by both the live client and the
 * `--dry-run` preview, so a preview cannot disagree with the request it
 * describes — including for `config.workspace`, which is as caller-controlled
 * as the rest (`--workspace`, `WAFFLEBASE_WORKSPACE`, or a config profile).
 */
export function seg(value: string): string {
  const encoded = encodeURIComponent(value);
  if (encoded === '' || DOT_SEGMENT.test(encoded)) {
    throw new Error(
      `Invalid identifier ${JSON.stringify(value)}: a URL path segment cannot ` +
        `be empty, "." or ".." — the URL parser resolves those, so the request ` +
        `would reach a different endpoint than the one named.`,
    );
  }
  return encoded;
}

/** The configured server with any trailing slash stripped. */
function origin(config: CliConfig): string {
  return config.server.replace(/\/$/, '');
}

/** Workspace-scoped v1 API base — everything under `/api/v1`. */
export function apiV1Base(config: CliConfig): string {
  return `${origin(config)}/api/v1/workspaces/${seg(config.workspace)}`;
}

/**
 * The API-key management URL. These endpoints are the workspace routes the
 * browser uses rather than v1 API routes, so they cannot be expressed as a
 * path under `apiV1Base`. One builder shared by `HttpClient` and the
 * `--dry-run` preview: "the preview is the request" only holds while there
 * is a single definition of the request.
 */
export function apiKeysUrl(config: CliConfig, keyId?: string): string {
  const base = `${origin(config)}/workspaces/${seg(config.workspace)}/api-keys`;
  return keyId === undefined ? base : `${base}/${seg(keyId)}`;
}
