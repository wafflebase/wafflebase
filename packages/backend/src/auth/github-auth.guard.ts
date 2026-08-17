import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CliAuthStore } from './cli-auth.store';

/**
 * Custom GitHub OAuth guard that detects CLI login params
 * (`?mode=cli&port=<port>&cliState=<nonce>`) and injects a state token onto
 * the request so GitHubStrategy.authenticate() can forward it to GitHub.
 *
 * `cliState` is the nonce the CLI invocation minted for its loopback callback.
 * It is stored with the flow and echoed back on the redirect to
 * `127.0.0.1:<port>` so the CLI can distinguish its own callback from an
 * authorization code injected by another local process or a visited page.
 */
const CLI_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
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
        const nonce =
          typeof cliState === 'string' && CLI_STATE_PATTERN.test(cliState)
            ? cliState
            : undefined;
        const { stateToken } = this.cliAuthStore.createState(
          mode,
          portNum,
          nonce,
        );
        req.__cliStateToken = stateToken;
      }
    }

    return super.canActivate(context);
  }
}
