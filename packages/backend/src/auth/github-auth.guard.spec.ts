import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { GitHubAuthGuard } from './github-auth.guard';
import { CliAuthStore } from './cli-auth.store';

/**
 * The guard is what decides whether a CLI login code will ever be minted
 * and shipped to a loopback port, so all three cases matter: a
 * well-formed request must carry its nonce into the stored state, a
 * malformed one must create no state at all, and an *absent* one must
 * still be served — published CLIs older than nonce-bound login send no
 * nonce, and the binding that protects a login is the CLI-side check.
 */
describe('GitHubAuthGuard', () => {
  let store: CliAuthStore;
  let guard: GitHubAuthGuard;
  let superCanActivate: jest.SpyInstance;

  const VALID_NONCE = 'a'.repeat(43);

  function contextFor(query: Record<string, unknown>): {
    context: ExecutionContext;
    req: Record<string, unknown>;
    res: { cookie: jest.Mock };
  } {
    const req: Record<string, unknown> = { query };
    const res = { cookie: jest.fn() };
    const context = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    return { context, req, res };
  }

  beforeEach(() => {
    store = new CliAuthStore();
    guard = new GitHubAuthGuard(store);
    // Stop the call from reaching passport's GitHub strategy; we only
    // care about what the guard did to the request before delegating.
    superCanActivate = jest
      .spyOn(
        Object.getPrototypeOf(GitHubAuthGuard.prototype) as {
          canActivate: (c: ExecutionContext) => boolean;
        },
        'canActivate',
      )
      .mockReturnValue(true);
  });

  afterEach(() => {
    superCanActivate.mockRestore();
  });

  it('stores the nonce with the CLI state and delegates', () => {
    const { context, req } = contextFor({
      mode: 'cli',
      port: '54321',
      nonce: VALID_NONCE,
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(superCanActivate).toHaveBeenCalled();

    const stateToken = req.__oauthState as string;
    expect(typeof stateToken).toBe('string');
    expect(store.consumeState(stateToken)).toEqual({
      csrf: expect.any(String) as string,
      mode: 'cli',
      port: 54321,
      nonce: VALID_NONCE,
    });
  });

  it('still serves a nonce-less CLI login, without a nonce in the state', () => {
    // `@wafflebase/cli` is published, so released versions that predate
    // nonce-bound login keep working: they get the same nonce-less
    // redirect they get today, which their own callback accepts. The
    // current CLI always sends a nonce, so it is unaffected.
    const { context, req } = contextFor({ mode: 'cli', port: '54321' });

    expect(guard.canActivate(context)).toBe(true);
    expect(superCanActivate).toHaveBeenCalled();

    const stateToken = req.__oauthState as string;
    expect(store.consumeState(stateToken)).toEqual({
      csrf: expect.any(String) as string,
      mode: 'cli',
      port: 54321,
      nonce: undefined,
    });
  });

  it.each([
    ['too short', 'short'],
    ['too long', 'a'.repeat(129)],
    ['non-URL-safe characters', `${'a'.repeat(20)}<script>`],
  ])('rejects a nonce that is %s', (_label, nonce) => {
    const { context, req } = contextFor({ mode: 'cli', port: '54321', nonce });

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
    expect(req.__oauthState).toBeUndefined();
  });

  it('rejects a repeated nonce param (array) rather than coercing it', () => {
    const { context } = contextFor({
      mode: 'cli',
      port: '54321',
      nonce: [VALID_NONCE, VALID_NONCE],
    });

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });

  it.each([
    ['a privileged port', '80'],
    ['an out-of-range port', '70000'],
    ['a non-numeric port', 'abc'],
    ['no port at all', undefined],
  ])('rejects CLI mode with %s', (_label, port) => {
    const { context, req } = contextFor({
      mode: 'cli',
      port,
      nonce: VALID_NONCE,
    });

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
    expect(req.__oauthState).toBeUndefined();
  });

  it('binds the ordinary web flow to a cookie-mirrored state', () => {
    // passport-oauth2 given no state store installs a `NullStore` that
    // verifies everything, so the web login had no CSRF binding at all:
    // an attacker's `?code=` loaded in the victim's browser minted a
    // session for the attacker's account. The state is minted here and
    // checked against this cookie in the callback.
    const { context, req, res } = contextFor({});

    expect(guard.canActivate(context)).toBe(true);

    const state = req.__oauthState as string;
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_oauth_state',
      state,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 5 * 60 * 1000,
      }),
    );
  });

  it('mints a fresh web state per request', () => {
    const first = contextFor({});
    const second = contextFor({});

    guard.canActivate(first.context);
    guard.canActivate(second.context);

    expect(first.req.__oauthState).not.toEqual(second.req.__oauthState);
  });

  it('sets no web state cookie for a CLI login', () => {
    // The CLI's callback lands on a loopback listener, not in a browser:
    // its binding is the server-side state entry plus the nonce.
    const { context, res } = contextFor({
      mode: 'cli',
      port: '54321',
      nonce: VALID_NONCE,
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
