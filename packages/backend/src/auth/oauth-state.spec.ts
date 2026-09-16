import {
  createWebOAuthState,
  isWebOAuthState,
  oauthStateCookieName,
  oauthStateCookieOptions,
  refreshCookieName,
  sessionCookieName,
  timingSafeEqualStr,
  UNPREFIXED_SESSION_COOKIE_NAMES,
  useSecureCookies,
  webOAuthStateMatches,
} from './oauth-state';

describe('oauth-state', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCallbackUrl = process.env.GITHUB_CALLBACK_URL;
  const originalGoogleCallbackUrl = process.env.GOOGLE_CALLBACK_URL;
  const originalCookieSecure = process.env.COOKIE_SECURE;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalCallbackUrl === undefined) delete process.env.GITHUB_CALLBACK_URL;
    else process.env.GITHUB_CALLBACK_URL = originalCallbackUrl;
    if (originalGoogleCallbackUrl === undefined)
      delete process.env.GOOGLE_CALLBACK_URL;
    else process.env.GOOGLE_CALLBACK_URL = originalGoogleCallbackUrl;
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

    /**
     * The session and refresh cookies are the ones worth stealing, and they
     * are open to the same tossing in the other direction: a sibling
     * subdomain that can write `wafflebase_session=<its own JWT>;
     * Domain=<parent>` puts the victim in the attacker's account. They take
     * the prefix on exactly the same condition, from the same helper, so the
     * name cannot drift from the `Secure` flag it requires.
     */
    it('prefixes the session cookies with the same rule', () => {
      process.env.NODE_ENV = 'production';
      expect(sessionCookieName()).toBe('__Host-wafflebase_session');
      expect(refreshCookieName()).toBe('__Host-wafflebase_refresh');

      process.env.NODE_ENV = 'development';
      expect(sessionCookieName()).toBe('wafflebase_session');
      expect(refreshCookieName()).toBe('wafflebase_refresh');
    });

    /**
     * Expiry, not acceptance: sign-out has to reach a cookie written before
     * the prefix applied, while the read path deliberately follows only the
     * current name.
     */
    it('keeps the bare names for expiry', () => {
      expect(UNPREFIXED_SESSION_COOKIE_NAMES).toEqual([
        'wafflebase_session',
        'wafflebase_refresh',
      ]);
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

    /**
     * `GOOGLE_CALLBACK_URL` is not a second source of truth for this answer,
     * in either direction.
     *
     * `useSecureCookies()` is read by far more than the cookie flag —
     * `cliLoginAvailable()`, `insecureProductionOrigin()`, the CLI consent
     * cookie and the `returnTo` cookie all move with it — and Google's
     * callback URL says nothing about the origin *GitHub* reaches when
     * `GITHUB_CALLBACK_URL` is unset and the OAuth app's registered URL is
     * serving the login. So adding a second provider moves none of them: a
     * deployment states its scheme with `GITHUB_CALLBACK_URL` or
     * `COOKIE_SECURE`, exactly as it did before Google sign-in existed.
     */
    it('ignores GOOGLE_CALLBACK_URL in both directions', () => {
      delete process.env.GITHUB_CALLBACK_URL;
      delete process.env.COOKIE_SECURE;

      // An https Google URL does not upgrade a non-production install...
      process.env.NODE_ENV = 'development';
      process.env.GOOGLE_CALLBACK_URL =
        'https://wafflebase.example.com/auth/google/callback';
      expect(useSecureCookies()).toBe(false);
      expect(sessionCookieName()).toBe('wafflebase_session');

      // ...and an http one does not downgrade a production install.
      process.env.NODE_ENV = 'production';
      process.env.GOOGLE_CALLBACK_URL =
        'http://localhost:3000/auth/google/callback';
      expect(useSecureCookies()).toBe(true);
      expect(sessionCookieName()).toBe('__Host-wafflebase_session');
    });

    // GitHub's is the only callback URL read, so a deployment that predates
    // Google keeps exactly the answer it had.
    it('follows the GitHub callback URL when both are set', () => {
      process.env.GITHUB_CALLBACK_URL =
        'http://localhost:3000/auth/github/callback';
      process.env.GOOGLE_CALLBACK_URL =
        'https://wafflebase.example.com/auth/google/callback';

      expect(useSecureCookies()).toBe(false);
    });

    it('falls back to NODE_ENV when no callback URL is configured', () => {
      delete process.env.GITHUB_CALLBACK_URL;
      delete process.env.GOOGLE_CALLBACK_URL;
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
