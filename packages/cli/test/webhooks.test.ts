import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerWebhooksCommand } from '../src/commands/webhooks.js';
import { createProgram } from '../src/commands/root.js';

/**
 * `webhooks` calls the JWT workspace routes (`/workspaces/:id/webhooks/…`),
 * never `/api/v1`, and builds every request — real or `--dry-run` — from
 * `webhooksUrl()`. These pin the method, path and body each subcommand sends.
 */
describe('webhooks command', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;
  const originalEnv = {
    session: process.env.WAFFLEBASE_SESSION,
    config: process.env.WAFFLEBASE_CONFIG,
  };

  beforeEach(() => {
    stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.WAFFLEBASE_SESSION = '/nonexistent/wafflebase-session.json';
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-config.yaml';
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ secret: 'whsec_revealed' }),
    }));
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
    registerWebhooksCommand(program);
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

  function lastRequest() {
    const [url, init] = fetchMock.mock.calls.at(-1) as [
      string,
      { method: string; body?: string },
    ];
    return {
      url,
      method: init.method,
      body: init.body ? (JSON.parse(init.body) as unknown) : undefined,
    };
  }

  function lastStderr(): string {
    return String(stderr.mock.calls.at(-1)?.[0]);
  }

  const BASE = 'https://api.example.com/workspaces/ws-1/webhooks';

  it('lists from the workspace route, not /api/v1', async () => {
    await run(['webhooks', 'list']);
    expect(lastRequest()).toMatchObject({ url: BASE, method: 'GET' });
  });

  it('creates with every filter defaulting to all', async () => {
    await run(['webhooks', 'create', 'Feed', 'https://hooks.example.com/x']);
    expect(lastRequest()).toEqual({
      url: BASE,
      method: 'POST',
      body: {
        name: 'Feed',
        url: 'https://hooks.example.com/x',
        events: [],
        documentTypes: [],
        folderIds: [],
      },
    });
  });

  it('collects repeatable filters', async () => {
    await run([
      'webhooks',
      'create',
      'Feed',
      'https://hooks.example.com/x',
      '--event',
      'document.created',
      '--event',
      'document.trashed',
      '--document-type',
      'sheet',
      '--folder',
      'f-1',
    ]);
    expect(lastRequest().body).toMatchObject({
      events: ['document.created', 'document.trashed'],
      documentTypes: ['sheet'],
      folderIds: ['f-1'],
    });
  });

  it('updates only what was named, and --all-* widens a filter', async () => {
    await run(['webhooks', 'update', 'wh-1', '--name', 'New', '--all-events']);
    expect(lastRequest()).toEqual({
      url: `${BASE}/wh-1`,
      method: 'PATCH',
      body: { name: 'New', events: [] },
    });
  });

  it('refuses an update with nothing to change, without a request', async () => {
    await run(['webhooks', 'update', 'wh-1']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(lastStderr()).error.code).toBe('INVALID_ARGUMENT');
  });

  it('refuses --all-events together with --event', async () => {
    await run([
      'webhooks',
      'update',
      'wh-1',
      '--event',
      'document.created',
      '--all-events',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(lastStderr()).error.code).toBe('INVALID_ARGUMENT');
  });

  it.each([
    [['delete', 'wh-1'], 'DELETE', `${BASE}/wh-1`],
    [['get', 'wh-1'], 'GET', `${BASE}/wh-1`],
    [['test', 'wh-1'], 'POST', `${BASE}/wh-1/test`],
    [['reveal-secret', 'wh-1'], 'POST', `${BASE}/wh-1/reveal-secret`],
    [['disable', 'wh-1'], 'POST', `${BASE}/wh-1/disable`],
    [
      ['redeliver', 'wh-1', 'd-1'],
      'POST',
      `${BASE}/wh-1/deliveries/d-1/redeliver`,
    ],
    [['deliveries', 'wh-1', 'd-1'], 'GET', `${BASE}/wh-1/deliveries/d-1`],
  ])('%j → %s %s', async (args, method, url) => {
    await run(['webhooks', ...args]);
    expect(lastRequest()).toMatchObject({ method, url });
  });

  it('rotates with an overlap, refusing a non-number locally', async () => {
    await run(['webhooks', 'rotate-secret', 'wh-1', '--overlap-hours', '48']);
    expect(lastRequest()).toEqual({
      url: `${BASE}/wh-1/rotate-secret`,
      method: 'POST',
      body: { overlapHours: 48 },
    });

    fetchMock.mockClear();
    await run(['webhooks', 'rotate-secret', 'wh-1', '--overlap-hours', 'x']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enables with recoverSince, null when not given', async () => {
    await run(['webhooks', 'enable', 'wh-1']);
    expect(lastRequest().body).toEqual({ recoverSince: null });

    await run([
      'webhooks',
      'enable',
      'wh-1',
      '--recover-since',
      '2026-11-20T00:00:00Z',
    ]);
    expect(lastRequest().body).toEqual({
      recoverSince: '2026-11-20T00:00:00Z',
    });
  });

  it('pages deliveries with the composite cursor', async () => {
    await run([
      'webhooks',
      'deliveries',
      'wh-1',
      '--status',
      'failed',
      '--limit',
      '10',
      '--before',
      '2026-11-20T00:00:00.000Z',
      '--before-id',
      'd-9',
    ]);
    const { url, method } = lastRequest();
    expect(method).toBe('GET');
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/workspaces/ws-1/webhooks/wh-1/deliveries');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      status: 'failed',
      limit: '10',
      before: '2026-11-20T00:00:00.000Z',
      beforeId: 'd-9',
    });
  });

  it('prints a revealed secret', async () => {
    await run(['webhooks', 'reveal-secret', 'wh-1']);
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('whsec_revealed');
  });

  it('rejects a bad --format before revealing or rotating', async () => {
    await run(['webhooks', 'rotate-secret', 'wh-1', '--format', 'bogus']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(lastStderr()).error.code).toBe('INVALID_FORMAT');
  });

  it('previews under --dry-run without sending', async () => {
    await run(['webhooks', 'delete', 'wh-1', '--dry-run']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain(`${BASE}/wh-1`);
  });

  it('refuses a dot-segment id', async () => {
    await run(['webhooks', 'get', '..']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
