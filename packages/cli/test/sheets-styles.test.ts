import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createProgram } from '../src/commands/root.js';
import { registerSheetsStylesCommand } from '../src/commands/sheets-styles.js';

/**
 * Drives the REAL commands through commander rather than a stand-in, because
 * what is worth guarding here — where the payload validation sits relative to
 * the dry-run branch, which client method each subcommand reaches for, and
 * that a `get | set` pipe round-trips — lives in the action handler's wiring,
 * not in any function it calls.
 */

const getRangeStyles = vi.fn();
const setRangeStyles = vi.fn();
const getSheetStyle = vi.fn();
const setSheetStyle = vi.fn();
const getColumnStyles = vi.fn();
const setColumnStyles = vi.fn();
const getRowStyles = vi.fn();
const setRowStyles = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    getRangeStyles = (...a: unknown[]) => getRangeStyles(...a);
    setRangeStyles = (...a: unknown[]) => setRangeStyles(...a);
    getSheetStyle = (...a: unknown[]) => getSheetStyle(...a);
    setSheetStyle = (...a: unknown[]) => setSheetStyle(...a);
    getColumnStyles = (...a: unknown[]) => getColumnStyles(...a);
    setColumnStyles = (...a: unknown[]) => setColumnStyles(...a);
    getRowStyles = (...a: unknown[]) => getRowStyles(...a);
    setRowStyles = (...a: unknown[]) => setRowStyles(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const DOC_BASE = `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/doc-1/tabs`;

function run(argv: string[]) {
  const program = createProgram();
  // These groups hang off `sheets` in the real CLI; the parent is irrelevant
  // to these assertions, so mount them on a bare namespace.
  registerSheetsStylesCommand(program.command('sheets'));
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

/**
 * Replace `process.stdin` with a finished async iterable so the stdin branch
 * of a `set` can be exercised without the suite hanging on a real tty.
 */
function withStdin(text: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin')!;
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: (async function* () {
      yield Buffer.from(text, 'utf-8');
    })(),
  });
  return () => Object.defineProperty(process, 'stdin', original);
}

