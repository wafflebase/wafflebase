import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
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

    // The CLI's callback port is guessable, so it only redeems a code whose
    // `state` echoes the nonce it minted. Drop the echo and any page in the
    // user's browser could feed the terminal someone else's code.
    it('echoes the CLI nonce back as `state`', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const { stateToken } = cliAuthStore.createState('cli', 9876, 'n0nce-x/y');
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        query: { state: stateToken },
      } as unknown as Request;
      const res = createMockResponse();

      await controller.githubAuthCallback(req as any, res, stateToken);

      const target = (res.redirect as jest.Mock).mock.calls[0][0] as string;
      expect(new URL(target).searchParams.get('state')).toBe('n0nce-x/y');
    });

    // The state the guard stored is what makes the exchange PKCE-bound: drop
    // it here and the minted code is a plain bearer, redeemable by whoever
    // lifts it off the loopback redirect, with every other test still green.
    it('carries the login`s PKCE challenge onto the code it mints', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url');
      const { stateToken } = cliAuthStore.createState(
        'cli',
        9876,
        undefined,
        challenge,
      );
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        query: { state: stateToken },
      } as unknown as Request;
      const res = createMockResponse();

      await controller.githubAuthCallback(req as any, res, stateToken);

      const target = new URL(
        (res.redirect as jest.Mock).mock.calls[0][0] as string,
      );
      const code = target.searchParams.get('code')!;
      // No `state` echo — this login sent no nonce — but the code is bound.
      expect(target.searchParams.get('state')).toBeNull();
      expect(cliAuthStore.consumeCode(code, 'not-the-verifier')).toBeUndefined();

      const { stateToken: second } = cliAuthStore.createState(
        'cli',
        9876,
        undefined,
        challenge,
      );
      const res2 = createMockResponse();
      await controller.githubAuthCallback(
        { ...req, query: { state: second } } as any,
        res2,
        second,
      );
      const code2 = new URL(
        (res2.redirect as jest.Mock).mock.calls[0][0] as string,
      ).searchParams.get('code')!;
      expect(cliAuthStore.consumeCode(code2, verifier)).toBe(mockUser.id);
    });

    it('mints an unchallenged code when the login carried no challenge', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);

      const { stateToken } = cliAuthStore.createState('cli', 9876);
      const req = {
        user: { username: 'bob', email: 'bob@example.com', photo: null },
        query: { state: stateToken },
      } as unknown as Request;
      const res = createMockResponse();

      await controller.githubAuthCallback(req as any, res, stateToken);

      const code = new URL(
        (res.redirect as jest.Mock).mock.calls[0][0] as string,
      ).searchParams.get('code')!;
      expect(cliAuthStore.consumeCode(code)).toBe(mockUser.id);
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
        `w.${value}`,
      );

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173');
      expect(res.cookie).toHaveBeenCalledTimes(2);
      // Single use: the state cookie is cleared on the way through.
      expect(res.clearCookie).toHaveBeenCalledWith(
        'wafflebase_oauth_state',
        expect.objectContaining({ path: '/auth' }),
      );
    });

    it('refuses a callback whose state does not match the cookie', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(
          webRequest(randomBytes(32).toString('base64url')) as any,
          res,
          `w.${randomBytes(32).toString('base64url')}`,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
      // The user is never even looked up for a callback we did not start.
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
    });

    it('refuses a callback that carries no state at all', async () => {
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(webRequest() as any, res, undefined),
      ).rejects.toThrow(UnauthorizedException);

      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('refuses a web state when the cookie is missing', async () => {
      const res = createMockResponse();

      await expect(
        controller.githubAuthCallback(
          webRequest() as any,
          res,
          `w.${randomBytes(32).toString('base64url')}`,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(res.redirect).not.toHaveBeenCalled();
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
