import { CookieOptions, Request, Response } from 'express';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { User } from '@prisma/client';
import { AuthService } from './auth.service';
import { CliExchangeDto } from './auth.dto';
import { EmailProviderConflictError, UserService } from '../user/user.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthGuard } from '@nestjs/passport';
import {
  AuthenticatedRequest,
  oauthRefusal,
  type OAuthProfile,
} from './auth.types';
import { CliAuthStore } from './cli-auth.store';
import { GitHubAuthGuard } from './github-auth.guard';
import { GoogleAuthGuard, GoogleCallbackGuard } from './google-auth.guard';
import { googleAuthConfigured } from './oauth-providers';
import { consumeWebOAuthState } from './web-oauth-login';
import {
  cliStateCookieName,
  cliStateCookieOptions,
  isWebOAuthState,
  refreshCookieName,
  sessionCookieName,
  UNPREFIXED_SESSION_COOKIE_NAMES,
  useSecureCookies,
} from './oauth-state';
import {
  loginRedirectUrl,
  loginReturnCookieName,
  loginReturnCookieOptions,
  safeReturnPath,
} from './login-return-path';

const DEFAULT_ACCESS_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly cliAuthStore: CliAuthStore,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: AuthenticatedRequest) {
    return req.user;
  }

  /**
   * Mint a short-lived token for the Yorkie client's `authTokenInjector`. The
   * session JWT lives in an httpOnly cookie the browser can't read, so the
   * frontend fetches this instead (the cookie authenticates the call). The
   * Yorkie auth webhook resolves document access from the returned token.
   */
  @Get('yorkie-token')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getYorkieToken(@Req() req: AuthenticatedRequest) {
    return { token: this.authService.issueYorkieUserToken(req.user.id) };
  }

  /**
   * Yorkie token for an anonymous share-link visitor (no session). Public: the
   * token only wraps the share token; the webhook does the real validation
   * (existence, expiry, document match, role) via `ShareLinkService`. Uses POST
   * with the share token in the body so the (access-granting) token stays out
   * of request URLs and access logs.
   */
  @Post('yorkie-token/share')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getYorkieShareToken(@Body('token') shareToken: string | undefined) {
    if (!shareToken) {
      throw new BadRequestException('Missing share token');
    }
    return { token: this.authService.issueYorkieShareToken(shareToken) };
  }

  @Post('logout')
  async logout(@Res() res: Response) {
    this.clearAuthCookies(res);
    return res.sendStatus(200);
  }

  @Get('github')
  @UseGuards(GitHubAuthGuard)
  async githubAuth(
    @Query('mode') mode: string | undefined,
    @Query('port') port: string | undefined,
    @Req() req: Request,
  ) {
    // NOTE(hackerwins): Redirect to GitHub for authentication.
    // The guard attaches the OAuth `state` (via __oauthState) and handles
    // the redirect. A CLI login (`?mode=cli`) is answered by
    // CliLoginConfirmMiddleware with a confirmation page first, and only
    // reaches the guard once the user has clicked through it.
    void mode;
    void port;
    void req;
  }

  @Get('github/callback')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('github'))
  async githubAuthCallback(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('state') stateToken: string | undefined,
  ) {
    const githubUser = req.user as unknown as OAuthProfile;

    // No `state` at all is never a login this server started: the guard
    // attaches one to every path, CLI and browser alike. Accepting a
    // stateless callback is login CSRF — an attacker replays a code they
    // obtained through the victim's browser and the victim ends up in
    // the attacker's account (session fixation).
    //
    // The refusal is a redirect back to the sign-in page, not a thrown
    // 400. This is reachable without any attacker — the state cookie
    // lives ten minutes, which a first-time sign-up with 2FA can
    // outlast, and a second login tab overwrites the first tab's cookie
    // — and a raw Nest error page on the *backend* origin leaves the
    // user staring at JSON with no way back. Refusing and returning them
    // somewhere they can retry are independent: no session is issued on
    // either path.
    //
    // A repeated `?state=` arrives as an array, which is likewise not a
    // login we started; it is normalized away here so it cannot reach
    // the string checks below as a 500.
    if (typeof stateToken !== 'string' || !stateToken) {
      return res.redirect(this.loginErrorUrl('oauth_state'));
    }

    if (isWebOAuthState(stateToken)) {
      // Browser flow: the state is the hash of a secret that only this
      // browser holds, in an httpOnly cookie. A code replayed with a
      // stolen or guessed `state` cannot bring the cookie with it. Shared
      // with the Google callback — see `web-oauth-login.ts`.
      if (!consumeWebOAuthState(req, res, stateToken)) {
        return res.redirect(this.loginErrorUrl('oauth_state'));
      }

      // Default web flow: set cookies and redirect to frontend. A profile
      // the strategy refused (no verified email) lands back on the sign-in
      // page saying so, like any other refusal — the strategy reports it as
      // a value precisely so it does not escape the guard as backend JSON.
      const result = await this.resolveOAuthUser('github', githubUser);
      if ('error' in result) {
        return res.redirect(this.loginErrorUrl(result.error));
      }
      return this.finishWebLogin(req, res, result.user);
    } else {
      // Otherwise it is a CLI state token; consume it. Like the browser
      // state, it counts only when the browser that started the login
      // presents the cookie secret minted alongside it — the token
      // itself travels through GitHub in a URL and is otherwise
      // transferable, so an attacker could click through the
      // confirmation page in their own browser, take the state out of
      // the redirect, and have the victim's callback mint a code for the
      // victim's account bound to the attacker's challenge and port.
      // Only the name this build mints is read, for the same reason the
      // web flow reads only its own (sibling-subdomain cookie tossing).
      const cliCookieName = cliStateCookieName();
      const cliCookieSecret = req.cookies?.[cliCookieName];
      res.clearCookie(cliCookieName, {
        ...cliStateCookieOptions(),
        maxAge: undefined,
      });
      const state = this.cliAuthStore.consumeState(stateToken, cliCookieSecret);
      if (state && state.mode === 'cli') {
        const port = state.port;
        if (port < 1024 || port > 65535) {
          throw new BadRequestException('Invalid CLI port');
        }
        // No challenge, no code. The code is delivered as plaintext in a
        // loopback URL, so on its own it is a bearer credential worth a
        // full session; the challenge is what makes redeeming it require
        // the verifier only the CLI process holds. A CLI that did not
        // send one is older than this server, and is told so rather than
        // handed a weaker credential.
        if (!state.challenge) {
          throw new BadRequestException(
            'CLI login is missing its proof-of-possession challenge. ' +
              'Update the wafflebase CLI and run `wafflebase login` again.',
          );
        }
        // Echo the CLI's per-attempt nonce back as `state`: the CLI's
        // loopback callback server only accepts a callback that carries it,
        // which is what stops a web page from feeding the CLI a code for
        // someone else's account (login CSRF). It rides the refusal below
        // for the same reason.
        const stateParam = state.nonce
          ? `&state=${encodeURIComponent(state.nonce)}`
          : '';

        // A refused profile is reported to the loopback listener rather than
        // thrown. `wafflebase login` is blocked on that callback, and a
        // backend 401 it never sees would leave it waiting out the whole
        // five-minute timeout with nothing to act on.
        const result = await this.resolveOAuthUser('github', githubUser);
        if ('error' in result) {
          return res.redirect(
            `http://127.0.0.1:${port}/callback?error=${encodeURIComponent(result.error)}${stateParam}`,
          );
        }

        const code = this.cliAuthStore.createCode(
          result.user.id,
          state.challenge,
        );
        return res.redirect(
          `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(code)}${stateParam}`,
        );
      }

      // State token was provided but invalid, expired, or came from
      // another browser — this is a CLI flow that failed. Return an error
      // instead of falling through to web flow.
      throw new BadRequestException(
        'CLI login state expired, invalid, or completed in a different ' +
          'browser. Please run `wafflebase login` again.',
      );
    }
  }

  /**
   * Turn a provider profile into the user it signs in as — or into the code
   * a refusal is reported under.
   *
   * Two things can refuse here, and neither is an exception the caller should
   * let escape: the strategy may have declined the profile outright (no
   * verified email), and the address may belong to an account created through
   * the other provider that this deployment has never seen proven
   * (`EmailProviderConflictError`). Both are things the person can act on, so
   * both come back as a code the caller routes — to the sign-in page for a
   * browser login, to the loopback listener for a CLI one.
   */
  private async resolveOAuthUser(
    authProvider: 'github' | 'google',
    profile: OAuthProfile,
  ): Promise<{ user: User } | { error: string }> {
    const refusal = oauthRefusal(profile);
    if (refusal) return { error: refusal };

    let user: User | null;
    try {
      user = await this.userService.findOrCreateUser({
        authProvider,
        username: profile.username!,
        email: profile.email!,
        photo: profile.photo,
      });
    } catch (error) {
      if (error instanceof EmailProviderConflictError) {
        return { error: 'email_conflict' };
      }
      throw error;
    }

    if (!user) {
      throw new Error('User not found or created');
    }
    return { user };
  }

  /**
   * Which sign-in buttons the login page should offer.
   *
   * Google is optional (`oauth-providers.ts`), and whether it is configured
   * is a property of the *deployment*, not of the frontend bundle — a
   * self-hosted image is built once and configured per install, so a
   * build-time `VITE_` flag could not answer it. Unauthenticated, because
   * the login page is: the answer is exactly what a visitor learns by
   * clicking, and it names no secret.
   */
  @Get('providers')
  authProviders() {
    return { github: true, google: googleAuthConfigured() };
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth() {
    // The guard mints the `state`, sets its cookie and issues the redirect
    // to Google. There is no CLI variant: `?mode=cli` stays a GitHub flow.
  }

  @Get('google/callback')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(GoogleCallbackGuard)
  async googleAuthCallback(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('state') stateToken: string | undefined,
  ) {
    // Same refusal as the GitHub callback, and for the same reason: a
    // callback carrying no `state`, or one this browser did not start, is
    // login CSRF. Only the browser vocabulary is accepted here — a CLI
    // state token cannot have been minted by this route.
    //
    // Checked *before* the user is upserted, so a refused callback leaves no
    // row (and no workspace) behind for a sign-in that never happened.
    if (
      typeof stateToken !== 'string' ||
      !isWebOAuthState(stateToken) ||
      !consumeWebOAuthState(req, res, stateToken)
    ) {
      return res.redirect(this.loginErrorUrl('oauth_state'));
    }

    const googleUser = req.user as unknown as OAuthProfile;

    // Matched on email alone, like every other sign-in — so a Google
    // account whose address already has a Wafflebase user signs into *that*
    // user rather than creating a second one with a second workspace.
    // `GoogleStrategy.validate` is what makes that safe: it refuses an
    // address Google has not verified. The account it merges into has to
    // have been proven too, which is what `email_conflict` reports (see
    // `UserService.findOrCreateUser`).
    const result = await this.resolveOAuthUser('google', googleUser);
    if ('error' in result) {
      return res.redirect(this.loginErrorUrl(result.error));
    }

    return this.finishWebLogin(req, res, result.user);
  }

  /**
   * Issue the session and send the browser back to the frontend — the tail
   * both browser logins share.
   *
   * The `returnTo` cookie is cleared on use and re-validated here rather
   * than trusted: it was written from an unauthenticated request, so this is
   * the read that decides a redirect and it does its own checking (see
   * `login-return-path.ts`).
   */
  private finishWebLogin(req: Request, res: Response, user: User) {
    const tokens = this.authService.createTokens(user);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    const returnCookie = req.cookies?.[loginReturnCookieName()] as unknown;
    if (returnCookie !== undefined) {
      res.clearCookie(loginReturnCookieName(), loginReturnCookieOptions());
    }
    return res.redirect(
      loginRedirectUrl(
        this.configService.get('FRONTEND_URL')!,
        safeReturnPath(returnCookie),
      ),
    );
  }

  /**
   * Redeem a CLI authorization code for a session.
   *
   * The code is not sufficient on its own: it arrives at the CLI over
   * plaintext loopback HTTP, at a port taken off the login URL's query
   * string, so treating it as a bearer credential would mean anything
   * that observed that hop could mint access **and** refresh JWTs here
   * with no authentication at all. The caller must also present the
   * `verifier` whose SHA-256 it bound at login time (PKCE S256) — a value
   * that lives only in the CLI process and never appears in a URL.
   */
  @Post('cli/exchange')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async cliExchange(@Body() body: CliExchangeDto) {
    const userId = this.cliAuthStore.consumeCode(body.code, body.verifier);
    if (userId === undefined) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const user = await this.userService.user({ id: userId });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const tokens = this.authService.createTokens(user);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res() res: Response) {
    const cookieToken = req.cookies?.[refreshCookieName()];
    const bodyToken =
      typeof req.body?.refreshToken === 'string'
        ? req.body.refreshToken
        : undefined;
    const fromBody = !cookieToken && !!bodyToken;
    const refreshToken = cookieToken ?? bodyToken;

    if (!refreshToken) {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token missing');
    }

    try {
      const payload = this.authService.verifyRefreshToken(refreshToken);
      const user = await this.userService.user({
        id: payload.sub,
      });

      if (!user) {
        if (!fromBody) this.clearAuthCookies(res);
        throw new UnauthorizedException('User not found');
      }

      const tokens = this.authService.createTokens(user);

      if (fromBody) {
        return res.json({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
      }

      this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
      return res.sendStatus(200);
    } catch (error) {
      if (!fromBody) this.clearAuthCookies(res);
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Where a browser login goes when it cannot be completed.
   *
   * The sign-in page reads `?error=` and says so, which is the whole
   * point of not throwing: the failure is reported on a page the user
   * can retry from, on the frontend origin, rather than as backend JSON.
   * The code is a fixed identifier, never upstream text.
   */
  private loginErrorUrl(code: string): string {
    const frontend = (this.configService.get<string>('FRONTEND_URL') ?? '')
      .replace(/\/+$/, '');
    return `${frontend}/login?error=${encodeURIComponent(code)}`;
  }

  /**
   * Expire the session cookies — in every shape this deployment may have
   * written them.
   *
   * One `clearCookie` with the configured options is not enough, in two
   * independent ways, and both of them end with a session surviving its own
   * sign-out.
   *
   * A `Set-Cookie` carrying `Secure` is discarded by the browser when the
   * connection is not, so on an origin actually served over plain http —
   * `COOKIE_SECURE=true` set by hand, or set for a TLS-terminating proxy that
   * is no longer in front — the expiring cookie never lands, `POST
   * /auth/logout` answers 200, and the cookie set under the previous config is
   * still there. The insecure variant is therefore emitted too: over https
   * both land (a cookie's identity is name/domain/path, so the non-`Secure`
   * one overwrites and expires the `Secure` one), and over http the one that
   * can arrive does.
   *
   * The name follows `__Host-` as well, so a cookie written before this
   * deployment turned `Secure` on answers to the bare name. Both names are
   * expired for the same reason: a deletion carries no credential, so the
   * blunt sweep is free, whereas *accepting* both names would re-admit the
   * sibling-subdomain planting the prefix exists to stop.
   */
  private clearAuthCookies(res: Response) {
    const base = this.baseCookieOptions();
    const names = new Set([
      sessionCookieName(),
      refreshCookieName(),
      ...UNPREFIXED_SESSION_COOKIE_NAMES,
    ]);
    for (const name of names) {
      for (const secure of [true, false]) {
        res.clearCookie(name, { ...base, secure });
      }
    }
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    res.cookie(sessionCookieName(), accessToken, {
      ...this.baseCookieOptions(),
      maxAge: this.cookieMaxAge(
        'JWT_ACCESS_COOKIE_MAX_AGE_MS',
        DEFAULT_ACCESS_COOKIE_MAX_AGE_MS,
      ),
    });

    res.cookie(refreshCookieName(), refreshToken, {
      ...this.baseCookieOptions(),
      maxAge: this.cookieMaxAge(
        'JWT_REFRESH_COOKIE_MAX_AGE_MS',
        DEFAULT_REFRESH_COOKIE_MAX_AGE_MS,
      ),
    });
  }

  private cookieMaxAge(key: string, fallback: number): number {
    const value = this.configService.get<string>(key);
    if (!value) {
      return fallback;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }

  private baseCookieOptions(): CookieOptions {
    // SameSite=Lax for CSRF defense; assumes frontend + backend share eTLD+1.
    return {
      httpOnly: true,
      // One answer for every login cookie (`oauth-state.ts`): the
      // deployment's own callback scheme, with `NODE_ENV` only as the
      // fallback when no callback URL is configured.
      secure: useSecureCookies(),
      sameSite: 'lax',
      // Explicit, because it is load-bearing rather than a default: the
      // `__Host-` prefix `sessionCookieName()` applies is honoured only on a
      // cookie with `Path=/` and no `Domain`, and a prefixed cookie set
      // without them is rejected outright.
      path: '/',
    };
  }
}
