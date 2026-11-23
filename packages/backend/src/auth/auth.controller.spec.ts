import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import {
  EmailProviderConflictError,
  UserService,
} from 'src/user/user.service';
import { AuthController, isDesktopOrigin } from './auth.controller';
import { AuthService } from './auth.service';
import { CliAuthStore, hashCliVerifier } from './cli-auth.store';
import { JwtStrategy } from './jwt.strategy';
import {
  cliStateCookieName,
  createWebOAuthState,
  refreshCookieName,
} from './oauth-state';

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
    claimGithubWorkspaces: jest.fn(),
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

  describe('githubAuthCallback — workspace claims', () => {
    const mockUser = {
      id: 42,
      authProvider: 'github',
      username: 'bob',
      email: 'bob@example.com',
      photo: null,
    };

    function signIn(user: Record<string, unknown>) {
      const { secret, state } = createWebOAuthState();
      const res = createMockResponse();
      const req = {
        user,
        query: {},
        cookies: { wafflebase_oauth_state: secret },
      } as unknown as Request;
      return controller
        .githubAuthCallback(req as any, res, state)
        .then(() => res);
    }

    beforeEach(() => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      (userService.claimGithubWorkspaces as jest.Mock).mockReset();
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });
    });

    it('claims the workspaces waiting for the proven GitHub account id', async () => {
      (userService.claimGithubWorkspaces as jest.Mock).mockResolvedValue(2);

      const res = await signIn({
        username: 'bob',
        email: 'bob@example.com',
        githubId: '12345',
      });

      expect(userService.claimGithubWorkspaces).toHaveBeenCalledWith(
        42,
        '12345',
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173');
    });

    it('still signs in when claiming fails', async () => {
      (userService.claimGithubWorkspaces as jest.Mock).mockRejectedValue(
        new Error('db down'),
      );

      const res = await signIn({
        username: 'bob',
        email: 'bob@example.com',
        githubId: '12345',
      });

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173');
      expect(res.cookie).toHaveBeenCalledTimes(2);
    });

    it('does not claim without a GitHub account id', async () => {
      await signIn({ username: 'bob', email: 'bob@example.com' });

      expect(userService.claimGithubWorkspaces).not.toHaveBeenCalled();
    });
  });

  describe('googleAuthCallback', () => {
    const mockUser = {
      id: 43,
      authProvider: 'google',
      username: 'Ada Lovelace',
      email: 'ada@example.com',
      photo: null,
    };

    function googleRequest(cookies: Record<string, string>) {
      return {
        user: {
          username: 'Ada Lovelace',
          email: 'ada@example.com',
          photo: null,
        },
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

    it('signs in and records the provider when the state matches', async () => {
      const { secret, state } = createWebOAuthState();
      const res = createMockResponse();

      await controller.googleAuthCallback(
        googleRequest({ wafflebase_oauth_state: secret }) as any,
        res,
        state,
      );

      expect(userService.findOrCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          authProvider: 'google',
          email: 'ada@example.com',
        }),
      );
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173');
      expect(res.cookie).toHaveBeenCalledTimes(2);
      expect(res.clearCookie).toHaveBeenCalledWith(
        'wafflebase_oauth_state',
        expect.any(Object),
      );
    });

    const LOGIN_ERROR_URL = 'http://localhost:5173/login?error=oauth_state';

    // The same CSRF property the GitHub callback has, and the same refusal:
    // back to the sign-in page with no session, since losing the state
    // cookie needs no attacker at all.
    it.each([
      ['no state at all', () => ({ cookies: {}, state: undefined })],
      [
        'a state with no cookie behind it',
        () => ({ cookies: {}, state: createWebOAuthState().state }),
      ],
      [
        'a state minted for another browser',
        () => ({
          cookies: { wafflebase_oauth_state: createWebOAuthState().secret },
          state: createWebOAuthState().state,
        }),
      ],
      [
        'a repeated ?state= parameter',
        () => {
          const { secret, state } = createWebOAuthState();
          return {
            cookies: { wafflebase_oauth_state: secret },
            state: [state, state] as unknown as string,
          };
        },
      ],
    ])('refuses %s', async (_name, make) => {
      const { cookies, state } = make();
      const res = createMockResponse();

      await controller.googleAuthCallback(
        googleRequest(cookies) as any,
        res,
        state,
      );

      expect(res.redirect).toHaveBeenCalledWith(LOGIN_ERROR_URL);
      expect(res.cookie).not.toHaveBeenCalled();
      // A refused callback must not leave a user row (and a workspace)
      // behind for a sign-in that never happened.
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
    });

    /**
     * A CLI state token is a `CliAuthStore` capability minted by
     * `GET /auth/github?mode=cli`, and the Google route never mints one.
     * Accepting one here would mean this callback could mint a CLI auth
     * code — a full session delivered to a loopback port — from a flow
     * that never showed the confirmation page.
     */
    it('refuses a CLI state token outright', async () => {
      const { stateToken, csrf } = cliAuthStore.createState(
        'cli',
        9876,
        undefined,
        CLI_CHALLENGE,
      );
      const res = createMockResponse();

      await controller.googleAuthCallback(
        googleRequest({ [cliStateCookieName()]: csrf }) as any,
        res,
        stateToken,
      );

      expect(res.redirect).toHaveBeenCalledWith(LOGIN_ERROR_URL);
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  /**
   * A provider profile the strategy would not sign in — no verified email —
   * and an address that belongs to an account the other provider created
   * without ever proving it.
   *
   * Neither may escape as backend JSON. The strategies report the first as a
   * value (a throw inside `AuthGuard(...)` runs before this handler and skips
   * the whole refusal contract), and `findOrCreateUser` raises the second,
   * which is caught here. A browser login lands back on the sign-in page; a
   * CLI login is told at its loopback callback, because `wafflebase login` is
   * blocked on that callback and would otherwise wait out its five-minute
   * timeout with nothing to act on.
   */
  describe('refused profiles', () => {
    beforeEach(() => {
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });
    });

    it('sends a refused GitHub browser login back to the sign-in page', async () => {
      const { secret, state } = createWebOAuthState();
      const res = createMockResponse();
      const req = {
        user: { authProvider: 'github', error: 'unverified_email' },
        query: {},
        cookies: { wafflebase_oauth_state: secret },
      } as unknown as Request;

      await controller.githubAuthCallback(req as any, res, state);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/login?error=unverified_email',
      );
      expect(res.cookie).not.toHaveBeenCalled();
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
    });

    it('sends a refused Google login back to the sign-in page', async () => {
      const { secret, state } = createWebOAuthState();
      const res = createMockResponse();
      const req = {
        user: { authProvider: 'google', error: 'no_email' },
        query: {},
        cookies: { wafflebase_oauth_state: secret },
      } as unknown as Request;

      await controller.googleAuthCallback(req as any, res, state);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/login?error=no_email',
      );
      expect(res.cookie).not.toHaveBeenCalled();
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
    });

    it('reports a refused CLI login at the loopback callback, with the nonce', async () => {
      const nonce = 'b'.repeat(64);
      const { stateToken, csrf } = cliAuthStore.createState(
        'cli',
        9876,
        nonce,
        CLI_CHALLENGE,
      );
      const res = createMockResponse();
      const req = {
        user: { authProvider: 'github', error: 'unverified_email' },
        cookies: { [cliStateCookieName()]: csrf },
        query: { state: stateToken },
      } as unknown as Request;

      await controller.githubAuthCallback(req as any, res, stateToken);

      // The nonce has to ride along: the CLI's listener refuses a callback
      // that does not carry it, which would strand the command anyway.
      expect(res.redirect).toHaveBeenCalledWith(
        `http://127.0.0.1:9876/callback?error=unverified_email&state=${nonce}`,
      );
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
    });

    it('routes an unproven cross-provider address to ?error=email_conflict', async () => {
      (userService.findOrCreateUser as jest.Mock).mockRejectedValue(
        new EmailProviderConflictError('github'),
      );
      const { secret, state } = createWebOAuthState();
      const res = createMockResponse();
      const req = {
        user: {
          authProvider: 'google',
          username: 'Ada Lovelace',
          email: 'ada@example.com',
        },
        query: {},
        cookies: { wafflebase_oauth_state: secret },
      } as unknown as Request;

      await controller.googleAuthCallback(req as any, res, state);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/login?error=email_conflict',
      );
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('GET /auth/providers', () => {
    const saved = { ...process.env };

    afterEach(() => {
      process.env = { ...saved };
    });

    beforeEach(() => {
      // `desktop.github` follows `cliLoginAvailable()`; pin a loopback
      // origin so a developer's own `.env` does not decide these cases.
      process.env.GITHUB_CALLBACK_URL =
        'http://localhost:3000/auth/github/callback';
      delete process.env.COOKIE_SECURE;
    });

    it('reports Google off until all three variables are set', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CALLBACK_URL;
      expect(controller.authProviders()).toEqual({
        github: true,
        google: false,
        desktop: { github: true, google: false },
      });

      process.env.GOOGLE_CLIENT_ID = 'id';
      process.env.GOOGLE_CLIENT_SECRET = 'secret';
      // Still missing the callback URL, which Google requires.
      expect(controller.authProviders().google).toBe(false);

      process.env.GOOGLE_CALLBACK_URL =
        'http://localhost:3000/auth/google/callback';
      expect(controller.authProviders()).toEqual({
        github: true,
        google: true,
        // Google has no loopback mode yet, configured or not.
        desktop: { github: true, google: false },
      });
    });

    /**
     * The desktop app reads `desktop.github` to decide whether to start a
     * sign-in at all, so it must be false exactly where
     * `?mode=desktop` would be refused — a cleartext non-loopback origin.
     */
    it('reports desktop GitHub sign-in only where the CLI gate allows it', () => {
      process.env.GITHUB_CALLBACK_URL =
        'http://wafflebase.example.com/auth/github/callback';
      expect(controller.authProviders().desktop).toEqual({
        github: false,
        google: false,
      });

      process.env.GITHUB_CALLBACK_URL =
        'https://wafflebase.example.com/auth/github/callback';
      expect(controller.authProviders().desktop.github).toBe(true);

      process.env.GITHUB_CALLBACK_URL =
        'http://wafflebase.internal:3000/auth/github/callback';
      process.env.COOKIE_SECURE = 'true';
      expect(controller.authProviders().desktop.github).toBe(true);
    });
  });

  describe('cookie SameSite policy', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCallbackUrl = process.env.GITHUB_CALLBACK_URL;

    // `useSecureCookies()` reads `GITHUB_CALLBACK_URL` first and only falls
    // back to `NODE_ENV` when none is configured, so these cases have to
    // clear it. Otherwise a developer's own `packages/backend/.env` (whose
    // callback URL is `http://localhost:3000/...`) decides the assertion
    // and the suite passes in CI while failing on their machine.
    beforeEach(() => {
      delete process.env.GITHUB_CALLBACK_URL;
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalCallbackUrl === undefined) {
        delete process.env.GITHUB_CALLBACK_URL;
      } else {
        process.env.GITHUB_CALLBACK_URL = originalCallbackUrl;
      }
    });

    /**
     * Drive the cookie-*setting* path. Sign-out deliberately emits both a
     * `Secure` and a non-`Secure` expiry (see `clearAuthCookies`), so it is
     * no longer where the configured flag can be observed — this is.
     */
    async function issueCookies() {
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
      const req = {
        cookies: { [refreshCookieName()]: 'refresh-token' },
      } as unknown as Request;

      await controller.refresh(req, res);
      return res;
    }

    it('sets SameSite=Lax with secure=true in production', async () => {
      process.env.NODE_ENV = 'production';
      const res = await issueCookies();

      expect(res.cookie).toHaveBeenCalledTimes(2);
      for (const [name, , options] of (res.cookie as jest.Mock).mock.calls) {
        // `__Host-` needs `Secure` *and* `Path=/`, and a browser rejects the
        // cookie outright without them — so the name and these two options
        // have to move together.
        expect(name).toMatch(/^__Host-wafflebase_(session|refresh)$/);
        expect(options).toMatchObject({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
        });
        expect(options).not.toHaveProperty('domain');
      }
    });

    it('sets SameSite=Lax with secure=false outside production', async () => {
      process.env.NODE_ENV = 'development';
      const res = await issueCookies();

      for (const [name, , options] of (res.cookie as jest.Mock).mock.calls) {
        expect(name).toMatch(/^wafflebase_(session|refresh)$/);
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
        const res = await issueCookies();
        await controller.logout(res);

        for (const call of [
          ...(res.cookie as jest.Mock).mock.calls,
          ...(res.clearCookie as jest.Mock).mock.calls,
        ]) {
          const options = call[call.length - 1];
          expect(options.sameSite).not.toBe('none');
        }
      }
    });
  });

  /**
   * Sign-out has to reach the cookie the browser actually holds, and which
   * one that is depends on config that may have changed since it was
   * written.
   *
   * A `Set-Cookie` carrying `Secure` is discarded on a plain-http
   * connection, so clearing only with the configured flag leaves the session
   * in place on an origin served over http with `COOKIE_SECURE=true` — a 200
   * from `POST /auth/logout` and a live session behind it. And the name
   * follows `__Host-`, so a cookie written before `Secure` was turned on
   * answers to the bare name. Both axes are therefore swept.
   */
  describe('sign-out expires every cookie shape', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCallbackUrl = process.env.GITHUB_CALLBACK_URL;

    beforeEach(() => {
      delete process.env.GITHUB_CALLBACK_URL;
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalCallbackUrl === undefined) {
        delete process.env.GITHUB_CALLBACK_URL;
      } else {
        process.env.GITHUB_CALLBACK_URL = originalCallbackUrl;
      }
    });

    it('expires the prefixed and bare names, Secure and not', async () => {
      process.env.NODE_ENV = 'production';
      const res = createMockResponse();

      await controller.logout(res);

      const cleared = (res.clearCookie as jest.Mock).mock.calls.map(
        ([name, options]) => `${name}:${options.secure}`,
      );
      for (const name of [
        '__Host-wafflebase_session',
        '__Host-wafflebase_refresh',
        'wafflebase_session',
        'wafflebase_refresh',
      ]) {
        // The insecure variant is the one that can arrive over http, where a
        // `Secure` expiry is dropped and the session would survive logout.
        expect(cleared).toContain(`${name}:true`);
        expect(cleared).toContain(`${name}:false`);
      }
    });

    it('emits each expiry once outside production too', async () => {
      process.env.NODE_ENV = 'development';
      const res = createMockResponse();

      await controller.logout(res);

      // Unprefixed and prefixed names coincide here, so the sweep is two
      // names × two `Secure` answers — no duplicated Set-Cookie headers.
      expect(res.clearCookie).toHaveBeenCalledTimes(4);
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
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'cli');
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
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'cli');
      (userService.user as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        controller.cliExchange({ code, verifier: 'w'.repeat(43) }),
      ).rejects.toThrow(UnauthorizedException);
      expect(authService.createTokens).not.toHaveBeenCalled();
    });

    it('refuses a code minted for the desktop app as an invalid code', async () => {
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'desktop');
      (userService.user as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        controller.cliExchange({ code, verifier: CLI_VERIFIER }),
      ).rejects.toThrow('Invalid or expired code');
      expect(authService.createTokens).not.toHaveBeenCalled();
    });

    it('rejects the same code on second use', async () => {
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'cli');
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

  describe('githubAuthCallback — desktop flow', () => {
    const mockUser = {
      id: 42,
      authProvider: 'github',
      username: 'bob',
      email: 'bob@example.com',
      photo: null,
    };

    it('redirects a desktop login to the loopback callback with its nonce', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      (userService.user as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      const nonce = 'd'.repeat(64);
      const { stateToken, csrf } = cliAuthStore.createState(
        'desktop',
        51234,
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

      const [url] = (res.redirect as jest.Mock).mock.calls[0] as [string];
      const match = new RegExp(
        `^http://127\\.0\\.0\\.1:51234/callback\\?code=([^&]+)&state=${nonce}$`,
      ).exec(url);
      expect(match).not.toBeNull();
      // No session for the system browser: the webview gets it, later.
      expect(res.cookie).not.toHaveBeenCalled();

      // The code is a desktop code: `cli/exchange` refuses it…
      const code = decodeURIComponent(match![1]);
      await expect(
        controller.cliExchange({ code, verifier: CLI_VERIFIER }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('mints a code that redeems at desktop/session', async () => {
      (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
      (userService.user as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });

      const { stateToken, csrf } = cliAuthStore.createState(
        'desktop',
        51234,
        'd'.repeat(64),
        CLI_CHALLENGE,
      );
      const res = createMockResponse();
      await controller.githubAuthCallback(
        {
          user: { username: 'bob', email: 'bob@example.com', photo: null },
          cookies: { [cliStateCookieName()]: csrf },
          query: { state: stateToken },
        } as any,
        res,
        stateToken,
      );
      const [url] = (res.redirect as jest.Mock).mock.calls[0] as [string];
      const code = new URL(url).searchParams.get('code')!;

      const sessionRes = createMockResponse();
      await controller.desktopSession(
        {
          headers: { origin: 'tauri://localhost' },
          body: { code, verifier: CLI_VERIFIER },
        } as unknown as Request,
        sessionRes,
      );
      expect(sessionRes.redirect).toHaveBeenCalledWith(
        303,
        'http://localhost:5173',
      );
    });
  });

  /**
   * The handoff page in the desktop app's webview posts the code here and
   * the response sets the session cookies on that webview. Because it signs
   * in *whoever posts*, any other origin is a login-CSRF vector.
   */
  describe('POST /auth/desktop/session', () => {
    const mockUser = {
      id: 42,
      authProvider: 'github',
      username: 'bob',
      email: 'bob@example.com',
      photo: null,
    };

    function sessionRequest(
      headers: Record<string, unknown>,
      body: Record<string, unknown>,
    ) {
      return { headers, body } as unknown as Request;
    }

    beforeEach(() => {
      (userService.user as jest.Mock).mockResolvedValue(mockUser);
      (authService.createTokens as jest.Mock).mockReturnValue({
        accessToken: 'desktop-at',
        refreshToken: 'desktop-rt',
      });
    });

    it.each(['tauri://localhost', 'http://tauri.localhost'])(
      'sets the session cookies and 303s to the frontend from %s',
      async (origin) => {
        const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'desktop');
        const res = createMockResponse();

        await controller.desktopSession(
          sessionRequest({ origin }, { code, verifier: CLI_VERIFIER }),
          res,
        );

        expect(userService.user).toHaveBeenCalledWith({ id: 42 });
        expect(res.cookie).toHaveBeenCalledWith(
          'wafflebase_session',
          'desktop-at',
          expect.objectContaining({
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 1000,
          }),
        );
        expect(res.cookie).toHaveBeenCalledWith(
          'wafflebase_refresh',
          'desktop-rt',
          expect.objectContaining({
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 2000,
          }),
        );
        expect(res.redirect).toHaveBeenCalledWith(303, 'http://localhost:5173');
      },
    );

    it.each<[string, Record<string, unknown>]>([
      ['no Origin', {}],
      ['Origin: null', { origin: 'null' }],
      ['an empty Origin', { origin: '' }],
      ['a web origin', { origin: 'https://evil.example' }],
      ['the frontend origin', { origin: 'http://localhost:5173' }],
      ['a look-alike host', { origin: 'tauri://localhost.evil.example' }],
      ['a trailing slash', { origin: 'tauri://localhost/' }],
      ['a different case', { origin: 'TAURI://LOCALHOST' }],
      ['a port', { origin: 'http://tauri.localhost:8080' }],
      ['the unused https scheme', { origin: 'https://tauri.localhost' }],
      [
        'a joined repeat',
        { origin: 'tauri://localhost, https://evil.example' },
      ],
      ['an array', { origin: ['tauri://localhost'] }],
    ])(
      'refuses %s with 403 and leaves the code unspent',
      async (_, headers) => {
        const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'desktop');
        const res = createMockResponse();

        await expect(
          controller.desktopSession(
            sessionRequest(headers, { code, verifier: CLI_VERIFIER }),
            res,
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(res.cookie).not.toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
        expect(userService.user).not.toHaveBeenCalled();

        // Not consumed: the real handoff can still redeem it.
        const ok = createMockResponse();
        await controller.desktopSession(
          sessionRequest(
            { origin: 'tauri://localhost' },
            { code, verifier: CLI_VERIFIER },
          ),
          ok,
        );
        expect(ok.redirect).toHaveBeenCalledWith(303, 'http://localhost:5173');
      },
    );

    it('checks the Origin before the body, so a bad body is still a 403', async () => {
      await expect(
        controller.desktopSession(
          sessionRequest({ origin: 'https://evil.example' }, {}),
          createMockResponse(),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a CLI code as an invalid code', async () => {
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'cli');
      const res = createMockResponse();

      await controller.desktopSession(
        sessionRequest(
          { origin: 'tauri://localhost' },
          { code, verifier: CLI_VERIFIER },
        ),
        res,
      );

      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        303,
        'http://localhost:5173/login?error=desktop_session',
      );
    });

    it.each<[string, (code: string) => Record<string, unknown>]>([
      ['an unknown code', () => ({ code: 'nope', verifier: CLI_VERIFIER })],
      ['the wrong verifier', (code) => ({ code, verifier: 'w'.repeat(43) })],
      ['a malformed verifier', (code) => ({ code, verifier: 'short' })],
      ['no verifier', (code) => ({ code })],
      ['no code', () => ({ verifier: CLI_VERIFIER })],
      ['an array code', (code) => ({ code: [code], verifier: CLI_VERIFIER })],
      ['an empty code', () => ({ code: '', verifier: CLI_VERIFIER })],
      ['an overlong code', () => ({ code: 'c'.repeat(201), verifier: CLI_VERIFIER })],
    ])('303s to the sign-in page on %s', async (_, body) => {
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'desktop');
      const res = createMockResponse();

      await controller.desktopSession(
        sessionRequest({ origin: 'tauri://localhost' }, body(code)),
        res,
      );

      expect(res.cookie).not.toHaveBeenCalled();
      expect(authService.createTokens).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        303,
        'http://localhost:5173/login?error=desktop_session',
      );
    });

    it('303s to a safe returnTo path', async () => {
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'desktop');
      const res = createMockResponse();

      await controller.desktopSession(
        sessionRequest(
          { origin: 'tauri://localhost' },
          { code, verifier: CLI_VERIFIER, returnTo: '/d/123?tab=2' },
        ),
        res,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        303,
        'http://localhost:5173/d/123?tab=2',
      );
    });

    it.each(['//evil.example/x', 'https://evil.example', '/\\evil', 'd/1'])(
      'ignores an unsafe returnTo %s',
      async (returnTo) => {
        const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'desktop');
        const res = createMockResponse();

        await controller.desktopSession(
          sessionRequest(
            { origin: 'tauri://localhost' },
            { code, verifier: CLI_VERIFIER, returnTo },
          ),
          res,
        );

        expect(res.redirect).toHaveBeenCalledWith(303, 'http://localhost:5173');
      },
    );

    it('is single-use', async () => {
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'desktop');
      const req = sessionRequest(
        { origin: 'tauri://localhost' },
        { code, verifier: CLI_VERIFIER },
      );
      await controller.desktopSession(req, createMockResponse());

      const res = createMockResponse();
      await controller.desktopSession(req, res);
      expect(res.redirect).toHaveBeenCalledWith(
        303,
        'http://localhost:5173/login?error=desktop_session',
      );
    });

    it('303s to the sign-in page when the user is gone', async () => {
      (userService.user as jest.Mock).mockResolvedValue(null);
      const code = cliAuthStore.createCode(42, CLI_CHALLENGE, 'desktop');
      const res = createMockResponse();

      await controller.desktopSession(
        sessionRequest(
          { origin: 'tauri://localhost' },
          { code, verifier: CLI_VERIFIER },
        ),
        res,
      );

      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        303,
        'http://localhost:5173/login?error=desktop_session',
      );
    });
  });
});

