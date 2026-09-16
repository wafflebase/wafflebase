import {
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { googleAuthConfigured } from './oauth-providers';
import { startWebOAuthLogin, type OAuthStateRequest } from './web-oauth-login';

/**
 * Refuse the route where this deployment has no Google OAuth client.
 *
 * Not providing `GoogleStrategy` is what keeps such a deployment booting, but
 * it leaves `AuthGuard('google')` to fail with passport's "Unknown
 * authentication strategy" — a 500 on a route a visitor reached by typing a
 * URL. `404` is the honest answer: on this install the endpoint does not
 * exist. The login page asks `GET /auth/providers` so nobody is sent here in
 * the first place.
 */
function assertGoogleConfigured() {
  if (!googleAuthConfigured()) {
    throw new NotFoundException('Google sign-in is not enabled');
  }
}

/**
 * `GET /auth/google` — the browser login start.
 *
 * Mints the double-submit `state` that `GoogleStrategy.authenticate`
 * forwards, exactly as `GitHubAuthGuard` does for its browser branch (they
 * share `startWebOAuthLogin`). There is no CLI branch: `?mode=cli` remains a
 * GitHub flow, so none of the confirmation-page, loopback-port or PKCE
 * machinery applies here.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  canActivate(context: ExecutionContext) {
    assertGoogleConfigured();
    const http = context.switchToHttp();
    startWebOAuthLogin(
      http.getRequest<OAuthStateRequest>(),
      http.getResponse<Response>(),
    );
    return super.canActivate(context);
  }
}

/**
 * `GET /auth/google/callback` — the same 404, without minting a new state.
 * The callback's own `state` check lives in the controller, where it can
 * redirect a refusal to the login page rather than throw.
 */
@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  canActivate(context: ExecutionContext) {
    assertGoogleConfigured();
    return super.canActivate(context);
  }
}
