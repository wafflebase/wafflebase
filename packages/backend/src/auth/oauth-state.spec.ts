import {
  createWebOAuthState,
  isWebOAuthState,
  oauthStateCookieName,
  oauthStateCookieOptions,
  timingSafeEqualStr,
  useSecureCookies,
  webOAuthStateMatches,
} from './oauth-state';

describe('oauth-state', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCallbackUrl = process.env.GITHUB_CALLBACK_URL;
  const originalCookieSecure = process.env.COOKIE_SECURE;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalCallbackUrl === undefined) delete process.env.GITHUB_CALLBACK_URL;
    else process.env.GITHUB_CALLBACK_URL = originalCallbackUrl;
    if (originalCookieSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = originalCookieSecure;
  });

  describe('createWebOAuthState', () => {
    it('sends the hash, never the secret', () => {
      const { secret, state } = createWebOAuthState();

      expect(isWebOAuthState(state)).toBe(true);
      expect(state).toMatch(/^web\.[0-9a-f]{64}$/);
      expect(state).not.toContain(secret);
    });

    it('mints a fresh pair each time', () => {
      expect(createWebOAuthState().state).not.toBe(createWebOAuthState().state);
    });
  });

  describe('webOAuthStateMatches', () => {
    it('accepts only the secret that produced the state', () => {
      const a = createWebOAuthState();
      const b = createWebOAuthState();

      expect(webOAuthStateMatches(a.state, a.secret)).toBe(true);
      expect(webOAuthStateMatches(a.state, b.secret)).toBe(false);
      expect(webOAuthStateMatches(a.state, undefined)).toBe(false);
      expect(webOAuthStateMatches(a.state, '')).toBe(false);
    });
  });

  /**
   * The double-submit pair is only as strong as the browser's guarantee
   * that nothing but this origin can write the cookie. Without the
   * `__Host-` prefix a sibling subdomain can set
   * `wafflebase_oauth_state=<its own secret>; Domain=<parent>` and pair
   * it with a `state` it minted itself — the login CSRF the state exists
   * to close. The prefix is honoured only on a `Secure` cookie with
   * `Path=/` and no `Domain`, so those attributes are part of the fix.
   */
  describe('cookie naming', () => {
    it('is __Host- prefixed, secure and path-/ in production', () => {
      process.env.NODE_ENV = 'production';

      expect(oauthStateCookieName()).toBe('__Host-wafflebase_oauth_state');
      const options = oauthStateCookieOptions();
      expect(options.secure).toBe(true);
      expect(options.path).toBe('/');
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
      expect(options).not.toHaveProperty('domain');
    });

    it('drops the prefix where Secure is unavailable', () => {
      process.env.NODE_ENV = 'development';

      expect(oauthStateCookieName()).toBe('wafflebase_oauth_state');
      expect(oauthStateCookieOptions().secure).toBe(false);
    });
  });

  /**
   * `__Host-` is the only thing that stops a sibling subdomain from
   * planting the browser's half of the double submit, so it has to apply
   * to every https deployment — not only to one that happens to set
   * `NODE_ENV=production`. And it has to be *withheld* on a plain-http
   * origin even under `NODE_ENV=production` (the shipped image sets it
   * while the self-hosting docs hand out an `http://` callback URL),
   * because the browser drops a `Secure` cookie there and the login then
   * fails with nothing to see.
   */
  describe('useSecureCookies', () => {
    it('follows an https callback URL regardless of NODE_ENV', () => {
      process.env.NODE_ENV = 'development';
      process.env.GITHUB_CALLBACK_URL =
        'https://wafflebase.example.com/auth/github/callback';

      expect(useSecureCookies()).toBe(true);
      expect(oauthStateCookieName()).toBe('__Host-wafflebase_oauth_state');
    });

    it('withholds Secure on a plain-http callback URL in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.GITHUB_CALLBACK_URL =
        'http://localhost:3000/auth/github/callback';

      expect(useSecureCookies()).toBe(false);
      expect(oauthStateCookieName()).toBe('wafflebase_oauth_state');
    });

    it('lets COOKIE_SECURE override a TLS-terminated deployment', () => {
      process.env.NODE_ENV = 'production';
      process.env.GITHUB_CALLBACK_URL =
        'http://internal:3000/auth/github/callback';
      process.env.COOKIE_SECURE = 'true';

      expect(useSecureCookies()).toBe(true);
    });

    it('falls back to NODE_ENV when no callback URL is configured', () => {
      delete process.env.GITHUB_CALLBACK_URL;
      delete process.env.COOKIE_SECURE;

      process.env.NODE_ENV = 'production';
      expect(useSecureCookies()).toBe(true);
      process.env.NODE_ENV = 'development';
      expect(useSecureCookies()).toBe(false);
    });
  });

  describe('timingSafeEqualStr', () => {
    it('compares by content and rejects a length mismatch', () => {
      expect(timingSafeEqualStr('abcdef', 'abcdef')).toBe(true);
      // Same length, one differing character — a length check alone
      // would pass this.
      expect(timingSafeEqualStr('abcdef', 'abcdeg')).toBe(false);
      expect(timingSafeEqualStr('abcdef', 'abcde')).toBe(false);
    });
  });
});
