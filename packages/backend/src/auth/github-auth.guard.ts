import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  Logger,
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
 * A malformed nonce is refused outright. A *missing* one is accepted for
 * now, and deliberately so: `@wafflebase/cli` is published to npm, so
 * users run whatever version they installed, and 400-ing a nonce-less
 * request would break every released CLI the moment a server deploys.
 * Refusing it also buys no security — the binding that defends a login
 * is the CLI's own check that the callback echoes *its* nonce, and an
 * attacker minting a code for a loopback port they control simply picks
 * a nonce of their own. Requiring one here only guarantees the redirect
 * carries something for a current CLI to compare against, which a
 * current CLI already gets by always sending one.
 *
 * Once published CLIs older than the nonce-bound login are out of
 * support, this can become a hard 400 (see `docs/design/cli.md`).
 */
/** Opaque, URL-safe, length-bounded — anything else is not ours. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

@Injectable()
export class GitHubAuthGuard extends AuthGuard('github') {
  private readonly logger = new Logger(GitHubAuthGuard.name);

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
      const raw: unknown = req.query?.nonce;
      let nonce: string | undefined;
      if (raw === undefined) {
        this.logger.warn(
          'CLI login without a nonce — the client predates nonce-bound login and cannot verify its own callback. Upgrade the `wafflebase` CLI.',
        );
      } else if (typeof raw !== 'string' || !NONCE_PATTERN.test(raw)) {
        throw new BadRequestException('Invalid CLI login nonce');
      } else {
        nonce = raw;
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
