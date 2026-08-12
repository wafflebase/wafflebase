import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CliAuthStore } from './cli-auth.store';

/** Upper bound on the CLI nonce we will store and echo back. */
const MAX_NONCE_LENGTH = 128;

/**
 * Custom GitHub OAuth guard that detects CLI login params
 * (`?mode=cli&port=<port>&nonce=<nonce>`) and injects a state token onto the
 * request so GitHubStrategy.authenticate() can forward it to GitHub.
 *
 * The optional `nonce` is remembered with the state and handed back to the
 * CLI's localhost callback, which redeems a code only for its own flow.
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
    const nonce = req.query?.nonce;

    if (mode === 'cli' && port) {
      const portNum = Number(port);
      if (Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535) {
        const { stateToken } = this.cliAuthStore.createState(
          mode,
          portNum,
          typeof nonce === 'string' &&
            nonce.length > 0 &&
            nonce.length <= MAX_NONCE_LENGTH
            ? nonce
            : undefined,
        );
        req.__cliStateToken = stateToken;
      }
    }

    return super.canActivate(context);
  }
}
