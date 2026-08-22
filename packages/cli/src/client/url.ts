import type { CliConfig } from '../config/config.js';
import { seg as coreSeg } from '@wafflebase/core/url';

/**
 * One path segment of a request URL.
 *
 * The escaping and the `.` / `..` refusal live in `@wafflebase/core/url` — the
 * shared home for URL safety primitives — because the browser client builds the
 * same kind of URL from the same kind of id, and two copies of a security rule
 * drift.
 *
 * Wrapped rather than re-exported because this package needs one rule more: the
 * *empty* segment. That is CLI-local because the reason is this server's
 * routing rather than URL semantics. An empty id does not retarget the request
 * the way a traversal does, and it does not 404 either — Nest runs Express with
 * strict routing disabled, so `GET /api/v1/workspaces/<ws>/documents/` matches
 * the *collection* route, and `documents get ""` would silently list every
 * document instead of failing on a missing id. The browser client builds its
 * URLs from ids it already holds, so it has no equivalent hole to close.
 *
 * Every id path uses this one, so nothing can reach the permissive form by
 * accident. The single segment allowed to be empty is the workspace, which has
 * its own builder (`workspaceSeg`).
 *
 * It is used in the two places this package builds a URL — `HttpClient` for the
 * request itself, and the commands assembling the path they hand `printDryRun`
 * for `--dry-run`. A preview that skipped it would print a walked-out URL as
 * "the request that would be sent", the one output an agent is most likely to
 * copy and run.
 */
export function seg(value: string): string {
  if (value === '') {
    throw new Error(
      'Invalid identifier "": a URL path segment cannot be empty — Express ' +
        'matches the trailing-slash path against the collection route, so the ' +
        'request would address the collection rather than the named resource.',
    );
  }
  return coreSeg(value);
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
