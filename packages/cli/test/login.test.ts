import { describe, it, expect } from 'vitest';
import {
  LoginError,
  classifyLoginFailure,
  fetchLoginSession,
  nonceMatches,
  startCallbackServer,
} from '../src/commands/login.js';
import {
  EXIT_SYSTEM_ERROR,
  EXIT_USER_ERROR,
  SystemError,
  UserError,
  exitCodeFor,
} from '../src/errors.js';

const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1' };
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
