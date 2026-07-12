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
   * (existence, expiry, document match, role) via `ShareLinkService`.
   */
  @Get('yorkie-token/share')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getYorkieShareToken(@Query('token') shareToken: string | undefined) {
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
    // For CLI mode, the state token is injected in the guard via
    // __cliStateToken (see below). The guard handles the redirect.
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

    // Check if this is a CLI OAuth flow by consuming the state token.
    if (stateToken) {
      const state = this.cliAuthStore.consumeState(stateToken);
      if (state && state.mode === 'cli') {
        const port = state.port;
        if (port < 1024 || port > 65535) {
          throw new BadRequestException('Invalid CLI port');
        }
        const code = this.cliAuthStore.createCode(user.id);
        return res.redirect(
          `http://127.0.0.1:${port}/callback?code=${encodeURIComponent(code)}`,
        );
      }

      // State token was provided but invalid/expired — this is a CLI flow
      // that failed. Return an error instead of falling through to web flow.
      throw new BadRequestException(
        'CLI login state expired or invalid. Please run `wafflebase login` again.',
      );
    }

    // Default web flow: set cookies and redirect to frontend.
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
