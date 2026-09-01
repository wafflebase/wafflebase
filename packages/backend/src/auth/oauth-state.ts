import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions } from 'express';

/**
 * CSRF state for the **browser** OAuth login.
 *
 * The CLI flow carries its state in `CliAuthStore` because it has to
 * carry a port and a nonce with it. The browser flow needs to carry
 * nothing but "this callback belongs to a login this browser started",
 * so it uses a double-submit cookie instead of a server-side map: the
 * secret goes in a short-lived cookie, its SHA-256 goes to GitHub as
 * `state`, and the callback accepts only a pair that matches. That is
 * what makes it correct across replicas and restarts — an in-memory map
 * would drop every login whose callback lands on another instance.
 *
 * The hash, not the secret, travels in the URL: `state` is echoed
 * through GitHub, referrers and access logs, and a leaked hash cannot be
 * replayed without the cookie the browser never exposes.
 */
const OAUTH_STATE_COOKIE_BASE = 'wafflebase_oauth_state';

/**
 * The cookie's name, `__Host-` prefixed wherever the browser will honour
 * the prefix.
 *
 * A double-submit pair is only as strong as the browser's guarantee that
 * nothing but this origin can write the cookie. Without the prefix, a
 * foothold on *any* sibling subdomain (`docs.example.com`, a stale
 * preview host, a vendor subdomain) can set
 * `wafflebase_oauth_state=<attacker secret>; Domain=example.com`, which
 * the browser then sends here — and the callback happily matches it
 * against the attacker's own `state`, restoring exactly the login CSRF /
 * session fixation this module exists to close.
 *
 * `__Host-` is what forbids that: a browser accepts such a cookie only
 * when it is `Secure`, has `Path=/` and carries **no** `Domain`, so it is
 * bound to this exact host and a sibling subdomain cannot write it.
 * (An HMAC over the secret would not help — the attacker can mint a
 * legitimate pair by starting their own login and toss *that* secret.
 * The write restriction is the property that matters, and only the
 * prefix provides it.)
 *
 * The prefix requires `Secure`, which a plain-HTTP dev server cannot
 * set, so the name follows `secure`: `__Host-` in production, the bare
 * name locally. There is deliberately no fallback to the unprefixed
 * cookie in production — accepting it would hand the attack straight
 * back.
 */
export function oauthStateCookieName(): string {
  return hostPrefixedCookieName(OAUTH_STATE_COOKIE_BASE);
}

/**
 * `__Host-<base>` wherever the browser will honour the prefix.
 *
 * Shared with `wafflebase_cli_confirm`, whose secret is proven the same
 * way — by possession of a cookie — and which is therefore open to the
 * same sibling-subdomain cookie tossing described above, and with the
 * session and refresh cookies, which are open to it in the other
 * direction (a *planted* session rather than a planted challenge).
 */
export function hostPrefixedCookieName(base: string): string {
  return isSecureCookie() ? `__Host-${base}` : base;
}

/**
 * The session and refresh cookies, named by the same rule.
 *
 * These are the cookies actually worth stealing — a session JWT and the
 * refresh token that mints more of them — and until now they were the only
 * login cookies carrying no prefix. `Secure` alone does not cover the write
 * side: a foothold on any sibling subdomain (a stale preview host, a vendor
 * subdomain, an https one of either) can set
 * `wafflebase_session=<attacker's JWT>; Domain=<parent>`, which the browser
 * then sends here alongside — or instead of — the host-only cookie, and the
 * victim browses as the attacker (session fixation). `__Host-` is what
 * forbids a `Domain` on that name, so the planted cookie cannot exist.
 *
 * Only the name this build would mint is read, exactly as for the state
 * cookies: honouring an unprefixed leftover in production would re-admit the
 * cookie tossing the prefix blocks. An existing session issued under the bare
 * name therefore stops being recognised the first time a deployment turns
 * `Secure` on, and the browser is sent through the login again;
 * `clearAuthCookies` expires both shapes so nothing stale is left behind.
 */
const SESSION_COOKIE_BASE = 'wafflebase_session';
const REFRESH_COOKIE_BASE = 'wafflebase_refresh';

export function sessionCookieName(): string {
  return hostPrefixedCookieName(SESSION_COOKIE_BASE);
}

export function refreshCookieName(): string {
  return hostPrefixedCookieName(REFRESH_COOKIE_BASE);
}

/**
 * The pre-prefix names, for expiry only.
 *
 * Logging out has to reach a cookie written before the prefix applied (or by
 * a build that predates it), and a deletion carries no credential, so
 * clearing both shapes is safe where *accepting* both would not be.
 */
export const UNPREFIXED_SESSION_COOKIE_NAMES: readonly string[] = [
  SESSION_COOKIE_BASE,
  REFRESH_COOKIE_BASE,
];

/**
 * Browser binding for the **CLI** OAuth login.
 *
 * The CLI `state` is an opaque `CliAuthStore` token, and an opaque token
 * is transferable: an attacker can walk their *own* browser through the
 * confirmation page, read the minted `state` out of the redirect to
 * GitHub, and hand the victim a plain `github.com/login/oauth/authorize`
 * URL carrying it. GitHub then returns the victim to our callback, which
 * would mint a code for the *victim's* account bound to the *attacker's*
 * PKCE challenge and post it to the attacker's loopback port — with no
 * confirmation page ever shown to the victim. The confirm cookie does
 * not close that: it gates the mint, not the redemption, and the
 * attacker satisfied it in their own browser.
 *
 * So the CLI state is bound the same way the web one is: the secret goes
 * in this cookie, its SHA-256 is kept beside the state entry, and the
 * callback consumes a state only when the browser presents the matching
 * secret. A state carried into another browser has no cookie behind it.
 */
