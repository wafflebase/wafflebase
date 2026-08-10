import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CliAuthStore } from './cli-auth.store';

/**
 * Accept only a hex nonce of a sane length. The value is echoed back on
 * a redirect to the CLI's loopback callback, so nothing but `[0-9a-f]`
 * is allowed through — no delimiters, no room to smuggle query params.
 */
export function parseCliNonce(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return /^[0-9a-f]{32,128}$/.test(raw) ? raw : undefined;
}

/**
 * Custom GitHub OAuth guard that detects CLI login params
 * (`?mode=cli&port=<port>&nonce=<hex>`) and injects a state token onto
 * the request so GitHubStrategy.authenticate() can forward it to GitHub.
 * The CLI nonce rides along in the stored state so the callback can
 * hand it back to the CLI (see `login.ts`).
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
          parseCliNonce(req.query?.nonce),
        );
        req.__cliStateToken = stateToken;
      }
    }

    return super.canActivate(context);
  }
}
