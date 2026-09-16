import type { Request, Response } from 'express';
import {
  createWebOAuthState,
  oauthStateCookieName,
  oauthStateCookieOptions,
  webOAuthStateMatches,
} from './oauth-state';
import {
  loginReturnCookieName,
  loginReturnCookieOptions,
  safeReturnPath,
} from './login-return-path';

/**
 * The two halves of a **browser** OAuth login's CSRF check, in one place.
 *
 * Both providers run the identical check — mint a secret into a cookie, send
 * its SHA-256 to the provider as `state`, refuse a callback whose `state`
 * does not match the cookie that started the login. It lived inline in
 * `GitHubAuthGuard` and `AuthController` while GitHub was the only provider;
 * copying it for Google would mean two implementations of the one thing that
 * stops login CSRF / session fixation, and a future fix landing in only one
 * of them.
 *
 * The CLI flow is deliberately *not* here. Its state carries a loopback port
 * and a PKCE challenge, is stored server-side, and is GitHub-only.
 */

/** The request field `*Strategy.authenticate` reads to put `state` on the wire. */
export interface OAuthStateRequest extends Request {
  __oauthState?: string;
}

/**
 * Start a browser login: attach the `state`, set the cookie holding its
 * secret, and remember where the login started if it asked to come back.
 *
 * `returnTo` is attacker-choosable by construction (the endpoint is
 * unauthenticated), so `safeReturnPath` reducing it to a same-origin path is
 * the actual guard — not the cookie, and not the fact that we wrote it.
 */
export function startWebOAuthLogin(req: OAuthStateRequest, res: Response) {
  const { secret, state } = createWebOAuthState();
  res.cookie(oauthStateCookieName(), secret, oauthStateCookieOptions());
  req.__oauthState = state;

  const returnTo = safeReturnPath(req.query?.returnTo);
  if (returnTo) {
    res.cookie(loginReturnCookieName(), returnTo, loginReturnCookieOptions());
  }
}

/**
 * Finish the check on the way back: clear the state cookie and say whether
 * the callback's `state` was minted by *this* browser.
 *
 * Only the name the login would mint **now** is read: in production that is
 * the `__Host-` prefixed one, and honouring an unprefixed leftover would
 * re-admit the sibling-subdomain cookie tossing the prefix exists to block
 * (see `oauth-state.ts`). The cookie is cleared whether or not it matches,
 * so a failed login leaves nothing behind to replay.
 */
export function consumeWebOAuthState(
  req: Request,
  res: Response,
  stateToken: string,
): boolean {
  const cookieName = oauthStateCookieName();
  const cookieSecret: unknown = req.cookies?.[cookieName];
  res.clearCookie(cookieName, {
    ...oauthStateCookieOptions(),
    maxAge: undefined,
  });
  return webOAuthStateMatches(stateToken, cookieSecret);
}
