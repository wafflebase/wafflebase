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
import {
  GitHubAuthGuard,
  OAUTH_STATE_COOKIE,
  WEB_STATE_PREFIX,
} from './github-auth.guard';
import { timingSafeEqual } from 'node:crypto';

/** Constant-time compare of two `state` halves (never leak by timing). */
function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

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
    // The guard injects the OAuth `state` via __oauthState — a stored token
    // for CLI mode, a cookie-backed one for the browser — and handles the
    // redirect itself.
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
    // Validated before the user is touched: a callback we did not start is
    // not a login, whichever flow it claims to be.
    const cliState = this.verifyCallbackState(req, res, stateToken);

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

    if (cliState) {
      const port = cliState.port;
      if (port < 1024 || port > 65535) {
        throw new BadRequestException('Invalid CLI port');
      }
      const code = this.cliAuthStore.createCode(user.id, cliState.codeChallenge);
      // Echo the CLI's nonce back as `state`. Its localhost callback port
      // is guessable, so this is what lets the CLI tell a code from its own
      // flow apart from one an attacker pushed at that port.
      const stateEcho = `&state=${encodeURIComponent(cliState.nonce)}`;
      return res.redirect(
        `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(code)}${stateEcho}`,
      );
    }

    // Default web flow: set cookies and redirect to frontend.
    const tokens = this.authService.createTokens(user);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return res.redirect(this.configService.get('FRONTEND_URL')!);
  }

  /**
   * Validate the `state` GitHub handed back, and say which flow it belongs to.
   *
   * Returns the consumed CLI state for a CLI login, or `undefined` for a
   * browser one. Every authorization request `GitHubAuthGuard` starts carries
   * a `state` — a store-backed token for the CLI, a `w.`-prefixed half of a
   * double-submit cookie for the browser — so a callback with none did not
   * come from a login this server began and is refused rather than completed
   * (forced-login CSRF).
   *
   * Both flows are cookie-bound, and for the same reason: a `state` alone
   * says a login was started somewhere, not that it was started by the
   * browser now completing it. For the CLI that gap is the worse of the two —
   * an attacker mints a state pointing at a loopback port they own and walks
   * the victim through consent, ending up with a code for the victim's
   * account that their own CLI redeems.
   */
  private verifyCallbackState(
    req: Request,
    res: Response,
    stateToken: string | undefined,
  ): { port: number; nonce: string; codeChallenge: string } | undefined {
    if (stateToken?.startsWith(WEB_STATE_PREFIX)) {
      const presented = stateToken.slice(WEB_STATE_PREFIX.length);
      const expected = this.takeStateCookie(req, res);
      if (typeof expected !== 'string' || !secretEquals(expected, presented)) {
        throw new UnauthorizedException(
          'Login session expired or invalid. Please sign in again.',
        );
      }
      return undefined;
    }

    if (stateToken) {
      const state = this.cliAuthStore.consumeState(stateToken);
      const binding = this.takeStateCookie(req, res);
      if (
        state &&
        state.mode === 'cli' &&
        typeof binding === 'string' &&
        secretEquals(state.browserBinding, binding)
      ) {
        return state;
      }

      // State token was provided but invalid, expired, or presented by a
      // browser other than the one that started the login. This is a CLI flow
      // that failed. Return an error instead of falling through to web flow.
      throw new BadRequestException(
        'CLI login state expired or invalid. Please run `wafflebase login` again.',
      );
    }

    throw new UnauthorizedException(
      'Login session expired or invalid. Please sign in again.',
    );
  }

  /**
   * Read the login `state` cookie and clear it in the same breath.
   *
   * Single use: it goes whether or not it matched, so a failed callback
   * cannot be retried against the same half.
   */
  private takeStateCookie(req: Request, res: Response): unknown {
    const value = req.cookies?.[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, {
      ...this.baseCookieOptions(),
      path: '/auth',
    });
    return value;
  }

  /**
   * Redeem a CLI authorization code.
   *
   * Unauthenticated by necessity — the CLI has no credential yet — so the
   * code must not be a plain bearer. A login that started with a PKCE
   * challenge (RFC 7636) only redeems against the matching `codeVerifier`,
   * which never left the CLI process; a leaked or intercepted code is then
   * useless to whoever holds it. A code from a CLI that sent no challenge
   * stays redeemable on its own, so older clients keep working — but a
   * caller that presents a verifier against such a code is refused
   * (RFC 7636 §4.6), so an unchallenged login cannot be passed off to a
   * PKCE-capable CLI.
   */
  @Post('cli/exchange')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async cliExchange(@Body() body: CliExchangeDto) {
    const userId = this.cliAuthStore.consumeCode(body.code, body.codeVerifier);
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    };
  }
}
