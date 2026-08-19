import { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  GitHubAuthGuard,
  parseCliChallenge,
  parseCliNonce,
} from './github-auth.guard';
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

describe('parseCliChallenge', () => {
  it('accepts a 43-character base64url digest', () => {
    const challenge = 'c'.repeat(43);
    expect(parseCliChallenge(challenge)).toBe(challenge);
    expect(parseCliChallenge('-_' + 'a'.repeat(41))).toBe('-_' + 'a'.repeat(41));
  });

  it('rejects anything outside the base64url digest vocabulary', () => {
    expect(parseCliChallenge('c'.repeat(42))).toBeUndefined();
    expect(parseCliChallenge('c'.repeat(44))).toBeUndefined();
    expect(parseCliChallenge('c'.repeat(42) + '&')).toBeUndefined();
    expect(parseCliChallenge('c'.repeat(42) + '=')).toBeUndefined();
    expect(parseCliChallenge(undefined)).toBeUndefined();
    expect(parseCliChallenge(['c'.repeat(43)])).toBeUndefined();
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

  it('binds the request nonce and challenge into the stored state', () => {
    const nonce = 'a'.repeat(64);
    const challenge = 'c'.repeat(43);
    const { req, result } = activate({
      mode: 'cli',
      port: '49152',
      nonce,
      challenge,
    });

    expect(result).toBe(true);
    expect(createState).toHaveBeenCalledWith('cli', 49152, nonce, challenge);
    expect(req.__oauthState).toBe('state-token');
  });

  /**
   * The state token goes through GitHub in a URL, so on its own it is
   * transferable: an attacker clicks through the confirmation page in
   * their own browser and hands the victim a bare `authorize` URL
   * carrying the state. The cookie is what the callback checks it
   * against, so if it is not minted here the whole binding is gone.
   */
  it('binds the CLI state to this browser with a cookie', () => {
    const { res } = activate({ mode: 'cli', port: '49152' });

    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_cli_state',
      'csrf',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('stores no nonce when the query carries none or a malformed one', () => {
    activate({ mode: 'cli', port: '49152' });
    expect(createState).toHaveBeenCalledWith('cli', 49152, undefined, undefined);

    createState.mockClear();
    activate({ mode: 'cli', port: '49152', nonce: 'not-hex&code=evil' });
    expect(createState).toHaveBeenCalledWith('cli', 49152, undefined, undefined);
  });

  /**
   * A malformed challenge must not degrade into an *unbound* code: the
   * state stores none, and the callback refuses rather than minting a
   * bearer-only code.
   */
  it('stores no challenge when the query carries a malformed one', () => {
    activate({ mode: 'cli', port: '49152', challenge: 'short' });
    expect(createState).toHaveBeenCalledWith('cli', 49152, undefined, undefined);
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

  /**
   * Neither state mechanism covers a login a hostile *page* navigated the
   * victim's browser into: the navigation that carries the attack is also
   * the one that mints the state and sets its cookie. `Sec-Fetch-Site` is
   * what tells the two apart, and only the browser can set it.
   */
  describe('cross-site initiation', () => {
    it('refuses a login navigated in from another site', () => {
      expect(() =>
        activate(
          { mode: 'cli', port: '49152' },
          { __cliConfirmed: true, headers: { 'sec-fetch-site': 'cross-site' } },
        ),
      ).toThrow(/Start the login from Wafflebase/);
      expect(createState).not.toHaveBeenCalled();
    });

    it('refuses a cross-site-initiated browser login too', () => {
      expect(() =>
        activate({}, { headers: { 'sec-fetch-site': 'cross-site' } }),
      ).toThrow(/Start the login from Wafflebase/);
    });

    it.each(['none', 'same-origin', 'same-site'])(
      'allows a login started %s',
      (site) => {
        // `none` is the CLI's shape (the OS opener), `same-origin` the
        // confirmation-page click, `same-site` a click inside the app.
        const { result } = activate(
          { mode: 'cli', port: '49152' },
          { __cliConfirmed: true, headers: { 'sec-fetch-site': site } },
        );
        expect(result).toBe(true);
        expect(createState).toHaveBeenCalled();
      },
    );

    /**
     * A client that sends no `Sec-Fetch-Site` at all is not the attack
     * shape — the attack needs the victim's browser, and every browser
     * that can be steered cross-site sends this header.
     */
    it('allows a request that sends no Sec-Fetch-Site', () => {
      const { result } = activate({ mode: 'cli', port: '49152' });
      expect(result).toBe(true);
    });
  });
});
