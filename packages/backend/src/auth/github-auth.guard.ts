import {
  BadRequestException,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CliAuthStore } from './cli-auth.store';

/**
 * Custom GitHub OAuth guard that detects CLI login params
 * (`?mode=cli&port=<port>&nonce=<nonce>`) and injects a state token onto
 * the request so GitHubStrategy.authenticate() can forward it to GitHub.
 * The CLI's nonce rides along in the stored state and is echoed back on
 * the loopback redirect, letting the CLI reject a callback it did not
 * start (see `packages/cli/src/commands/login.ts`).
 *
 * The nonce is required, not best-effort: without it this endpoint mints
 * a login code and delivers it to an arbitrary `127.0.0.1:<port>` for
 * anyone who can make the browser navigate here, and the CLI has no way
 * to tell that callback from its own.
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

    if (mode === 'cli') {
      const portNum = Number(req.query?.port);
      if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
        throw new BadRequestException('Invalid CLI port');
      }
      const nonce = req.query?.nonce;
      if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) {
        throw new BadRequestException(
          'Missing or invalid CLI login nonce. Upgrade the `wafflebase` CLI.',
        );
      }
      const { stateToken } = this.cliAuthStore.createState(
        mode,
        portNum,
        nonce,
      );
      req.__cliStateToken = stateToken;
    }

    return super.canActivate(context);
  }
}
