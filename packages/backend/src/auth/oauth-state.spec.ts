import {
  createWebOAuthState,
  isWebOAuthState,
  oauthStateCookieName,
  oauthStateCookieOptions,
  timingSafeEqualStr,
  webOAuthStateMatches,
} from './oauth-state';

describe('oauth-state', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
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
