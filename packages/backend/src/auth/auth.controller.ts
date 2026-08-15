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
  bindingSecret,
  CLI_CONFIRM_PARAM,
  CliConsentRequest,
  GitHubAuthGuard,
  loginCookieName,
  CLI_STATE_COOKIE,
  loginCookieOptions,
  OAUTH_STATE_COOKIE,
  secretEquals,
  stateSignature,
  WEB_STATE_PREFIX,
} from './github-auth.guard';

/** Escape a value for interpolation into the consent page's HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** What a validated CLI callback needs in order to mint and deliver a code. */
interface CliCallbackState {
  port: number;
  nonce: string;
  codeChallenge: string;
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
  async githubAuth(@Req() req: Request, @Res() res: Response) {
    // NOTE(hackerwins): Redirect to GitHub for authentication.
    // The guard injects the OAuth `state` via __oauthState — a stored token
    // for CLI mode, a cookie-backed one for the browser — and handles the
    // redirect itself, so this handler only runs for the one case the guard
    // deliberately stops short of GitHub: an unconfirmed CLI start.
    const consent = (req as Request & { __cliConsent?: CliConsentRequest })
      .__cliConsent;
    if (consent) {
      return (
        res
          .type('html')
          // This page's entire defence is a deliberate human click, and a
          // click is exactly what an invisible frame can steal: overlay the
          // Continue link under something the victim means to press and the
          // confirmation is forged without them ever reading the port.
          // `SameSite=Lax` on the confirm cookie only stops a *cross-site*
          // framer, and frontend and backend are expected to share eTLD+1
          // here, so a same-site page is not covered by it. There is no
          // helmet (or any other global header layer) in this app, so the
          // response carries the refusal itself — `X-Frame-Options` for
          // older browsers, `frame-ancestors` for the ones that have moved
          // on. The markup also embeds a single-use confirm token, which no
          // shared cache should ever hand to a second person.
          .set({
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "frame-ancestors 'none'",
            'Cache-Control': 'no-store',
          })
          // Continue against this very route, so a global path prefix (or the
          // spelling the router matched) is carried over rather than guessed.
          .send(this.renderCliConsent(consent, req.path || '/auth/github'))
      );
    }
  }

  /**
   * The page a CLI login stops on before GitHub sees it.
   *
   * `?mode=cli&port=` is an unauthenticated parameter anyone can put in a
   * link, and the nonce, the PKCE challenge and the browser-binding cookie
   * are all things whoever *wrote* the link holds. What none of them covers
   * is a victim clicking an attacker's start URL: consent succeeds and the
   * code is delivered to a loopback port the attacker is listening on. So the
   * person is asked, once, with the port spelled out.
   *
   * The click is not forgeable from a link: continuing carries a token this
   * response also sets as an httpOnly cookie, so an attacker who appends
   * `cli_confirm=` to their own URL presents a value the victim's browser has
   * no cookie for.
   */
  private renderCliConsent(consent: CliConsentRequest, self: string): string {
    const params = new URLSearchParams({
      mode: 'cli',
      port: String(consent.port),
      nonce: consent.nonce,
      code_challenge: consent.codeChallenge,
      [CLI_CONFIRM_PARAM]: consent.confirmToken,
    });
    const href = escapeHtml(`${self}?${params.toString()}`);
    const port = escapeHtml(String(consent.port));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Confirm command-line sign-in</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; justify-content: center; align-items: center; min-height: 100vh;
    margin: 0; background: #fafafa; color: #1a1a1a; }
  .card { max-width: 30rem; padding: 2.5rem; background: #fff; border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04); }
  h2 { margin: 0 0 0.75rem; font-size: 1.25rem; }
  p { margin: 0 0 1rem; color: #444; font-size: 0.95rem; line-height: 1.5; }
  code { background: #f2f2f2; padding: 0.1rem 0.3rem; border-radius: 4px; }
  a.continue { display: inline-block; padding: 0.6rem 1.2rem; border-radius: 8px;
    background: #1a1a1a; color: #fff; text-decoration: none; font-size: 0.95rem; }
</style>
</head>
<body>
  <div class="card">
    <h2>Confirm command-line sign-in</h2>
    <p>A command-line application is asking to sign in to your Wafflebase
    account. If you continue, it receives access at
    <code>http://127.0.0.1:${port}</code> on this computer.</p>
    <p><strong>Only continue if you just ran <code>wafflebase login</code>
    yourself.</strong> If you got here from a link or a message, close this
    page — continuing would hand your account to whoever sent it.</p>
    <a class="continue" href="${href}">Continue sign-in</a>
  </div>
</body>
</html>`;
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
    let cliState: CliCallbackState | undefined;
    try {
      cliState = this.verifyCallbackState(req, res, stateToken);
    } catch (error) {
      // A browser lands here as a top-level navigation, so a thrown 401
      // renders as a JSON body with no way back to the app — and the common
      // cause is not an attack but a consent screen left open past the
      // five-minute cookie. Send the person to the login page with a reason;
      // no session is issued either way. A CLI failure still throws: its
      // callback is read by the CLI, not by a person.
      if (error instanceof UnauthorizedException) {
        return res.redirect(this.loginErrorUrl('login_state'));
      }
      throw error;
    }

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
  ): CliCallbackState | undefined {
    if (stateToken?.startsWith(WEB_STATE_PREFIX)) {
      const presented = stateToken.slice(WEB_STATE_PREFIX.length);
      const cookie = this.takeStateCookie(req, res, OAUTH_STATE_COOKIE);
      // The cookie is the binding; the signature only says this server issued
      // the start (see `stateSignature` — one unauthenticated request hands
      // out a matching pair, so it is no defence against cookie planting).
      const expected =
        typeof cookie === 'string'
          ? stateSignature(bindingSecret(this.configService), cookie)
          : undefined;
      if (expected === undefined || !secretEquals(expected, presented)) {
        throw new UnauthorizedException(
          'Login session expired or invalid. Please sign in again.',
        );
      }
      return undefined;
    }

    if (stateToken) {
      const state = this.cliAuthStore.consumeState(stateToken);
      const binding = this.takeStateCookie(req, res, CLI_STATE_COOKIE);
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
   * Read one flow's login `state` cookie and clear it in the same breath.
   *
   * Single use: it goes whether or not it matched, so a failed callback
   * cannot be retried against the same half. Only the flow's own cookie is
   * touched — the browser and CLI logins keep separate names precisely so
   * that one starting (or failing) does not take the other down with it.
   */
  private takeStateCookie(req: Request, res: Response, base: string): unknown {
    const name = loginCookieName(this.configService, base);
    const value = req.cookies?.[name];
    res.clearCookie(name, loginCookieOptions(this.configService));
    return value;
  }

  /**
   * Where a browser goes when its login could not be completed. The target is
   * `FRONTEND_URL` from configuration — never anything off the request — so
   * this is not a redirector an attacker can point elsewhere.
   */
  private loginErrorUrl(reason: string): string {
    const base = (this.configService.get<string>('FRONTEND_URL') ?? '').replace(
      /\/$/,
      '',
    );
    return `${base}/login?error=${encodeURIComponent(reason)}`;
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
