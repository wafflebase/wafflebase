import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { randomBytes } from 'node:crypto';
import { CliAuthStore } from './cli-auth.store';

/**
 * Cookie holding the browser flow's OAuth `state`, double-submitted back by
 * GitHub's redirect and compared on the callback.
 */
export const OAUTH_STATE_COOKIE = 'wafflebase_oauth_state';

/**
 * Marks a `state` as the browser flow's (cookie-checked) rather than the
 * CLI's (store-checked). The two arrive on the same callback parameter.
 */
export const WEB_STATE_PREFIX = 'w.';

/** The `state` cookie lives only as long as the consent screen takes. */
const STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

/** Upper bound on the CLI-supplied values we will store and echo back. */
const MAX_NONCE_LENGTH = 128;
/** RFC 7636 §4.1 bounds the `code_challenge` at 43–128 characters. */
const MIN_CHALLENGE_LENGTH = 43;
const MAX_CHALLENGE_LENGTH = 128;

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
 * A browser login gets a `state` too: a random value sent to GitHub under the
 * `w.` prefix and stored in a short-lived first-party cookie the callback
 * compares it against. It is a double submit rather than a server-side entry
 * because the callback may land on a different replica than the one that
 * started the login. Without it the callback accepted any GitHub redirect,
 * which is a forced-login CSRF: an attacker completes consent for their own
 * account and gets the victim's browser issued cookies for it.
 *
 * A CLI login carries three bindings, and all three are required — a login
 * that is missing one is refused rather than started, because "the client did
 * not send it" and "this login is unbound" are the same request on the wire:
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
 *
 * The cost is that a CLI predating the parameters can no longer log in: it
 * gets a `400` naming what is missing instead of a login with the injection
 * of RFC 8252 §8.9 left open. `--api-key` needs no browser at all.
 */
@Injectable()
export class GitHubAuthGuard extends AuthGuard('github') {
  constructor(private readonly cliAuthStore: CliAuthStore) {
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

        const { stateToken } = this.cliAuthStore.createState({
          mode,
          port: portNum,
          browserBinding: this.issueStateCookie(context),
          nonce,
          codeChallenge,
        });
        req.__oauthState = stateToken;
      }
    }

    if (!req.__oauthState) {
      req.__oauthState = `${WEB_STATE_PREFIX}${this.issueStateCookie(context)}`;
    }

    return super.canActivate(context);
  }

  /**
   * Mint one half of a login's double submit and set the cookie holding it.
   *
   * Both flows use it: the browser sends the other half to GitHub under the
   * `w.` prefix, the CLI keeps it beside its state entry. `SameSite=Lax`
   * still travels on GitHub's top-level redirect back here, which is the
   * only request that reads it.
   */
  private issueStateCookie(context: ExecutionContext): string {
    const value = randomBytes(32).toString('base64url');
    const res = context.switchToHttp().getResponse();
    // The cookie is the binding, not a nicety: without a response that can
    // set it, every callback would be refused. Fail here, where the reason
    // is visible, rather than at a callback that looks like a CSRF hit.
    if (typeof res?.cookie !== 'function') {
      throw new InternalServerErrorException('Cannot start a login session');
    }
    res.cookie(OAUTH_STATE_COOKIE, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/auth',
      maxAge: STATE_COOKIE_MAX_AGE_MS,
    });
    return value;
  }
}
