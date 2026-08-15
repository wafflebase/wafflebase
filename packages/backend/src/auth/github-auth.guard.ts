import {
  BadRequestException,
  ExecutionContext,
  Injectable,
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

/** Browser `state` lives only as long as the consent screen takes. */
const WEB_STATE_MAX_AGE_MS = 5 * 60 * 1000;

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
 * The optional `nonce` is remembered with the state and handed back to the
 * CLI's localhost callback, which redeems a code only for its own flow. The
 * optional `code_challenge` (PKCE S256) rides onto the authorization code,
 * so redeeming it takes the verifier the CLI never sent. Both are optional
 * because a CLI predating them sends neither; a `code_challenge` that *is*
 * sent and is malformed fails the request rather than downgrading it.
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
        const presented = req.query?.code_challenge;
        const codeChallenge = boundedToken(
          presented,
          MIN_CHALLENGE_LENGTH,
          MAX_CHALLENGE_LENGTH,
          /^[A-Za-z0-9\-._~]+$/,
        );
        // A challenge that was sent but does not survive the bounds is a
        // failed authorization request, not a login to continue without
        // PKCE. Dropping it silently would hand back a bearer-only code to
        // a client that believes it is PKCE-bound — a downgrade neither end
        // can see (e.g. a copy-pasted start URL truncated at the terminal
        // edge). Absent is still fine: that is a CLI predating PKCE.
        if (presented !== undefined && codeChallenge === undefined) {
          throw new BadRequestException('Invalid code_challenge');
        }

        const { stateToken } = this.cliAuthStore.createState(
          mode,
          portNum,
          boundedToken(req.query?.nonce, 1, MAX_NONCE_LENGTH),
          codeChallenge,
        );
        req.__oauthState = stateToken;
      }
    }

    if (!req.__oauthState) {
      req.__oauthState = this.startWebState(context);
    }

    return super.canActivate(context);
  }

  /**
   * Mint the browser flow's `state` and set its half of the double submit.
   *
   * `SameSite=Lax` still travels on GitHub's top-level redirect back here,
   * which is the only request that reads it.
   */
  private startWebState(context: ExecutionContext): string {
    const value = randomBytes(32).toString('base64url');
    const res = context.switchToHttp().getResponse();
    res.cookie?.(OAUTH_STATE_COOKIE, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/auth',
      maxAge: WEB_STATE_MAX_AGE_MS,
    });
    return `${WEB_STATE_PREFIX}${value}`;
  }
}
