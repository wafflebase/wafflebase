import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createProgram } from '../src/commands/root.js';
import { registerSheetsChartsCommand } from '../src/commands/sheets-charts.js';

/**
 * Drives the REAL command through commander rather than a stand-in, because
 * the behaviours worth guarding here — where the payload-shape check sits
 * relative to the dry-run branch, that the previewed body is the wire body,
 * and which client method each subcommand reaches for — live in the action
 * handler's wiring, not in any function it calls.
 */

const getCharts = vi.fn();
const setCharts = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    getCharts = (...a: unknown[]) => getCharts(...a);
    setCharts = (...a: unknown[]) => setCharts(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';

const CHART = {
  id: 'chart-1',
  type: 'bar',
  sourceTabId: 'tab-1',
  sourceRange: 'A1:B10',
  anchor: 'D2',
  offsetX: 0,
  offsetY: 0,
  width: 480,
  height: 320,
};

function run(argv: string[]) {
  const program = createProgram();
  // A `charts` group hangs off `sheets` in the real CLI; the parent is
  // irrelevant to these assertions, so mount it on a bare namespace.
  registerSheetsChartsCommand(program.command('sheets'));
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

describe('sheets charts commands', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    getCharts.mockReset();
    setCharts.mockReset();
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

  describe('get', () => {
    it('reads the charts endpoint for the default tab', async () => {
      getCharts.mockResolvedValue({
        ok: true,
        status: 200,
        data: { charts: [CHART] },
      });

      await run(['sheets', 'charts', 'get', 'doc-1']);

      expect(getCharts).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({ charts: [CHART] });
    });

    it('targets the tab named by --tab', async () => {
      getCharts.mockResolvedValue({
        ok: true,
        status: 200,
        data: { charts: [] },
      });

      await run(['sheets', 'charts', 'get', 'doc-1', '--tab', 'tab-9']);

      expect(getCharts).toHaveBeenCalledWith('doc-1', 'tab-9');
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'charts', 'get', 'doc-1', '--dry-run']);

      expect(getCharts).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/doc-1/tabs/tab-1/charts`,
      });
    });

    it('envelopes an upstream failure instead of printing a body', async () => {
      // A non-sheet document answers 400 here; the CLI must surface that as
      // the error envelope, not as a success payload.
      getCharts.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run(['sheets', 'charts', 'get', 'doc-1']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });

    it('rejects a bad --format before reading the charts', async () => {
      await run(['sheets', 'charts', 'get', 'doc-1', '--format', 'bogus']);

      expect(getCharts).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('set', () => {
    it('puts the chart array from --data', async () => {
      setCharts.mockResolvedValue({
        ok: true,
        status: 200,
        data: { charts: [CHART] },
      });

      await run([
        'sheets',
        'charts',
        'set',
        'doc-1',
        '--data',
        JSON.stringify([CHART]),
      ]);

      expect(setCharts).toHaveBeenCalledWith('doc-1', 'tab-1', [CHART]);
      expect(JSON.parse(stdout.join('\n'))).toEqual({ charts: [CHART] });
    });

    it('accepts the `{ charts: [...] }` shape `get` prints, so the two pipe together', async () => {
      setCharts.mockResolvedValue({
        ok: true,
        status: 200,
        data: { charts: [CHART] },
      });

      await run([
        'sheets',
        'charts',
        'set',
        'doc-1',
        '--data',
        JSON.stringify({ charts: [CHART] }),
      ]);

      // Unwrapped, not forwarded: the client wraps its argument as
      // `{ charts }`, so passing the envelope through would send
      // `{ charts: { charts: [...] } }` and earn a 400.
      expect(setCharts).toHaveBeenCalledWith('doc-1', 'tab-1', [CHART]);
    });

    it('sends an empty array as an explicit "delete every chart"', async () => {
      setCharts.mockResolvedValue({
        ok: true,
        status: 200,
        data: { charts: [] },
      });

      await run(['sheets', 'charts', 'set', 'doc-1', '--data', '[]']);

      expect(setCharts).toHaveBeenCalledWith('doc-1', 'tab-1', []);
    });

    it('prints the wire body without sending it under --dry-run', async () => {
      await run([
        'sheets',
        'charts',
        'set',
        'doc-1',
        '--tab',
        'tab-2',
        '--data',
        JSON.stringify([CHART]),
        '--dry-run',
      ]);

      expect(setCharts).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/doc-1/tabs/tab-2/charts`,
        body: { charts: [CHART] },
      });
    });

    it('names --data as the source of a malformed payload', async () => {
      await run(['sheets', 'charts', 'set', 'doc-1', '--data', '{nope']);

      expect(setCharts).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { message: string };
      };
      expect(err.error.message).toMatch(/Invalid JSON chart data in --data/);
    });

    it('rejects a payload that is neither an array nor { charts: [...] }', async () => {
      await run([
        'sheets',
        'charts',
        'set',
        'doc-1',
        '--data',
        JSON.stringify({ chart: CHART }),
      ]);

      expect(setCharts).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { message: string };
      };
      expect(err.error.message).toMatch(/expected a JSON array of charts/);
    });

    it('rejects a bad payload shape BEFORE the dry-run branch', async () => {
      // A dry run whose printed request the server would reject is worse than
      // no dry run at all — the point of the flag is to show what would happen.
      await run([
        'sheets',
        'charts',
        'set',
        'doc-1',
        '--data',
        '"not-a-list"',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
    });

    it('envelopes a rejected write instead of printing a body', async () => {
      setCharts.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run([
        'sheets',
        'charts',
        'set',
        'doc-1',
        '--data',
        JSON.stringify([CHART]),
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });

    // `format()` throws on an unsupported `--format`. If that throw fires
    // after the request, a completed write reports exit 1 / INVALID_FORMAT
    // with the server's response discarded — and this write REPLACED the
    // whole chart collection, so the guard has to run first.
    it('rejects a bad --format before replacing the charts', async () => {
      await run([
        'sheets',
        'charts',
        'set',
        'doc-1',
        '--data',
        JSON.stringify([CHART]),
        '--format',
        'bogus',
      ]);

      expect(setCharts).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });
  });
});

describe('sheets charts command registration', () => {
  it('mounts get and set under a `charts` group aliased `chart`', () => {
    const sheets = new Command('sheets');
    registerSheetsChartsCommand(sheets);
    const charts = sheets.commands.find((c) => c.name() === 'charts');
    expect(charts?.aliases()).toEqual(['chart']);
    expect(charts?.commands.map((c) => c.name()).sort()).toEqual([
      'get',
      'set',
    ]);
  });
});
