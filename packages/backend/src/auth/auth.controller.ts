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
  OAuthFlow,
  baseCookieOptions,
  oauthStateCookieName,
  oauthStateCookieOptions,
} from './cookies';
import { timingSafeEqual } from 'node:crypto';

const ACCESS_COOKIE_NAME = 'wafflebase_session';
const REFRESH_COOKIE_NAME = 'wafflebase_refresh';
const DEFAULT_ACCESS_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compare two secrets without leaking their common prefix through timing.
 * `timingSafeEqual` throws on a length mismatch, so the lengths are
 * compared first — that much is public, and the values here are
 * fixed-length anyway.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

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
    // NOTE(hackerwins): Redirect to GitHub for authentication. The guard
    // mints the `state` (`req.__oauthState`) and handles the redirect —
    // a random value for the web flow, a CLI state token for `?mode=cli`
    // — and mirrors either into that flow's own cookie. Both are
    // verified against the cookie in the callback below.
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
    // Which flow this is, decided BEFORE a user is touched: a callback
    // that cannot prove it belongs to a login this backend started must
    // not create an account as a side effect of being rejected.
    const cliState = stateToken
      ? this.cliAuthStore.consumeState(stateToken)
      : undefined;
    this.consumeOAuthState(
      req,
      res,
      stateToken,
      cliState?.mode === 'cli' ? 'cli' : 'web',
    );

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

    if (cliState?.mode === 'cli') {
      const port = cliState.port;
      if (port < 1024 || port > 65535) {
        throw new BadRequestException('Invalid CLI port');
      }
      const code = this.cliAuthStore.createCode(user.id);
      // Echo the CLI's nonce so it can tell this callback from one
      // injected by another local process or a web page that guessed
      // the port (see `packages/cli/src/commands/login.ts`).
      const nonceParam = cliState.nonce
        ? `&nonce=${encodeURIComponent(cliState.nonce)}`
        : '';
      return res.redirect(
        `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(code)}${nonceParam}`,
      );
    }

    // Web flow: set cookies and redirect to frontend.
    const tokens = this.authService.createTokens(user);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return res.redirect(this.configService.get('FRONTEND_URL')!);
  }

  @Post('cli/exchange')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async cliExchange(@Body() body: CliExchangeDto) {
    const userId = this.cliAuthStore.consumeCode(body.code);
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
   * Spend the flow's OAuth `state`, refusing a callback that is not the
   * one this browser started.
   *
   * Without it the callback accepts any `?code=` presented to it: an
   * attacker mints a code against their own GitHub account, gets the
   * victim's browser to load the callback with it, and the victim is
   * silently seated inside the attacker's account (OAuth login CSRF /
   * session fixation) — everything they then write goes to the attacker.
   * The CLI flow is bound the same way, one cookie per flow, so a state
   * token seen elsewhere cannot be replayed into a victim's browser.
   *
   * The cookie is cleared whatever the outcome, so a state that has been
   * presented once cannot be replayed. A callback carrying no `state` at
   * all lands here too and is refused: after this change every login
   * this backend starts carries one, so its absence means the request
   * did not come from one (or predates a deploy, which costs one retry).
   */
  private consumeOAuthState(
    req: Request,
    res: Response,
    stateToken: string | undefined,
    flow: OAuthFlow,
  ) {
    const name = oauthStateCookieName(flow);
    const cookie: unknown = req.cookies?.[name];
    res.clearCookie(name, oauthStateCookieOptions());

    if (
      !stateToken ||
      typeof cookie !== 'string' ||
      !timingSafeEqualString(cookie, stateToken)
    ) {
      throw new BadRequestException(
        'Login state expired or invalid. Please start the login again (run `wafflebase login` again for the CLI).',
      );
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
    // Shared with `GitHubAuthGuard`'s OAuth state cookie — one definition,
    // so the state cookie can never drift into weaker attributes than the
    // session it protects.
    return baseCookieOptions();
  }
}
