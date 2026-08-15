import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { CliAuthStore } from './cli-auth.store';
import {
  CLI_CONFIRM_COOKIE,
  CLI_CONFIRM_PARAM,
  CliConsentRequest,
  GitHubAuthGuard,
  OAUTH_STATE_COOKIE,
  stateSignature,
  WEB_STATE_PREFIX,
} from './github-auth.guard';

const SECRET = 'test-secret';

const configService = {
  get: (key: string) => (key === 'JWT_SECRET' ? SECRET : undefined),
} as unknown as ConfigService;

/**
 * The guard is the only place the CLI's `nonce` and `code_challenge` enter
 * the server, and both arrive on an attacker-influenceable query string.
 *
 * Passport's own `canActivate` (the mixin this guard extends) is stubbed:
 * it would try to run the GitHub strategy and redirect. What is under test
 * is what the guard recorded on the way through.
 */
function contextFor(
  query: Record<string, unknown>,
  reqCookies: Record<string, unknown> = {},
) {
  const req: Record<string, unknown> = { query, cookies: reqCookies };
  const cookies: Array<{
    name: string;
    value: string;
    options: Record<string, unknown>;
  }> = [];
  const cleared: string[] = [];
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) =>
      cookies.push({ name, value, options }),
    clearCookie: (name: string) => cleared.push(name),
  };
  return {
    req,
    cookies,
    cleared,
    context: {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext,
  };
}

/** A syntactically valid S256 challenge (RFC 7636 §4.1). */
const CHALLENGE = createHash('sha256')
  .update(randomBytes(32).toString('base64url'))
  .digest('base64url');

