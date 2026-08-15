import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LoginError,
  classifyLoginFailure,
  fetchLoginSession,
  nonceMatches,
  runLogin,
  startCallbackServer,
  type LoginDeps,
} from '../src/commands/login.js';
import type { Session } from '../src/config/session.js';
import {
  EXIT_SYSTEM_ERROR,
  EXIT_USER_ERROR,
  SystemError,
  UserError,
  exitCodeFor,
} from '../src/errors.js';

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
): { impl: typeof globalThis.fetch; urls: string[] } {
  const urls: string[] = [];
  const impl: typeof globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    urls.push(url);
    if (url.endsWith('/auth/cli/exchange')) {
      return overrides.exchange ?? json(TOKENS);
    }
    if (url.endsWith('/auth/me')) return overrides.me ?? json(USER);
    if (url.endsWith('/workspaces')) {
      return overrides.workspaces ?? json(WORKSPACES);
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { impl, urls };
}

async function failureOf(
  overrides: Parameters<typeof stubFetch>[0],
): Promise<unknown> {
  const { impl } = stubFetch(overrides);
  return fetchLoginSession('https://api.example', 'code-1', impl)
    .then(() => null)
    .catch((e: unknown) => e);
}

describe('fetchLoginSession', () => {
  it('walks exchange → me → workspaces and returns the session', async () => {
    const { impl, urls } = stubFetch();
    const session = await fetchLoginSession(
      'https://api.example',
      'code-1',
      impl,
    );

    expect(urls).toEqual([
      'https://api.example/auth/cli/exchange',
      'https://api.example/auth/me',
      'https://api.example/workspaces',
    ]);
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
    const err = await fetchLoginSession('https://api.example', 'code-1', impl)
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SystemError);
    expect((err as SystemError).code).toBe('NETWORK_ERROR');
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });
});

