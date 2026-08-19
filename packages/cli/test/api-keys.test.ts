import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerApiKeysCommand } from '../src/commands/api-keys.js';
import { createProgram } from '../src/commands/root.js';

/**
 * `api-keys create` validates `--format` *before* it calls the server:
 * the response carries a raw key the server will never show again, so a
 * bad flag must not be what discards it. These tests pin that ordering
 * by asserting the HTTP request never happens — revert the ordering in
 * `api-keys.ts` and the first one fails.
 */
describe('api-keys command', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;
  const originalEnv = {
    session: process.env.WAFFLEBASE_SESSION,
    config: process.env.WAFFLEBASE_CONFIG,
  };

  beforeEach(() => {
    stdout = vi.spyOn(console, 'log').mockImplementation(() => {
      /* swallow */
    });
    stderr = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow */
    });
    // Isolate from the developer's real session / config file.
    process.env.WAFFLEBASE_SESSION = '/nonexistent/wafflebase-session.json';
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-config.yaml';
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: 'key-1', key: 'wfb_secret_shown_once' }),
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
    registerApiKeysCommand(program);
    return program.parseAsync(
      ['--api-key', 'wfb_test', '--workspace', 'ws-1', ...argv],
      { from: 'user' },
    );
  }

  function lastStderr(): string {
    return String(stderr.mock.calls.at(-1)?.[0]);
  }

  it('rejects a bad --format before minting the key', async () => {
    await run(['api-keys', 'create', 'ci-key', '--format', 'bogus']);

    // The whole point of the ordering: no key was ever created.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(lastStderr()).error.code).toBe('INVALID_FORMAT');
    expect(process.exitCode).toBe(1);
  });

  it('prints the raw key once when --format is valid', async () => {
    await run(['api-keys', 'create', 'ci-key']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
    expect(url).toContain('/workspaces/ws-1/api-keys');
    expect(init.method).toBe('POST');
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain(
      'wfb_secret_shown_once',
    );
    expect(process.exitCode).toBe(0);
  });

  it('still prints the raw key under --quiet', async () => {
    await run(['api-keys', 'create', 'ci-key', '--quiet']);

    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain(
      'wfb_secret_shown_once',
    );
  });

  it('rejects a bad --format before revoking a key', async () => {
    await run(['api-keys', 'revoke', 'key-1', '--format', 'bogus']);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(lastStderr()).error.code).toBe('INVALID_FORMAT');
    expect(process.exitCode).toBe(1);
  });

  it('rejects a bad --format on list without a request', async () => {
    await run(['api-keys', 'list', '--format', 'bogus']);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(lastStderr()).error.code).toBe('INVALID_FORMAT');
  });
});
