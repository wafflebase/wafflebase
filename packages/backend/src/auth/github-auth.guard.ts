import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { CookieOptions } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CliAuthStore } from './cli-auth.store';

/**
 * Cookie holding the browser flow's OAuth `state`, double-submitted back by
 * GitHub's redirect and compared on the callback.
 */
export const OAUTH_STATE_COOKIE = 'wafflebase_oauth_state';

/**
 * Cookie holding the half of the CLI consent click that a crafted link cannot
 * carry; see `GitHubAuthGuard`'s class comment.
 */
export const CLI_CONFIRM_COOKIE = 'wafflebase_cli_confirm';

/** Query parameter presenting the other half of that consent click. */
export const CLI_CONFIRM_PARAM = 'cli_confirm';

/**
 * Marks a `state` as the browser flow's (cookie-checked) rather than the
 * CLI's (store-checked). The two arrive on the same callback parameter.
 */
export const WEB_STATE_PREFIX = 'w.';

/** The `state` cookie lives only as long as the consent screen takes. */
export const STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

/** Upper bound on the CLI-supplied values we will store and echo back. */
const MAX_NONCE_LENGTH = 128;
/** RFC 7636 §4.1 bounds the `code_challenge` at 43–128 characters. */
const MIN_CHALLENGE_LENGTH = 43;
const MAX_CHALLENGE_LENGTH = 128;

/** Whether cookies are set `Secure` (and so can carry the `__Host-` prefix). */
function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * The wire name of a login cookie.
 *
 * `__Host-` is not decoration: without it these are ordinary host cookies, and
 * any sibling subdomain (or anything that can inject a `Set-Cookie` for the
 * registrable domain) can write the browser's half of the double submit. The
 * prefix makes the browser refuse such a cookie — it is only accepted from the
 * exact host, with `Secure` and `Path=/` and no `Domain`. It requires
 * `Secure`, so outside production (plain http on localhost) the bare name is
 * used and the HMAC binding below carries the weight on its own.
 */
export function loginCookieName(base: string): string {
  return secureCookies() ? `__Host-${base}` : base;
}

/**
 * Attributes for a login cookie. `Path=/` is forced by `__Host-`; the cookie
 * is httpOnly, single-use and expires with the consent screen, so the wider
 * path costs nothing.
 */
export function loginCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
  };
}

/** Constant-time compare of two login secrets (never leak by timing). */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Only used when `JWT_SECRET` is unset — a deployment whose sessions are
 * already broken. Random per process rather than a constant, so a
 * misconfigured server refuses cross-replica callbacks instead of signing
 * bindings with a value an attacker can read out of this file.
 */
const EPHEMERAL_BINDING_SECRET = randomBytes(32).toString('base64url');

/** The key the state binding is signed with; see `stateSignature`. */
export function bindingSecret(configService: ConfigService): string {
  return configService.get<string>('JWT_SECRET') ?? EPHEMERAL_BINDING_SECRET;
}

/**
 * The `state` value that belongs to a given cookie value.
 *
 * A plain double submit (send the cookie's value back as `state`) is only as
 * good as the browser's cookie jar: whoever can plant a cookie can also send
 * the matching `state`, which is the sibling-subdomain injection the
 * `__Host-` prefix closes in production and nothing closed elsewhere. Signing
 * the cookie value with a server key means the attacker can plant a cookie but
 * cannot produce the `state` that matches it, so the forced-login CSRF stays
 * shut even where the prefix cannot be used.
 */
export function stateSignature(secret: string, cookieValue: string): string {
  return createHmac('sha256', secret).update(cookieValue).digest('base64url');
}

/** What the CLI consent interstitial needs to render itself. */
export interface CliConsentRequest {
  port: number;
  nonce: string;
  codeChallenge: string;
  confirmToken: string;
}

/**
 * A query value we are willing to remember, or `undefined`.
 *
 * Anything the CLI sends is attacker-influenceable — it reaches this guard
 * straight off the query string — so it is length-bounded before it is
 * stored, and (for the challenge) restricted to the base64url alphabet so
 * nothing that lands in a redirect URL or a log line can carry structure.
 */
function boundedToken(
  value: unknown,
  min: number,
  max: number,
  pattern?: RegExp,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length < min || value.length > max) return undefined;
  if (pattern && !pattern.test(value)) return undefined;
  return value;
}

