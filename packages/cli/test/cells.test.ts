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
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({ cells: { A1: { value: '1' } } });
  });

  // docs/design/rest-api.md §5.3 shows the raw REST body as
  // `{"cells": {...}}`. Passing that same shape into `--data` used to
  // double-wrap it into `{"cells":{"cells":{...}}}`, which the backend
  // read as a single bad ref named "cells" and 500'd on.
  it('unwraps an already-enveloped {cells: {...}} --data payload', async () => {
    await run([
      'sheets',
      'cells',
      'batch',
      'doc-1',
      '--data',
      '{"cells":{"A1":{"value":"1"}}}',
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({ cells: { A1: { value: '1' } } });
  });

  // `cells` alongside real refs is not an envelope. Unwrapping it would drop
  // the siblings silently; the server's reference error is the honest answer.
  it('does not unwrap when the payload holds more than the cells key', async () => {
    await run([
      'sheets',
      'cells',
      'batch',
      'doc-1',
      '--data',
      '{"cells":{"A1":{"value":"1"}},"B2":{"value":"2"}}',
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({
      cells: { cells: { A1: { value: '1' } }, B2: { value: '2' } },
    });
  });

  // stdin is the input the issue reproduced with, and the only one that says
  // "on stdin" rather than "in --data". Both were untested.
  function withStdin(payload: string): () => void {
    const original = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: (async function* () {
        yield Buffer.from(payload);
      })(),
    });
    return () => Object.defineProperty(process, 'stdin', original);
  }

  it('unwraps an already-enveloped payload read from stdin', async () => {
    const restore = withStdin('{"cells":{"A1":{"value":"1"}}}');
    try {
      await run(['sheets', 'cells', 'batch', 'doc-1']);
    } finally {
      restore();
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({ cells: { A1: { value: '1' } } });
  });

  it('names stdin, not --data, when the stdin payload is not an object', async () => {
    const restore = withStdin('null');
    try {
      await run(['sheets', 'cells', 'batch', 'doc-1']);
    } finally {
      restore();
    }

    expect(JSON.parse(lastStderr()).error.message).toBe(
      'Cell data on stdin must be a JSON object mapping A1 references to cell data',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  // Valid JSON of the wrong shape. Reporting these through the parse catch
  // would send the caller looking for a syntax error that isn't there.
  it.each([
    ['null', 'null'],
    ['a number', '5'],
    ['an array', '[{"value":"1"}]'],
    ['an enveloped array', '{"cells":[{"value":"1"}]}'],
  ])('rejects %s as a shape error, not a JSON error', async (_label, data) => {
    await run(['sheets', 'cells', 'batch', 'doc-1', '--data', data]);

    const body = JSON.parse(lastStderr());
    expect(body.error.message).toBe(
      'Cell data in --data must be a JSON object mapping A1 references to cell data',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
