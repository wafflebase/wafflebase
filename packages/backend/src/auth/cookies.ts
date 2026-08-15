import { CookieOptions } from 'express';

/**
 * The web OAuth flow's `state`, mirrored into a cookie so the callback can
 * prove it belongs to the browser that started the login.
 *
 * The CLI flow binds its callback with a server-side state entry
 * (`CliAuthStore`) because there is no browser session to bind to — the
 * redirect lands on a loopback listener. The web flow has a browser, and
 * binding to it is what stops an attacker from feeding a victim a code minted
 * for the attacker's own GitHub account (OAuth login CSRF / session
 * fixation). A cookie rather than an in-memory map on purpose: the callback
 * may be served by a different replica than the one that started the login,
 * and a map would turn that into a failed login.
 */
export const OAUTH_STATE_COOKIE_NAME = 'wafflebase_oauth_state';

/** Long enough for a consent screen, short enough not to linger. */
export const OAUTH_STATE_MAX_AGE_MS = 5 * 60 * 1000;

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
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  };
}
