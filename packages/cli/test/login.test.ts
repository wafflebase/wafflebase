import { describe, it, expect } from 'vitest';
import {
  LoginError,
  classifyLoginFailure,
  fetchLoginSession,
} from '../src/commands/login.js';
import {
  EXIT_SYSTEM_ERROR,
  EXIT_USER_ERROR,
  SystemError,
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

describe('classifyLoginFailure', () => {
  it('classifies contract failures by their carried exit code', () => {
    expect(classifyLoginFailure(new SystemError('AUTH_ERROR', 'nope'))).toBe(
      EXIT_SYSTEM_ERROR,
    );
    expect(classifyLoginFailure(new LoginError(EXIT_USER_ERROR, 'bad'))).toBe(
      EXIT_USER_ERROR,
    );
  });

  it('leaves unclassified throws to the caller (stack trace preserved)', () => {
    expect(classifyLoginFailure(new TypeError('bug'))).toBeNull();
    expect(classifyLoginFailure('not an error')).toBeNull();
  });
});
