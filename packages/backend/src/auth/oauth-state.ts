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
 * same sibling-subdomain cookie tossing described above.
 */
export function hostPrefixedCookieName(base: string): string {
  return isSecureCookie() ? `__Host-${base}` : base;
}

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

function isSecureCookie(): boolean {
  return process.env.NODE_ENV === 'production';
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
