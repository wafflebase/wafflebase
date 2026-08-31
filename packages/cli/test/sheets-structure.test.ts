import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createProgram } from '../src/commands/root.js';
import { registerSheetsStructureCommand } from '../src/commands/sheets-structure.js';

/**
 * Drives the REAL commands through commander rather than a stand-in, because
 * what is worth guarding here lives in the action handler's wiring, not in any
 * function it calls: which client method each verb reaches for, that the body
 * put on the wire is the body the `--dry-run` preview printed, and that a
 * rejected payload stops before either.
 */

const clearRange = vi.fn();
const insertAxis = vi.fn();
const deleteAxis = vi.fn();
const moveAxis = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    clearRange = (...a: unknown[]) => clearRange(...a);
    insertAxis = (...a: unknown[]) => insertAxis(...a);
    deleteAxis = (...a: unknown[]) => deleteAxis(...a);
    moveAxis = (...a: unknown[]) => moveAxis(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const TAB_BASE = `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/doc-1/tabs/tab-1`;

function run(argv: string[]) {
  const program = createProgram();
  // These verbs hang off `sheets` in the real CLI; the parent is irrelevant to
  // these assertions, so mount them on a bare namespace.
  registerSheetsStructureCommand(program.command('sheets'));
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

describe('sheets structure commands', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    clearRange.mockReset();
    insertAxis.mockReset();
    deleteAxis.mockReset();
    moveAxis.mockReset();
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

  describe('clear', () => {
    it('posts the range to the clear endpoint', async () => {
      clearRange.mockResolvedValue({
        ok: true,
        status: 200,
        data: { cleared: 30 },
      });

      await run([
        'sheets',
        'clear',
        'doc-1',
        '--data',
        '{"range":"A1:C10"}',
      ]);

      // The client wraps the string into `{ range }` itself, so the command
      // hands it the bare range — not the whole parsed body.
      expect(clearRange).toHaveBeenCalledWith('doc-1', 'tab-1', 'A1:C10');
      expect(JSON.parse(stdout.join('\n'))).toEqual({ cleared: 30 });
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run([
        'sheets',
        'clear',
        'doc-1',
        '--tab',
        'tab-2',
        '--data',
        '{"range":"A1"}',
        '--dry-run',
      ]);

      expect(clearRange).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/doc-1/tabs/tab-2/clear`,
        body: { range: 'A1' },
      });
    });

    it('drops keys the endpoint does not read, so the preview is the request', async () => {
      await run([
        'sheets',
        'clear',
        'doc-1',
        '--data',
        '{"range":"A1:B2","axis":"row"}',
        '--dry-run',
      ]);

      expect(JSON.parse(stdout.join('\n'))).toMatchObject({
        body: { range: 'A1:B2' },
      });
      expect(
        (JSON.parse(stdout.join('\n')) as { body: Record<string, unknown> })
          .body,
      ).not.toHaveProperty('axis');
    });

    it('rejects a body with no range', async () => {
      await run(['sheets', 'clear', 'doc-1', '--data', '{}']);

      expect(clearRange).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { message: string } }).error
          .message,
      ).toMatch(/'range' must be a non-empty A1 range string/);
    });
  });

  describe('insert', () => {
    it('posts the shift verbatim and echoes the response', async () => {
      insertAxis.mockResolvedValue({
        ok: true,
        status: 201,
        data: { axis: 'row', index: 2, count: 3 },
      });

      await run([
        'sheets',
        'insert',
        'doc-1',
        '--data',
        '{"axis":"row","index":2,"count":3}',
      ]);

      expect(insertAxis).toHaveBeenCalledWith('doc-1', 'tab-1', {
        axis: 'row',
        index: 2,
        count: 3,
      });
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        axis: 'row',
        index: 2,
        count: 3,
      });
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run([
        'sheets',
        'insert',
        'doc-1',
        '--data',
        '{"axis":"column","index":1,"count":2}',
        '--dry-run',
      ]);

      expect(insertAxis).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${TAB_BASE}/insert`,
        body: { axis: 'column', index: 1, count: 2 },
      });
    });

    it('rejects an axis that is neither row nor column, before the dry run', async () => {
      // A dry run whose printed request the server would reject is worse than
      // no dry run at all — the point of the flag is to show what would happen.
      await run([
        'sheets',
        'insert',
        'doc-1',
        '--data',
        '{"axis":"diagonal","index":1,"count":1}',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(insertAxis).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { message: string } }).error
          .message,
      ).toMatch(/"row" or "column"/);
    });

    it('rejects a zero or fractional index', async () => {
      await run([
        'sheets',
        'insert',
        'doc-1',
        '--data',
        '{"axis":"row","index":0,"count":1}',
      ]);

      expect(insertAxis).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { message: string } }).error
          .message,
      ).toMatch(/indices are 1-based/);
    });

    it('names --data as the source of a malformed payload', async () => {
      await run(['sheets', 'insert', 'doc-1', '--data', '{not json']);

      expect(insertAxis).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { message: string } }).error
          .message,
      ).toMatch(/Invalid JSON insert data in --data/);
    });
  });

  describe('delete', () => {
    it('sends a positive count, as the endpoint expects', async () => {
      deleteAxis.mockResolvedValue({
        ok: true,
        status: 200,
        data: { axis: 'row', index: 5, count: 2 },
      });

      await run([
        'sheets',
        'delete',
        'doc-1',
        '--data',
        '{"axis":"row","index":5,"count":2}',
      ]);

      // The engine's negative-count convention is applied server-side; a
      // negated count here would delete the wrong rows.
      expect(deleteAxis).toHaveBeenCalledWith('doc-1', 'tab-1', {
        axis: 'row',
        index: 5,
        count: 2,
      });
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ count: 2 });
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run([
        'sheets',
        'delete',
        'doc-1',
        '--data',
        '{"axis":"row","index":5,"count":2}',
        '--dry-run',
      ]);

      expect(deleteAxis).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${TAB_BASE}/delete`,
        body: { axis: 'row', index: 5, count: 2 },
      });
    });

    it('envelopes an upstream refusal instead of printing a body', async () => {
      // A structural edit on a pivot-output or datasource tab comes back 400.
      deleteAxis.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run([
        'sheets',
        'delete',
        'doc-1',
        '--data',
        '{"axis":"row","index":1,"count":1}',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });
  });

  describe('move', () => {
    it('posts the move verbatim', async () => {
      moveAxis.mockResolvedValue({
        ok: true,
        status: 200,
        data: { axis: 'row', srcIndex: 2, count: 1, dstIndex: 5 },
      });

      await run([
        'sheets',
        'move',
        'doc-1',
        '--data',
        '{"axis":"row","srcIndex":2,"count":1,"dstIndex":5}',
      ]);

      expect(moveAxis).toHaveBeenCalledWith('doc-1', 'tab-1', {
        axis: 'row',
        srcIndex: 2,
        count: 1,
        dstIndex: 5,
      });
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ dstIndex: 5 });
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run([
        'sheets',
        'move',
        'doc-1',
        '--data',
        '{"axis":"column","srcIndex":1,"count":2,"dstIndex":7}',
        '--dry-run',
      ]);

      expect(moveAxis).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${TAB_BASE}/move`,
        body: { axis: 'column', srcIndex: 1, count: 2, dstIndex: 7 },
      });
    });

    it('surfaces the 409 merge-split refusal as the error envelope', async () => {
      // The editor silently no-ops a move that would split a merged range; the
      // API refuses it, and that refusal has to reach the caller rather than
      // read as success.
      moveAxis.mockResolvedValue({
        ok: false,
        status: 409,
        data: {
          error: {
            code: 'CONFLICT',
            message: 'The move would split the merged range anchored at A1',
          },
        },
      });

      await run([
        'sheets',
        'move',
        'doc-1',
        '--data',
        '{"axis":"row","srcIndex":2,"count":1,"dstIndex":9}',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { code: string; message: string; command: string };
      };
      expect(err.error.message).toMatch(/split the merged range/);
      expect(err.error.command).toBe('sheets.move');
    });

    it('rejects a missing dstIndex', async () => {
      await run([
        'sheets',
        'move',
        'doc-1',
        '--data',
        '{"axis":"row","srcIndex":2,"count":1}',
      ]);

      expect(moveAxis).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { message: string } }).error
          .message,
      ).toMatch(/'dstIndex'/);
    });
  });

  // `format()` throws on an unsupported `--format`. If that throw fires after
  // the request, a completed structural edit reports exit 1 / INVALID_FORMAT
  // with the server's response discarded — so the guard has to run first.
  describe('--format validation ordering', () => {
    it('rejects a bad --format before inserting', async () => {
      await run([
        'sheets',
        'insert',
        'doc-1',
        '--data',
        '{"axis":"row","index":1,"count":1}',
        '--format',
        'bogus',
      ]);

      expect(insertAxis).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('still previews under --dry-run with an unsupported --format', async () => {
      // `--format` narrows the response; a preview has none, so a rejected
      // format must not suppress it.
      await run([
        'sheets',
        'move',
        'doc-1',
        '--data',
        '{"axis":"row","srcIndex":1,"count":1,"dstIndex":3}',
        '--format',
        'bogus',
        '--dry-run',
      ]);

      expect(process.exitCode).toBeUndefined();
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ dry_run: true });
    });
  });

  describe('path safety', () => {
    it('refuses a dot-segment id rather than previewing a walked-out URL', async () => {
      await run([
        'sheets',
        'insert',
        'doc-1',
        '--tab',
        '..',
        '--data',
        '{"axis":"row","index":1,"count":1}',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/Invalid/);
    });
  });
});

describe('sheets structure command registration', () => {
  it('mounts clear, insert, delete and move on the sheets namespace', () => {
    const sheets = new Command('sheets');
    registerSheetsStructureCommand(sheets);
    expect(sheets.commands.map((c) => c.name()).sort()).toEqual([
      'clear',
      'delete',
      'insert',
      'move',
    ]);
  });

  it('defaults --tab to tab-1 on every verb', () => {
    const sheets = new Command('sheets');
    registerSheetsStructureCommand(sheets);
    for (const cmd of sheets.commands) {
      expect(cmd.opts<{ tab?: string }>().tab).toBe('tab-1');
    }
  });
});
