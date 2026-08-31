import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createProgram } from '../src/commands/root.js';
import { registerSheetsDimensionsCommand } from '../src/commands/sheets-dimensions.js';

/**
 * Drives the REAL commands through commander rather than a stand-in, because
 * the behaviours worth guarding here — the wire body each `set` builds, where
 * the JSON parse sits relative to the dry-run branch, and which client method
 * each subcommand reaches for — live in the action handler's wiring, not in
 * any function it calls.
 */

const getColumnWidths = vi.fn();
const setColumnWidths = vi.fn();
const getRowHeights = vi.fn();
const setRowHeights = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    getColumnWidths = (...a: unknown[]) => getColumnWidths(...a);
    setColumnWidths = (...a: unknown[]) => setColumnWidths(...a);
    getRowHeights = (...a: unknown[]) => getRowHeights(...a);
    setRowHeights = (...a: unknown[]) => setRowHeights(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const BASE = `${SERVER}/api/v1/workspaces/${WORKSPACE}`;

function run(argv: string[]) {
  const program = createProgram();
  // Both groups hang off `sheets` in the real CLI; the parent is irrelevant
  // to these assertions, so mount them on a bare namespace.
  registerSheetsDimensionsCommand(program.command('sheets'));
  return program.parseAsync(
    [
      '--server',
      SERVER,
      '--workspace',
      WORKSPACE,
      '--api-key',
      'wfb_test',
      ...argv,
    ],
    { from: 'user' },
  );
}

describe('sheets dimensions commands', () => {
  let stdout: string[];
  let stderr: string[];
  const originalEnv = {
    session: process.env.WAFFLEBASE_SESSION,
    config: process.env.WAFFLEBASE_CONFIG,
  };

  beforeEach(() => {
    stdout = [];
    stderr = [];
    getColumnWidths.mockReset();
    setColumnWidths.mockReset();
    getRowHeights.mockReset();
    setRowHeights.mockReset();
    // Never let a developer's on-disk session/profile answer for the flags.
    process.env.WAFFLEBASE_SESSION = '/nonexistent/wafflebase-session.json';
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-config.yaml';
    vi.spyOn(console, 'log').mockImplementation((v) => {
      stdout.push(String(v));
    });
    vi.spyOn(console, 'error').mockImplementation((v) => {
      stderr.push(String(v));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const [key, value] of [
      ['WAFFLEBASE_SESSION', originalEnv.session],
      ['WAFFLEBASE_CONFIG', originalEnv.config],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('column-widths get', () => {
    it('reads the column-widths endpoint with the default tab', async () => {
      getColumnWidths.mockResolvedValue({
        ok: true,
        status: 200,
        data: { columnWidths: { '1': 140 } },
      });

      await run(['sheets', 'column-widths', 'get', 'doc-1']);

      expect(getColumnWidths).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        columnWidths: { '1': 140 },
      });
      expect(process.exitCode).toBeUndefined();
    });

    it('passes an explicit --tab through', async () => {
      getColumnWidths.mockResolvedValue({
        ok: true,
        status: 200,
        data: { columnWidths: {} },
      });

      await run(['sheets', 'column-widths', 'get', 'doc-1', '--tab', 'tab-9']);

      expect(getColumnWidths).toHaveBeenCalledWith('doc-1', 'tab-9');
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'column-widths', 'get', 'doc-1', '--dry-run']);

      expect(getColumnWidths).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1/tabs/tab-1/column-widths`,
      });
    });

    it('envelopes an upstream rejection instead of printing a body', async () => {
      // A non-sheet document comes back 400; the CLI must surface that as
      // the error envelope, not as a success payload.
      getColumnWidths.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run(['sheets', 'column-widths', 'get', 'doc-1']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });
  });

  describe('column-widths set', () => {
    it('sends the parsed index map to the client', async () => {
      setColumnWidths.mockResolvedValue({
        ok: true,
        status: 200,
        data: { columnWidths: { '1': 200 } },
      });

      await run([
        'sheets',
        'column-widths',
        'set',
        'doc-1',
        '--data',
        '{"1":200,"3":null}',
      ]);

      // The bare map is what the command owns; the `{ columnWidths }`
      // envelope is the wire format and belongs to `HttpClient`.
      expect(setColumnWidths).toHaveBeenCalledWith('doc-1', 'tab-1', {
        '1': 200,
        '3': null,
      });
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        columnWidths: { '1': 200 },
      });
    });

    it('previews the enveloped PUT body under --dry-run', async () => {
      await run([
        'sheets',
        'column-widths',
        'set',
        'doc-1',
        '--tab',
        'tab-2',
        '--data',
        '{"2":80}',
        '--dry-run',
      ]);

      expect(setColumnWidths).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${BASE}/documents/doc-1/tabs/tab-2/column-widths`,
        body: { columnWidths: { '2': 80 } },
      });
    });

    it('names --data as the source of a malformed payload', async () => {
      // Would reject the action's promise (raw stack trace) if the parse
      // sat outside the try block.
      await expect(
        run(['sheets', 'column-widths', 'set', 'doc-1', '--data', '{']),
      ).resolves.toBeDefined();

      const body = JSON.parse(stderr.join('\n')) as {
        error: { code: string; message: string; command: string };
      };
      expect(body.error.code).toBe('ERROR');
      expect(body.error.message).toContain(
        'Invalid JSON column width data in --data',
      );
      expect(body.error.command).toBe('sheets.column-widths.set');
      expect(setColumnWidths).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('does not reach the dry-run preview with malformed JSON', async () => {
      await run([
        'sheets',
        'column-widths',
        'set',
        'doc-1',
        '--data',
        'nope',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(JSON.parse(stderr.join('\n')).error.code).toBe('ERROR');
    });

    it('envelopes an upstream rejection instead of printing a body', async () => {
      // A key that is not a 1-based index is a 400 from the controller's
      // `parseIndexKeyedSizes`.
      setColumnWidths.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run([
        'sheets',
        'column-widths',
        'set',
        'doc-1',
        '--data',
        '{"1":200}',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });
  });

  describe('row-heights get', () => {
    it('reads the row-heights endpoint', async () => {
      getRowHeights.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rowHeights: { '1': 32 } },
      });

      await run(['sheets', 'row-heights', 'get', 'doc-1']);

      expect(getRowHeights).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        rowHeights: { '1': 32 },
      });
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'row-heights', 'get', 'doc-1', '--dry-run']);

      expect(getRowHeights).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1/tabs/tab-1/row-heights`,
      });
    });
  });

  describe('row-heights set', () => {
    it('sends the parsed index map to the client', async () => {
      setRowHeights.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rowHeights: { '4': 48 } },
      });

      await run([
        'sheets',
        'row-heights',
        'set',
        'doc-1',
        '--data',
        '{"4":48,"5":null}',
      ]);

      expect(setRowHeights).toHaveBeenCalledWith('doc-1', 'tab-1', {
        '4': 48,
        '5': null,
      });
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        rowHeights: { '4': 48 },
      });
    });

    it('previews the enveloped PUT body under --dry-run', async () => {
      await run([
        'sheets',
        'row-heights',
        'set',
        'doc-1',
        '--data',
        '{"4":48}',
        '--dry-run',
      ]);

      expect(setRowHeights).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${BASE}/documents/doc-1/tabs/tab-1/row-heights`,
        body: { rowHeights: { '4': 48 } },
      });
    });

    it('names stdin as the source when --data is absent', async () => {
      // No `--data`, so the payload comes from stdin; the message has to say
      // so rather than blaming a flag the user never passed.
      const stdinChunks = ['not json'];
      vi.spyOn(process, 'stdin', 'get').mockReturnValue({
        async *[Symbol.asyncIterator]() {
          for (const chunk of stdinChunks) yield Buffer.from(chunk);
        },
      } as unknown as typeof process.stdin);

      await run(['sheets', 'row-heights', 'set', 'doc-1']);

      const body = JSON.parse(stderr.join('\n')) as {
        error: { message: string };
      };
      expect(body.error.message).toContain(
        'Invalid JSON row height data on stdin',
      );
      expect(setRowHeights).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('reads a valid payload from stdin', async () => {
      setRowHeights.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rowHeights: { '2': 24 } },
      });
      vi.spyOn(process, 'stdin', 'get').mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('{"2":');
          yield Buffer.from('24}');
        },
      } as unknown as typeof process.stdin);

      await run(['sheets', 'row-heights', 'set', 'doc-1']);

      expect(setRowHeights).toHaveBeenCalledWith('doc-1', 'tab-1', { '2': 24 });
    });
  });

  // `format()` throws on an unsupported `--format`. If that throw fires after
  // the request, a completed write reports exit 1 / INVALID_FORMAT with the
  // server's response discarded — so the guard has to run first.
  describe('--format validation ordering', () => {
    it('rejects a bad --format before reading the widths', async () => {
      await run([
        'sheets',
        'column-widths',
        'get',
        'doc-1',
        '--format',
        'bogus',
      ]);

      expect(getColumnWidths).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('rejects a bad --format before writing the heights', async () => {
      await run([
        'sheets',
        'row-heights',
        'set',
        'doc-1',
        '--data',
        '{"1":20}',
        '--format',
        'bogus',
      ]);

      expect(setRowHeights).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('still previews a dry run under an unsupported --format', async () => {
      // The dry-run branch precedes `parseOutputFormat` deliberately: the
      // preview is not rendered through `output()`, so a bad format must not
      // suppress it.
      await run([
        'sheets',
        'column-widths',
        'get',
        'doc-1',
        '--format',
        'bogus',
        '--dry-run',
      ]);

      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ dry_run: true });
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('path segment refusal', () => {
    it('envelopes a dot-segment tab id rather than rejecting the promise', async () => {
      await expect(
        run([
          'sheets',
          'column-widths',
          'set',
          'doc-1',
          '--tab',
          '..',
          '--data',
          '{"1":10}',
          '--dry-run',
        ]),
      ).resolves.toBeDefined();

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/Invalid path segment/);
    });
  });

  /**
   * Regression: the size-map `get`s print `{ columnWidths }` /
   * `{ rowHeights }`, which `set` used to wrap a second time. See the
   * matching block in sheets-view.test.ts.
   */
  describe('column-widths and row-heights get | set', () => {
    it('round-trips the real stdout of column-widths get back into set', async () => {
      const columnWidths = { 1: 180, 2: 90 };
      getColumnWidths.mockResolvedValue({
        ok: true,
        status: 200,
        data: { columnWidths },
      });
      await run(['sheets', 'column-widths', 'get', 'doc-1']);
      const piped = stdout.join('\n');
      stdout.length = 0;

      setColumnWidths.mockResolvedValue({
        ok: true,
        status: 200,
        data: { columnWidths },
      });
      await run(['sheets', 'column-widths', 'set', 'doc-1', '--data', piped]);

      expect(setColumnWidths).toHaveBeenCalledWith(
        'doc-1',
        'tab-1',
        columnWidths,
      );
    });

    it('round-trips the real stdout of row-heights get back into set', async () => {
      const rowHeights = { 1: 32, 4: null };
      getRowHeights.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rowHeights },
      });
      await run(['sheets', 'row-heights', 'get', 'doc-1']);
      const piped = stdout.join('\n');
      stdout.length = 0;

      setRowHeights.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rowHeights },
      });
      await run(['sheets', 'row-heights', 'set', 'doc-1', '--data', piped]);

      expect(setRowHeights).toHaveBeenCalledWith('doc-1', 'tab-1', rowHeights);
    });
  });
});

describe('sheets dimensions command registration', () => {
  it('mounts get and set under both groups', () => {
    const sheets = new Command('sheets');
    registerSheetsDimensionsCommand(sheets);

    const widths = sheets.commands.find((c) => c.name() === 'column-widths');
    const heights = sheets.commands.find((c) => c.name() === 'row-heights');
    expect(widths?.commands.map((c) => c.name()).sort()).toEqual([
      'get',
      'set',
    ]);
    expect(heights?.commands.map((c) => c.name()).sort()).toEqual([
      'get',
      'set',
    ]);
    expect(widths?.aliases()).toEqual(['column-width']);
    expect(heights?.aliases()).toEqual(['row-height']);
  });
});
