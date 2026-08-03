import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CliAuthStore } from './cli-auth.store';

/**
 * Custom GitHub OAuth guard that detects CLI login params
 * (`?mode=cli&port=<port>&nonce=<nonce>`) and injects a state token onto
 * the request so GitHubStrategy.authenticate() can forward it to GitHub.
 * The CLI's nonce rides along in the stored state and is echoed back on
 * the loopback redirect, letting the CLI reject a callback it did not
 * start (see `packages/cli/src/commands/login.ts`).
 */
/** Opaque, URL-safe, length-bounded — anything else is not ours. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
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
      const rawNonce = req.query?.nonce;
      const nonce =
        typeof rawNonce === 'string' && NONCE_PATTERN.test(rawNonce)
          ? rawNonce
          : undefined;
      if (Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535) {
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