describe('sheets styles commands', () => {
  let stdout: string[];
  let stderr: string[];
  const originalEnv = {
    session: process.env.WAFFLEBASE_SESSION,
    config: process.env.WAFFLEBASE_CONFIG,
  };

  beforeEach(() => {
    stdout = [];
    stderr = [];
    for (const spy of [
      getRangeStyles,
      setRangeStyles,
      getSheetStyle,
      setSheetStyle,
      getColumnStyles,
      setColumnStyles,
      getRowStyles,
      setRowStyles,
    ]) {
      spy.mockReset();
    }
    // Never let a developer's on-disk profile decide a test's server or
    // workspace; the flags above are the only source.
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

  describe('styles get', () => {
    it('reads the range-styles endpoint of the default tab', async () => {
      getRangeStyles.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rangeStyles: [] },
      });

      await run(['sheets', 'styles', 'get', 'doc-1']);

      expect(getRangeStyles).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({ rangeStyles: [] });
      expect(process.exitCode).toBeUndefined();
    });

    it('forwards an explicit --tab', async () => {
      getRangeStyles.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rangeStyles: [] },
      });

      await run(['sheets', 'styles', 'get', 'doc-1', '--tab', 'tab-9']);

      expect(getRangeStyles).toHaveBeenCalledWith('doc-1', 'tab-9');
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'styles', 'get', 'doc-1', '--dry-run']);

      expect(getRangeStyles).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${DOC_BASE}/tab-1/range-styles`,
      });
    });

    it('rejects a bad --format before the request', async () => {
      // A throw after the request would discard a response the server already
      // produced, so the guard has to run first.
      await run(['sheets', 'styles', 'get', 'doc-1', '--format', 'bogus']);

      expect(getRangeStyles).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('envelopes an upstream failure instead of printing a body', async () => {
      getRangeStyles.mockResolvedValue({ ok: false, status: 404, data: {} });

      await run(['sheets', 'styles', 'get', 'doc-1']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/404/);
    });
  });

  describe('styles set', () => {
    const patch = {
      range: [
        { r: 1, c: 1 },
        { r: 2, c: 2 },
      ],
      style: { bold: true },
    };

    it('puts a bare JSON array of patches', async () => {
      setRangeStyles.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rangeStyles: [patch] },
      });

      await run([
        'sheets',
        'styles',
        'set',
        'doc-1',
        '--data',
        JSON.stringify([patch]),
      ]);

      expect(setRangeStyles).toHaveBeenCalledWith('doc-1', 'tab-1', [patch]);
      expect(JSON.parse(stdout.join('\n'))).toEqual({ rangeStyles: [patch] });
    });

    it('accepts the envelope `styles get` prints, so get | set round-trips', async () => {
      setRangeStyles.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rangeStyles: [patch] },
      });

      await run([
        'sheets',
        'styles',
        'set',
        'doc-1',
        '--data',
        JSON.stringify({ rangeStyles: [patch] }),
      ]);

      expect(setRangeStyles).toHaveBeenCalledWith('doc-1', 'tab-1', [patch]);
    });

    it('reads the payload from stdin when --data is absent', async () => {
      const restore = withStdin(JSON.stringify([patch]));
      setRangeStyles.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rangeStyles: [patch] },
      });

      try {
        await run(['sheets', 'styles', 'set', 'doc-1']);
      } finally {
        restore();
      }

      expect(setRangeStyles).toHaveBeenCalledWith('doc-1', 'tab-1', [patch]);
    });

    it('prints the wire body without sending it under --dry-run', async () => {
      await run([
        'sheets',
        'styles',
        'set',
        'doc-1',
        '--data',
        JSON.stringify([patch]),
        '--dry-run',
      ]);

      expect(setRangeStyles).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${DOC_BASE}/tab-1/range-styles`,
        body: { rangeStyles: [patch] },
      });
    });

    it('names --data as the source of malformed JSON', async () => {
      await run(['sheets', 'styles', 'set', 'doc-1', '--data', '{']);

      const body = JSON.parse(stderr.join('\n')) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe('ERROR');
      expect(body.error.message).toContain(
        'Invalid JSON range styles in --data',
      );
      expect(setRangeStyles).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('names stdin as the source of malformed JSON', async () => {
      const restore = withStdin('not json');

      try {
        await run(['sheets', 'styles', 'set', 'doc-1']);
      } finally {
        restore();
      }

      expect(
        (JSON.parse(stderr.join('\n')) as { error: { message: string } }).error
          .message,
      ).toContain('Invalid JSON range styles on stdin');
      expect(setRangeStyles).not.toHaveBeenCalled();
    });

    it('rejects a non-array payload BEFORE the dry-run branch', async () => {
      // A dry run whose printed body the server would reject is worse than no
      // dry run at all — the point of the flag is to show what would happen.
      await run([
        'sheets',
        'styles',
        'set',
        'doc-1',
        '--data',
        '{"bold":true}',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/JSON array/);
    });

    it('envelopes an upstream rejection instead of printing a body', async () => {
      setRangeStyles.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run([
        'sheets',
        'styles',
        'set',
        'doc-1',
        '--data',
        JSON.stringify([patch]),
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });
  });

  describe('sheet-style', () => {
    it('reads the sheet-style endpoint', async () => {
      getSheetStyle.mockResolvedValue({
        ok: true,
        status: 200,
        data: { style: { bold: true } },
      });

      await run(['sheets', 'sheet-style', 'get', 'doc-1', '--tab', 'tab-2']);

      expect(getSheetStyle).toHaveBeenCalledWith('doc-1', 'tab-2');
      expect(JSON.parse(stdout.join('\n'))).toEqual({ style: { bold: true } });
    });

    it('puts a bare style object', async () => {
      setSheetStyle.mockResolvedValue({
        ok: true,
        status: 200,
        data: { style: { bold: true } },
      });

      await run([
        'sheets',
        'sheet-style',
        'set',
        'doc-1',
        '--data',
        '{"bold":true}',
      ]);

      expect(setSheetStyle).toHaveBeenCalledWith('doc-1', 'tab-1', {
        bold: true,
      });
    });

    it('unwraps the `style` envelope a get prints', async () => {
      setSheetStyle.mockResolvedValue({ ok: true, status: 200, data: {} });

      await run([
        'sheets',
        'sheet-style',
        'set',
        'doc-1',
        '--data',
        '{"style":{"bold":true}}',
      ]);

      expect(setSheetStyle).toHaveBeenCalledWith('doc-1', 'tab-1', {
        bold: true,
      });
    });

    it('passes an explicit null through as the clear', async () => {
      setSheetStyle.mockResolvedValue({
        ok: true,
        status: 200,
        data: { style: null },
      });

      await run(['sheets', 'sheet-style', 'set', 'doc-1', '--data', 'null']);

      // `null` clears; the server rejects an omitted `style` rather than
      // treating it as a clear, so the argument is always sent.
      expect(setSheetStyle).toHaveBeenCalledWith('doc-1', 'tab-1', null);
    });

    it('prints the wire body under --dry-run', async () => {
      await run([
        'sheets',
        'sheet-style',
        'set',
        'doc-1',
        '--data',
        '{"bold":true}',
        '--dry-run',
      ]);

      expect(setSheetStyle).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${DOC_BASE}/tab-1/sheet-style`,
        body: { style: { bold: true } },
      });
    });

    it('rejects a payload that is neither an object nor null', async () => {
      await run(['sheets', 'sheet-style', 'set', 'doc-1', '--data', '[1,2]']);

      expect(setSheetStyle).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/object or null/);
    });
  });

  describe('column-styles', () => {
    it('reads the column-styles endpoint', async () => {
      getColumnStyles.mockResolvedValue({
        ok: true,
        status: 200,
        data: { columnStyles: { '1': { bold: true } } },
      });

      await run(['sheets', 'column-styles', 'get', 'doc-1']);

      expect(getColumnStyles).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        columnStyles: { '1': { bold: true } },
      });
    });

    it('puts an index-keyed map, with null clearing an index', async () => {
      setColumnStyles.mockResolvedValue({
        ok: true,
        status: 200,
        data: { columnStyles: { '1': { bold: true } } },
      });

      await run([
        'sheets',
        'column-styles',
        'set',
        'doc-1',
        '--data',
        '{"1":{"bold":true},"2":null}',
      ]);

      expect(setColumnStyles).toHaveBeenCalledWith('doc-1', 'tab-1', {
        '1': { bold: true },
        '2': null,
      });
    });

    it('unwraps the `columnStyles` envelope a get prints', async () => {
      setColumnStyles.mockResolvedValue({ ok: true, status: 200, data: {} });

      await run([
        'sheets',
        'column-styles',
        'set',
        'doc-1',
        '--data',
        '{"columnStyles":{"3":{"bold":true}}}',
      ]);

      expect(setColumnStyles).toHaveBeenCalledWith('doc-1', 'tab-1', {
        '3': { bold: true },
      });
    });

    it('rejects a key that is not a 1-based index, before the dry run', async () => {
      // The server answers 400 for `"A"` / `"0"`; catching it here keeps the
      // preview honest and the message specific.
      await run([
        'sheets',
        'column-styles',
        'set',
        'doc-1',
        '--data',
        '{"A":{"bold":true}}',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(setColumnStyles).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/1-based integer indices/);
    });

    it('prints the wire body under --dry-run', async () => {
      await run([
        'sheets',
        'column-styles',
        'set',
        'doc-1',
        '--data',
        '{"1":{"bold":true}}',
        '--dry-run',
      ]);

      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${DOC_BASE}/tab-1/column-styles`,
        body: { columnStyles: { '1': { bold: true } } },
      });
    });
  });

  describe('row-styles', () => {
    it('reads the row-styles endpoint', async () => {
      getRowStyles.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rowStyles: {} },
      });

      await run(['sheets', 'row-styles', 'get', 'doc-1']);

      expect(getRowStyles).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({ rowStyles: {} });
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'row-styles', 'get', 'doc-1', '--dry-run']);

      expect(getRowStyles).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${DOC_BASE}/tab-1/row-styles`,
      });
    });

    it('puts an index-keyed map', async () => {
      setRowStyles.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rowStyles: { '2': { bold: true } } },
      });

      await run([
        'sheets',
        'row-styles',
        'set',
        'doc-1',
        '--tab',
        'tab-2',
        '--data',
        '{"2":{"bold":true}}',
      ]);

      expect(setRowStyles).toHaveBeenCalledWith('doc-1', 'tab-2', {
        '2': { bold: true },
      });
    });

    it('rejects a non-object payload', async () => {
      await run(['sheets', 'row-styles', 'set', 'doc-1', '--data', '[]']);

      expect(setRowStyles).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/object map/);
    });

    it('envelopes an upstream failure with the system exit class on a 500', async () => {
      setRowStyles.mockResolvedValue({ ok: false, status: 500, data: {} });

      await run([
        'sheets',
        'row-styles',
        'set',
        'doc-1',
        '--data',
        '{"1":{"bold":true}}',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(2);
      expect(stderr.join('\n')).toMatch(/500/);
    });
  });
});

describe('sheets styles command registration', () => {
  it('mounts a get/set pair under each style group', () => {
    const sheets = new Command('sheets');
    registerSheetsStylesCommand(sheets);

    const names = sheets.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      'column-styles',
      'row-styles',
      'sheet-style',
      'styles',
    ]);

    for (const group of sheets.commands) {
      expect(group.commands.map((c) => c.name()).sort()).toEqual([
        'get',
        'set',
      ]);
    }
  });

  it('keeps the singular aliases an older script might use', () => {
    const sheets = new Command('sheets');
    registerSheetsStylesCommand(sheets);
    const aliasesOf = (name: string) =>
      sheets.commands.find((c) => c.name() === name)?.aliases();

    expect(aliasesOf('styles')).toEqual(['style', 'range-styles']);
    expect(aliasesOf('column-styles')).toEqual(['column-style']);
    expect(aliasesOf('row-styles')).toEqual(['row-style']);
  });
});
