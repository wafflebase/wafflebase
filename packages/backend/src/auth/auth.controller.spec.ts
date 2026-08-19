import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { UserService } from 'src/user/user.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CliAuthStore, hashCliVerifier } from './cli-auth.store';
import { JwtStrategy } from './jwt.strategy';
import { cliStateCookieName, createWebOAuthState } from './oauth-state';

/** The PKCE pair a current CLI registers for a login attempt. */
const CLI_VERIFIER = 'v'.repeat(43);
const CLI_CHALLENGE = hashCliVerifier(CLI_VERIFIER);

function createMockResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    sendStatus: jest.fn(),
    redirect: jest.fn(),
    json: jest.fn(),
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

    it('redirects to CLI localhost when state is a valid CLI token', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const { stateToken, csrf } = cliAuthStore.createState(
        'cli',
        9876,
        undefined,
        CLI_CHALLENGE,
      );
      const req = {
        user: {
          username: 'bob',
          email: 'bob@example.com',
          photo: null,
        },
        cookies: { [cliStateCookieName()]: csrf },
        query: { state: stateToken },
      } as unknown as Request;
      const res = createMockResponse();

      await controller.githubAuthCallback(req as any, res, stateToken);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringMatching(
          /^http:\/\/127\.0\.0\.1:9876\/callback\?code=.+/,
        ),
      );
      // Should NOT set cookies for CLI flow
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('echoes the CLI nonce back as `state` on the loopback redirect', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const nonce = 'a'.repeat(64);
      const { stateToken, csrf } = cliAuthStore.createState(
        'cli',
        9876,
        nonce,
        CLI_CHALLENGE,
      );
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        cookies: { [cliStateCookieName()]: csrf },
        query: { state: stateToken },
      } as unknown as Request;
      const res = createMockResponse();

      await controller.githubAuthCallback(req as any, res, stateToken);

      // The CLI's loopback server refuses a code without this — it is
      // what stops a web page from feeding the CLI someone else's code.
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining(`&state=${nonce}`),
      );
    });

    it('omits `state` when the CLI sent no nonce', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const { stateToken, csrf } = cliAuthStore.createState(
        'cli',
        9876,
        undefined,
        CLI_CHALLENGE,
      );
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        cookies: { [cliStateCookieName()]: csrf },
        query: { state: stateToken },
      } as unknown as Request;
      const res = createMockResponse();

      await controller.githubAuthCallback(req as any, res, stateToken);

      const [url] = (res.redirect as jest.Mock).mock.calls[0] as [string];
      expect(url).not.toContain('state=');
    });

    /**
     * A code with nothing bound to it is a bearer credential, and it
     * travels to the CLI as plaintext in a loopback URL. Rather than mint
     * a weaker one for a CLI that registered no PKCE challenge, the
     * callback refuses and says why.
     */
    it('mints no code when the CLI login registered no challenge', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const { stateToken, csrf } = cliAuthStore.createState('cli', 9876);
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        cookies: { [cliStateCookieName()]: csrf },
        query: { state: stateToken },
      } as unknown as Request;
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(req as any, res, stateToken),
      ).rejects.toThrow(/proof-of-possession challenge/);
      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    /**
     * The confirmation page gates the *mint*, and an attacker can click
     * through it in their own browser: they take the `state` out of the
     * redirect to GitHub and hand the victim a bare `authorize` URL
     * carrying it. Without a browser binding the callback would then mint
     * a code for the **victim's** account, bound to the attacker's PKCE
     * challenge and posted to the attacker's loopback port — no
     * confirmation page ever shown to the victim. The state cookie is
     * what the attacker cannot put in the victim's browser.
     */
    it('mints no code for a CLI state carried into another browser', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      // Attacker's browser starts the login and keeps the cookie secret.
      const { stateToken } = cliAuthStore.createState(
        'cli',
        9876,
        undefined,
        CLI_CHALLENGE,
      );
      // Victim's browser completes it: same state, no matching cookie.
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        cookies: {},
        query: { state: stateToken },
      } as unknown as Request;
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(req as any, res, stateToken),
      ).rejects.toThrow(/different browser/);
      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('mints no code when the cookie belongs to a different attempt', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const { stateToken } = cliAuthStore.createState(
        'cli',
        9876,
        undefined,
        CLI_CHALLENGE,
      );
      const other = cliAuthStore.createState(
        'cli',
        9876,
        undefined,
        CLI_CHALLENGE,
      );
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        cookies: { [cliStateCookieName()]: other.csrf },
        query: { state: stateToken },
      } as unknown as Request;
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(req as any, res, stateToken),
      ).rejects.toThrow(/different browser/);
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  /**
   * The browser callback used to accept any code presented to it, with
   * no `state` at all — login CSRF / session fixation: an attacker
   * replays a code obtained for *their* account through the victim's
   * browser and the victim is silently signed into it. The state is a
   * double-submit pair, so a forged callback has to carry a cookie the
   * attacker cannot read or set.
   */
  describe('githubAuthCallback — web flow CSRF state', () => {
    const mockUser = {
      id: 42,
      authProvider: 'github',
      username: 'bob',
      email: 'bob@example.com',
      photo: null,
    };

    function webRequest(cookies: Record<string, string>) {
      return {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        query: {},
        cookies,
      } as unknown as Request;
    }

    beforeEach(() => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });
    });

    it('signs in when the state matches the cookie', async () => {
      const { secret, state } = createWebOAuthState();
      const res = createMockResponse();

      await controller.githubAuthCallback(
        webRequest({ wafflebase_oauth_state: secret }) as any,
        res,
        state,
      );

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173');
      expect(res.cookie).toHaveBeenCalledTimes(2);
      // The state cookie is single-use.
      expect(res.clearCookie).toHaveBeenCalledWith(
        'wafflebase_oauth_state',
        expect.any(Object),
      );
    });

    /**
     * Refusing and stranding the user are separate things. Every path
     * below issues no session — that is the CSRF property — but it also
     * has to land the browser back on the sign-in page: losing the state
     * cookie needs no attacker (it expires in ten minutes, and a second
     * login tab overwrites the first tab's), and a thrown 400 leaves the
     * user on the backend origin looking at raw JSON.
     */
    const LOGIN_ERROR_URL = 'http://localhost:5173/login?error=oauth_state';

    it('sends a callback carrying no state back to the sign-in page', async () => {
      const res = createMockResponse();

      await controller.githubAuthCallback(
        webRequest({}) as any,
        res,
        undefined,
      );

      expect(res.redirect).toHaveBeenCalledWith(LOGIN_ERROR_URL);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('sends a state that does not match the cookie back to the sign-in page', async () => {
      const { state } = createWebOAuthState();
      const other = createWebOAuthState();
      const res = createMockResponse();

      await controller.githubAuthCallback(
        webRequest({ wafflebase_oauth_state: other.secret }) as any,
        res,
        state,
      );

      expect(res.redirect).toHaveBeenCalledWith(LOGIN_ERROR_URL);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('sends a state presented without the cookie back to the sign-in page', async () => {
      const { state } = createWebOAuthState();
      const res = createMockResponse();

      await controller.githubAuthCallback(webRequest({}) as any, res, state);

      expect(res.redirect).toHaveBeenCalledWith(LOGIN_ERROR_URL);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    /**
     * `?state=a&state=b` reaches the handler as an array. It is not a
     * login this server started either, and before it was normalized it
     * reached `isWebOAuthState`, where `.startsWith` on an array threw a
     * TypeError — a 500 in place of the refusal.
     */
    it('sends a repeated state parameter back to the sign-in page', async () => {
      const { secret, state } = createWebOAuthState();
      const res = createMockResponse();

      await controller.githubAuthCallback(
        webRequest({ wafflebase_oauth_state: secret }) as any,
        res,
        [state, state] as unknown as string,
      );

      expect(res.redirect).toHaveBeenCalledWith(LOGIN_ERROR_URL);
      expect(res.cookie).not.toHaveBeenCalled();
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

    it('returns tokens for a valid code and its verifier', async () => {
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE);
      (userService.user as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
      });

      const result = await controller.cliExchange({
        code,
        verifier: CLI_VERIFIER,
      });

      expect(result).toEqual({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
      });
      expect(userService.user).toHaveBeenCalledWith({ id: 42 });
    });

    it('rejects an invalid code with 401', async () => {
      await expect(
        controller.cliExchange({ code: 'bad-code', verifier: CLI_VERIFIER }),
      ).rejects.toThrow(UnauthorizedException);
    });

    /**
     * The code arrives at the CLI over plaintext loopback HTTP, so it is
     * not a credential by itself: without the verifier its challenge was
     * derived from, it buys no session.
     */
    it('rejects a valid code presented without its verifier', async () => {
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE);
      (userService.user as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        controller.cliExchange({ code, verifier: 'w'.repeat(43) }),
      ).rejects.toThrow(UnauthorizedException);
      expect(authService.createTokens).not.toHaveBeenCalled();
    });

    it('rejects the same code on second use', async () => {
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE);
      (userService.user as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      // First use succeeds
      await controller.cliExchange({ code, verifier: CLI_VERIFIER });

      // Second use fails (code consumed)
      await expect(
        controller.cliExchange({ code, verifier: CLI_VERIFIER }),
      ).rejects.toThrow(UnauthorizedException);
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
