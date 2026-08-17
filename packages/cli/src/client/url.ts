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
 * describes.
 *
 * The *empty* segment is refused too. It does not retarget the request the way
 * a traversal does, but it does not 404 either: Nest runs Express with strict
 * routing disabled, so `GET /api/v1/workspaces/<ws>/documents/` matches the
 * *collection* route — `documents get ""` would silently list every document
 * instead of failing on a missing id. The one segment allowed to be empty is
 * the workspace (see `workspaceSeg`).
 */
export function seg(value: string): string {
  if (value === '') {
    throw new Error(
      'Invalid identifier "": a URL path segment cannot be empty — Express ' +
        'matches the trailing-slash path against the collection route, so the ' +
        'request would address the collection rather than the named resource.',
    );
  }
  const encoded = encodeURIComponent(value);
  if (DOT_SEGMENT.test(encoded)) {
    throw new Error(
      `Invalid identifier ${JSON.stringify(value)}: a URL path segment cannot ` +
        `be "." or ".." — the URL parser resolves those, so the request would ` +
        `reach a different endpoint than the one named.`,
    );
  }
  return encoded;
}

/** The configured server with any trailing slash stripped. */
function origin(config: CliConfig): string {
  return config.server.replace(/\/$/, '');
}

/**
 * The workspace path segment — the one identifier allowed to be empty.
 *
 * `resolveConfig` intentionally returns `workspace: ''` when nobody has picked
 * one (`--workspace`, `WAFFLEBASE_WORKSPACE`, session `activeWorkspace`, or a
 * config profile are all absent), and `login` persists `activeWorkspace: ''`
 * for an account with no workspaces. Throwing here would turn every command,
 * and every offline `--dry-run` preview, into an `Invalid identifier ""` for a
 * caller who has simply not chosen a workspace yet. Unlike an empty document or
 * tab id, an empty workspace cannot fall through to a collection route: every
 * path built on it has further segments (`/documents`, `/api-keys`), so
 * `/workspaces//documents` matches no route at all.
 *
 * A non-empty workspace goes through `seg()` unchanged — it is as
 * caller-controlled as the rest and gets the same escaping and dot-segment
 * rejection.
 */
export function workspaceSeg(config: CliConfig): string {
  return config.workspace === '' ? '' : seg(config.workspace);
}

/** Workspace-scoped v1 API base — everything under `/api/v1`. */
export function apiV1Base(config: CliConfig): string {
  return `${origin(config)}/api/v1/workspaces/${workspaceSeg(config)}`;
}

/**
 * The API-key management URL. These endpoints are the workspace routes the
 * browser uses rather than v1 API routes, so they cannot be expressed as a
 * path under `apiV1Base`. One builder shared by `HttpClient` and the
 * `--dry-run` preview: "the preview is the request" only holds while there
 * is a single definition of the request.
 */
export function apiKeysUrl(config: CliConfig, keyId?: string): string {
  const base = `${origin(config)}/workspaces/${workspaceSeg(config)}/api-keys`;
  return keyId === undefined ? base : `${base}/${seg(keyId)}`;
}
