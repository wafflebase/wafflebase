import { CookieOptions } from 'express';

/**
 * The OAuth flow a `state` cookie belongs to. One name per flow, because
 * a browser can hold a pending CLI login and a pending web login at the
 * same time and a single name would let either clobber the other — and
 * would let any cross-site-initiated `/auth/github` navigation overwrite
 * an in-flight login's state.
 */
export type OAuthFlow = 'web' | 'cli';

/**
 * The OAuth flow's `state`, mirrored into a cookie so the callback can
 * prove it belongs to the browser that started the login.
 *
 * Binding to the browser is what stops an attacker from feeding a victim a
 * code minted for the attacker's own GitHub account (OAuth login CSRF /
 * session fixation). A cookie rather than an in-memory map on purpose: the
 * callback may be served by a different replica than the one that started the
 * login, and a map would turn that into a failed login.
 *
 * The CLI flow *also* keeps a server-side state entry (`CliAuthStore`),
 * which is what carries the port and nonce across the round trip; the
 * cookie is the browser half of the same binding.
 */
const COOKIE_BASE: Record<OAuthFlow, string> = {
  web: 'wafflebase_oauth_state',
  cli: 'wafflebase_cli_oauth_state',
};

/** Long enough for a consent screen, short enough not to linger. */
export const OAUTH_STATE_MAX_AGE_MS = 5 * 60 * 1000;

/** Whether the cookies this backend sets are marked `Secure`. */
export function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * The state cookie's name, host-locked wherever the environment allows it.
 *
 * `__Host-` is not decoration. A plain cookie is scoped to a *domain*, not
 * an origin, so anything that can write a cookie for the registrable domain
 * — a sibling subdomain, a compromised staging host, a MITM on a plain-http
 * sibling — can overwrite the state cookie with a value it knows and walk
 * straight through the binding this cookie exists to provide. The prefix
 * makes the browser refuse every such write: a `__Host-` cookie must be
 * `Secure`, carry no `Domain`, and use `Path=/`, all of which only the
 * backend's own origin can satisfy.
 *
 * The prefix requires `Secure`, which a plain-http dev server cannot set, so
 * it follows `secureCookies()` — and the name is therefore computed per
 * request rather than frozen at import time. The callback reads exactly the
 * name this environment issues and never the other one: accepting both would
 * hand the un-prefixed spelling back to the attacker the prefix locks out.
 */
export function oauthStateCookieName(flow: OAuthFlow): string {
  const base = COOKIE_BASE[flow];
  return secureCookies() ? `__Host-${base}` : base;
}

/**
 * Attributes for the OAuth state cookie: the shared base plus the explicit
 * `Path=/` that `__Host-` requires (and that keeps the clear on the callback
 * matching the cookie the guard set). No `Domain`, deliberately — a
 * host-locked cookie cannot have one.
 */
export function oauthStateCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), path: '/' };
}

/**
 * Cookie attributes shared by every cookie this backend sets.
 *
 * SameSite=Lax for CSRF defense; assumes frontend + backend share eTLD+1.
 * Lax is also what makes the OAuth state cookie work: the callback is a
 * top-level GET navigation from github.com, which Lax permits and Strict
 * would not.
 */
export function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
  };
}
