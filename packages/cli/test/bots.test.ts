import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerBotsCommand } from '../src/commands/bots.js';
import { createProgram } from '../src/commands/root.js';

const BOTS = [
  {
    id: 42,
    username: 'deck-bot',
    photo: null,
    invokers: 'owner',
    owner: { id: 1, username: 'me' },
    createdAt: '2026-11-28T00:00:00.000Z',
    lastSeenAt: null,
    hosts: [],
  },
  {
    id: 7,
    username: 'sheet-bot',
    photo: null,
    invokers: 'owner',
    owner: { id: 1, username: 'me' },
    createdAt: '2026-11-28T00:00:00.000Z',
    lastSeenAt: null,
    hosts: [],
  },
];

/**
 * `bots` calls the JWT workspace routes (`/workspaces/:id/bots/…`), never
 * `/api/v1`. These pin the method, path and body each subcommand sends, and
 * how a bot name is resolved to its id.
 */
describe('bots command', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;
  const originalEnv = {
    session: process.env.WAFFLEBASE_SESSION,
    config: process.env.WAFFLEBASE_CONFIG,
  };
  const BASE = 'https://api.example.com/workspaces/ws-1/bots';

  beforeEach(() => {
    stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.WAFFLEBASE_SESSION = '/nonexistent/wafflebase-session.json';
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-config.yaml';
    // A listing for GET, the route's own answer for everything else.
    fetchMock = vi.fn(async (_url: string, init: { method: string }) => {
      if (init.method === 'GET') {
        return { ok: true, status: 200, json: async () => BOTS };
      }
      if (init.method === 'DELETE') {
        return { ok: true, status: 204, json: async () => null };
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({
          code: '4F2K-9QXD',
          expiresAt: '2026-11-28T00:10:00.000Z',
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    process.exitCode = 0;
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    vi.unstubAllGlobals();
    process.exitCode = originalExitCode;
    for (const [key, value] of [
      ['WAFFLEBASE_SESSION', originalEnv.session],
      ['WAFFLEBASE_CONFIG', originalEnv.config],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function run(argv: string[]): Promise<unknown> {
    const program = createProgram();
    registerBotsCommand(program);
    return program.parseAsync(
      [
        '--api-key',
        'wfb_test',
        '--server',
        'https://api.example.com',
        '--workspace',
        'ws-1',
        ...argv,
      ],
      { from: 'user' },
    );
  }

  function requests() {
    return fetchMock.mock.calls.map(([url, init]) => ({
      url: url as string,
      method: (init as { method: string }).method,
      body: (init as { body?: string }).body
        ? (JSON.parse((init as { body: string }).body) as unknown)
        : undefined,
    }));
  }

  function lastStdout(): unknown {
    return JSON.parse(String(stdout.mock.calls.at(-1)?.[0]));
  }

  function lastError(): { code: string; message: string } {
    return JSON.parse(String(stderr.mock.calls.at(-1)?.[0])).error;
  }

  it('list reads the workspace bots', async () => {
    await run(['bots', 'list']);

    expect(requests()).toEqual([{ url: BASE, method: 'GET', body: undefined }]);
    expect(lastStdout()).toEqual(BOTS);
  });

  it('create posts the name', async () => {
    await run(['bots', 'create', 'deck-bot']);

    expect(requests()).toEqual([
      { url: BASE, method: 'POST', body: { name: 'deck-bot' } },
    ]);
  });

  it.each(['Deck', 'a', 'deck_bot', 'deck bot', 'x'.repeat(33)])(
    'create refuses the name %j locally',
    async (name) => {
      await run(['bots', 'create', name]);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(lastError().code).toBe('INVALID_ARGUMENT');
    },
  );

  it('delete resolves a name to its id', async () => {
    await run(['bots', 'delete', 'sheet-bot']);

    expect(requests()).toEqual([
      { url: BASE, method: 'GET', body: undefined },
      { url: `${BASE}/7`, method: 'DELETE', body: undefined },
    ]);
    expect(lastStdout()).toEqual({ ok: true });
  });

  it('delete takes an id as well', async () => {
    await run(['bots', 'delete', '42']);

    expect(requests().at(-1)).toEqual({
      url: `${BASE}/42`,
      method: 'DELETE',
      body: undefined,
    });
  });

  it('pair-code asks for a code for the named bot', async () => {
    await run(['bots', 'pair-code', 'deck-bot']);

    expect(requests().at(-1)).toEqual({
      url: `${BASE}/42/pairing-codes`,
      method: 'POST',
      body: undefined,
    });
    expect(lastStdout()).toEqual({
      code: '4F2K-9QXD',
      expiresAt: '2026-11-28T00:10:00.000Z',
    });
  });

  it('reports a bot that is not in the workspace', async () => {
    await run(['bots', 'pair-code', 'ghost-bot']);

    expect(requests()).toHaveLength(1);
    const err = lastError();
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('ghost-bot');
    expect(process.exitCode).toBe(1);
  });

  it('previews a delete under --dry-run, sending only the lookup', async () => {
    await run(['--dry-run', 'bots', 'delete', 'deck-bot']);

    expect(requests().map((r) => r.method)).toEqual(['GET']);
    expect(lastStdout()).toEqual({
      dry_run: true,
      method: 'DELETE',
      url: `${BASE}/42`,
    });
  });

  it('previews a create under --dry-run without a request', async () => {
    await run(['--dry-run', 'bots', 'create', 'deck-bot']);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastStdout()).toEqual({
      dry_run: true,
      method: 'POST',
      url: BASE,
      body: { name: 'deck-bot' },
    });
  });
});