const CLI_STATE_COOKIE_BASE = 'wafflebase_cli_state';

/** `__Host-` prefixed wherever the browser will honour the prefix. */
export function cliStateCookieName(): string {
  return hostPrefixedCookieName(CLI_STATE_COOKIE_BASE);
}

/** Five minutes: the `CliAuthStore` entry behind it expires then too. */
const CLI_STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

export function cliStateCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureCookie(),
    // Lax for the same reason the web state cookie is: GitHub sends the
    // browser back to the callback cross-site, and Strict would withhold
    // the cookie on exactly the navigation that has to carry it.
    sameSite: 'lax',
    // `/`: required for `__Host-`, and nothing but the callback reads it.
    path: '/',
    maxAge: CLI_STATE_COOKIE_MAX_AGE_MS,
  };
}

/** Marks a `state` as belonging to the web flow, not the CLI store. */
export const WEB_STATE_PREFIX = 'web.';

/** Ten minutes: long enough for a GitHub sign-in, short enough to expire. */
const STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

export interface WebOAuthState {
  /** Goes in the cookie. Never leaves the browser. */
  secret: string;
  /** Goes to GitHub as `state`. */
  state: string;
}

export function createWebOAuthState(): WebOAuthState {
  const secret = randomBytes(32).toString('base64url');
  return { secret, state: WEB_STATE_PREFIX + hashSecret(secret) };
}

export function isWebOAuthState(state: string): boolean {
  // CLI state tokens are base64url, which has no `.`, so the two
  // vocabularies cannot collide.
  return state.startsWith(WEB_STATE_PREFIX);
}

/** Constant-time check of a callback's `state` against the cookie. */
export function webOAuthStateMatches(
  state: string,
  cookieSecret: unknown,
): boolean {
  if (typeof cookieSecret !== 'string' || cookieSecret.length === 0) {
    return false;
  }
  return timingSafeEqualStr(state, WEB_STATE_PREFIX + hashSecret(cookieSecret));
}

export function oauthStateCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureCookie(),
    // Lax, not Strict: GitHub redirects the browser back to us, and a
    // Strict cookie is withheld on that cross-site navigation, so every
    // login would fail its own state check.
    sameSite: 'lax',
    // `/`, not `/auth`: the `__Host-` prefix is only honoured on a
    // cookie with no `Domain` and `Path=/`, and that write restriction
    // is worth more here than the narrower path. Nothing reads the
    // cookie but the callback, and it is httpOnly and lives ten minutes.
    path: '/',
    maxAge: STATE_COOKIE_MAX_AGE_MS,
  };
}

/**
 * Whether login cookies are set `Secure` — and so may carry `__Host-`.
 *
 * `COOKIE_SECURE` decides when an operator sets it; otherwise the
 * deployment's own `GITHUB_CALLBACK_URL` does. That URL is where GitHub
 * redirects the login, so its scheme *is* this server's public scheme, and
 * reading a configured value rather than the live request keeps the answer
 * identical on the request that sets the cookie and the callback that reads
 * it — which a per-request `req.secure` behind a proxy would not.
 *
 * `NODE_ENV === 'production'` is only the fallback for a deployment that
 * configures no callback URL at all, and deliberately not an override.
 * Checking it first got the rule wrong in *both* directions. It dropped the
 * prefix — the only thing that stops a sibling subdomain from planting the
 * browser's half of the double submit — on every https deployment that does
 * not happen to set the variable. And, because the shipped image sets
 * `NODE_ENV=production` while the self-hosting docs hand out an `http://`
 * callback URL, it set `Secure`/`__Host-` cookies on a plain-http origin,
 * where the browser discards them on arrival: not a hardened login but a
 * dead one, since the callback never finds its state cookie.
 *
 * The residual risk is a stale `http://` callback URL on a TLS-terminating
 * deployment, which downgrades the cookie. `COOKIE_SECURE=true` is how such
 * a deployment says so.
 */
export function isSecureCookie(): boolean {
  const configured = (process.env.COOKIE_SECURE ?? '').trim().toLowerCase();
  if (configured === 'true' || configured === '1') return true;
  if (configured === 'false' || configured === '0') return false;

  const callbackUrl = (process.env.GITHUB_CALLBACK_URL ?? '')
    .trimStart()
    .toLowerCase();
  if (callbackUrl.startsWith('https://')) return true;
  if (callbackUrl.startsWith('http://')) return false;
  return process.env.NODE_ENV === 'production';
}

/**
 * The same decision, for the cookies outside this module.
 *
 * Exported so the session cookies and the CLI confirmation cookie cannot
 * drift from the name the `__Host-` prefix is applied to: a cookie set
 * without `Secure` under a `__Host-` name is rejected by the browser
 * outright, so the two answers have to come from one place.
 */
export function useSecureCookies(): boolean {
  return isSecureCookie();
}

/** Comparison that does not leak the answer through its timing. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Hash of a cookie-held secret, hex. Shared with `CliAuthStore`, which
 * keeps this beside its state entry rather than the secret itself.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
