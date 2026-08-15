import {
  BadRequestException,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { randomBytes } from 'node:crypto';
import { Request, Response } from 'express';
import { CliAuthStore } from './cli-auth.store';
import {
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_MAX_AGE_MS,
  baseCookieOptions,
} from './cookies';

/**
 * Custom GitHub OAuth guard that puts an unguessable `state` on every
 * authorization request, in one of two shapes, and hands it to
 * `GitHubStrategy.authenticate()` to forward to GitHub.
 *
 * A **web** login gets a random value mirrored into a short-lived cookie
 * (`OAUTH_STATE_COOKIE_NAME`); the callback accepts only a `state` that
 * matches the cookie, which is what ties the code being redeemed to the
 * browser that asked for it. A **CLI** login gets a server-side state
 * entry instead — its callback lands on a loopback listener, so there is
 * no browser to bind to — carrying the CLI parameters
 * (`?mode=cli&port=<port>&nonce=<nonce>`) through the round trip.
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
    // Typed here rather than left as `any`: `__oauthState` is the whole
    // hand-off to `GitHubStrategy.authenticate`, and a typo in it would
    // silently drop the `state` — that is, silently drop the binding.
    const req = context
      .switchToHttp()
      .getRequest<Request & { __oauthState?: string }>();
    const mode = req.query?.mode;

    if (mode !== 'cli') {
      // The web flow gets a `state` too, mirrored into a cookie the
      // callback checks. Without one, passport-oauth2 installs a
      // `NullStore` whose verify always succeeds: any `?code=` the
      // attacker holds completes a login in the victim's browser and
      // silently seats them inside the attacker's account. The CLI's
      // binding is a server-side entry instead, because its callback
      // lands on a loopback listener and there is no browser to bind.
      const state = randomBytes(32).toString('base64url');
      const res = context.switchToHttp().getResponse<Response>();
      res.cookie(OAUTH_STATE_COOKIE_NAME, state, {
        ...baseCookieOptions(),
        maxAge: OAUTH_STATE_MAX_AGE_MS,
      });
      req.__oauthState = state;
      return super.canActivate(context);
    }

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
    const { stateToken } = this.cliAuthStore.createState(mode, portNum, nonce);
    req.__oauthState = stateToken;

    return super.canActivate(context);
  }
}