describe('startCallbackServer', () => {
  const NONCE = 'n'.repeat(43);

  /** Hit the loopback callback listener and report what it answered. */
  async function callback(port: number, query: string): Promise<number> {
    const res = await fetch(`http://127.0.0.1:${port}/callback${query}`);
    await res.text();
    return res.status;
  }

  it('accepts a callback that echoes the nonce', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      const status = await callback(
        srv.port,
        `?code=good-code&nonce=${NONCE}`,
      );
      expect(status).toBe(200);
      await expect(srv.waitForCallback()).resolves.toBe('good-code');
    } finally {
      srv.close();
    }
  });

  it('refuses a callback with a mismatched nonce', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      expect(
        await callback(srv.port, `?code=evil-code&nonce=${'x'.repeat(43)}`),
      ).toBe(403);
      // …and does not settle: the real callback still wins afterwards.
      expect(await callback(srv.port, `?code=good-code&nonce=${NONCE}`)).toBe(
        200,
      );
      await expect(srv.waitForCallback()).resolves.toBe('good-code');
    } finally {
      srv.close();
    }
  });

  it('refuses a callback with no nonce at all', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      expect(await callback(srv.port, '?code=evil-code')).toBe(403);
      expect(await callback(srv.port, `?code=good-code&nonce=${NONCE}`)).toBe(
        200,
      );
      await expect(srv.waitForCallback()).resolves.toBe('good-code');
    } finally {
      srv.close();
    }
  });

  it('accepts a nonce-less callback when --allow-unbound-callback is set', async () => {
    const srv = await startCallbackServer(NONCE, { allowUnbound: true });
    try {
      expect(await callback(srv.port, '?code=old-server-code')).toBe(200);
      await expect(srv.waitForCallback()).resolves.toBe('old-server-code');
    } finally {
      srv.close();
    }
  });

  it('still refuses a mismatched nonce under --allow-unbound-callback', async () => {
    const srv = await startCallbackServer(NONCE, { allowUnbound: true });
    try {
      expect(
        await callback(srv.port, `?code=evil-code&nonce=${'x'.repeat(43)}`),
      ).toBe(403);
      expect(await callback(srv.port, '?code=old-server-code')).toBe(200);
      await expect(srv.waitForCallback()).resolves.toBe('old-server-code');
    } finally {
      srv.close();
    }
  });

  it('reports an ordinary timeout as a user error', async () => {
    const srv = await startCallbackServer(NONCE, { timeoutMs: 30 });
    try {
      const err = await srv
        .waitForCallback()
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LoginError);
      expect((err as Error).message).toMatch(/timed out/);
      expect(exitCodeFor(err)).toBe(EXIT_USER_ERROR);
    } finally {
      srv.close();
    }
  });

  it('never lets an injected nonce-less callback steer the failure advice', async () => {
    // The listener is reachable by any local process and by any page
    // that guesses the port. If a nonce-less callback made the CLI
    // report "the server predates nonce-bound login — re-run with
    // --allow-unbound-callback", an attacker could inject one, and the
    // victim's re-run would accept the attacker's replayed code: login
    // fixation. The advice must not be attacker-settable.
    const srv = await startCallbackServer(NONCE, { timeoutMs: 300 });
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
      expect((err as Error).message).not.toMatch(/predates/);
      expect(exitCodeFor(err)).toBe(EXIT_USER_ERROR);
    } finally {
      srv.close();
    }
  });

  it('keeps a mismatched nonce an ordinary timeout, not an old server', async () => {
    const srv = await startCallbackServer(NONCE, { timeoutMs: 300 });
    try {
      const pending = srv
        .waitForCallback()
        .then(() => null)
        .catch((e: unknown) => e);
      expect(
        await callback(srv.port, `?code=evil-code&nonce=${'x'.repeat(43)}`),
      ).toBe(403);
      const err = await pending;
      expect((err as Error).message).toMatch(/timed out/);
      expect(exitCodeFor(err)).toBe(EXIT_USER_ERROR);
    } finally {
      srv.close();
    }
  });

  it('still rejects a callback with no code, and 404s other paths', async () => {
    const srv = await startCallbackServer(NONCE);
    try {
      expect(await callback(srv.port, `?nonce=${NONCE}`)).toBe(400);
      const res = await fetch(`http://127.0.0.1:${srv.port}/other`);
      await res.text();
      expect(res.status).toBe(404);
    } finally {
      srv.close();
    }
  });
});

describe('runLogin', () => {
  /**
   * Drive the whole login flow with the browser, the callback listener,
   * the session file and the three HTTP calls stubbed at their real
   * boundaries — everything between them (nonce generation, the OAuth
   * URL, the flag wiring) is the code under test.
   */
  async function login(options: Parameters<typeof runLogin>[0]): Promise<{
    oauthUrl: string;
    listenerNonce: string;
    listenerOptions: { allowUnbound?: boolean } | undefined;
    saved: Session | null;
  }> {
    let oauthUrl = '';
    let listenerNonce = '';
    let listenerOptions: { allowUnbound?: boolean } | undefined;
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
        };
      },
      fetchLoginSession: async () => ({
        tokens: TOKENS,
        user: USER,
        workspaces: WORKSPACES,
      }),
      openBrowser: async (url) => {
        oauthUrl = url;
      },
    };

    await runLogin(options, deps);
    return { oauthUrl, listenerNonce, listenerOptions, saved };
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(listenerNonce).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(url.searchParams.get('nonce')).toBe(listenerNonce);
  });

  it('generates a fresh nonce for every login', async () => {
    const first = await login({ server: 'https://api.example' });
    const second = await login({ server: 'https://api.example' });
    expect(first.listenerNonce).not.toBe(second.listenerNonce);
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
  it('matches only the exact nonce', () => {
    expect(nonceMatches('abc', 'abc')).toBe(true);
    expect(nonceMatches('abc', 'abd')).toBe(false);
  });

  it('tolerates a differing length instead of throwing', () => {
    expect(nonceMatches('abc', 'abcd')).toBe(false);
    expect(nonceMatches('', 'abcd')).toBe(false);
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
