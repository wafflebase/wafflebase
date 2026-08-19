import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { CliAuthStore } from './cli-auth.store';
import {
  cliStateCookieName,
  cliStateCookieOptions,
  createWebOAuthState,
  oauthStateCookieName,
  oauthStateCookieOptions,
} from './oauth-state';

/**
 * Accept only a hex nonce of a sane length. The value is echoed back on
 * a redirect to the CLI's loopback callback, so nothing but `[0-9a-f]`
 * is allowed through — no delimiters, no room to smuggle query params.
 */
export function parseCliNonce(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return /^[0-9a-f]{32,128}$/.test(raw) ? raw : undefined;
}

/**
 * Accept only a base64url SHA-256 digest, which is exactly 43 characters.
 * This is the PKCE-style `challenge` half of the CLI login: the hash of a
 * verifier the CLI keeps in memory, redeemed at
 * `POST /auth/cli/exchange`. It is not a secret — it travels in the start
 * URL and through the confirmation page — but it is interpolated into
 * that page's link, so the vocabulary stays closed.
 */
export function parseCliChallenge(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined;
}

/**
 * `Sec-Fetch-Site` values a login may legitimately arrive with. See
 * `GitHubAuthGuard.assertBrowserInitiated`.
 */
const ALLOWED_FETCH_SITES = new Set(['none', 'same-origin', 'same-site']);

/** The loopback port, or `undefined` when it is not a usable one. */
export function parseCliPort(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return undefined;
  return port;
}

/**
 * Custom GitHub OAuth guard that attaches the `state` parameter
 * `GitHubStrategy.authenticate()` forwards to GitHub. Every login gets
 * one — there is no stateless path:
 *
 * - **CLI** (`?mode=cli&port=<port>&nonce=<hex>&challenge=<s256>`) — a
 *   token from `CliAuthStore` carrying the port, the CLI's nonce and its
 *   PKCE challenge, so the callback can redirect the code to the loopback
 *   server and bind it to the verifier only that CLI process holds (see
 *   `login.ts`). Minted
 *   only once `CliLoginConfirmMiddleware` has seen the user click through
 *   the confirmation page; without that flag this degrades to an ordinary
 *   browser login rather than silently minting a code for whoever framed
 *   the request. The token is paired with a cookie secret
 *   (`cliStateCookieName()`) so it is bound to this browser, exactly as
 *   the browser state is: the confirmation click gates the *mint*, and
 *   an attacker can perform it in their own browser, so without the
 *   cookie the resulting state could simply be handed to a victim.
 * - **Browser** — a double-submit cookie pair (see `oauth-state.ts`).
 *   Without it, `/auth/github/callback` would set session cookies for any
 *   code presented to it, which is login CSRF / session fixation.
 *
 * Ahead of either, a login another *site* navigated the browser into is
 * refused outright (`assertBrowserInitiated`). Neither state mechanism
 * covers that on its own — the navigation carrying the attack is also
 * the navigation that mints the state and sets its cookie — so the
 * cheapest place to stop it is before a login is started at all.
 */
@Injectable()
export class GitHubAuthGuard extends AuthGuard('github') {
  private readonly logger = new Logger(GitHubAuthGuard.name);

  constructor(private readonly cliAuthStore: CliAuthStore) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse<Response>();
    this.assertBrowserInitiated(req);
    const port = parseCliPort(req.query?.port);

    if (req.query?.mode === 'cli' && port !== undefined && req.__cliConfirmed) {
      const { stateToken, csrf } = this.cliAuthStore.createState(
        'cli',
        port,
        parseCliNonce(req.query?.nonce),
        parseCliChallenge(req.query?.challenge),
      );
      // The state token alone is transferable — it goes through GitHub in
      // a URL. This cookie is what ties it to *this* browser, and the
      // callback will not consume the state without it.
      res.cookie(cliStateCookieName(), csrf, cliStateCookieOptions());
      req.__oauthState = stateToken;
    } else {
      const { secret, state } = createWebOAuthState();
      res.cookie(oauthStateCookieName(), secret, oauthStateCookieOptions());
      req.__oauthState = state;
    }

    return super.canActivate(context);
  }

  /**
   * Refuse a login another site navigated the browser into.
   *
   * How a login may legitimately be started, as the browser reports it:
   *
   * - `none` — typed, bookmarked, or opened by another program. This is
   *   the CLI's shape: `wafflebase login` hands the URL to the OS opener.
   * - `same-origin` / `same-site` — a click inside the app, or the click
   *   through `CliLoginConfirmMiddleware`'s confirmation page, which is
   *   served from this origin. `SameSite=Lax` already assumes frontend
   *   and backend share eTLD+1, so a login that is genuinely cross-site
   *   cannot complete anyway.
   *
   * `cross-site` is refused: that is a hostile page navigating the
   * victim's browser into a login it chose the parameters of, which for
   * `?mode=cli` means a code minted from the victim's GitHub session
   * being delivered to an attacker-chosen loopback port, and for the web
   * flow means clobbering an in-flight login's state cookie.
   *
   * A missing `Sec-Fetch-Site` is allowed: it means a client that does
   * not send the header at all, which is not the attack shape — the
   * attack needs the victim's *browser*, carrying the victim's GitHub
   * session, and every browser that can be steered cross-site also sends
   * this.
   */
  private assertBrowserInitiated(req: Request) {
    const site = req.headers?.['sec-fetch-site'];
    if (site === undefined) return;
    const value = Array.isArray(site) ? site[0] : site;
    if (ALLOWED_FETCH_SITES.has(value)) return;
    this.logger.warn(
      `Refused a cross-site-initiated login (Sec-Fetch-Site: ${value}).`,
    );
    throw new BadRequestException(
      'Start the login from Wafflebase itself (or run `wafflebase login`).',
    );
  }
}
