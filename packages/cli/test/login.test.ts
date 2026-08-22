import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { request as httpRequest } from 'node:http';
import {
  LoginError,
  classifyLoginFailure,
  createLoginNonce,
  createPkcePair,
  fetchLoginSession,
  isLoopbackHost,
  nonceMatches,
  runLogin,
  startCallbackServer,
  type LoginDeps,
} from '../src/commands/login.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../src/config/session.js';
import {
  EXIT_SYSTEM_ERROR,
  EXIT_USER_ERROR,
  SystemError,
  UserError,
  exitCodeFor,
} from '../src/errors.js';
import { createHash } from 'node:crypto';

/** A JWT that carries only what `decodeJwtExpiry` reads. */
const EXPIRES_AT = '2030-01-01T00:00:00.000Z';
const b64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const ACCESS_TOKEN = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({ exp: Math.floor(Date.parse(EXPIRES_AT) / 1000) }),
  'signature',
].join('.');

const TOKENS = { accessToken: ACCESS_TOKEN, refreshToken: 'refresh-1' };
const USER = { id: 7, username: 'ada', email: 'ada@example.com', photo: null };
const WORKSPACES = [{ id: 'ws-1', name: 'Team' }];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Stub `fetch` that answers each login step, letting a test override one
 * of them with a failure response.
 */
