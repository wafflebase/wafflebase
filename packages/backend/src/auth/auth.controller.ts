import { CookieOptions, Request, Response } from 'express';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
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
import {
  BotSignInRefusedError,
  EmailProviderConflictError,
  UserService,
} from '../user/user.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthGuard } from '@nestjs/passport';
import {
  AuthenticatedRequest,
  oauthRefusal,
  type OAuthProfile,
} from './auth.types';
import { CliAuthStore } from './cli-auth.store';
import { cliLoginAvailable, GitHubAuthGuard } from './github-auth.guard';
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

/**
 * The webview origin Tauri serves the desktop app's bundled pages from on
 * macOS and Linux. `https://tauri.localhost` (Tauri's `useHttpsScheme`) is
 * not accepted in either direction, because the app does not use it.
 */
const DESKTOP_CUSTOM_ORIGIN = 'tauri://localhost';

/**
 * The same, on Windows — where the webview has no custom scheme and Tauri
 * falls back to a plain `http://` origin.
 *
 * Unlike `tauri://localhost`, this one is a name an ordinary browser can
 * reach: Chrome and Firefox resolve RFC 6761 `.localhost` to loopback, and
 * `tauri.localhost` is also a real DNS name somebody else controls. So a
 * process listening on the user's port 80, or a resolver that answers for
 * the name, can serve a page whose `Origin` this allowlist trusts (login
 * CSRF — `docs/design/desktop-app.md` § Risks). That is accepted so Windows
 * can sign in, and `WAFFLEBASE_DESKTOP_WINDOWS_ORIGIN=false` is how a
 * deployment with no Windows desktop users declines to accept it at all.
 */
const DESKTOP_WINDOWS_ORIGIN = 'http://tauri.localhost';

/**
 * Whether `http://tauri.localhost` is a trusted handoff origin on this
 * deployment. The literal `false` — trimmed, case-insensitive, the same
 * reading `YORKIE_AUTH_WEBHOOK_ENFORCE` gets — turns it off; anything else,
 * unset included, leaves it on, so an existing install changes nothing.
 *
 * Turning it off costs the Windows app its in-webview sign-in (the handoff
 * POST answers `403`); macOS and Linux keep theirs on `tauri://localhost`,
 * which no browser can produce.
 */
function windowsDesktopOriginAllowed(): boolean {
  return (
    (process.env.WAFFLEBASE_DESKTOP_WINDOWS_ORIGIN ?? '')
      .trim()
      .toLowerCase() !== 'false'
  );
}

/**
 * The origins `POST /auth/desktop/session` answers, in this deployment's
 * configuration. These origins are not Wafflebase's alone: every Tauri app
 * on the machine serves its pages from them. The check stops web pages, not
 * another installed app, and the design doc lists that as an accepted risk.
 */
function desktopOrigins(): ReadonlySet<string> {
  const origins = new Set([DESKTOP_CUSTOM_ORIGIN]);
  if (windowsDesktopOriginAllowed()) {
    origins.add(DESKTOP_WINDOWS_ORIGIN);
  }
  return origins;
}

/**
 * Whether a request's `Origin` is the desktop app's bundled handoff page.
 *
 * `POST /auth/desktop/session` signs in *the browser that sent it*, so
 * without this check any web page could auto-submit a form carrying the
 * code and verifier from the attacker's own unfinished desktop login and
 * sign the visitor into the attacker's account (login CSRF). A browser
 * always sends `Origin` on a cross-site POST and a page cannot forge it.
 *
 * Exact match only. A missing header is refused, and so is `null`, which a
 * sandboxed iframe on any site can send. A repeated header arrives joined
 * (`a, b`) or as an array and matches nothing.
 */
export function isDesktopOrigin(raw: unknown): boolean {
  return typeof raw === 'string' && desktopOrigins().has(raw);
}

/**
 * Whether `{ code, verifier }` passes the same rules as `CliExchangeDto`.
 * Run by hand after the origin check, see `desktopSession`.
 */
function isValidDesktopRedemption(code: unknown, verifier: unknown): boolean {
  const dto = plainToInstance(CliExchangeDto, { code, verifier });
  return validateSync(dto).length === 0;
}

/**
 * Whether this user may be issued a session JWT. A bot never may: it acts
 * only through the API key a pairing minted for its host. The OAuth callback
 * already refuses one (`BotSignInRefusedError`), so a CLI or desktop code
 * can never name a bot; these checks keep the redeeming and refresh paths
 * from relying on that.
 */
