import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { Request, Response } from 'express';
import { UserService } from 'src/user/user.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CliAuthStore } from './cli-auth.store';
import { bindingSecret, stateSignature } from './github-auth.guard';
import { JwtStrategy } from './jwt.strategy';

function createMockResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    sendStatus: jest.fn(),
    redirect: jest.fn(),
    json: jest.fn(),
    type: jest.fn(),
    set: jest.fn(),
    send: jest.fn(),
  } as unknown as Response;
}

describe('AuthController', () => {
  const authService = {
    createTokens: jest.fn(),
    verifyRefreshToken: jest.fn(),
  } as unknown as AuthService;

  const userService = {
    user: jest.fn(),
    findOrCreateUser: jest.fn(),
  } as unknown as UserService;

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'FRONTEND_URL') return 'http://localhost:5173';
      if (key === 'JWT_SECRET') return 'test-secret';
      if (key === 'JWT_ACCESS_COOKIE_MAX_AGE_MS') return '1000';
      if (key === 'JWT_REFRESH_COOKIE_MAX_AGE_MS') return '2000';
      return undefined;
    }),
  } as unknown as ConfigService;

  const cliAuthStore = new CliAuthStore();

  const controller = new AuthController(
    authService,
    userService,
    configService,
    cliAuthStore,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears both cookies on logout', async () => {
    const res = createMockResponse();
    (res.sendStatus as jest.Mock).mockReturnValue(undefined);

    await controller.logout(res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'wafflebase_session',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'wafflebase_refresh',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('refreshes cookies when refresh token is valid', async () => {
    const req = {
      cookies: {
        wafflebase_refresh: 'refresh-token',
      },
    } as unknown as Request;
    const res = createMockResponse();
    (res.sendStatus as jest.Mock).mockReturnValue(undefined);
    (authService.verifyRefreshToken as jest.Mock).mockReturnValue({ sub: 7 });
    (userService.user as jest.Mock).mockResolvedValue({
      id: 7,
      authProvider: 'github',
      username: 'alice',
      email: 'alice@example.com',
      photo: null,
    });
    (authService.createTokens as jest.Mock).mockReturnValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token-next',
    });

    await controller.refresh(req, res);

    expect(authService.verifyRefreshToken).toHaveBeenCalledWith('refresh-token');
    expect(userService.user).toHaveBeenCalledWith({ id: 7 });
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_session',
      'access-token',
      expect.objectContaining({ maxAge: 1000 }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_refresh',
      'refresh-token-next',
      expect.objectContaining({ maxAge: 2000 }),
    );
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('rejects refresh requests without refresh cookie', async () => {
    const req = {
      cookies: {},
    } as unknown as Request;
    const res = createMockResponse();

    await expect(controller.refresh(req, res)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(res.clearCookie).toHaveBeenCalledWith(
      'wafflebase_session',
      expect.any(Object),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'wafflebase_refresh',
      expect.any(Object),
    );
  });

  it('returns JSON tokens when refresh token is provided in body (no cookie)', async () => {
    const req = {
      cookies: {},
      body: { refreshToken: 'body-refresh-token' },
    } as unknown as Request;
    const res = createMockResponse();
    (res.json as jest.Mock).mockReturnValue(undefined);
    (authService.verifyRefreshToken as jest.Mock).mockReturnValue({ sub: 7 });
    (userService.user as jest.Mock).mockResolvedValue({
      id: 7,
      authProvider: 'github',
      username: 'alice',
      email: 'alice@example.com',
      photo: null,
    });
    (authService.createTokens as jest.Mock).mockReturnValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });

    await controller.refresh(req, res);

    expect(authService.verifyRefreshToken).toHaveBeenCalledWith(
      'body-refresh-token',
    );
    expect(res.json).toHaveBeenCalledWith({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
    // Should NOT set cookies for body-based flow
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.sendStatus).not.toHaveBeenCalled();
  });

  it('rejects refresh when body token is invalid', async () => {
    const req = {
      cookies: {},
      body: { refreshToken: 'bad-body-token' },
    } as unknown as Request;
    const res = createMockResponse();
    (authService.verifyRefreshToken as jest.Mock).mockImplementation(() => {
      throw new Error('invalid token');
    });

    await expect(controller.refresh(req, res)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(res.json).not.toHaveBeenCalled();
    expect(res.sendStatus).not.toHaveBeenCalled();
  });

  describe('githubAuthCallback — CLI flow', () => {
    const mockUser = {
      id: 42,
      authProvider: 'github',
      username: 'bob',
      email: 'bob@example.com',
      photo: null,
    };

    const CHALLENGE_VERIFIER = randomBytes(32).toString('base64url');
    const CHALLENGE = createHash('sha256')
      .update(CHALLENGE_VERIFIER)
      .digest('base64url');

    /**
     * Start a CLI login the way `GitHubAuthGuard` does — every binding filled
     * in, including the cookie half that ties it to one browser — and return
     * both the `state` GitHub would hand back and a request carrying that
     * browser's cookie.
     */
    function startCliLogin(
      over: Partial<{
        port: number;
        nonce: string;
        codeChallenge: string;
        browserBinding: string;
      }> = {},
    ) {
      const browserBinding =
        over.browserBinding ?? randomBytes(32).toString('base64url');
      const { stateToken } = cliAuthStore.createState({
        mode: 'cli',
        port: over.port ?? 9876,
        browserBinding,
        nonce: over.nonce ?? 'n0nce-x/y',
        codeChallenge: over.codeChallenge ?? CHALLENGE,
      });
      return {
        stateToken,
        browserBinding,
        // `null` means "this browser has no state cookie" — distinct from
        // omitting the argument, which is the matching cookie.
        request: (cookieValue: string | null = browserBinding) =>
          ({
            user: { username: 'bob', email: 'bob@example.com', photo: null },
            query: { state: stateToken },
            cookies: cookieValue
              ? { wafflebase_cli_state: cookieValue }
              : {},
          }) as unknown as Request,
      };
    }

    it('redirects to CLI localhost when state is a valid CLI token', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const login = startCliLogin();
      const res = createMockResponse();

      await controller.githubAuthCallback(
        login.request() as any,
        res,
        login.stateToken,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringMatching(/^http:\/\/127\.0\.0\.1:9876\/callback\?code=.+/),
      );
      // Should NOT set session cookies for CLI flow
      expect(res.cookie).not.toHaveBeenCalled();
      // The state cookie is single-use and cleared on the way through.
      expect(res.clearCookie).toHaveBeenCalledWith(
        'wafflebase_cli_state',
        expect.objectContaining({ path: '/' }),
      );
    });

    // The nonce and the PKCE verifier are both held by whoever *starts* the
    // login, so neither stops an attacker minting a state that points at a
    // loopback port they own and walking the victim through consent. The
    // cookie is what says this browser began this login.
    it('refuses a CLI callback presented by a different browser', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const login = startCliLogin();
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(
          login.request(randomBytes(32).toString('base64url')) as any,
          res,
          login.stateToken,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(res.redirect).not.toHaveBeenCalled();
      // Refused before any user record is touched.
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
    });

    it('refuses a CLI callback that carries no state cookie at all', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const login = startCliLogin();
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(
          login.request(null) as any,
          res,
          login.stateToken,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(res.redirect).not.toHaveBeenCalled();
    });

    // A refused callback must not leave the browser half spendable on a
    // retry, so the cookie is cleared whether or not it matched.
    it('clears the state cookie even when the CLI callback is refused', async () => {
      const login = startCliLogin();
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(
          login.request('not-the-binding') as any,
          res,
          login.stateToken,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(res.clearCookie).toHaveBeenCalledWith(
        'wafflebase_cli_state',
        expect.objectContaining({ path: '/' }),
      );
    });

    // The CLI's callback port is guessable, so it only redeems a code whose
    // `state` echoes the nonce it minted. Drop the echo and any page in the
    // user's browser could feed the terminal someone else's code.
    it('echoes the CLI nonce back as `state`', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const login = startCliLogin({ nonce: 'n0nce-x/y' });
      const res = createMockResponse();

      await controller.githubAuthCallback(
        login.request() as any,
        res,
        login.stateToken,
      );

      const target = (res.redirect as jest.Mock).mock.calls[0][0] as string;
      expect(new URL(target).searchParams.get('state')).toBe('n0nce-x/y');
    });

    // The state the guard stored is what makes the exchange PKCE-bound: drop
    // it here and the minted code is a plain bearer, redeemable by whoever
    // lifts it off the loopback redirect, with every other test still green.
    it('carries the login`s PKCE challenge onto the code it mints', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const first = startCliLogin();
      const res = createMockResponse();
      await controller.githubAuthCallback(
        first.request() as any,
        res,
        first.stateToken,
      );

      const code = new URL(
        (res.redirect as jest.Mock).mock.calls[0][0] as string,
      ).searchParams.get('code')!;
      expect(cliAuthStore.consumeCode(code, 'not-the-verifier')).toBeUndefined();

      const second = startCliLogin();
      const res2 = createMockResponse();
      await controller.githubAuthCallback(
        second.request() as any,
        res2,
        second.stateToken,
      );
      const code2 = new URL(
        (res2.redirect as jest.Mock).mock.calls[0][0] as string,
      ).searchParams.get('code')!;
      expect(cliAuthStore.consumeCode(code2, CHALLENGE_VERIFIER)).toBe(
        mockUser.id,
      );
    });
  });

  // A browser login now carries a `state` too — half of it in the query, half
  // in a cookie. Without it the callback completed any GitHub redirect,
  // letting an attacker have the victim's browser issued cookies for the
  // attacker's account (forced-login CSRF).
  describe('githubAuthCallback — browser flow', () => {
    const mockUser = {
      id: 42,
      authProvider: 'github',
      username: 'bob',
      email: 'bob@example.com',
      photo: null,
    };

    function webRequest(cookieValue?: string): Request {
      return {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        query: {},
        cookies: cookieValue ? { wafflebase_oauth_state: cookieValue } : {},
      } as unknown as Request;
    }

    /**
     * The `state` GitHub hands back for a cookie holding `value`.
     *
     * Signed with the *derived* binding key, not `JWT_SECRET` — see
     * `bindingSecret`. Deriving it here rather than hard-coding a signature
     * is what keeps this from passing if the two ends ever disagree.
     */
    function webState(value: string): string {
      return `${'w.'}${stateSignature(bindingSecret(configService), value)}`;
    }

    it('completes the web flow when the state matches its cookie', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      const value = randomBytes(32).toString('base64url');
      const res = createMockResponse();

      await controller.githubAuthCallback(
        webRequest(value) as any,
        res,
        webState(value),
      );

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173');
      expect(res.cookie).toHaveBeenCalledTimes(2);
      // Single use: the state cookie is cleared on the way through.
      expect(res.clearCookie).toHaveBeenCalledWith(
        'wafflebase_oauth_state',
        expect.objectContaining({ path: '/' }),
      );
    });

    // The two flows start independently and one browser can hold both — a
    // `wafflebase login` run while a sign-in waits on GitHub's consent
    // screen. When they shared a cookie name the second start overwrote the
    // first's binding, so the first callback was refused as a forgery and the
    // person was bounced to `/login?error=login_state` for no visible reason.
    it('completes a browser login while a CLI login is also in flight', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      const webValue = randomBytes(32).toString('base64url');
      const cliValue = randomBytes(32).toString('base64url');
      const res = createMockResponse();
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        query: {},
        cookies: {
          wafflebase_oauth_state: webValue,
          wafflebase_cli_state: cliValue,
        },
      } as unknown as Request;

      await controller.githubAuthCallback(req as any, res, webState(webValue));

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173');
      expect(res.cookie).toHaveBeenCalledTimes(2);
      // And the CLI login it was racing is left intact: only the web flow's
      // own half is spent.
      expect(res.clearCookie).toHaveBeenCalledWith(
        'wafflebase_oauth_state',
        expect.objectContaining({ path: '/' }),
      );
      expect(res.clearCookie).not.toHaveBeenCalledWith(
        'wafflebase_cli_state',
        expect.anything(),
      );
    });

    // Separate cookie names cover web-vs-CLI, but two logins of the *same*
    // flow (the login page opened in two tabs) shared one value: the second
    // start overwrote the first's binding and the first callback was refused
    // as a forgery. The cookie now carries both, and a callback spends only
    // the one it matched.
    it('completes the older of two browser logins in one browser', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      const older = randomBytes(32).toString('base64url');
      const newer = randomBytes(32).toString('base64url');
      const res = createMockResponse();

      await controller.githubAuthCallback(
        webRequest(`${older}.${newer}`) as any,
        res,
        webState(older),
      );

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173');
      // The other tab's login survives: its binding is written back, and the
      // cookie is not cleared out from under it.
      expect(res.cookie).toHaveBeenCalledWith(
        'wafflebase_oauth_state',
        newer,
        expect.objectContaining({ path: '/' }),
      );
      expect(res.clearCookie).not.toHaveBeenCalledWith(
        'wafflebase_oauth_state',
        expect.anything(),
      );
    });

    // Echoing the cookie's value would let a `state` this server never issued
    // be presented against a planted cookie; the query half is its HMAC.
    it('refuses a state that merely copies the cookie value', async () => {
      const res = createMockResponse();
      const value = randomBytes(32).toString('base64url');

      await controller.githubAuthCallback(
        webRequest(value) as any,
        res,
        `w.${value}`,
      );

      expect(res.cookie).not.toHaveBeenCalled();
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
    });

    // A refused browser callback is a top-level navigation, so it goes back
    // to the login page with a reason rather than rendering a JSON 401 the
    // person cannot act on. No session is issued either way.
    it('refuses a callback whose state does not match the cookie', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      const res = createMockResponse();

      await controller.githubAuthCallback(
        webRequest(randomBytes(32).toString('base64url')) as any,
        res,
        webState(randomBytes(32).toString('base64url')),
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/login?error=login_state',
      );
      expect(res.cookie).not.toHaveBeenCalled();
      // The user is never even looked up for a callback we did not start.
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
    });

    it('refuses a callback that carries no state at all', async () => {
      const res = createMockResponse();

      await controller.githubAuthCallback(
        webRequest() as any,
        res,
        undefined,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/login?error=login_state',
      );
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('refuses a web state when the cookie is missing', async () => {
      const res = createMockResponse();

      await controller.githubAuthCallback(
        webRequest() as any,
        res,
        webState(randomBytes(32).toString('base64url')),
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/login?error=login_state',
      );
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  // A CLI start is an unauthenticated link anyone can write, pointing `port`
  // at a listener they own. The guard stops it here instead of redirecting to
  // GitHub, and the controller renders the page that asks.
  describe('GET /auth/github — CLI consent page', () => {
    const consentRequest = () =>
      ({
        path: '/auth/github',
        __cliConsent: {
          port: 9876,
          nonce: 'n0nce-x/y',
          codeChallenge: 'c'.repeat(43),
          confirmToken: 'tok-123',
        },
      }) as unknown as Request;

    /** The `href` of the page's Continue link, unescaped back to a URL. */
    const continueLink = (html: string): URL => {
      const href = /href="([^"]+)"/.exec(html)?.[1] ?? '';
      const unescaped = href
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      return new URL(unescaped, 'http://backend.test');
    };

    const renderConsent = async () => {
      const res = createMockResponse();
      (res.type as jest.Mock).mockReturnValue(res);
      (res.set as jest.Mock).mockReturnValue(res);

      await controller.githubAuth(consentRequest(), res);

      return { res, html: (res.send as jest.Mock).mock.calls[0][0] as string };
    };

    it('renders the interstitial instead of starting the login', async () => {
      const { html } = await renderConsent();

      // The port is named, because it is the one thing that tells a genuine
      // `wafflebase login` apart from an attacker's link.
      expect(html).toContain('http://127.0.0.1:9876');
      // Continuing carries the token the same response set as a cookie.
      expect(html).toContain('cli_confirm=tok-123');
      expect(html).toContain('/auth/github?mode=cli&amp;port=9876');
    });

    // Continuing re-enters the very route that stopped here, so the link has
    // to carry *every* binding the guard requires — drop `nonce` or
    // `code_challenge` and the guard answers 400, i.e. no CLI login can ever
    // complete. Asserting only `mode`/`port`/`cli_confirm` would let that
    // ship green, so the whole query is pinned.
    it('carries every binding the guard requires on the continue link', async () => {
      const { html } = await renderConsent();

      const link = continueLink(html);
      expect(link.pathname).toBe('/auth/github');
      expect(Object.fromEntries(link.searchParams)).toEqual({
        mode: 'cli',
        port: '9876',
        nonce: 'n0nce-x/y',
        code_challenge: 'c'.repeat(43),
        cli_confirm: 'tok-123',
      });
    });

    // The page's whole defence is a deliberate human click, which an overlay
    // in a frame can steal. `SameSite=Lax` on the confirm cookie only covers
    // the cross-site framer; frontend and backend are expected to share
    // eTLD+1 here, so a same-site page could frame it. There is no helmet in
    // this app, so the response says so itself. It also embeds a single-use
    // confirm token, hence `no-store`.
    it('refuses to be framed and refuses to be cached', async () => {
      const { res } = await renderConsent();

      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "frame-ancestors 'none'",
          'Cache-Control': 'no-store',
        }),
      );
    });

    it('does nothing for an ordinary start (the guard already redirected)', async () => {
      const res = createMockResponse();
      await controller.githubAuth({ path: '/auth/github' } as any, res);
      expect(res.send).not.toHaveBeenCalled();
    });
  });

  describe('cookie SameSite policy', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('sets SameSite=Lax with secure=true in production', async () => {
      process.env.NODE_ENV = 'production';
      const res = createMockResponse();

      await controller.logout(res);

      expect(res.clearCookie).toHaveBeenCalledTimes(2);
      for (const call of (res.clearCookie as jest.Mock).mock.calls) {
        const [, options] = call;
        expect(options).toMatchObject({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        });
      }
    });

    it('sets SameSite=Lax with secure=false outside production', async () => {
      process.env.NODE_ENV = 'development';
      const res = createMockResponse();

      await controller.logout(res);

      for (const call of (res.clearCookie as jest.Mock).mock.calls) {
        const [, options] = call;
        expect(options).toMatchObject({
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
        });
      }
    });

    // The shipped image sets `NODE_ENV=production`; a self-hosted install may
    // still be served over plain http. A `Secure` session cookie there is not
    // a stricter session but no session at all — the browser drops it — so a
    // login that finally passed its state check would still land logged out.
    // The configured callback scheme decides, exactly as it does for the
    // login cookies.
    it('sets secure=false on a plain-http production deployment', async () => {
      process.env.NODE_ENV = 'production';
      const httpConfig = {
        get: jest.fn((key: string) =>
          key === 'GITHUB_CALLBACK_URL'
            ? 'http://app.example.test/auth/github/callback'
            : key === 'FRONTEND_URL'
              ? 'http://app.example.test'
              : undefined,
        ),
      } as unknown as ConfigService;
      const httpController = new AuthController(
        authService,
        userService,
        httpConfig,
        cliAuthStore,
      );
      const res = createMockResponse();

      await httpController.logout(res);

      for (const call of (res.clearCookie as jest.Mock).mock.calls) {
        const [, options] = call;
        expect(options).toMatchObject({ httpOnly: true, secure: false });
      }
    });

    it('never sets SameSite=None on auth cookies', async () => {
      for (const env of ['production', 'staging', 'development', 'test']) {
        process.env.NODE_ENV = env;
        const res = createMockResponse();

        await controller.logout(res);

        for (const call of (res.clearCookie as jest.Mock).mock.calls) {
          const [, options] = call;
          expect(options.sameSite).not.toBe('none');
        }
      }
    });
  });

  describe('POST /auth/cli/exchange', () => {
    const mockUser = {
      id: 42,
      authProvider: 'github',
      username: 'bob',
      email: 'bob@example.com',
      photo: null,
    };

    it('returns tokens for a valid code', async () => {
      const code = cliAuthStore.createCode(42);
      (userService.user as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
      });

      const result = await controller.cliExchange({ code });

      expect(result).toEqual({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
      });
      expect(userService.user).toHaveBeenCalledWith({ id: 42 });
    });

    it('rejects an invalid code with 401', async () => {
      await expect(
        controller.cliExchange({ code: 'bad-code' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    // The exchange is unauthenticated, so a code minted under PKCE must not
    // be a bearer: only the CLI that holds the verifier can spend it.
    describe('PKCE binding', () => {
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url');

      beforeEach(() => {
        (userService.user as jest.Mock).mockResolvedValue(mockUser);
        (authService.createTokens as jest.Mock).mockReturnValue({
          accessToken: 'at',
          refreshToken: 'rt',
        });
      });

      it('redeems a challenged code for the matching verifier', async () => {
        const code = cliAuthStore.createCode(42, challenge);
        await expect(
          controller.cliExchange({ code, codeVerifier: verifier }),
        ).resolves.toEqual({ accessToken: 'at', refreshToken: 'rt' });
      });

      it('refuses a challenged code presented with no verifier', async () => {
        const code = cliAuthStore.createCode(42, challenge);
        await expect(controller.cliExchange({ code })).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('refuses a challenged code presented with a wrong verifier', async () => {
        const code = cliAuthStore.createCode(42, challenge);
        await expect(
          controller.cliExchange({
            code,
            codeVerifier: randomBytes(32).toString('base64url'),
          }),
        ).rejects.toThrow(UnauthorizedException);
      });

      // RFC 7636 §4.6. Without this an attacker can start an *unchallenged*
      // login at the victim's callback port and nonce, and the victim's
      // PKCE-capable CLI spends the attacker's code — verifier and all —
      // binding the terminal to the attacker's account.
      it('refuses an unchallenged code when a verifier is presented', async () => {
        const code = cliAuthStore.createCode(42);
        await expect(
          controller.cliExchange({ code, codeVerifier: verifier }),
        ).rejects.toThrow(UnauthorizedException);
        // And the attempt burned it, so it cannot be retried bare either.
        await expect(controller.cliExchange({ code })).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('burns a challenged code even when the verifier is wrong', async () => {
        const code = cliAuthStore.createCode(42, challenge);
        await expect(
          controller.cliExchange({ code, codeVerifier: 'nope' }),
        ).rejects.toThrow(UnauthorizedException);
        // A failed guess must not leave the code spendable on a retry.
        await expect(
          controller.cliExchange({ code, codeVerifier: verifier }),
        ).rejects.toThrow(UnauthorizedException);
      });
    });

    it('rejects the same code on second use', async () => {
      const code = cliAuthStore.createCode(42);
      (userService.user as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      // First use succeeds
      await controller.cliExchange({ code });

      // Second use fails (code consumed)
      await expect(controller.cliExchange({ code })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});

describe('JwtStrategy', () => {
  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret';
      return undefined;
    }),
  } as unknown as ConfigService;

  it('extracts JWT from wafflebase_session cookie', () => {
    const strategy = new JwtStrategy(mockConfigService);
    const req = {
      cookies: { wafflebase_session: 'cookie-token' },
      headers: {},
    } as unknown as Request;

    // Access the internal _jwtFromRequest extractor
    const extractor = (strategy as any)._jwtFromRequest;
    const token = extractor(req);

    expect(token).toBe('cookie-token');
  });

  it('extracts JWT from Authorization Bearer header', () => {
    const strategy = new JwtStrategy(mockConfigService);
    const req = {
      cookies: {},
      headers: { authorization: 'Bearer bearer-token' },
    } as unknown as Request;

    const extractor = (strategy as any)._jwtFromRequest;
    const token = extractor(req);

    expect(token).toBe('bearer-token');
  });

  it('prefers cookie over Authorization Bearer header when both present', () => {
    const strategy = new JwtStrategy(mockConfigService);
    const req = {
      cookies: { wafflebase_session: 'cookie-token' },
      headers: { authorization: 'Bearer bearer-token' },
    } as unknown as Request;

    const extractor = (strategy as any)._jwtFromRequest;
    const token = extractor(req);

    expect(token).toBe('cookie-token');
  });
});
