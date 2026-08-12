import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CliAuthStore } from './cli-auth.store';

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
 * Custom GitHub OAuth guard that detects CLI login params
 * (`?mode=cli&port=<port>&nonce=<nonce>&code_challenge=<challenge>`) and
 * injects a state token onto the request so GitHubStrategy.authenticate()
 * can forward it to GitHub.
 *
 * The optional `nonce` is remembered with the state and handed back to the
 * CLI's localhost callback, which redeems a code only for its own flow. The
 * optional `code_challenge` (PKCE S256) rides onto the authorization code,
 * so redeeming it takes the verifier the CLI never sent.
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
        const { stateToken } = this.cliAuthStore.createState(
          mode,
          portNum,
          boundedToken(req.query?.nonce, 1, MAX_NONCE_LENGTH),
          boundedToken(
            req.query?.code_challenge,
            MIN_CHALLENGE_LENGTH,
            MAX_CHALLENGE_LENGTH,
            /^[A-Za-z0-9\-._~]+$/,
          ),
        );
        req.__cliStateToken = stateToken;
      }
    }

    return super.canActivate(context);
  }
}