describe('isDesktopOrigin', () => {
  it('accepts exactly the two Tauri webview origins the app uses', () => {
    expect(isDesktopOrigin('tauri://localhost')).toBe(true);
    expect(isDesktopOrigin('http://tauri.localhost')).toBe(true);
    expect(isDesktopOrigin('https://tauri.localhost')).toBe(false);
    expect(isDesktopOrigin('null')).toBe(false);
    expect(isDesktopOrigin(undefined)).toBe(false);
    expect(isDesktopOrigin('https://tauri.localhost.example')).toBe(false);
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

  /**
   * The extractor has to follow the name the controller writes. Reading the
   * bare name where `__Host-wafflebase_session` is what gets set would hand
   * a session back to a sibling subdomain that planted it under a `Domain`
   * — which is precisely what the prefix forbids — and reading only the bare
   * name would log every https deployment out.
   */
  describe('session cookie naming', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalCallbackUrl = process.env.GITHUB_CALLBACK_URL;

    beforeEach(() => {
      delete process.env.GITHUB_CALLBACK_URL;
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalCallbackUrl === undefined) {
        delete process.env.GITHUB_CALLBACK_URL;
      } else {
        process.env.GITHUB_CALLBACK_URL = originalCallbackUrl;
      }
    });

    it('reads the __Host- cookie and ignores an unprefixed leftover', () => {
      const strategy = new JwtStrategy(mockConfigService);
      const extractor = (strategy as any)._jwtFromRequest;

      expect(
        extractor({
          cookies: { '__Host-wafflebase_session': 'prefixed-token' },
          headers: {},
        } as unknown as Request),
      ).toBe('prefixed-token');

      expect(
        extractor({
          cookies: { wafflebase_session: 'planted-token' },
          headers: {},
        } as unknown as Request),
      ).toBeNull();
    });
  });
});