function canHoldSession(user: Pick<User, 'kind'>): boolean {
  return user.kind !== 'bot';
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

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
      // A desktop-app login (`?mode=desktop`) is this same branch: same
      // state, cookie and loopback redirect. Its mode is minted into the
      // code, which then redeems only at `POST /auth/desktop/session`.
      const state = this.cliAuthStore.consumeState(stateToken, cliCookieSecret);
      if (state && (state.mode === 'cli' || state.mode === 'desktop')) {
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
            state.mode === 'desktop'
              ? 'Desktop sign-in is missing its proof-of-possession ' +
                'challenge. Update the Wafflebase desktop app and sign ' +
                'in again.'
              : 'CLI login is missing its proof-of-possession challenge. ' +
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
          state.mode,
        );
        return res.redirect(
          `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(code)}${stateParam}`,
        );
      }

      // State token was provided but invalid, expired, or came from
      // another browser — this is a CLI flow that failed. Return an error
      // instead of falling through to web flow.
      // Which program started it is unknown here — the state is gone — so
      // the message names both.
      throw new BadRequestException(
        'CLI login state expired, invalid, or completed in a different ' +
          'browser. Please run `wafflebase login` again (or sign in again ' +
          'from the Wafflebase desktop app).',
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
      if (error instanceof BotSignInRefusedError) {
        return { error: 'bot_account' };
      }
      throw error;
    }

    if (!user) {
      throw new Error('User not found or created');
    }

    // A failure here must not cost the person their sign-in: the claims stay
    // unclaimed and the next sign-in tries again.
    if (authProvider === 'github' && profile.githubId) {
      try {
        await this.userService.claimGithubWorkspaces(
          user.id,
          String(profile.githubId),
        );
      } catch (error) {
        this.logger.warn(
          `Claiming workspaces for user ${user.id} failed: ${String(error)}`,
        );
      }
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
   *
   * `desktop` says which of them the desktop app can run through the system
   * browser (`?mode=desktop`). GitHub can wherever the CLI login can
   * (`cliLoginAvailable()`), since it is the same gate; Google has no
   * loopback mode yet. A server that predates the field is how the app tells
   * "too old for desktop sign-in" apart from a login that never comes back.
   *
   * `desktop.windowsOrigin` is the second half of that answer, and only
   * Windows reads it: the handoff that ends a desktop sign-in POSTs from the
   * app's own webview, whose origin there is `http://tauri.localhost`, and a
   * deployment that set `WAFFLEBASE_DESKTOP_WINDOWS_ORIGIN=false` refuses it.
   * Reporting it here is what lets the Windows app say so before it opens a
   * browser, instead of after the user has signed in and the handoff 403s.
   * It stays a separate field rather than folding into `github`, because
   * macOS and Linux hand off from `tauri://localhost` and are unaffected.
   */
  @Get('providers')
  authProviders() {
    return {
      github: true,
      google: googleAuthConfigured(),
      desktop: {
        github: cliLoginAvailable(),
        google: false,
        windowsOrigin: windowsDesktopOriginAllowed(),
      },
    };
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
    // A code minted for the desktop app is refused here as an unknown one.
    const userId = this.cliAuthStore.consumeCode(
      body.code,
      body.verifier,
      'cli',
    );
    if (userId === undefined) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const user = await this.userService.user({ id: userId });
    if (!user || !canHoldSession(user)) {
      throw new UnauthorizedException('User not found');
    }

    const tokens = this.authService.createTokens(user);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  /**
   * Turn a desktop-app login code into session cookies on the webview.
   *
   * The desktop app's bundled handoff page top-level POSTs
   * `application/x-www-form-urlencoded` `{ code, verifier }` here, so the
   * response that sets the cookies is one the webview itself receives and
   * the native shell never holds a JWT (`docs/design/desktop-app.md` §3).
   *
   * Unlike `cliExchange`, this signs in the browser that sent the request,
   * so the `Origin` check comes first and before the code is touched: from
   * any other origin it is a login-CSRF vector (`isDesktopOrigin`). That is
   * also why the body is read off the request rather than through a
   * validated DTO — the global `ValidationPipe` would answer a malformed
   * body with a 400 before the origin was ever looked at. The same DTO's
   * rules are applied after the check instead.
   *
   * An optional `returnTo` (the path the sign-in link carried) is
   * re-validated with `safeReturnPath`, as the web callback does with its
   * cookie.
   *
   * Every failure past the origin check is the same `303` to the sign-in
   * page with `?error=desktop_session`: the webview is the reader, and a
   * JSON error would strand it on the backend origin. A CLI code is refused
   * as an unknown one.
   */
  @Post('desktop/session')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async desktopSession(@Req() req: Request, @Res() res: Response) {
    if (!isDesktopOrigin(req.headers?.origin)) {
      throw new ForbiddenException('Desktop sign-in only');
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { code, verifier } = body;
    if (!isValidDesktopRedemption(code, verifier)) {
      return res.redirect(303, this.loginErrorUrl('desktop_session'));
    }

    const userId = this.cliAuthStore.consumeCode(
      code as string,
      verifier as string,
      'desktop',
    );
    if (userId === undefined) {
      return res.redirect(303, this.loginErrorUrl('desktop_session'));
    }
    // The code is spent from here on, so every failure below must still end
    // in the 303: the webview cannot retry, and a JSON 500 would strand it on
    // the backend origin.
    let user: Awaited<ReturnType<UserService['user']>>;
    try {
      user = await this.userService.user({ id: userId });
    } catch (e) {
      this.logger.error(
        `desktop session: user lookup failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return res.redirect(303, this.loginErrorUrl('desktop_session'));
    }
    if (!user || !canHoldSession(user)) {
      return res.redirect(303, this.loginErrorUrl('desktop_session'));
    }

    // The same session the OAuth callback issues. Workspace claims already
    // ran when the callback resolved this user. There is no `returnTo`
    // cookie (the webview never visited `/auth/github` itself), so the
    // handoff page posts the path instead.
    const tokens = this.authService.createTokens(user);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res.redirect(
      303,
      loginRedirectUrl(
        this.configService.get<string>('FRONTEND_URL')!,
        safeReturnPath(body.returnTo),
      ),
    );
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

      if (!user || !canHoldSession(user)) {
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
