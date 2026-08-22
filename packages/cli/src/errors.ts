/**
 * Failure classification behind the CLI's documented exit contract:
 * `0` success, `1` user error (bad input, 404, type mismatch), `2` system
 * error (network, auth, server fault). Agents branch on the exit code
 * instead of parsing stderr, so the class of a failure has to be recorded
 * where the failure is raised — by the time `outputError` sees it, only
 * the message text is left, and matching on that would break the moment
 * undici or the backend rewords something.
 */

export const EXIT_USER_ERROR = 1;
export const EXIT_SYSTEM_ERROR = 2;

/**
 * A failure the caller cannot fix by changing their input: the server was
 * unreachable, the credentials were rejected, or the server itself broke.
 * `code` also feeds the JSON error body via `errorCode()`.
 */
export class SystemError extends Error {
  readonly exitCode = EXIT_SYSTEM_ERROR;

  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SystemError';
  }
}

/**
 * A failure the caller *can* fix by changing what they typed, but which
 * still deserves a machine-readable `code` in the JSON body (an
 * unparseable `--server`, a document `src` we refuse to dereference).
 */
export class UserError extends Error {
  readonly exitCode = EXIT_USER_ERROR;

  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'UserError';
  }
}

/**
 * Exit code for an HTTP status. `401`/`403` are auth failures and `5xx` is
 * a server fault — both system errors. Everything else (`400`, `404`,
 * `409`, …) describes something the caller sent, so it stays a user error.
 */
export function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) return EXIT_SYSTEM_ERROR;
  if (status >= 500) return EXIT_SYSTEM_ERROR;
  return EXIT_USER_ERROR;
}

/**
 * What a rejected credential looks like on stderr. Named here rather
 * than at each of the ~30 throw sites so the message documented in the
 * design doc's error matrix has exactly one source.
 */
export const AUTH_FAILED_MESSAGE =
  'Authentication failed. Run `wafflebase login`.';

/**
 * Build the error for a non-OK API response, classified by status. A
 * caller with a better message (the server's own error text) passes it
 * in; otherwise 401/403 gets the documented "run login" hint and
 * everything else keeps the previous `HTTP <status>` wording.
 */
export function httpError(status: number, message?: string): Error {
  if (status === 401 || status === 403) {
    return new SystemError('AUTH_ERROR', message ?? AUTH_FAILED_MESSAGE);
  }
  const text = message ?? `HTTP ${status}`;
  if (status >= 500) {
    return new SystemError('SERVER_ERROR', text);
  }
  return new Error(text);
}

/**
 * Strip the credential-bearing parts of a URL before it goes into an
 * error message. `--server`/`WAFFLEBASE_SERVER` may carry userinfo
 * (`https://user:pass@host`) and image `src` values routinely carry
 * presigned tokens in the query string; both would otherwise land on
 * stderr and in CI logs. Scheme, host and path are kept — that is what
 * makes a network failure diagnosable.
 */
export function redactUrl(url: string): string {
  // Strip userinfo textually first. `new URL().username = ''` only works
  // for URLs the WHATWG parser gives an authority to; a scheme-less
  // `user:pw@host/path` (what `--server user:pw@host` builds) parses as
  // an opaque path, where the setters are silently ignored.
  const stripped = stripUserinfo(url);
  try {
    const u = new URL(stripped);
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    // Not parseable (a typo'd `--server`, say). Drop everything that
    // could hold a secret and keep the rest for the user to recognize.
    return stripped.split(/[?#]/)[0];
  }
}

/**
 * Remove `user:pass@` from a URL's authority, whether or not the URL has
 * a scheme and whether or not it parses. `[^/?#]*` cannot cross into the
 * path, so an `@` in a path or query is left alone, and being greedy it
 * strips through the *last* `@` of the authority rather than the first.
 *
 * Exported for the `--dry-run` printer, which needs this half of
 * `redactUrl` but not the other: a preview must keep its query string
 * (`?range=A1%3AC10` is the point of the `cells get` preview, and the
 * query is built here from the caller's own arguments rather than
 * arriving with the server), while the userinfo is the same secret in a
 * previewed URL as in a failed one.
 */
export function stripUserinfo(url: string): string {
  const withScheme = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1');
  if (withScheme !== url) return withScheme;
  return url.replace(/^(\/\/)?[^/?#]*@/, '$1');
}

/**
 * Scrub a transport error's own message before it is quoted. undici and
 * Node echo the request URL verbatim for some failures (most visibly
 * `Failed to parse URL from <url>`), which would put back the userinfo
 * and presigned query string `redactUrl` just removed.
 */
function redactDetail(detail: string, url: string): string {
  return detail
    .split(url)
    .join(redactUrl(url))
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi, '$1')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/\S*?)\?\S*/gi, '$1');
}

/**
 * `fetch` rejects (rather than resolving non-OK) when the request never
 * reached an HTTP server: DNS failure, refused connection, TLS error,
 * abort — all system errors. It also rejects when the URL itself is
 * unparseable, which is the caller's input, not the environment; that
 * case is separated out up front so it keeps the user-error exit class.
 */
export async function fetchOrThrow(
  url: string,
  init?: RequestInit,
  impl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  try {
    new URL(url);
  } catch {
    throw new UserError(
      'INVALID_URL',
      `Invalid URL "${redactUrl(url)}". Check --server / WAFFLEBASE_SERVER.`,
    );
  }

  try {
    return await impl(url, init);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new SystemError(
      'NETWORK_ERROR',
      `Request to ${redactUrl(url)} failed: ${redactDetail(detail, url)}`,
      { cause },
    );
  }
}

/**
 * Exit code carried by a thrown value; user error unless it says
 * otherwise. Only a genuine failure code is honored: `0` would report
 * success for a throw we are in the middle of reporting (commander's
 * `CommanderError` uses `0` for `--help`), and anything outside a
 * byte-wide exit status is not a code this process can hand back.
 */
export function exitCodeFor(error: unknown): number {
  if (error instanceof Error && 'exitCode' in error) {
    const code = (error as { exitCode: unknown }).exitCode;
    if (typeof code === 'number' && Number.isInteger(code)) {
      if (code > 0 && code < 256) return code;
    }
  }
  return EXIT_USER_ERROR;
}
