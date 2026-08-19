import {
  BadRequestException,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CliAuthStore } from './cli-auth.store';

/** The shape of a `cliState` nonce: `randomBytes(32).toString('base64url')`. */
export const CLI_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Read the `cliState` query param, or fail the request.
 *
 * Absent is legitimate: a CLI older than the nonce echo sends no `cliState`,
 * and that flow still has to work. Anything *present* but unusable is not
 * silently dropped — a dropped nonce completes the flow with a redirect the
 * current CLI's listener rejects as an injected callback, so the caller sees
 * "State mismatch" (or a login timeout) instead of the malformed parameter that
 * actually caused it. Express's query parser yields an array when the param
 * arrives twice (a proxy or a hand-copied URL can do that): identical repeats
 * are the same nonce and are accepted, a conflict is refused rather than
 * guessed at.
 */
export function normalizeCliState(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;

  const values = Array.isArray(raw) ? raw : [raw];
  const first: unknown = values[0];
  if (
    typeof first !== 'string' ||
    !values.every((value) => value === first) ||
    !CLI_STATE_PATTERN.test(first)
  ) {
    throw new BadRequestException(
      'Invalid cliState: expected one value of 16-128 characters from ' +
        '[A-Za-z0-9_-]. Run `wafflebase login` again.',
    );
  }
  return first;
}

/**
 * Custom GitHub OAuth guard that starts a flow for *every* login — browser or
 * CLI — and injects its state token onto the request so
 * `GitHubStrategy.authenticate()` forwards it to GitHub as OAuth `state`.
 *
 * The token is 32 random bytes held for 5 minutes and consumed on the callback
 * (`AuthController.githubAuthCallback`), which is what ties a callback to a
 * flow this backend started: without it, a callback carrying an attacker's
 * authorization code would be honoured and the victim's browser would end up
 * holding a session for the attacker's GitHub account (OAuth login CSRF). The
 * browser flow previously sent no `state` at all and had no such check.
 *
 * For a CLI login (`?mode=cli&port=<port>&cliState=<nonce>`) the flow also
 * carries the nonce the CLI invocation minted for its loopback callback. It is
 * echoed back on the redirect to `127.0.0.1:<port>` so the CLI can distinguish
 * its own callback from an authorization code injected by a page the browser
 * visited or any other injector that cannot read the CLI process's command
 * line. A present-but-malformed nonce is a 400 (see `normalizeCliState`), never
 * a silent drop.
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
    const cliState = req.query?.cliState;

    if (mode === 'cli' && port) {
      const portNum = Number(port);
      if (Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535) {
        const nonce = normalizeCliState(cliState);
        const { stateToken } = this.cliAuthStore.createState(
          mode,
          portNum,
          nonce,
        );
        req.__oauthStateToken = stateToken;
        return super.canActivate(context);
      }
    }

    // Browser login. `port` is meaningless here; the callback recognises the
    // flow by `mode` and redirects to the frontend.
    const { stateToken } = this.cliAuthStore.createState('web', 0);
    req.__oauthStateToken = stateToken;

    return super.canActivate(context);
  }
}
