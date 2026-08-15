import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { CliAuthStore } from './cli-auth.store';
import {
  CLI_CONFIRM_COOKIE,
  CLI_CONFIRM_PARAM,
  CLI_STATE_COOKIE,
  CliConsentRequest,
  GitHubAuthGuard,
  loginCookieName,
  OAUTH_STATE_COOKIE,
  stateSignature,
  WEB_STATE_PREFIX,
} from './github-auth.guard';

const SECRET = 'test-secret';

/** Config for a plain-http development origin (no `__Host-` available). */
const configService = {
  get: (key: string) =>
    key === 'JWT_SECRET'
      ? SECRET
      : key === 'GITHUB_CALLBACK_URL'
        ? 'http://localhost:3000/auth/github/callback'
        : undefined,
} as unknown as ConfigService;

/** A plain-http deployment on a real hostname — cleartext, and plantable. */
function insecureConfig(): ConfigService {
  return {
    get: (key: string) =>
      key === 'JWT_SECRET'
        ? SECRET
        : key === 'GITHUB_CALLBACK_URL'
          ? 'http://app.example.test/auth/github/callback'
          : undefined,
  } as unknown as ConfigService;
}

/** The same deployment reached over https, which is the normal case. */
function httpsConfig(): ConfigService {
  return {
    get: (key: string) =>
      key === 'JWT_SECRET'
        ? SECRET
        : key === 'GITHUB_CALLBACK_URL'
          ? 'https://api.example.test/auth/github/callback'
          : undefined,
  } as unknown as ConfigService;
}

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
    expect(cookies[0].name).toBe(CLI_STATE_COOKIE);

    const state = store.consumeState(req.__oauthState as string);
    expect(state?.browserBinding).toBe(cookies[0].value);
    expect(cookies[0].value.length).toBeGreaterThan(0);
  });

  // A browser can hold both logins at once — `wafflebase login` run while a
  // sign-in waits on GitHub's consent screen. Sharing one cookie name meant
  // the second start silently overwrote the first's binding, so whichever
  // callback arrived was refused as a forgery: a login that fails for a
  // reason neither end can see.
  it('keeps the CLI binding on a cookie of its own, not the browser flow’s', () => {
    const web = contextFor({});
    guard.canActivate(web.context);
    const cli = confirmedContext(cliQuery());
    guard.canActivate(cli.context);

    expect(web.cookies[0].name).toBe(OAUTH_STATE_COOKIE);
    expect(cli.cookies[0].name).toBe(CLI_STATE_COOKIE);
    expect(cli.cookies[0].name).not.toBe(web.cookies[0].name);
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

    // The gate is one cookie, and without `Secure` it is not `__Host-`
    // prefixed — an ordinary host cookie anything on the origin (a sibling
    // subdomain, a network position on cleartext) can write. Whoever writes
    // it also holds the query half, harvested from their own start, so the
    // click a crafted link cannot carry becomes one it can: the pair below is
    // the forgery, and it must not open the gate.
    it('refuses a CLI login on a plain-http origin that is not loopback', () => {
      const exposed = new GitHubAuthGuard(store, insecureConfig());
      const { req, cookies, context } = confirmedContext(cliQuery());

      expect(() => exposed.canActivate(context)).toThrow(BadRequestException);
      // Nothing was started, and no consent page was rendered either: the
      // gate cannot be held shut here, so there is nothing to ask.
      expect(req.__oauthState).toBeUndefined();
      expect(req.__cliConsent).toBeUndefined();
      expect(cookies).toHaveLength(0);
    });

    // Loopback is the exception the whole flow exists for: planting a cookie
    // on `http://localhost` already means running code on the machine the
    // terminal is on. Refusing it would break `pnpm dev` for no gain.
    it('still starts a loopback CLI login over plain http', () => {
      const { req, context } = confirmedContext(cliQuery());
      guard.canActivate(context);

      expect(store.consumeState(req.__oauthState as string)).toMatchObject({
        port: 9876,
      });
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

  it('stores no CLI state for a non-CLI request', () => {
    const { req: web, context: webCtx } = contextFor({ nonce: 'n' });
    guard.canActivate(webCtx);
    expect(store.consumeState(web.__oauthState as string)).toBeUndefined();
    expect((web.__oauthState as string).startsWith(WEB_STATE_PREFIX)).toBe(
      true,
    );
  });

  // An unusable port used to fall through to the *browser* flow: the person
  // was walked through GitHub and issued real session cookies for a sign-in
  // they asked to hand to a terminal, while the CLI sat waiting out its
  // timeout on a callback that was never going to arrive. The port is held to
  // the same "missing and malformed are the same failure" rule as the nonce
  // and the challenge.
  it('refuses a CLI start whose port is missing or out of range', () => {
    for (const port of [undefined, '', '80', '65536', 'http', '8080.5']) {
      const query: Record<string, unknown> = {
        mode: 'cli',
        nonce: 'n',
        code_challenge: CHALLENGE,
      };
      if (port !== undefined) query.port = port;
      const { context } = contextFor(query);
      expect(() => guard.canActivate(context)).toThrow(BadRequestException);
    }
  });

  it('does not downgrade a refused CLI start into a browser login', () => {
    const { req, cookies, context } = contextFor({
      mode: 'cli',
      port: '80',
      nonce: 'n',
      code_challenge: CHALLENGE,
    });

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
    // Nothing was started: no browser `state`, no cookie, no consent page.
    expect(req.__oauthState).toBeUndefined();
    expect(req.__cliConsent).toBeUndefined();
    expect(cookies).toHaveLength(0);
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
    // The query half is the signature of the cookie, not a copy of it, so a
    // `state` this server never issued cannot be invented. It is not a
    // defence against cookie planting — `GET /auth/github` hands any caller a
    // matching pair — which is what `__Host-` below is for.
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

  // A cookie a sibling subdomain can write is not a binding — and the
  // signature is no backstop, since one unauthenticated `GET /auth/github`
  // hands out a matching (cookie, state) pair. `__Host-` is the whole of the
  // defence, so it must not be optional on a real deployment: with no
  // callback URL configured to read a scheme from, `NODE_ENV=production` is
  // taken to mean https.
  it('prefixes the state cookie with `__Host-` in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const unconfigured = {
        get: (key: string) => (key === 'JWT_SECRET' ? SECRET : undefined),
      } as unknown as ConfigService;
      const { cookies, context } = contextFor({});
      new GitHubAuthGuard(store, unconfigured).canActivate(context);

      expect(cookies[0].name).toBe(`__Host-${OAUTH_STATE_COOKIE}`);
      expect(cookies[0].options).toMatchObject({ secure: true, path: '/' });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  // The shipped image sets `NODE_ENV=production` and the self-hosting docs
  // hand out an `http://` callback URL, so a `NODE_ENV` short-circuit put
  // `Secure`/`__Host-` cookies on a plain-http origin — where the browser
  // discards them, the callback never finds its state and every login dead
  // ends at `/login?error=login_state`. The configured scheme wins.
  it('keeps the bare name on a plain-http production deployment', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const httpProd = new GitHubAuthGuard(store, insecureConfig());
      const { cookies, context } = contextFor({});
      httpProd.canActivate(context);

      expect(cookies[0].name).toBe(OAUTH_STATE_COOKIE);
      expect(cookies[0].options).toMatchObject({ secure: false });
      // And the callback looks for the very name that was set.
      expect(loginCookieName(insecureConfig(), OAUTH_STATE_COOKIE)).toBe(
        cookies[0].name,
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  // Keying the prefix on `NODE_ENV` alone dropped it on every https
  // deployment that did not happen to set the variable — a staging box, a
  // self-hosted install — leaving the forced-login CSRF wide open there. The
  // deployment's own callback URL says what its public scheme is.
  it('prefixes the cookie on an https deployment even outside production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const secureGuard = new GitHubAuthGuard(store, httpsConfig());
      const { cookies, context } = contextFor({});
      secureGuard.canActivate(context);

      expect(cookies[0].name).toBe(`__Host-${OAUTH_STATE_COOKIE}`);
      expect(cookies[0].options).toMatchObject({ secure: true, path: '/' });
      // And the callback looks for the very name that was set.
      expect(loginCookieName(httpsConfig(), OAUTH_STATE_COOKIE)).toBe(
        cookies[0].name,
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('keeps the bare name on a plain-http origin, which cannot carry `Secure`', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const httpConfig = {
        get: (key: string) =>
          key === 'GITHUB_CALLBACK_URL'
            ? 'http://localhost:3000/auth/github/callback'
            : key === 'JWT_SECRET'
              ? SECRET
              : undefined,
      } as unknown as ConfigService;
      const localGuard = new GitHubAuthGuard(store, httpConfig);
      const { cookies, context } = contextFor({});
      localGuard.canActivate(context);

      expect(cookies[0].name).toBe(OAUTH_STATE_COOKIE);
      expect(cookies[0].options).toMatchObject({ secure: false });
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