/**
 * Custom GitHub OAuth guard that puts a `state` on every authorization
 * request it starts, so the callback always has something to validate.
 *
 * CLI login params (`?mode=cli&port=<port>&nonce=<nonce>&code_challenge=
 * <challenge>`) are detected here and a state token is injected onto the
 * request so GitHubStrategy.authenticate() can forward it to GitHub.
 *
 * A browser login gets a `state` too: the HMAC of a random value held in a
 * short-lived first-party cookie, sent to GitHub under the `w.` prefix and
 * recomputed from the cookie on the callback. It is a double submit rather
 * than a server-side entry because the callback may land on a different
 * replica than the one that started the login, and it is *signed* rather than
 * echoed so that planting a cookie is not enough to forge the pair. Without
 * any of it the callback accepted any GitHub redirect, which is a
 * forced-login CSRF: an attacker completes consent for their own account and
 * gets the victim's browser issued cookies for it.
 *
 * A CLI login carries four bindings, and the first three are required — a
 * login that is missing one is refused rather than started, because "the
 * client did not send it" and "this login is unbound" are the same request on
 * the wire:
 *
 * - `nonce` is remembered with the state and handed back to the CLI's
 *   localhost callback, which redeems a code only for its own flow.
 * - `code_challenge` (PKCE S256) rides onto the authorization code, so
 *   redeeming it takes the verifier the CLI never sent.
 * - a cookie, exactly like the browser flow's, ties the state to the browser
 *   that started it. Without it an attacker can mint a CLI state pointing at
 *   a loopback port they own and phish the victim through GitHub's consent
 *   screen, capturing an authorization code for the victim's account on a
 *   shared host — an attack neither of the other two bindings sees, since the
 *   attacker holds both the nonce and the verifier.
 * - a human confirmation. The three bindings above all assume the *start* URL
 *   was the CLI's; none of them looks at a victim who simply clicks
 *   `…/auth/github?mode=cli&port=<attacker's listener>`, where the attacker
 *   holds the nonce and the verifier because the attacker wrote the link. So
 *   a CLI start never redirects to GitHub on its own: it renders an
 *   interstitial naming the loopback port, and only a click on that page —
 *   which echoes a token the page itself set as a cookie, so a crafted link
 *   cannot pre-supply it — starts the login.
 *
 * The cost is that a CLI predating the parameters can no longer log in: it
 * gets a `400` naming what is missing instead of a login with the injection
 * of RFC 8252 §8.9 left open. `--api-key` needs no browser at all.
 */
@Injectable()
export class GitHubAuthGuard extends AuthGuard('github') {
  constructor(
    private readonly cliAuthStore: CliAuthStore,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const mode = req.query?.mode;
    const port = req.query?.port;

    if (mode === 'cli' && port) {
      const portNum = Number(port);
      if (Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535) {
        // Missing and malformed are the same failure: a login that continues
        // without one of these is a bearer-only code at a guessable loopback
        // port, and neither end can see the downgrade (a copy-pasted start
        // URL truncated at the terminal edge looks exactly like an older
        // client). Refusing costs an upgrade; accepting costs the account.
        const nonce = boundedToken(req.query?.nonce, 1, MAX_NONCE_LENGTH);
        if (nonce === undefined) {
          throw new BadRequestException('Missing or invalid nonce');
        }

        const codeChallenge = boundedToken(
          req.query?.code_challenge,
          MIN_CHALLENGE_LENGTH,
          MAX_CHALLENGE_LENGTH,
          /^[A-Za-z0-9\-._~]+$/,
        );
        if (codeChallenge === undefined) {
          throw new BadRequestException('Missing or invalid code_challenge');
        }

        // Nothing about this request says the CLI wrote it — an attacker's
        // link reaches here identically, pointing `port` at a listener they
        // own. Stop before GitHub and ask the person, once, naming the port.
        if (!this.hasConfirmation(req)) {
          const consent: CliConsentRequest = {
            port: portNum,
            nonce,
            codeChallenge,
            confirmToken: this.issueLoginCookie(context, CLI_CONFIRM_COOKIE),
          };
          req.__cliConsent = consent;
          return true;
        }

        this.clearLoginCookie(context, CLI_CONFIRM_COOKIE);
        const { stateToken } = this.cliAuthStore.createState({
          mode,
          port: portNum,
          browserBinding: this.issueLoginCookie(context, OAUTH_STATE_COOKIE),
          nonce,
          codeChallenge,
        });
        req.__oauthState = stateToken;
      }
    }

    if (!req.__oauthState) {
      const binding = this.issueLoginCookie(context, OAUTH_STATE_COOKIE);
      req.__oauthState = `${WEB_STATE_PREFIX}${stateSignature(
        bindingSecret(this.configService),
        binding,
      )}`;
    }

    return super.canActivate(context);
  }

  /** Whether this request carries both halves of the CLI consent click. */
  private hasConfirmation(req: {
    query?: Record<string, unknown>;
    cookies?: Record<string, unknown>;
  }): boolean {
    const presented = req.query?.[CLI_CONFIRM_PARAM];
    const expected = req.cookies?.[loginCookieName(CLI_CONFIRM_COOKIE)];
    return (
      typeof presented === 'string' &&
      typeof expected === 'string' &&
      secretEquals(expected, presented)
    );
  }

  /**
   * Mint one half of a login's double submit and set the cookie holding it.
   *
   * Both flows use it: the browser sends the signature of the value to GitHub
   * under the `w.` prefix, the CLI keeps the value itself beside its state
   * entry. `SameSite=Lax` still travels on GitHub's top-level redirect back
   * here, which is the only request that reads it.
   */
  private issueLoginCookie(context: ExecutionContext, base: string): string {
    const value = randomBytes(32).toString('base64url');
    const res = context.switchToHttp().getResponse();
    // The cookie is the binding, not a nicety: without a response that can
    // set it, every callback would be refused. Fail here, where the reason
    // is visible, rather than at a callback that looks like a CSRF hit.
    if (typeof res?.cookie !== 'function') {
      throw new InternalServerErrorException('Cannot start a login session');
    }
    res.cookie(loginCookieName(base), value, {
      ...loginCookieOptions(),
      maxAge: STATE_COOKIE_MAX_AGE_MS,
    });
    return value;
  }

  /** Spend a login cookie: it authorizes exactly one start. */
  private clearLoginCookie(context: ExecutionContext, base: string): void {
    const res = context.switchToHttp().getResponse();
    if (typeof res?.clearCookie === 'function') {
      res.clearCookie(loginCookieName(base), loginCookieOptions());
    }
  }
}
