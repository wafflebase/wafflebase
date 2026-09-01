import { CookieOptions } from 'express';
import { hostPrefixedCookieName, useSecureCookies } from './oauth-state';
/**
 * The path to send the browser back to after a web OAuth login.
 *
 * GitHub returns the browser to `FRONTEND_URL` with nothing of ours attached,
 * so a "come back where you started" needs somewhere to survive the round
 * trip. It rides in its own short-lived cookie rather than inside the OAuth
 * `state`: `state` is a CSRF token whose whole value is that it is opaque and
 * compared by equality, and packing routing data into it would mean parsing
 * attacker-supplied structure out of the one field that must stay a bare
 * comparison.
 *
 * Nothing here is a security boundary on its own — the cookie is set from an
 * unauthenticated request, so its value is attacker-chosen by construction.
 * `safeReturnPath` is the boundary: it reduces whatever arrives to a
 * *same-origin path*, which is what keeps the login endpoint from being an
 * open redirect.
 */
export const LOGIN_RETURN_COOKIE_BASE = 'wafflebase_login_return';

/** Long enough to complete a consent screen, short enough to be forgettable. */
export const LOGIN_RETURN_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Reduce a caller-supplied `returnTo` to a path this server is willing to
 * redirect to, or `null`.
 *
 * Accepts only a root-relative path — the value is appended to `FRONTEND_URL`,
 * so anything that could re-point the origin is refused rather than sanitized:
 *
 * - `//evil.example` and `/\evil.example` are **protocol-relative**: a browser
 *   reads `//host` as another origin, and backslash is folded to `/` by the
 *   URL parser, so both are rejected despite starting with `/`.
 * - `https://evil.example`, `javascript:…`, and anything else carrying a
 *   scheme or authority is rejected — a path may not contain `:` before its
 *   first `/`, and we simply require the first character to be `/` and reject
 *   any embedded scheme.
 * - Control characters (including the `\n`/`\r` that would let a value split a
 *   header, and the tab/newline the URL parser silently strips) are rejected
 *   rather than filtered, so no two parsers can disagree about the result.
 *
 * The query and fragment are preserved: `/t/abc?use=1` is a legitimate target.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > 512) return null;
  // Reject, never strip: a stripped control character means this function and
  // the browser's URL parser saw different strings.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  if (!value.startsWith('/')) return null;
  // Protocol-relative, in both spellings the URL parser accepts.
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  // A scheme cannot appear in a root-relative path; `/x:y` would be a valid
  // path segment, but nothing we redirect to needs one, so refuse the class.
  if (/^\/[^/?#]*:/.test(value)) return null;
  return value;
}

/**
 * Join a validated path onto the frontend origin. Returns the bare origin when
 * there is no path, which is the pre-existing behavior.
 */
export function loginRedirectUrl(
  frontendUrl: string,
  path: string | null,
): string {
  const base = frontendUrl.replace(/\/+$/, '');
  return path ? `${base}${path}` : frontendUrl;
}

/**
 * `__Host-`-prefixed wherever the browser honours the prefix, exactly as the
 * OAuth state cookie is.
 */
export function loginReturnCookieName(): string {
  return hostPrefixedCookieName(LOGIN_RETURN_COOKIE_BASE);
}

/**
 * Same shape as the state cookie: `Lax` because GitHub returns the browser to
 * us on a cross-site navigation and a `Strict` cookie would be withheld
 * exactly then, and `Path=/` because `__Host-` requires it.
 *
 * `httpOnly` even though the value is not a secret: nothing in the page needs
 * to read it, and a cookie no script can touch is one fewer way for a value
 * that decides a redirect to be rewritten after it was validated.
 */
export function loginReturnCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: LOGIN_RETURN_MAX_AGE_MS,
  };
}
