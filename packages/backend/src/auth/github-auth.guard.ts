import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { randomBytes } from 'node:crypto';
import { Request, Response } from 'express';
import { CliAuthStore } from './cli-auth.store';
import {
  OAUTH_STATE_MAX_AGE_MS,
  OAuthFlow,
  oauthStateCookieName,
  oauthStateCookieOptions,
} from './cookies';

/**
 * Custom GitHub OAuth guard that puts an unguessable `state` on every
 * authorization request, in one of two shapes, and hands it to
 * `GitHubStrategy.authenticate()` to forward to GitHub.
 *
 * Both flows get a random value mirrored into a short-lived, per-flow
 * cookie (`oauthStateCookieName`); the callback accepts only a `state`
 * that matches the cookie, which is what ties the code being redeemed to
 * the browser that asked for it. A **CLI** login additionally gets a
 * server-side state entry, because its `state` has to carry the CLI
 * parameters (`?mode=cli&port=<port>&nonce=<nonce>`) through the round
 * trip and a cookie the browser holds cannot carry them to a listener on
 * loopback. The CLI's nonce rides along in the stored state and is echoed
 * back on the loopback redirect, letting the CLI reject a callback it did
 * not start (see `packages/cli/src/commands/login.ts`).
 *
 * Neither cookie stops a *hostile page* from starting a login in the
 * victim's browser — the navigation that carries the attack is also the
 * navigation that sets the cookie. What stops that is refusing to start
 * one at all for a cross-site navigation (`assertBrowserInitiated`): a
 * CLI login is opened by the CLI itself and a web login is a click inside
 * the app, so neither is ever `Sec-Fetch-Site: cross-site`.
 *
 * A malformed nonce is refused outright. A *missing* one is accepted for
 * now, and deliberately so: `@wafflebase/cli` is published to npm, so
 * users run whatever version they installed, and 400-ing a nonce-less
 * request would break every released CLI the moment a server deploys.
 * Refusing it also buys no security — the binding that defends a login
 * is the CLI's own check that the callback echoes *its* nonce, and an
 * attacker minting a code for a loopback port they control simply picks
 * a nonce of their own. Requiring one here only guarantees the redirect
 * carries something for a current CLI to compare against, which a
 * current CLI already gets by always sending one.
 *
 * Once published CLIs older than the nonce-bound login are out of
 * support, this can become a hard 400 (see `docs/design/cli.md`).
 */
/** Opaque, URL-safe, length-bounded — anything else is not ours. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * How a login may legitimately be started, as the browser reports it.
 *
 * - `none` — typed, bookmarked, or opened by another program. This is the
 *   CLI's shape: `wafflebase login` hands the URL to the OS opener.
 * - `same-origin` / `same-site` — a click inside the app. `SameSite=Lax`
 *   already assumes frontend and backend share eTLD+1 (see `cookies.ts`),
 *   so a login that is genuinely cross-site cannot complete anyway.
 *
 * `cross-site` is refused: that is a hostile page navigating the victim's
 * browser into a login it chose the parameters of, which for `?mode=cli`
 * means a code minted from the victim's GitHub session being delivered to
 * an attacker-chosen loopback port, and for the web flow means clobbering
 * an in-flight login's state cookie.
 */
const ALLOWED_FETCH_SITES = new Set(['none', 'same-origin', 'same-site']);

@Injectable()
export class GitHubAuthGuard extends AuthGuard('github') {
  private readonly logger = new Logger(GitHubAuthGuard.name);

  constructor(private readonly cliAuthStore: CliAuthStore) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Typed here rather than left as `any`: `__oauthState` is the whole
    // hand-off to `GitHubStrategy.authenticate`, and a typo in it would
    // silently drop the `state` — that is, silently drop the binding.
    const req = context
      .switchToHttp()
      .getRequest<Request & { __oauthState?: string }>();
    const res = context.switchToHttp().getResponse<Response>();
    const mode = req.query?.mode;
    this.assertBrowserInitiated(req);

    if (mode !== 'cli') {
      // The web flow gets a `state` mirrored into a cookie the callback
      // checks. Without one, passport-oauth2 installs a `NullStore` whose
      // verify always succeeds: any `?code=` the attacker holds completes
      // a login in the victim's browser and silently seats them inside
      // the attacker's account.
      const state = randomBytes(32).toString('base64url');
      this.mirrorState(res, 'web', state);
      req.__oauthState = state;
      return super.canActivate(context);
    }

    const portNum = Number(req.query?.port);
    if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
      throw new BadRequestException('Invalid CLI port');
    }
    const raw: unknown = req.query?.nonce;
    let nonce: string | undefined;
    if (raw === undefined) {
      this.logger.warn(
        'CLI login without a nonce — the client predates nonce-bound login and cannot verify its own callback. Upgrade the `wafflebase` CLI.',
      );
    } else if (typeof raw !== 'string' || !NONCE_PATTERN.test(raw)) {
      throw new BadRequestException('Invalid CLI login nonce');
    } else {
      nonce = raw;
    }
    const { stateToken } = this.cliAuthStore.createState(mode, portNum, nonce);
    // The CLI flow is browser-bound too: the token the callback receives
    // must be the one *this* browser was handed. Without it a state token
    // observed anywhere (a shared terminal, a CI log, an agent
    // transcript) could be replayed into a victim's browser.
    this.mirrorState(res, 'cli', stateToken);
    req.__oauthState = stateToken;

    return super.canActivate(context);
  }

  /** Mirror a flow's `state` into its own short-lived, host-locked cookie. */
  private mirrorState(res: Response, flow: OAuthFlow, state: string) {
    res.cookie(oauthStateCookieName(flow), state, {
      ...oauthStateCookieOptions(),
      maxAge: OAUTH_STATE_MAX_AGE_MS,
    });
  }

  /**
   * Refuse a login another site navigated the browser into.
   *
   * A missing `Sec-Fetch-Site` is allowed: it means a client that does not
   * send the header at all, which is not the attack shape — the attack
   * needs the victim's *browser*, carrying the victim's GitHub session,
   * and every browser that can be steered cross-site also sends this.
   */
  private assertBrowserInitiated(req: Request) {
    const site = req.headers['sec-fetch-site'];
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