function stubFetch(
  overrides: Partial<Record<'exchange' | 'me' | 'workspaces', Response>> = {},
): {
  impl: typeof globalThis.fetch;
  urls: string[];
  bodies: Array<Record<string, unknown>>;
} {
  const urls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const impl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    urls.push(url);
    if (url.endsWith('/auth/cli/exchange')) {
      bodies.push(JSON.parse(String(init?.body)));
      return overrides.exchange ?? json(TOKENS);
    }
    if (url.endsWith('/auth/me')) return overrides.me ?? json(USER);
    if (url.endsWith('/workspaces')) {
      return overrides.workspaces ?? json(WORKSPACES);
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { impl, urls, bodies };
}

async function failureOf(
  overrides: Parameters<typeof stubFetch>[0],
): Promise<unknown> {
  const { impl } = stubFetch(overrides);
  return fetchLoginSession('https://api.example', 'code-1', 'verifier-1', impl)
    .then(() => null)
    .catch((e: unknown) => e);
}

/**
 * A request built by hand, so the `Host` header is ours to set — `fetch`
 * treats `Host` as forbidden and rewrites it.
 */
function rawHit(
  port: number,
  path: string,
  host: string,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('createLoginNonce', () => {
  it('is a 64-char hex string and differs per attempt', () => {
    const a = createLoginNonce();
    const b = createLoginNonce();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('createPkcePair', () => {
  it('publishes only the SHA-256 of a fresh verifier', () => {
    const first = createPkcePair();
    const second = createPkcePair();
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).toBe(
      createHash('sha256').update(first.verifier).digest('base64url'),
    );
  });
});

describe('fetchLoginSession', () => {
  it('walks exchange → me → workspaces and returns the session', async () => {
    const { impl, urls, bodies } = stubFetch();
    const session = await fetchLoginSession(
      'https://api.example',
      'code-1',
      'verifier-1',
      impl,
    );

    expect(urls).toEqual([
      'https://api.example/auth/cli/exchange',
      'https://api.example/auth/me',
      'https://api.example/workspaces',
    ]);
    // The PKCE verifier is what makes the code a proof-of-possession
    // credential rather than a bearer one; it must reach the exchange.
    expect(bodies[0]).toEqual({ code: 'code-1', verifier: 'verifier-1' });
    expect(session.tokens).toEqual(TOKENS);
    expect(session.user.username).toBe('ada');
    expect(session.workspaces).toEqual(WORKSPACES);
  });

  it('reports a stale or malformed code (400) as a user error', async () => {
    const err = await failureOf({ exchange: json({}, 400) });
    expect(err).toBeInstanceOf(LoginError);
    expect((err as Error).message).toContain('HTTP 400');
    expect(exitCodeFor(err)).toBe(EXIT_USER_ERROR);
  });

  it('reports a rejected exchange (401) as a system error', async () => {
    const err = await failureOf({ exchange: json({}, 401) });
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });

  it('reports a broken /auth/me (500) as a system error', async () => {
    const err = await failureOf({ me: json({}, 500) });
    expect((err as Error).message).toContain('user info');
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });

  it('reports a forbidden workspace list (403) as a system error', async () => {
    const err = await failureOf({ workspaces: json({}, 403) });
    expect((err as Error).message).toContain('workspaces');
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });

  it('reports a 404 workspace list as a user error', async () => {
    const err = await failureOf({ workspaces: json({}, 404) });
    expect(exitCodeFor(err)).toBe(EXIT_USER_ERROR);
  });

  it('turns an unreachable server into a NETWORK_ERROR system error', async () => {
    const impl: typeof globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const err = await fetchLoginSession(
      'https://api.example',
      'code-1',
      'verifier-1',
      impl,
    )
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SystemError);
    expect((err as SystemError).code).toBe('NETWORK_ERROR');
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });
});

describe('isLoopbackHost', () => {
  it('accepts only a loopback literal addressing this listener', () => {
    expect(isLoopbackHost('127.0.0.1:4321', 4321)).toBe(true);
    expect(isLoopbackHost('localhost:4321', 4321)).toBe(true);
    expect(isLoopbackHost('[::1]:4321', 4321)).toBe(true);
    expect(isLoopbackHost('127.0.0.1', 4321)).toBe(true);
    // HTTP/1.0 sends no Host; a browser always does.
    expect(isLoopbackHost(undefined, 4321)).toBe(true);
    expect(isLoopbackHost('rebind.example.com:4321', 4321)).toBe(false);
    expect(isLoopbackHost('127.0.0.1.nip.io:4321', 4321)).toBe(false);
    expect(isLoopbackHost('127.0.0.1:4322', 4321)).toBe(false);
  });
});

/**
 * The loopback callback is the login CSRF surface: the port space is
 * small enough for a web page the user visits to scan, so a `code`
 * without our per-attempt nonce (echoed back as `state`) must be
 * refused — otherwise the CLI exchanges an attacker-minted code and
 * saves a session for the wrong account.
 */
describe('startCallbackServer', () => {
  /** Hit the loopback callback listener and report what it answered. */
  async function callback(port: number, query: string): Promise<number> {
    const res = await fetch(`http://127.0.0.1:${port}/callback${query}`);
    await res.text();
    return res.status;
  }

  it('accepts a code carrying the matching state', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce);
    try {
      expect(await callback(port, `?code=good-code&state=${nonce}`)).toBe(200);
      await expect(waitForCallback()).resolves.toBe('good-code');
    } finally {
      close();
    }
  });

  it('refuses a code with a wrong or missing state and keeps waiting', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce);
    try {
      expect(
        await callback(
          port,
          `?code=attacker-code&state=${createLoginNonce()}`,
        ),
      ).toBe(403);
      expect(await callback(port, '?code=attacker-code')).toBe(403);

      // The wait is still open, so the genuine redirect can still land —
      // and it is the one that decides the code.
      expect(await callback(port, `?code=real-code&state=${nonce}`)).toBe(200);
      await expect(waitForCallback()).resolves.toBe('real-code');
    } finally {
      close();
    }
  });

  it('refuses non-GET requests', async () => {
    const nonce = createLoginNonce();
    const { port, close } = await startCallbackServer(nonce);
    try {
      const posted = await fetch(
        `http://127.0.0.1:${port}/callback?code=c&state=${nonce}`,
        { method: 'POST' },
      );
      expect(posted.status).toBe(403);
    } finally {
      close();
    }
  });

  /**
   * The nonce is the defense, not the `Origin` header. A browser,
   * extension or proxy may attach one (`Origin: null` among them) to the
   * cross-origin redirect chain that *is* our callback, and refusing on
   * that would refuse the genuine login — which, since a refusal never
   * settles the wait, hangs the command for the whole timeout.
   */
  it('accepts the genuine redirect even when it carries an Origin header', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce);
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/callback?code=real-code&state=${nonce}`,
        { headers: { Origin: 'null' } },
      );
      expect(res.status).toBe(200);
      await expect(waitForCallback()).resolves.toBe('real-code');
    } finally {
      close();
    }
  });

  it('accepts a state-less callback when --allow-unbound-callback is set', async () => {
    const nonce = createLoginNonce();
    const srv = await startCallbackServer(nonce, { allowUnbound: true });
    try {
      expect(await callback(srv.port, '?code=old-server-code')).toBe(200);
      await expect(srv.waitForCallback()).resolves.toBe('old-server-code');
    } finally {
      srv.close();
    }
  });

  it('still refuses a mismatched state under --allow-unbound-callback', async () => {
    const nonce = createLoginNonce();
    const srv = await startCallbackServer(nonce, { allowUnbound: true });
    try {
      expect(
        await callback(srv.port, `?code=evil-code&state=${createLoginNonce()}`),
      ).toBe(403);
      expect(await callback(srv.port, '?code=old-server-code')).toBe(200);
      await expect(srv.waitForCallback()).resolves.toBe('old-server-code');
    } finally {
      srv.close();
    }
  });

  /**
   * The nonce is a backend contract: a server older than this CLI does
   * not echo it, and every genuine redirect is then refused. Failing
   * silently and hanging until the timeout leaves the user with nothing
   * to act on, so the refusal has to reach the error the wait rejects
   * with.
   */
  it('names the missing state when the timeout is reached', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce, {
      timeoutMs: 150,
    });
    try {
      expect(await callback(port, '?code=c')).toBe(403);
      await expect(waitForCallback()).rejects.toThrow(/no `state`/);
      await expect(waitForCallback()).rejects.toThrow(/older than this CLI/);
    } finally {
      close();
    }
  });

  it('names a refused non-GET callback when the timeout is reached', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce, {
      timeoutMs: 150,
    });
    try {
      await fetch(`http://127.0.0.1:${port}/callback?code=c&state=${nonce}`, {
        method: 'POST',
      });
      await expect(waitForCallback()).rejects.toThrow(/non-GET/);
    } finally {
      close();
    }
  });

  it('times out with the plain message when nothing was refused', async () => {
    const { waitForCallback, close } = await startCallbackServer(
      createLoginNonce(),
      { timeoutMs: 150 },
    );
    try {
      const err = await waitForCallback()
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LoginError);
      expect((err as Error).message).toMatch(/Login timed out\./);
      expect(exitCodeFor(err)).toBe(EXIT_USER_ERROR);
    } finally {
      close();
    }
  });

  /**
   * A name under an attacker's control that resolves to `127.0.0.1` (DNS
   * rebinding) lets a remote page's requests reach this listener. The
   * nonce still guards the code, but such a request never addressed this
   * listener directly, so it is refused before it gets that far — and,
   * like every refusal, without settling the wait.
   */
  it('refuses a request addressed to a rebound host', async () => {
    const nonce = createLoginNonce();
    const { port, waitForCallback, close } = await startCallbackServer(nonce);
    try {
      const rebound = await rawHit(
        port,
        `/callback?code=rebound&state=${nonce}`,
        'attacker.example.com',
      );
      expect(rebound.status).toBe(403);

      const real = await fetch(
        `http://127.0.0.1:${port}/callback?code=real-code&state=${nonce}`,
      );
      expect(real.status).toBe(200);
      await expect(waitForCallback()).resolves.toBe('real-code');
    } finally {
      close();
    }
  });

  it('never lets an injected state-less callback steer the failure advice', async () => {
    // The listener is reachable by any local process and by any page
    // that guesses the port. If a state-less callback made the CLI
    // report "the server predates nonce-bound login — re-run with
    // --allow-unbound-callback", an attacker could inject one, and the
    // victim's re-run would accept the attacker's replayed code: login
    // fixation. Naming the cause is fine; prescribing the downgrade is
    // not, so the advice must never be attacker-settable.
    const srv = await startCallbackServer(createLoginNonce(), {
      timeoutMs: 300,
    });
    try {
      const pending = srv
        .waitForCallback()
        .then(() => null)
        .catch((e: unknown) => e);
      expect(await callback(srv.port, '?code=injected-code')).toBe(403);
      const err = await pending;
      expect(err).toBeInstanceOf(LoginError);
      expect((err as Error).message).toMatch(/timed out/);
      expect((err as Error).message).not.toMatch(/--allow-unbound-callback/);
      expect(exitCodeFor(err)).toBe(EXIT_USER_ERROR);
    } finally {
      srv.close();
    }
  });

  it('reports a mismatched state as a user-error timeout', async () => {
    const srv = await startCallbackServer(createLoginNonce(), {
      timeoutMs: 300,
    });
    try {
      const pending = srv
        .waitForCallback()
        .then(() => null)
        .catch((e: unknown) => e);
      expect(
        await callback(srv.port, `?code=evil-code&state=${createLoginNonce()}`),
      ).toBe(403);
      const err = await pending;
      expect((err as Error).message).toMatch(/timed out/);
      expect((err as Error).message).toMatch(/does not match this login/);
      expect(exitCodeFor(err)).toBe(EXIT_USER_ERROR);
    } finally {
      srv.close();
    }
  });

  it('still rejects a callback with no code, and 404s other paths', async () => {
    const nonce = createLoginNonce();
    const srv = await startCallbackServer(nonce);
    try {
      expect(await callback(srv.port, `?state=${nonce}`)).toBe(400);
      const res = await fetch(`http://127.0.0.1:${srv.port}/other`);
      await res.text();
      expect(res.status).toBe(404);
    } finally {
      srv.close();
    }
  });
});

