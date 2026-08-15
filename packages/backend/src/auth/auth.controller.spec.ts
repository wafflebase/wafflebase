import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { UserService } from 'src/user/user.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CliAuthStore } from './cli-auth.store';
import { JwtStrategy } from './jwt.strategy';

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

      const { stateToken } = cliAuthStore.createState('cli', 9876);
      const req = {
        user: {
          username: 'bob',
          email: 'bob@example.com',
          photo: null,
        },
        query: { state: stateToken },
        cookies: { wafflebase_cli_oauth_state: stateToken },
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

    it('echoes the CLI nonce so the CLI can bind the callback', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const { stateToken } = cliAuthStore.createState('cli', 9876, 'nonce-abc');
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        query: { state: stateToken },
        cookies: { wafflebase_cli_oauth_state: stateToken },
      } as unknown as Request;
      const res = createMockResponse();

      await controller.githubAuthCallback(req as any, res, stateToken);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('&nonce=nonce-abc'),
      );
    });

    it('refuses a CLI callback that this browser did not start', async () => {
      // The state token alone is not proof: it travels in the printed
      // OAuth URL, so a shared terminal or a CI log leaks it. Replaying
      // it in a victim's browser must not mint a code for the port the
      // attacker chose.
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const { stateToken } = cliAuthStore.createState('cli', 9876, 'nonce-abc');
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        query: { state: stateToken },
        cookies: {},
      } as unknown as Request;
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(req as any, res, stateToken),
      ).rejects.toThrow(BadRequestException);

      expect(res.redirect).not.toHaveBeenCalled();
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith(
        'wafflebase_cli_oauth_state',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
    });

    /**
     * The web flow's own binding. Without it the callback mints a session
     * for whatever `?code=` it is handed, so an attacker's code loaded in
     * the victim's browser seats the victim inside the attacker's account.
     */
    function webRequest(cookies: Record<string, string>) {
      return {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        query: {},
        cookies,
      } as unknown as Request;
    }

    it('completes the web flow when the state matches the browser cookie', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      const req = webRequest({ wafflebase_oauth_state: 'web-state' });
      const res = createMockResponse();

      await controller.githubAuthCallback(req as any, res, 'web-state');

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173');
      expect(res.cookie).toHaveBeenCalledTimes(2);
      // Spent, so a leaked state cannot be replayed.
      expect(res.clearCookie).toHaveBeenCalledWith(
        'wafflebase_oauth_state',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
      );
    });

    // What the guard actually mints: `randomBytes(32).toString('base64url')`.
    // The attack shape is an attacker-chosen state of the *same* length as
    // the victim's cookie — a differently-sized one is refused by the
    // length check alone and never reaches the constant-time compare.
    const MINE = 'A'.repeat(43);
    const THEIRS = `${'A'.repeat(42)}B`;
    const SAME_PREFIX = `${'A'.repeat(21)}${'C'.repeat(22)}`;

    it.each([
      [
        'an equal-length state differs in its last character',
        { wafflebase_oauth_state: MINE },
        THEIRS,
      ],
      [
        'an equal-length state shares only a prefix',
        { wafflebase_oauth_state: MINE },
        SAME_PREFIX,
      ],
      ['the state is a prefix of the cookie', { wafflebase_oauth_state: MINE }, 'A'.repeat(42)],
      ['there is no state cookie', {}, THEIRS],
      ['the callback carries no state at all', { wafflebase_oauth_state: MINE }, undefined],
      ['the cookie is not a string', { wafflebase_oauth_state: 1 as unknown as string }, MINE],
    ])('refuses the web callback when %s', async (_label, cookies, state) => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(
          webRequest(cookies) as any,
          res,
          state as string | undefined,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
      // A rejected callback creates no account either.
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
      // ...and spends the state, so a near-miss cannot be retried against
      // the same cookie until one guess lands.
      expect(res.clearCookie).toHaveBeenCalledWith(
        'wafflebase_oauth_state',
        expect.objectContaining({ httpOnly: true, path: '/' }),
      );
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
