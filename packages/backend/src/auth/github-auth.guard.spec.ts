import { CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import {
  cliLoginAvailable,
  GitHubAuthGuard,
  insecureProductionOrigin,
  loopbackCallback,
  parseCliChallenge,
  parseCliNonce,
  parseFetchSite,
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

  // Every CLI branch below now runs through `cliLoginAvailable()`, which
  // reads these. Clearing them keeps the suite from being decided by a
  // developer's own `packages/backend/.env` (or by a case above leaking
  // one), which would pass in CI and fail on their machine.
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
  };

  function restoreEnv() {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  beforeEach(() => {
    createState.mockClear();
    delete process.env.GITHUB_CALLBACK_URL;
    delete process.env.COOKIE_SECURE;
    superSpy = jest.spyOn(passportProto, 'canActivate').mockReturnValue(true);
  });

  afterEach(() => {
    superSpy.mockRestore();
    restoreEnv();
  });

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
   * Neither state mechanism covers a CLI login a hostile *page* navigated
   * the victim's browser into: the navigation that carries the attack is
   * also the one that mints the state and sets its cookie.
   * `Sec-Fetch-Site` is what tells the two apart, and only the browser
   * can set it.
   */
  describe('cross-site initiation', () => {
    it('refuses a CLI login navigated in from another site', () => {
      expect(() =>
        activate(
          { mode: 'cli', port: '49152' },
          { __cliConfirmed: true, headers: { 'sec-fetch-site': 'cross-site' } },
        ),
      ).toThrow(/Start the login from Wafflebase/);
      expect(createState).not.toHaveBeenCalled();
    });

    /**
     * The web login link lives on the frontend origin and points at
     * `VITE_BACKEND_API_URL`, which need not share a site with it. That
     * navigation is `cross-site` on such a deployment, and refusing it
     * would 400 every sign-in. The double-submit state cookie is set and
     * read on the backend's own origin, so it covers this flow on its
     * own.
     */
    it('serves a cross-site-initiated browser login', () => {
      const { req, res, result } = activate(
        {},
        { headers: { 'sec-fetch-site': 'cross-site' } },
      );

      expect(result).toBe(true);
      expect(req.__oauthState).toMatch(/^web\.[0-9a-f]{64}$/);
      expect(res.cookie).toHaveBeenCalledWith(
        'wafflebase_oauth_state',
        expect.any(String),
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it.each(['none', 'same-origin', 'same-site'])(
      'allows a CLI login started %s',
      (site) => {
        // `none` is the CLI's shape (the OS opener), `same-origin` the
        // confirmation-page click, `same-site` the same click on a
        // sibling host.
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

    /**
     * Only a browser sets this header, so a duplicated or empty value is
     * a hop artefact rather than an attack — reading it as an unknown
     * value would refuse a legitimate CLI login.
     */
    it('reads a duplicated or empty Sec-Fetch-Site as its first token', () => {
      for (const header of [
        ['same-origin', 'same-origin'],
        'same-origin, same-origin',
        'Same-Origin',
        '',
        '   ',
      ]) {
        createState.mockClear();
        const { result } = activate(
          { mode: 'cli', port: '49152' },
          { __cliConfirmed: true, headers: { 'sec-fetch-site': header } },
        );
        expect(result).toBe(true);
        expect(createState).toHaveBeenCalled();
      }
    });

    it('still refuses a duplicated cross-site header', () => {
      expect(() =>
        activate(
          { mode: 'cli', port: '49152' },
          {
            __cliConfirmed: true,
            headers: { 'sec-fetch-site': 'cross-site, same-origin' },
          },
        ),
      ).toThrow(/Start the login from Wafflebase/);
    });
  });

  /**
   * A CLI login's only defence against a page navigating a victim into it
   * is the consent click, and that click is proven by a cookie. Where the
   * cookie cannot be `Secure` (a cleartext non-loopback origin) anything on
   * the path or on a sibling subdomain can plant it, so the login is refused
   * rather than gated by a page that proves nothing.
   *
   * `COOKIE_SECURE` decides this now, in both directions — it is read ahead
   * of the callback URL's scheme — so both of its answers are pinned here:
   * without them, the gate could be wired to `NODE_ENV`, or to the callback
   * URL alone, and every other test in the file would still pass.
   */
  describe('CLI login availability', () => {
    it('refuses a CLI login on a plain-http non-loopback origin', () => {
      process.env.GITHUB_CALLBACK_URL =
        'http://wafflebase.example.com/auth/github/callback';

      expect(() => activate({ mode: 'cli', port: '49152' })).toThrow(
        /Command-line sign-in requires an https server/,
      );
      expect(createState).not.toHaveBeenCalled();
    });

    it('starts one on that origin when COOKIE_SECURE says it is https', () => {
      process.env.GITHUB_CALLBACK_URL =
        'http://wafflebase.internal:3000/auth/github/callback';
      process.env.COOKIE_SECURE = 'true';

      const { result } = activate({ mode: 'cli', port: '49152' });

      expect(result).toBe(true);
      expect(createState).toHaveBeenCalled();
    });

    it('refuses one on an https origin when COOKIE_SECURE=false', () => {
      process.env.GITHUB_CALLBACK_URL =
        'https://wafflebase.example.com/auth/github/callback';
      process.env.COOKIE_SECURE = 'false';

      expect(() => activate({ mode: 'cli', port: '49152' })).toThrow(
        /Command-line sign-in requires an https server/,
      );
    });

    it('starts one against an https callback URL', () => {
      process.env.GITHUB_CALLBACK_URL =
        'https://wafflebase.example.com/auth/github/callback';

      expect(activate({ mode: 'cli', port: '49152' }).result).toBe(true);
      expect(createState).toHaveBeenCalled();
    });

    it.each([
      'http://localhost:3000/auth/github/callback',
      'http://127.0.0.1:3000/auth/github/callback',
      'http://[::1]:3000/auth/github/callback',
    ])('starts one against the loopback callback %s', (url) => {
      // Loopback is a secure context in the browser, and it is how the
      // whole flow is developed — refusing it would refuse `wafflebase
      // login` on the only origin that exercises it end to end.
      process.env.GITHUB_CALLBACK_URL = url;

      expect(activate({ mode: 'cli', port: '49152' }).result).toBe(true);
      expect(createState).toHaveBeenCalled();
    });

    /**
     * The browser login has to survive the refusal: its state is a
     * double-submit pair on the backend's own origin, and refusing it would
     * leave a cleartext deployment with no way in at all.
     */
    it('still serves a browser login there', () => {
      process.env.GITHUB_CALLBACK_URL =
        'http://wafflebase.example.com/auth/github/callback';

      const { req, result } = activate({}, {});

      expect(result).toBe(true);
      expect(req.__oauthState).toMatch(/^web\./);
    });
  });

  /**
   * The downgrade the docs promise a warning for: `NODE_ENV=production` with
   * session cookies going out in the clear. It is logged at the first login,
   * once per process.
   */
  describe('insecure production origin warning', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => warn.mockRestore());

    it('warns once on a production non-loopback http origin', () => {
      process.env.NODE_ENV = 'production';
      process.env.GITHUB_CALLBACK_URL =
        'http://wafflebase.example.com/auth/github/callback';

      const guard = new GitHubAuthGuard(store);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ query: {} }),
          getResponse: () => ({ cookie: jest.fn() }),
        }),
      } as unknown as ExecutionContext;

      guard.canActivate(context);
      guard.canActivate(context);

      const downgrades = warn.mock.calls.filter(([message]) =>
        String(message).includes('without `Secure`'),
      );
      expect(downgrades).toHaveLength(1);
    });

    /**
     * `COOKIE_SECURE=false` states the origin's scheme; it does not make
     * cleartext session cookies in production any less of a finding, so it
     * must not silence the warning.
     */
    it('warns even when COOKIE_SECURE=false said so explicitly', () => {
      process.env.NODE_ENV = 'production';
      process.env.GITHUB_CALLBACK_URL =
        'https://wafflebase.example.com/auth/github/callback';
      process.env.COOKIE_SECURE = 'false';

      activate({}, {});

      expect(
        warn.mock.calls.some(([message]) =>
          String(message).includes('without `Secure`'),
        ),
      ).toBe(true);
    });

    it('stays quiet on an https origin and on loopback', () => {
      process.env.NODE_ENV = 'production';
      process.env.GITHUB_CALLBACK_URL =
        'https://wafflebase.example.com/auth/github/callback';
      activate({}, {});

      process.env.GITHUB_CALLBACK_URL =
        'http://localhost:3000/auth/github/callback';
      activate({}, {});

      expect(
        warn.mock.calls.some(([message]) =>
          String(message).includes('without `Secure`'),
        ),
      ).toBe(false);
    });
  });
});