describe('runLogin', () => {
  /** Stand-in for the loopback launch token `armLaunch` mints. */
  const LAUNCH_TOKEN = 'launch-token';
  /**
   * `announceLoginUrl` writes the URL beside the config file when stderr
   * is not a terminal, which it is not under vitest. Point the config at a
   * scratch directory so the suite never touches the developer's own
   * `~/.wafflebase`.
   */
  const configPath = join(
    mkdtempSync(join(tmpdir(), 'wb-runlogin-')),
    'config.yaml',
  );

  /**
   * Drive the whole login flow with the browser, the callback listener,
   * the session file and the three HTTP calls stubbed at their real
   * boundaries — everything between them (nonce generation, the PKCE
   * pair, the OAuth URL, the flag wiring) is the code under test.
   */
  async function login(options: Parameters<typeof runLogin>[0]): Promise<{
    oauthUrl: string;
    browserUrl: string;
    listenerNonce: string;
    listenerOptions: { allowUnbound?: boolean } | undefined;
    exchangedVerifier: string;
    saved: Session | null;
  }> {
    let oauthUrl = '';
    let browserUrl = '';
    let listenerNonce = '';
    let listenerOptions: { allowUnbound?: boolean } | undefined;
    let exchangedVerifier = '';
    let saved: Session | null = null;

    const deps: LoginDeps = {
      loadSession: () => null,
      saveSession: (session) => {
        saved = session;
      },
      startCallbackServer: async (nonce, serverOptions) => {
        listenerNonce = nonce;
        listenerOptions = serverOptions;
        return {
          port: 4321,
          waitForCallback: async () => 'code-1',
          close: () => {},
          // The authorization URL is parked behind a loopback redirect
          // rather than handed to the opener, so the secrets it carries
          // never reach a child process's argv. Record what was parked
          // (the assertions below are about that URL) and hand back the
          // stand-in the browser actually receives.
          armLaunch: (authorizationUrl) => {
            oauthUrl = authorizationUrl;
            return `http://127.0.0.1:4321/launch/${LAUNCH_TOKEN}`;
          },
        };
      },
      fetchLoginSession: async (_server, _code, verifier) => {
        exchangedVerifier = verifier;
        return { tokens: TOKENS, user: USER, workspaces: WORKSPACES };
      },
      openBrowser: async (url) => {
        browserUrl = url;
      },
    };

    await runLogin(options, deps);
    return {
      oauthUrl,
      browserUrl,
      listenerNonce,
      listenerOptions,
      exchangedVerifier,
      saved,
    };
  }

  let savedConfigEnv: string | undefined;

  beforeEach(() => {
    savedConfigEnv = process.env.WAFFLEBASE_CONFIG;
    process.env.WAFFLEBASE_CONFIG = configPath;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (savedConfigEnv === undefined) delete process.env.WAFFLEBASE_CONFIG;
    else process.env.WAFFLEBASE_CONFIG = savedConfigEnv;
    vi.restoreAllMocks();
  });

  // Opening a URL spawns a child process with that URL in its argv, which
  // any local user can read. The authorization URL carries both bindings
  // this login rests on, so what the opener gets is the loopback stand-in.
  it('hands the browser the launch URL, never the login secrets', async () => {
    const { browserUrl, oauthUrl } = await login({
      server: 'https://api.example/',
    });

    expect(browserUrl).toBe(`http://127.0.0.1:4321/launch/${LAUNCH_TOKEN}`);
    expect(browserUrl).not.toContain('nonce=');
    expect(browserUrl).not.toContain('challenge=');
    // The parked URL is the real one — the indirection must not lose it.
    expect(oauthUrl).toContain('nonce=');
  });

  it('sends the listener’s own nonce in the OAuth URL', async () => {
    // The whole binding rests on this wire: if the nonce never reaches
    // the server, the callback comes back without one and no login can
    // complete except through the downgrade flag.
    const { oauthUrl, listenerNonce } = await login({
      server: 'https://api.example/',
    });

    const url = new URL(oauthUrl);
    expect(url.origin + url.pathname).toBe('https://api.example/auth/github');
    expect(url.searchParams.get('mode')).toBe('cli');
    expect(url.searchParams.get('port')).toBe('4321');
    // The vocabulary `github-auth.guard.ts` accepts off the query.
    expect(listenerNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('nonce')).toBe(listenerNonce);
  });

  it('publishes the PKCE challenge but never the verifier', async () => {
    const { oauthUrl, exchangedVerifier } = await login({
      server: 'https://api.example',
    });
    const url = new URL(oauthUrl);
    expect(exchangedVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('challenge')).toBe(
      createHash('sha256').update(exchangedVerifier).digest('base64url'),
    );
    expect(url.search).not.toContain(exchangedVerifier);
  });

  it('generates a fresh nonce for every login', async () => {
    const first = await login({ server: 'https://api.example' });
    const second = await login({ server: 'https://api.example' });
    expect(first.listenerNonce).not.toBe(second.listenerNonce);
    expect(first.exchangedVerifier).not.toBe(second.exchangedVerifier);
  });

  it('keeps the callback bound unless --allow-unbound-callback is given', async () => {
    const { listenerOptions } = await login({ server: 'https://api.example' });
    expect(listenerOptions?.allowUnbound).toBe(false);
  });

  it('passes --allow-unbound-callback through to the listener', async () => {
    const { listenerOptions } = await login({
      server: 'https://api.example',
      allowUnboundCallback: true,
    });
    expect(listenerOptions?.allowUnbound).toBe(true);
  });

  it('saves the exchanged session against the normalized server', async () => {
    const { saved } = await login({ server: 'https://api.example/' });
    expect(saved).not.toBeNull();
    expect(saved?.server).toBe('https://api.example');
    expect(saved?.accessToken).toBe(TOKENS.accessToken);
    expect(saved?.expiresAt).toBe(EXPIRES_AT);
    expect(saved?.activeWorkspace).toBe('ws-1');
  });
});

