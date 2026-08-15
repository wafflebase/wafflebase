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

  function contextFor(
    query: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): {
    context: ExecutionContext;
    req: Record<string, unknown>;
    res: { cookie: jest.Mock };
  } {
    const req: Record<string, unknown> = { query, headers };
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
        path: '/',
        maxAge: 5 * 60 * 1000,
      }),
    );
  });

  it.each([
    ['web', {}, '__Host-wafflebase_oauth_state'],
    [
      'CLI',
      { mode: 'cli', port: '54321', nonce: VALID_NONCE },
      '__Host-wafflebase_cli_oauth_state',
    ],
  ])('host-locks the %s state cookie in production', (_label, query, name) => {
    // Without `__Host-`, a cookie is scoped to the registrable domain:
    // anything that can write one there (a sibling subdomain, a MITM on a
    // plain-http sibling) can fix the state to a value it knows and walk
    // through the binding. The prefix makes the browser refuse that write.
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { context, res } = contextFor(query);
      expect(guard.canActivate(context)).toBe(true);
      expect(res.cookie).toHaveBeenCalledWith(
        name,
        expect.any(String),
        expect.objectContaining({ secure: true, path: '/', httpOnly: true }),
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('mints a fresh web state per request', () => {
    const first = contextFor({});
    const second = contextFor({});

    guard.canActivate(first.context);
    guard.canActivate(second.context);

    expect(first.req.__oauthState).not.toEqual(second.req.__oauthState);
  });

  it('mirrors the CLI state into its own cookie, not the web one', () => {
    // The CLI login is browser-bound too: the callback runs in the same
    // browser that started it, so a state token seen elsewhere (a shared
    // terminal, a CI log) cannot be replayed into a victim's browser. A
    // separate name so a pending web login and a pending CLI login in one
    // browser cannot clobber each other.
    const { context, req, res } = contextFor({
      mode: 'cli',
      port: '54321',
      nonce: VALID_NONCE,
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_cli_oauth_state',
      req.__oauthState as string,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(res.cookie).toHaveBeenCalledTimes(1);
  });

  /**
   * The cookies bind the *callback* to the browser. They cannot bind the
   * *start*: the navigation that carries a login-CSRF is the same
   * navigation that sets the cookie. Refusing a cross-site-initiated
   * start is what stops a hostile page from making the victim's browser
   * mint a code for an attacker-chosen loopback port.
   */
  describe('cross-site initiation', () => {
    it.each([
      ['a CLI login', { mode: 'cli', port: '54321', nonce: VALID_NONCE }],
      ['a web login', {}],
    ])('refuses %s started by another site', (_label, query) => {
      const { context, req, res } = contextFor(query, {
        'sec-fetch-site': 'cross-site',
      });

      expect(() => guard.canActivate(context)).toThrow(BadRequestException);
      expect(req.__oauthState).toBeUndefined();
      // No cookie either: a refused start must not disturb a login that
      // is already in flight in this browser.
      expect(res.cookie).not.toHaveBeenCalled();
      expect(superCanActivate).not.toHaveBeenCalled();
    });

    it.each([
      ['opened by the CLI itself', 'none'],
      ['clicked inside the app', 'same-origin'],
      ['clicked on a sibling host of the app', 'same-site'],
    ])('serves a login %s', (_label, site) => {
      const { context, req } = contextFor(
        { mode: 'cli', port: '54321', nonce: VALID_NONCE },
        { 'sec-fetch-site': site },
      );

      expect(guard.canActivate(context)).toBe(true);
      expect(typeof req.__oauthState).toBe('string');
    });

    it('serves a client that sends no Sec-Fetch-Site at all', () => {
      // Not the attack shape: the attack needs the victim's browser and
      // its GitHub session, and every browser that can be steered
      // cross-site sends the header.
      const { context, req } = contextFor({});

      expect(guard.canActivate(context)).toBe(true);
      expect(typeof req.__oauthState).toBe('string');
    });
  });
});