describe('GitHubAuthGuard', () => {
  let store: CliAuthStore;
  let guard: GitHubAuthGuard;

  beforeEach(() => {
    const passportBase = Object.getPrototypeOf(
      GitHubAuthGuard.prototype,
    ) as Record<string, unknown>;
    jest.spyOn(passportBase, 'canActivate' as never).mockReturnValue(
      true as never,
    );
    store = new CliAuthStore();
    guard = new GitHubAuthGuard(store, configService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The token a CLI start must echo back off its consent page. */
  const CONFIRM = 'confirm-token';

  /**
   * A confirmed CLI start: the consent click's query half plus the cookie
   * half the interstitial set. Every test below that is about the *other*
   * bindings starts from here, so the consent gate is not silently what they
   * are measuring.
   */
  function confirmedContext(query: Record<string, unknown>) {
    return contextFor(
      { ...query, [CLI_CONFIRM_PARAM]: CONFIRM },
      { [CLI_CONFIRM_COOKIE]: CONFIRM },
    );
  }

  /** Run the guard and read back what it put in the store. */
  function stateFor(query: Record<string, unknown>) {
    const { req, context } = confirmedContext(query);
    guard.canActivate(context);
    const token = req.__oauthState as string | undefined;
    return token && !token.startsWith(WEB_STATE_PREFIX)
      ? store.consumeState(token)
      : undefined;
  }

  /** A CLI start URL with both required parameters filled in. */
  function cliQuery(over: Record<string, unknown> = {}) {
    return {
      mode: 'cli',
      port: '9876',
      nonce: 'n0nce-x/y',
      code_challenge: CHALLENGE,
      ...over,
    };
  }

  it('remembers the CLI nonce so the callback can echo it', () => {
    const state = stateFor(cliQuery());
    expect(state).toMatchObject({
      mode: 'cli',
      port: 9876,
      nonce: 'n0nce-x/y',
    });
  });

  it('keeps a nonce at the 128-character bound and rejects a longer one', () => {
    const atBound = 'a'.repeat(128);
    expect(stateFor(cliQuery({ nonce: atBound }))?.nonce).toBe(atBound);

    expect(() => stateFor(cliQuery({ nonce: 'a'.repeat(129) }))).toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty or non-string nonce rather than echoing it', () => {
    expect(() => stateFor(cliQuery({ nonce: '' }))).toThrow(
      BadRequestException,
    );
    // Express gives a repeated `?nonce=` as an array; it is not a nonce.
    expect(() => stateFor(cliQuery({ nonce: ['a', 'b'] }))).toThrow(
      BadRequestException,
    );
  });

  // Missing is the same failure as malformed. A login that continues without
  // the nonce is a code at a guessable loopback port with nothing tying it to
  // the flow that started it (RFC 8252 §8.9), and neither end can see the
  // downgrade — so it is refused, not started.
  it('refuses a CLI login that sends no nonce', () => {
    expect(() => stateFor({ mode: 'cli', port: '9876', code_challenge: CHALLENGE })).toThrow(
      BadRequestException,
    );
  });

  it('remembers a well-formed PKCE challenge', () => {
    expect(stateFor(cliQuery())?.codeChallenge).toBe(CHALLENGE);
  });

  // A challenge that is sent but unusable must fail the request. Storing
  // `undefined` instead would continue the login as an unchallenged,
  // bearer-only code while the client still believes it is PKCE-bound —
  // a downgrade neither end can observe.
  it('fails the request for a malformed challenge instead of dropping it', () => {
    // Too short for RFC 7636 §4.1, and outside the base64url alphabet.
    expect(() => stateFor(cliQuery({ code_challenge: 'short' }))).toThrow(
      BadRequestException,
    );
    expect(() =>
      stateFor(cliQuery({ code_challenge: `${'a'.repeat(42)}&x=1` })),
    ).toThrow(BadRequestException);
    // Express gives a repeated `?code_challenge=` as an array.
    expect(() => stateFor(cliQuery({ code_challenge: ['a', 'b'] }))).toThrow(
      BadRequestException,
    );
  });

  it('refuses a CLI login that sends no challenge', () => {
    expect(() => stateFor({ mode: 'cli', port: '9876', nonce: 'n' })).toThrow(
      BadRequestException,
    );
  });

  // The nonce and the verifier are both things an attacker who *starts* the
  // login holds. Only the cookie says the browser now completing consent is
  // the one that began it, which is what stops a state pointing at an
  // attacker-owned loopback port from being walked through by the victim.
  it('binds a CLI login to the browser that started it', () => {
    const { req, cookies, context } = confirmedContext(cliQuery());
    guard.canActivate(context);

    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(OAUTH_STATE_COOKIE);

    const state = store.consumeState(req.__oauthState as string);
    expect(state?.browserBinding).toBe(cookies[0].value);
    expect(cookies[0].value.length).toBeGreaterThan(0);
  });

  it('binds each CLI login to its own cookie value', () => {
    const first = confirmedContext(cliQuery());
    guard.canActivate(first.context);
    const second = confirmedContext(cliQuery());
    guard.canActivate(second.context);

    expect(first.cookies[0].value).not.toBe(second.cookies[0].value);
  });

  // The nonce, the challenge and the browser-binding cookie are all things
  // whoever *wrote* the start URL holds. A victim who clicks an attacker's
  // `?mode=cli&port=` link satisfies all three and hands a code to the
  // attacker's loopback listener, so a CLI start never reaches GitHub
  // unasked: it stops on an interstitial naming the port.
  describe('CLI consent gate', () => {
    it('stops an unconfirmed CLI start before GitHub', () => {
      const { req, cookies, context } = contextFor(cliQuery());

      expect(guard.canActivate(context)).toBe(true);
      // No authorization request was started: no state, nothing stored.
      expect(req.__oauthState).toBeUndefined();
      const consent = req.__cliConsent as CliConsentRequest;
      expect(consent).toMatchObject({ port: 9876, nonce: 'n0nce-x/y' });

      // The page's half of the click is set as a cookie, so the link on it
      // carries something an attacker's crafted URL cannot.
      expect(cookies).toHaveLength(1);
      expect(cookies[0].name).toBe(CLI_CONFIRM_COOKIE);
      expect(cookies[0].value).toBe(consent.confirmToken);
      expect(cookies[0].options).toMatchObject({ httpOnly: true, path: '/' });
    });

    // Otherwise the gate would be one query parameter away from useless.
    it('re-asks when the confirm parameter has no matching cookie', () => {
      const { req, context } = contextFor({
        ...cliQuery(),
        [CLI_CONFIRM_PARAM]: 'forged',
      });
      guard.canActivate(context);

      expect(req.__oauthState).toBeUndefined();
      expect(req.__cliConsent).toBeDefined();
    });

    it('re-asks when the cookie is for a different confirmation', () => {
      const { req, context } = contextFor(
        { ...cliQuery(), [CLI_CONFIRM_PARAM]: 'a'.repeat(12) },
        { [CLI_CONFIRM_COOKIE]: 'b'.repeat(12) },
      );
      guard.canActivate(context);

      expect(req.__oauthState).toBeUndefined();
      expect(req.__cliConsent).toBeDefined();
    });

    it('starts the login once the click is confirmed, and spends the token', () => {
      const { req, cleared, context } = confirmedContext(cliQuery());
      guard.canActivate(context);

      expect(req.__cliConsent).toBeUndefined();
      expect(store.consumeState(req.__oauthState as string)).toMatchObject({
        port: 9876,
      });
      expect(cleared).toContain(CLI_CONFIRM_COOKIE);
    });
  });

  it('stores no CLI state for a non-CLI request or an out-of-range port', () => {
    const { req: web, context: webCtx } = contextFor({ nonce: 'n' });
    guard.canActivate(webCtx);
    expect(store.consumeState(web.__oauthState as string)).toBeUndefined();

    const { req: low, context: lowCtx } = contextFor({
      mode: 'cli',
      port: '80',
      nonce: 'n',
      code_challenge: CHALLENGE,
    });
    guard.canActivate(lowCtx);
    expect(store.consumeState(low.__oauthState as string)).toBeUndefined();
  });

  // A browser login used to reach GitHub with no `state` at all, which left
  // the callback nothing to validate — any redirect completed a login
  // (forced-login CSRF). Every request now carries one, cookie-backed.
  it('mints a cookie-backed `state` for a browser login', () => {
    const { req, cookies, context } = contextFor({});
    guard.canActivate(context);

    const state = req.__oauthState as string;
    expect(state.startsWith(WEB_STATE_PREFIX)).toBe(true);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(OAUTH_STATE_COOKIE);
    // The query half is the *signature* of the cookie, not a copy of it.
    // Echoing the value would make the pair forgeable by anyone who can
    // plant a cookie — a sibling subdomain, an http injection — which is the
    // forced-login CSRF this exists to stop.
    expect(state.slice(WEB_STATE_PREFIX.length)).not.toBe(cookies[0].value);
    expect(state.slice(WEB_STATE_PREFIX.length)).toBe(
      stateSignature(SECRET, cookies[0].value),
    );
    // Attributes are the control, not decoration: without httpOnly a script
    // reads the half it is not supposed to have, and `path=/` is what the
    // `__Host-` prefix (production, where the name is prefixed) requires.
    expect(cookies[0].options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 5 * 60 * 1000,
    });
  });

  // A cookie a sibling subdomain can write is not a binding. In production
  // the name carries `__Host-`, which the browser only accepts from this
  // exact host, with `Secure` and `Path=/` and no `Domain`.
  it('prefixes the state cookie with `__Host-` in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { cookies, context } = contextFor({});
      guard.canActivate(context);

      expect(cookies[0].name).toBe(`__Host-${OAUTH_STATE_COOKIE}`);
      expect(cookies[0].options).toMatchObject({ secure: true, path: '/' });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('leaves the CLI state alone rather than overwriting it with a web one', () => {
    const { req, cookies, context } = confirmedContext(cliQuery());
    guard.canActivate(context);

    expect((req.__oauthState as string).startsWith(WEB_STATE_PREFIX)).toBe(
      false,
    );
    // One cookie: the CLI's own browser binding, not a second web state.
    expect(cookies).toHaveLength(1);
  });

  it('mints a fresh browser state per request', () => {
    const first = contextFor({});
    guard.canActivate(first.context);
    const second = contextFor({});
    guard.canActivate(second.context);

    expect(first.req.__oauthState).not.toBe(second.req.__oauthState);
  });
});