describe('nonceMatches', () => {
  it('accepts the exact nonce', () => {
    const nonce = createLoginNonce();
    expect(nonceMatches(nonce, nonce)).toBe(true);
  });

  it('rejects a missing, short, long, or different value', () => {
    const nonce = createLoginNonce();
    expect(nonceMatches(nonce, null)).toBe(false);
    expect(nonceMatches(nonce, '')).toBe(false);
    expect(nonceMatches(nonce, nonce.slice(0, -1))).toBe(false);
    expect(nonceMatches(nonce, `${nonce}0`)).toBe(false);
    expect(nonceMatches(nonce, createLoginNonce())).toBe(false);
  });
});

describe('classifyLoginFailure', () => {
  it('classifies contract failures by their carried exit code', () => {
    expect(classifyLoginFailure(new SystemError('AUTH_ERROR', 'nope'))).toBe(
      EXIT_SYSTEM_ERROR,
    );
    expect(classifyLoginFailure(new LoginError(EXIT_USER_ERROR, 'bad'))).toBe(
      EXIT_USER_ERROR,
    );
    // An unparseable `--server` reaches `login` as a `UserError` from
    // `fetchOrThrow`; it is part of the contract, not a bug to rethrow.
    expect(classifyLoginFailure(new UserError('INVALID_URL', 'bad url'))).toBe(
      EXIT_USER_ERROR,
    );
  });

  it('leaves unclassified throws to the caller (stack trace preserved)', () => {
    expect(classifyLoginFailure(new TypeError('bug'))).toBeNull();
    expect(classifyLoginFailure('not an error')).toBeNull();
  });
});
