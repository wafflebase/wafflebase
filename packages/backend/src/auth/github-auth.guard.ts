import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CliAuthStore } from './cli-auth.store';

/**
 * Custom GitHub OAuth guard that detects CLI login params
 * (`?mode=cli&port=<port>`) and injects a state token onto the
 * request so GitHubStrategy.authenticate() can forward it to GitHub.
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
        const { stateToken } = this.cliAuthStore.createState(mode, portNum);
        req.__cliStateToken = stateToken;
      }
    }

    return super.canActivate(context);
  }
}
