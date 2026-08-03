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
 * Build the error for a non-OK API response, classified by status. The
 * default message keeps the previous `HTTP <status>` wording so existing
 * error bodies are unchanged apart from the more specific `code`.
 */
export function httpError(status: number, message?: string): Error {
  const text = message ?? `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return new SystemError('AUTH_ERROR', text);
  }
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
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    // Not parseable (a typo'd `--server`, say). Drop everything that
    // could hold a secret and keep the rest for the user to recognize.
    return url.split(/[?#]/)[0].replace(/\/\/[^/@]*@/, '//');
  }
}

/**
 * `fetch` rejects (rather than resolving non-OK) only when the request
 * never reached an HTTP server: DNS failure, refused connection, TLS
 * error, abort. All of those are system errors.
 */
export async function fetchOrThrow(
  url: string,
  init?: RequestInit,
  impl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  try {
    return await impl(url, init);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new SystemError(
      'NETWORK_ERROR',
      `Request to ${redactUrl(url)} failed: ${detail}`,
      { cause },
    );
  }
}

/**
 * Exit code carried by a thrown value; user error unless it says otherwise.
 */
export function exitCodeFor(error: unknown): number {
  if (error instanceof Error && 'exitCode' in error) {
    const code = (error as { exitCode: unknown }).exitCode;
    if (typeof code === 'number' && Number.isInteger(code)) return code;
  }
  return EXIT_USER_ERROR;
}