describe('cliLoginAvailable', () => {
  const originalCallbackUrl = process.env.GITHUB_CALLBACK_URL;
  const originalCookieSecure = process.env.COOKIE_SECURE;

  beforeEach(() => {
    delete process.env.GITHUB_CALLBACK_URL;
    delete process.env.COOKIE_SECURE;
  });

  afterEach(() => {
    if (originalCallbackUrl === undefined)
      delete process.env.GITHUB_CALLBACK_URL;
    else process.env.GITHUB_CALLBACK_URL = originalCallbackUrl;
    if (originalCookieSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = originalCookieSecure;
  });

  /**
   * The refusal needs *positive* evidence of a cleartext non-loopback
   * origin. An install that configures no callback URL has no origin to
   * read — and cannot complete GitHub's flow at all — so it is not what the
   * gate is about.
   */
  it('does not refuse when no callback URL is configured', () => {
    expect(cliLoginAvailable()).toBe(true);
  });

  it('reads a malformed callback URL as no origin at all', () => {
    process.env.GITHUB_CALLBACK_URL = 'not a url';

    expect(loopbackCallback()).toBe(false);
    expect(cliLoginAvailable()).toBe(true);
  });

  it('treats a *.localhost callback as loopback', () => {
    process.env.GITHUB_CALLBACK_URL = 'http://app.localhost:3000/callback';

    expect(loopbackCallback()).toBe(true);
    expect(cliLoginAvailable()).toBe(true);
  });
});

describe('insecureProductionOrigin', () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
  };

  beforeEach(() => {
    delete process.env.GITHUB_CALLBACK_URL;
    delete process.env.COOKIE_SECURE;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('is the production cleartext non-loopback shape only', () => {
    process.env.NODE_ENV = 'production';
    process.env.GITHUB_CALLBACK_URL = 'http://example.com/auth/github/callback';
    expect(insecureProductionOrigin()).toBe(true);

    process.env.NODE_ENV = 'development';
    expect(insecureProductionOrigin()).toBe(false);

    process.env.NODE_ENV = 'production';
    process.env.GITHUB_CALLBACK_URL = 'http://localhost:3000/callback';
    expect(insecureProductionOrigin()).toBe(false);

    process.env.GITHUB_CALLBACK_URL = 'https://example.com/callback';
    expect(insecureProductionOrigin()).toBe(false);
  });
});

describe('parseFetchSite', () => {
  it('normalises what a proxy or express may hand back', () => {
    expect(parseFetchSite('same-origin')).toBe('same-origin');
    expect(parseFetchSite('Same-Origin')).toBe('same-origin');
    expect(parseFetchSite(' cross-site ')).toBe('cross-site');
    expect(parseFetchSite('none, none')).toBe('none');
    expect(parseFetchSite(['same-site', 'none'])).toBe('same-site');
  });

  it('treats an absent or empty value as no verdict', () => {
    expect(parseFetchSite(undefined)).toBeUndefined();
    expect(parseFetchSite('')).toBeUndefined();
    expect(parseFetchSite('  ')).toBeUndefined();
    expect(parseFetchSite([])).toBeUndefined();
    expect(parseFetchSite(42)).toBeUndefined();
  });
});
