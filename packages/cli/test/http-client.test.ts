import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpClient } from '../src/client/http-client.js';
import type { CliConfig } from '../src/config/config.js';
import { SystemError, exitCodeFor, EXIT_SYSTEM_ERROR } from '../src/errors.js';

/**
 * The API-key endpoints do not live under the workspace-scoped
 * `/api/v1` base, so they used to bypass `request()` — and with it the
 * 401 refresh-and-retry — calling `fetch` directly. They now go through
 * the same `send()` helper as everything else; these tests pin that,
 * plus the path encoding on revoke.
 */
function config(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    server: 'http://localhost:3000',
    apiKey: 'wfb_test',
    workspace: 'ws-1',
    authMode: 'api-key',
    ...overrides,
  };
}

let originalFetch: typeof globalThis.fetch;
let dir: string;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  dir = mkdtempSync(join(tmpdir(), 'wafflebase-http-client-'));
  process.env.WAFFLEBASE_SESSION = join(dir, 'session.json');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.WAFFLEBASE_SESSION;
  vi.restoreAllMocks();
});

/** Record every request and answer from a scripted queue. */
function stubFetch(responses: Array<() => Response>) {
  const calls: Array<{ url: string; method?: string; auth?: string }> = [];
  let i = 0;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(url),
      method: init?.method,
      auth: headers['Authorization'],
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve(next());
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

/**
 * A structurally valid JWT — `saveSession` decodes the access token's
 * `exp`, so the session-file test needs one with a real payload.
 */
const NEW_JWT = [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString('base64url'),
  'sig',
].join('.');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('HttpClient API-key endpoints', () => {
  it('lists keys off the management base with the auth header', async () => {
    const calls = stubFetch([() => json([{ id: 'k1' }])]);
    const res = await new HttpClient(config()).listApiKeys();

    expect(res.ok).toBe(true);
    expect(calls).toEqual([
      {
        url: 'http://localhost:3000/workspaces/ws-1/api-keys',
        method: 'GET',
        auth: 'Bearer wfb_test',
      },
    ]);
  });

  it('percent-encodes the key id on revoke', async () => {
    const calls = stubFetch([() => json({ ok: true })]);
    await new HttpClient(config()).revokeApiKey('a/b c');

    expect(calls[0].url).toBe(
      'http://localhost:3000/workspaces/ws-1/api-keys/a%2Fb%20c',
    );
    expect(calls[0].method).toBe('DELETE');
  });

  it('refreshes and retries a 401 on the management base', async () => {
    // The bug this pins: a refreshable JWT session used to be reported
    // as an auth failure purely because the call used the API-key base
    // rather than `/api/v1`.
    const responses = [
      () => json({ error: 'unauthorized' }, 401),
      () => json({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
      () => json([{ id: 'k1' }]),
    ];
    const calls = stubFetch(responses);

    const cfg = config({
      authMode: 'jwt',
      accessToken: 'stale',
      refreshToken: 'refresh-me',
    });
    const res = await new HttpClient(cfg).listApiKeys();

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      'http://localhost:3000/workspaces/ws-1/api-keys',
      'http://localhost:3000/auth/refresh',
      'http://localhost:3000/workspaces/ws-1/api-keys',
    ]);
    // The retry carries the refreshed token, not the stale one.
    expect(calls[0].auth).toBe('Bearer stale');
    expect(calls[2].auth).toBe('Bearer new-access');
    expect(cfg.accessToken).toBe('new-access');
  });

  it('persists refreshed tokens into an existing session file', async () => {
    const sessionPath = process.env.WAFFLEBASE_SESSION as string;
    writeFileSync(
      sessionPath,
      JSON.stringify({
        server: 'http://localhost:3000',
        user: { id: 1, username: 'u', email: 'e', photo: null },
        accessToken: 'stale',
        refreshToken: 'refresh-me',
        expiresAt: new Date(0).toISOString(),
        activeWorkspace: 'ws-1',
        workspaces: [],
      }),
      'utf-8',
    );

    stubFetch([
      () => json({ error: 'unauthorized' }, 401),
      () => json({ accessToken: NEW_JWT, refreshToken: 'new-refresh' }),
      () => json([]),
    ]);

    await new HttpClient(
      config({
        authMode: 'jwt',
        accessToken: 'stale',
        refreshToken: 'refresh-me',
      }),
    ).listApiKeys();

    expect(existsSync(sessionPath)).toBe(true);
    const saved = JSON.parse(readFileSync(sessionPath, 'utf-8'));
    expect(saved.accessToken).toBe(NEW_JWT);
    expect(saved.refreshToken).toBe('new-refresh');
  });

  it('reports SESSION_EXPIRED when the refresh itself is rejected', async () => {
    stubFetch([
      () => json({ error: 'unauthorized' }, 401),
      () => json({ error: 'nope' }, 401),
    ]);

    const res = await new HttpClient(
      config({
        authMode: 'jwt',
        accessToken: 'stale',
        refreshToken: 'refresh-me',
      }),
    ).listApiKeys();

    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect((res.data as { error: { code: string } }).error.code).toBe(
      'SESSION_EXPIRED',
    );
  });

  it('leaves a 401 alone for API-key auth (nothing to refresh)', async () => {
    const calls = stubFetch([() => json({ error: 'unauthorized' }, 401)]);
    const res = await new HttpClient(config()).createApiKey('ci');

    expect(res.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
  });

  it('classifies an unreachable server as a system error', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new TypeError('fetch failed'))) as typeof globalThis.fetch;

    const err = await new HttpClient(config())
      .listApiKeys()
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SystemError);
    expect((err as SystemError).code).toBe('NETWORK_ERROR');
    expect(exitCodeFor(err)).toBe(EXIT_SYSTEM_ERROR);
  });
});
