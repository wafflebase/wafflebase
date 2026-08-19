import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerCellsCommand } from '../src/commands/cells.js';
import { createProgram } from '../src/commands/root.js';

/**
 * `cells batch` takes JSON from `--data`/stdin. A parse failure is user
 * input, so it has to surface as the structured error body agents read —
 * not as an unhandled promise rejection (`bin.ts` installs no handler).
 */
describe('cells batch', () => {
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
    process.env.WAFFLEBASE_SESSION = '/nonexistent/wafflebase-session.json';
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-config.yaml';
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ updated: 1 }),
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
    const sheets = program.command('sheets');
    registerCellsCommand(sheets);
    return program.parseAsync(
      ['--api-key', 'wfb_test', '--workspace', 'ws-1', ...argv],
      { from: 'user' },
    );
  }

  function lastStderr(): string {
    return String(stderr.mock.calls.at(-1)?.[0]);
  }

  it('reports malformed --data JSON as a structured error, not a rejection', async () => {
    // Would reject the action's promise (raw stack trace) if the parse
    // sat outside the try block.
    await expect(
      run(['sheets', 'cells', 'batch', 'doc-1', '--data', '{']),
    ).resolves.toBeDefined();

    const body = JSON.parse(lastStderr());
    expect(body.error.code).toBe('ERROR');
    expect(body.error.message).toContain('Invalid JSON cell data in --data');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('does not reach the dry-run preview with malformed JSON', async () => {
    await run(['sheets', 'cells', 'batch', 'doc-1', '--data', 'nope', '--dry-run']);

    expect(JSON.parse(lastStderr()).error.code).toBe('ERROR');
    expect(stdout).not.toHaveBeenCalled();
  });

  it('sends valid --data JSON to the batch endpoint', async () => {
    await run([
      'sheets',
      'cells',
      'batch',
      'doc-1',
      '--data',
      '{"A1":{"value":"1"}}',
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });
});
