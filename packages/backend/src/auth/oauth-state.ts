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
export const OAUTH_STATE_COOKIE = 'wafflebase_oauth_state';

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
    secure: process.env.NODE_ENV === 'production',
    // Lax, not Strict: GitHub redirects the browser back to us, and a
    // Strict cookie is withheld on that cross-site navigation, so every
    // login would fail its own state check.
    sameSite: 'lax',
    path: '/auth',
    maxAge: STATE_COOKIE_MAX_AGE_MS,
  };
}

/** Comparison that does not leak the answer through its timing. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
