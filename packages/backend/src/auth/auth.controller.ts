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
import { AuthService } from './auth.service';
import { CliExchangeDto } from './auth.dto';
import { UserService } from '../user/user.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedRequest } from './auth.types';
import { CliAuthStore } from './cli-auth.store';
import { GitHubAuthGuard } from './github-auth.guard';
import {
  cliStateCookieName,
  cliStateCookieOptions,
  isWebOAuthState,
  oauthStateCookieName,
  oauthStateCookieOptions,
  useSecureCookies,
  webOAuthStateMatches,
} from './oauth-state';

const ACCESS_COOKIE_NAME = 'wafflebase_session';
const REFRESH_COOKIE_NAME = 'wafflebase_refresh';
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
    const githubUser = req.user;

    const user = await this.userService.findOrCreateUser({
      authProvider: 'github',
      username: githubUser.username,
      email: githubUser.email,
      photo: githubUser.photo,
    });

    if (!user) {
      throw new Error('User not found or created');
    }

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
      // stolen or guessed `state` cannot bring the cookie with it.
      // Only the name the guard would mint *now* is read: in production
      // that is the `__Host-` prefixed one, and honouring an unprefixed
      // leftover would re-admit the sibling-subdomain cookie-tossing the
      // prefix exists to block (see `oauth-state.ts`).
      const cookieName = oauthStateCookieName();
      const cookieSecret = req.cookies?.[cookieName];
      res.clearCookie(cookieName, {
        ...oauthStateCookieOptions(),
        maxAge: undefined,
      });
      if (!webOAuthStateMatches(stateToken, cookieSecret)) {
        return res.redirect(this.loginErrorUrl('oauth_state'));
      }
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
        const code = this.cliAuthStore.createCode(user.id, state.challenge);
        // Echo the CLI's per-attempt nonce back as `state`: the CLI's
        // loopback callback server only accepts a `code` that carries it,
        // which is what stops a web page from feeding the CLI a code for
        // someone else's account (login CSRF).
        const stateParam = state.nonce
          ? `&state=${encodeURIComponent(state.nonce)}`
          : '';
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

    // Default web flow: set cookies and redirect to frontend.
    const tokens = this.authService.createTokens(user);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return res.redirect(this.configService.get('FRONTEND_URL')!);
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
    const cookieToken = req.cookies?.[REFRESH_COOKIE_NAME];
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

  private clearAuthCookies(res: Response) {
    const clearOptions = this.baseCookieOptions();
    res.clearCookie(ACCESS_COOKIE_NAME, clearOptions);
    res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    res.cookie(ACCESS_COOKIE_NAME, accessToken, {
      ...this.baseCookieOptions(),
      maxAge: this.cookieMaxAge(
        'JWT_ACCESS_COOKIE_MAX_AGE_MS',
        DEFAULT_ACCESS_COOKIE_MAX_AGE_MS,
      ),
    });

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
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
    };
  }
}
