import { CanActivate, ExecutionContext } from '@nestjs/common';
import { GitHubAuthGuard, parseCliNonce } from './github-auth.guard';
import { CliAuthStore } from './cli-auth.store';

describe('parseCliNonce', () => {
  it('accepts a hex nonce of a sane length', () => {
    const nonce = 'a1b2c3d4'.repeat(8); // 64 chars
    expect(parseCliNonce(nonce)).toBe(nonce);
    expect(parseCliNonce('f'.repeat(32))).toBe('f'.repeat(32));
  });

  it('rejects anything that could smuggle a query param into the redirect', () => {
    expect(parseCliNonce('f'.repeat(32) + '&code=evil')).toBeUndefined();
    expect(parseCliNonce('../callback')).toBeUndefined();
    expect(parseCliNonce('F'.repeat(32))).toBeUndefined(); // uppercase
    expect(parseCliNonce('f'.repeat(31))).toBeUndefined(); // too short
    expect(parseCliNonce('f'.repeat(129))).toBeUndefined(); // too long
  });

  it('rejects non-string input', () => {
    expect(parseCliNonce(undefined)).toBeUndefined();
    expect(parseCliNonce(['f'.repeat(32)])).toBeUndefined();
    expect(parseCliNonce(42)).toBeUndefined();
  });
});

/**
 * The CSRF binding runs query param -> stored state -> loopback
 * `state`, and this guard is its entry point. Testing `parseCliNonce`
 * alone leaves the wiring unpinned: read the nonce from the wrong query
 * key, or drop the argument, and every other test in the chain still
 * passes, because they hand `createState` a nonce directly.
 */
describe('GitHubAuthGuard.canActivate', () => {
  const createState = jest
    .fn()
    .mockReturnValue({ stateToken: 'state-token', csrf: 'csrf' });
  const store = { createState } as unknown as CliAuthStore;

  // `super.canActivate()` would run the real passport strategy.
  const passportProto = Object.getPrototypeOf(
    GitHubAuthGuard.prototype,
  ) as CanActivate;
  let superSpy: jest.SpyInstance;

  beforeEach(() => {
    createState.mockClear();
    superSpy = jest.spyOn(passportProto, 'canActivate').mockReturnValue(true);
  });

  afterEach(() => superSpy.mockRestore());

  function activate(
    query: Record<string, unknown>,
    extra: Record<string, unknown> = { __cliConfirmed: true },
  ) {
    const req: Record<string, unknown> = { query, ...extra };
    const res = { cookie: jest.fn() };
    const context = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    const result = new GitHubAuthGuard(store).canActivate(context);
    return { req, res, result };
  }

  it('binds the request nonce into the stored state', () => {
    const nonce = 'a'.repeat(64);
    const { req, result } = activate({ mode: 'cli', port: '49152', nonce });

    expect(result).toBe(true);
    expect(createState).toHaveBeenCalledWith('cli', 49152, nonce);
    expect(req.__oauthState).toBe('state-token');
  });

  it('stores no nonce when the query carries none or a malformed one', () => {
    activate({ mode: 'cli', port: '49152' });
    expect(createState).toHaveBeenCalledWith('cli', 49152, undefined);

    createState.mockClear();
    activate({ mode: 'cli', port: '49152', nonce: 'not-hex&code=evil' });
    expect(createState).toHaveBeenCalledWith('cli', 49152, undefined);
  });

  it('mints no CLI state for an out-of-range port', () => {
    activate({ mode: 'cli', port: '80' });
    activate({ mode: 'cli', port: 'not-a-port' });
    expect(createState).not.toHaveBeenCalled();
  });

  /**
   * The confirmation page is the only thing standing between
   * `?mode=cli&port=<attacker's>` and an auth code minted for whoever
   * navigated the victim here. If that gate is ever unwired, the guard
   * must not mint the CLI state anyway — it degrades to a browser login.
   */
  it('mints no CLI state for an unconfirmed CLI request', () => {
    const { req } = activate({ mode: 'cli', port: '49152' }, {});

    expect(createState).not.toHaveBeenCalled();
    expect(req.__oauthState).toMatch(/^web\./);
  });

  /**
   * A browser login with no `state` is login CSRF: the callback would
   * set session cookies for any code presented to it.
   */
  it('mints a cookie-bound state for a browser login', () => {
    const { req, res } = activate({}, {});

    expect(createState).not.toHaveBeenCalled();
    expect(req.__oauthState).toMatch(/^web\.[0-9a-f]{64}$/);
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_oauth_state',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    // The state is the *hash*; the secret never leaves the cookie.
    const [, secret] = (res.cookie as jest.Mock).mock.calls[0] as [
      string,
      string,
    ];
    expect(req.__oauthState).not.toContain(secret);
  });
});
