import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { CliAuthStore } from './cli-auth.store';
import {
  createWebOAuthState,
  oauthStateCookieName,
  oauthStateCookieOptions,
} from './oauth-state';

/**
 * Accept only a hex nonce of a sane length. The value is echoed back on
 * a redirect to the CLI's loopback callback, so nothing but `[0-9a-f]`
 * is allowed through — no delimiters, no room to smuggle query params.
 */
export function parseCliNonce(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return /^[0-9a-f]{32,128}$/.test(raw) ? raw : undefined;
}

/** The loopback port, or `undefined` when it is not a usable one. */
export function parseCliPort(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return undefined;
  return port;
}

/**
 * Custom GitHub OAuth guard that attaches the `state` parameter
 * `GitHubStrategy.authenticate()` forwards to GitHub. Every login gets
 * one — there is no stateless path:
 *
 * - **CLI** (`?mode=cli&port=<port>&nonce=<hex>`) — a token from
 *   `CliAuthStore` carrying the port and the CLI's nonce, so the callback
 *   can redirect the code to the loopback server (see `login.ts`). Minted
 *   only once `CliLoginConfirmMiddleware` has seen the user click through
 *   the confirmation page; without that flag this degrades to an ordinary
 *   browser login rather than silently minting a code for whoever framed
 *   the request.
 * - **Browser** — a double-submit cookie pair (see `oauth-state.ts`).
 *   Without it, `/auth/github/callback` would set session cookies for any
 *   code presented to it, which is login CSRF / session fixation.
 */
@Injectable()
export class GitHubAuthGuard extends AuthGuard('github') {
  constructor(private readonly cliAuthStore: CliAuthStore) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse<Response>();
    const port = parseCliPort(req.query?.port);

    if (req.query?.mode === 'cli' && port !== undefined && req.__cliConfirmed) {
      const { stateToken } = this.cliAuthStore.createState(
        'cli',
        port,
        parseCliNonce(req.query?.nonce),
      );
      req.__oauthState = stateToken;
    } else {
      const { secret, state } = createWebOAuthState();
      res.cookie(oauthStateCookieName(), secret, oauthStateCookieOptions());
      req.__oauthState = state;
    }

    return super.canActivate(context);
  }
}
