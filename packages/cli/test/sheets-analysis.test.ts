import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createProgram } from '../src/commands/root.js';
import { registerSheetsAnalysisCommand } from '../src/commands/sheets-analysis.js';

/**
 * Drives the REAL commands through commander rather than a stand-in: what is
 * worth guarding here is the wiring — which client method each subcommand
 * reaches for, that the write payload is the *unwrapped* filter/pivot object
 * (the `{ filter }` / `{ pivot }` envelope is `HttpClient`'s job, and adding it
 * twice would send `{ filter: { filter: … } }`), and where the payload check
 * sits relative to the dry-run branch.
 */

const getFilter = vi.fn();
const setFilter = vi.fn();
const getPivot = vi.fn();
const setPivot = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    getFilter = (...a: unknown[]) => getFilter(...a);
    setFilter = (...a: unknown[]) => setFilter(...a);
    getPivot = (...a: unknown[]) => getPivot(...a);
    setPivot = (...a: unknown[]) => setPivot(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const BASE = `${SERVER}/api/v1/workspaces/${WORKSPACE}`;

const FILTER = {
  startRow: 1,
  endRow: 10,
  startCol: 1,
  endCol: 3,
  columns: {},
  hiddenRows: [4, 5],
};

const PIVOT = {
  id: 'pivot-1',
  sourceTabId: 'tab-1',
  sourceRange: 'A1:C10',
  rowFields: [{ index: 0 }],
  columnFields: [],
  valueFields: [{ index: 2, summarize: 'sum' }],
  filterFields: [],
  showTotals: { rows: true, columns: false },
};

function run(argv: string[]) {
  const program = createProgram();
  // `filter` and `pivot` hang off `sheets` in the real CLI; the parent is
  // irrelevant to these assertions, so mount them on a bare namespace.
  registerSheetsAnalysisCommand(program.command('sheets'));
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

describe('sheets filter/pivot commands', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    getFilter.mockReset();
    setFilter.mockReset();
    getPivot.mockReset();
    setPivot.mockReset();
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
  });

  describe('filter get', () => {
    it('reads the filter endpoint for the default tab', async () => {
      getFilter.mockResolvedValue({
        ok: true,
        status: 200,
        data: { filter: FILTER },
      });

      await run(['sheets', 'filter', 'get', 'doc-1']);

      expect(getFilter).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({ filter: FILTER });
      expect(process.exitCode).toBeUndefined();
    });

    it('honours --tab', async () => {
      getFilter.mockResolvedValue({
        ok: true,
        status: 200,
        data: { filter: null },
      });

      await run(['sheets', 'filter', 'get', 'doc-1', '--tab', 'tab-7']);

      expect(getFilter).toHaveBeenCalledWith('doc-1', 'tab-7');
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'filter', 'get', 'doc-1', '--dry-run']);

      expect(getFilter).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1/tabs/tab-1/filter`,
      });
    });

    it('envelopes an upstream failure instead of printing a body', async () => {
      // A non-sheet document answers 400 here; the CLI must surface that as
      // the error envelope, not as a success payload.
      getFilter.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run(['sheets', 'filter', 'get', 'doc-1']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });
  });

  describe('filter set', () => {
    it('sends the filter object unwrapped to the client', async () => {
      setFilter.mockResolvedValue({
        ok: true,
        status: 200,
        data: { filter: FILTER },
      });

      await run([
        'sheets',
        'filter',
        'set',
        'doc-1',
        '--data',
        JSON.stringify(FILTER),
      ]);

      expect(setFilter).toHaveBeenCalledWith('doc-1', 'tab-1', FILTER);
      expect(JSON.parse(stdout.join('\n'))).toEqual({ filter: FILTER });
    });

    it('passes an explicit null through as the clear', async () => {
      // `null` clears; an omitted key is a 400 server-side, so the CLI has to
      // forward the null rather than drop the body.
      setFilter.mockResolvedValue({
        ok: true,
        status: 200,
        data: { filter: null },
      });

      await run(['sheets', 'filter', 'set', 'doc-1', '--data', 'null']);

      expect(setFilter).toHaveBeenCalledWith('doc-1', 'tab-1', null);
    });

    it('previews the enveloped body under --dry-run', async () => {
      await run([
        'sheets',
        'filter',
        'set',
        'doc-1',
        '--tab',
        'tab-2',
        '--data',
        JSON.stringify(FILTER),
        '--dry-run',
      ]);

      expect(setFilter).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${BASE}/documents/doc-1/tabs/tab-2/filter`,
        // `HttpClient.setFilter` wraps the argument, so the preview has to
        // show the envelope to be the request that would be sent.
        body: { filter: FILTER },
      });
    });

    it('names --data as the source of malformed JSON', async () => {
      await run(['sheets', 'filter', 'set', 'doc-1', '--data', '{oops']);

      expect(setFilter).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { message: string; command: string };
      };
      expect(err.error.message).toMatch(/Invalid JSON filter data in --data/);
      expect(err.error.command).toBe('sheets.filter.set');
    });

    it('rejects a non-object payload BEFORE the dry-run branch', async () => {
      // A preview of a request the server would reject with a 400 is worse
      // than no preview at all — the flag's job is to show what would happen.
      await run([
        'sheets',
        'filter',
        'set',
        'doc-1',
        '--data',
        '[1,2,3]',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(setFilter).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/expected a JSON object/);
    });

    it('envelopes an upstream rejection of the filter body', async () => {
      setFilter.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run(['sheets', 'filter', 'set', 'doc-1', '--data', '{}']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });

    // `format()` throws on an unsupported `--format`. If that throw fires
    // after the request, a completed write reports exit 1 / INVALID_FORMAT
    // with the server's response discarded — so the guard runs first.
    it('rejects a bad --format before writing the filter', async () => {
      await run([
        'sheets',
        'filter',
        'set',
        'doc-1',
        '--data',
        JSON.stringify(FILTER),
        '--format',
        'bogus',
      ]);

      expect(setFilter).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('still previews under an unsupported --format', async () => {
      // `--dry-run` sends nothing, so a `--format` it never reaches must not
      // turn the preview into an error.
      await run([
        'sheets',
        'filter',
        'set',
        'doc-1',
        '--data',
        'null',
        '--format',
        'bogus',
        '--dry-run',
      ]);

      expect(process.exitCode).toBeUndefined();
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({
        dry_run: true,
        body: { filter: null },
      });
    });
  });

  describe('pivot get', () => {
    it('reads the pivot endpoint', async () => {
      getPivot.mockResolvedValue({
        ok: true,
        status: 200,
        data: { pivot: PIVOT },
      });

      await run(['sheets', 'pivot', 'get', 'doc-1', '--tab', 'tab-3']);

      expect(getPivot).toHaveBeenCalledWith('doc-1', 'tab-3');
      expect(JSON.parse(stdout.join('\n'))).toEqual({ pivot: PIVOT });
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'pivot', 'get', 'doc-1', '--dry-run']);

      expect(getPivot).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1/tabs/tab-1/pivot`,
      });
    });

    it('envelopes an upstream failure', async () => {
      getPivot.mockResolvedValue({ ok: false, status: 404, data: {} });

      await run(['sheets', 'pivot', 'get', 'doc-1']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/404/);
    });
  });

  describe('pivot set', () => {
    it('sends the pivot definition unwrapped to the client', async () => {
      setPivot.mockResolvedValue({
        ok: true,
        status: 200,
        data: { pivot: PIVOT },
      });

      await run([
        'sheets',
        'pivot',
        'set',
        'doc-1',
        '--data',
        JSON.stringify(PIVOT),
      ]);

      expect(setPivot).toHaveBeenCalledWith('doc-1', 'tab-1', PIVOT);
      expect(JSON.parse(stdout.join('\n'))).toEqual({ pivot: PIVOT });
    });

    it('previews the enveloped body under --dry-run', async () => {
      await run([
        'sheets',
        'pivot',
        'set',
        'doc-1',
        '--data',
        'null',
        '--dry-run',
      ]);

      expect(setPivot).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${BASE}/documents/doc-1/tabs/tab-1/pivot`,
        body: { pivot: null },
      });
    });

    it('names stdin as the source when --data is absent', async () => {
      // No `--data`: the payload comes from stdin, which the harness feeds a
      // malformed body so the message has to name stdin, not `--data`.
      const original = Object.getOwnPropertyDescriptor(process, 'stdin');
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: (async function* () {
          yield Buffer.from('{nope');
        })(),
      });
      try {
        await run(['sheets', 'pivot', 'set', 'doc-1']);
      } finally {
        if (original) Object.defineProperty(process, 'stdin', original);
      }

      expect(setPivot).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/Invalid JSON pivot data on stdin/);
    });

    it('reads a well-formed payload from stdin', async () => {
      setPivot.mockResolvedValue({
        ok: true,
        status: 200,
        data: { pivot: PIVOT },
      });
      const original = Object.getOwnPropertyDescriptor(process, 'stdin');
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: (async function* () {
          yield Buffer.from(JSON.stringify(PIVOT));
        })(),
      });
      try {
        await run(['sheets', 'pivot', 'set', 'doc-1']);
      } finally {
        if (original) Object.defineProperty(process, 'stdin', original);
      }

      expect(setPivot).toHaveBeenCalledWith('doc-1', 'tab-1', PIVOT);
    });

    it('rejects a bad --format before writing the pivot', async () => {
      await run([
        'sheets',
        'pivot',
        'set',
        'doc-1',
        '--data',
        'null',
        '--format',
        'bogus',
      ]);

      expect(setPivot).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('envelopes an upstream rejection of the pivot body', async () => {
      setPivot.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run(['sheets', 'pivot', 'set', 'doc-1', '--data', '{}']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });
  });
});

describe('sheets filter/pivot registration', () => {
  it('mounts get and set under both groups', () => {
    const sheets = new Command('sheets');
    registerSheetsAnalysisCommand(sheets);

    expect(sheets.commands.map((c) => c.name()).sort()).toEqual([
      'filter',
      'pivot',
    ]);
    for (const name of ['filter', 'pivot']) {
      const group = sheets.commands.find((c) => c.name() === name);
      expect(group?.commands.map((c) => c.name()).sort()).toEqual([
        'get',
        'set',
      ]);
    }
  });

  it('defaults --tab to tab-1 on every subcommand', () => {
    const sheets = new Command('sheets');
    registerSheetsAnalysisCommand(sheets);

    for (const group of sheets.commands) {
      for (const sub of group.commands) {
        expect(sub.opts<{ tab?: string }>().tab).toBe('tab-1');
      }
    }
  });
});
