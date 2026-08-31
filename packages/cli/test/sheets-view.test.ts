import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createProgram } from '../src/commands/root.js';
import { registerSheetsViewCommand } from '../src/commands/sheets-view.js';

/**
 * Drives the REAL commands through commander rather than a stand-in, because
 * the behaviours worth guarding here — where the payload parse sits relative
 * to the dry-run branch, which client method each subcommand reaches for, and
 * whether the printed preview is the request that would be sent — live in the
 * action handler's wiring, not in any function it calls.
 *
 * Every write case passes `--data`: with the flag absent the handler drains
 * stdin, which in a test worker never ends.
 */

const getFreeze = vi.fn();
const setFreeze = vi.fn();
const getHidden = vi.fn();
const setHidden = vi.fn();
const getMerges = vi.fn();
const setMerges = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    getFreeze = (...a: unknown[]) => getFreeze(...a);
    setFreeze = (...a: unknown[]) => setFreeze(...a);
    getHidden = (...a: unknown[]) => getHidden(...a);
    setHidden = (...a: unknown[]) => setHidden(...a);
    getMerges = (...a: unknown[]) => getMerges(...a);
    setMerges = (...a: unknown[]) => setMerges(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const BASE = `${SERVER}/api/v1/workspaces/${WORKSPACE}`;

function run(argv: string[]) {
  const program = createProgram();
  // `freeze` / `hidden` / `merges` hang off `sheets` in the real CLI; the
  // parent is irrelevant to these assertions, so mount them on a bare
  // namespace rather than pulling in the whole sheets registration.
  registerSheetsViewCommand(program.command('sheets'));
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

describe('sheets view-state commands', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    getFreeze.mockReset();
    setFreeze.mockReset();
    getHidden.mockReset();
    setHidden.mockReset();
    getMerges.mockReset();
    setMerges.mockReset();
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

  describe('freeze', () => {
    it('reads the freeze endpoint on the default tab', async () => {
      getFreeze.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rows: 1, cols: 2 },
      });

      await run(['sheets', 'freeze', 'get', 'doc-1']);

      expect(getFreeze).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({ rows: 1, cols: 2 });
    });

    it('honours --tab', async () => {
      getFreeze.mockResolvedValue({ ok: true, status: 200, data: {} });

      await run(['sheets', 'freeze', 'get', 'doc-1', '--tab', 'tab-9']);

      expect(getFreeze).toHaveBeenCalledWith('doc-1', 'tab-9');
    });

    it('prints the read without sending it under --dry-run', async () => {
      await run(['sheets', 'freeze', 'get', 'doc-1', '--dry-run']);

      expect(getFreeze).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1/tabs/tab-1/freeze`,
      });
    });

    it('puts the parsed payload as the body verbatim', async () => {
      setFreeze.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rows: 2, cols: 0 },
      });

      await run([
        'sheets',
        'freeze',
        'set',
        'doc-1',
        '--data',
        '{"rows":2,"cols":0}',
      ]);

      // The freeze endpoint takes the payload as the body itself — no
      // envelope key — so the client argument is the parsed object as-is.
      expect(setFreeze).toHaveBeenCalledWith('doc-1', 'tab-1', {
        rows: 2,
        cols: 0,
      });
      expect(JSON.parse(stdout.join('\n'))).toEqual({ rows: 2, cols: 0 });
    });

    it('prints the write without sending it under --dry-run', async () => {
      await run([
        'sheets',
        'freeze',
        'set',
        'doc-1',
        '--data',
        '{"rows":2}',
        '--dry-run',
      ]);

      expect(setFreeze).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${BASE}/documents/doc-1/tabs/tab-1/freeze`,
        body: { rows: 2 },
      });
    });

    it('envelopes a rejected write instead of printing a body', async () => {
      // The server bounds a freeze by the grid; an out-of-range one is a 400
      // and must surface as the error envelope, not as a success payload.
      setFreeze.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run([
        'sheets',
        'freeze',
        'set',
        'doc-1',
        '--data',
        '{"rows":99999999}',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });
  });

  describe('hidden', () => {
    it('reads the hidden endpoint', async () => {
      getHidden.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rows: [1, 2], columns: [] },
      });

      await run(['sheets', 'hidden', 'get', 'doc-1', '--tab', 'tab-2']);

      expect(getHidden).toHaveBeenCalledWith('doc-1', 'tab-2');
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        rows: [1, 2],
        columns: [],
      });
    });

    it('puts the parsed payload as the body verbatim', async () => {
      setHidden.mockResolvedValue({
        ok: true,
        status: 200,
        data: { rows: [3], columns: [4] },
      });

      await run([
        'sheets',
        'hidden',
        'set',
        'doc-1',
        '--data',
        '{"rows":[3],"columns":[4]}',
      ]);

      expect(setHidden).toHaveBeenCalledWith('doc-1', 'tab-1', {
        rows: [3],
        columns: [4],
      });
    });

    it('prints the write without sending it under --dry-run', async () => {
      await run([
        'sheets',
        'hidden',
        'set',
        'doc-1',
        '--tab',
        'tab-2',
        '--data',
        '{"columns":[5]}',
        '--dry-run',
      ]);

      expect(setHidden).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${BASE}/documents/doc-1/tabs/tab-2/hidden`,
        body: { columns: [5] },
      });
    });

    it('envelopes a 404 from a missing tab as a user-class exit', async () => {
      getHidden.mockResolvedValue({ ok: false, status: 404, data: {} });

      await run(['sheets', 'hidden', 'get', 'doc-1', '--tab', 'nope']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/404/);
    });
  });

  describe('merges', () => {
    it('reads the merges endpoint', async () => {
      getMerges.mockResolvedValue({
        ok: true,
        status: 200,
        data: { merges: { A1: { rs: 2, cs: 2 } } },
      });

      await run(['sheets', 'merges', 'get', 'doc-1']);

      expect(getMerges).toHaveBeenCalledWith('doc-1', 'tab-1');
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        merges: { A1: { rs: 2, cs: 2 } },
      });
    });

    it('passes the map itself to the client, which envelopes it', async () => {
      setMerges.mockResolvedValue({
        ok: true,
        status: 200,
        data: { merges: { A1: { rs: 2, cs: 2 } } },
      });

      await run([
        'sheets',
        'merges',
        'set',
        'doc-1',
        '--data',
        '{"A1":{"rs":2,"cs":2}}',
      ]);

      // `HttpClient.setMerges` wraps the map in `{ merges }`; the payload the
      // user pipes is the bare map, matching what `merges get` prints under
      // its `merges` key.
      expect(setMerges).toHaveBeenCalledWith('doc-1', 'tab-1', {
        A1: { rs: 2, cs: 2 },
      });
    });

    it('previews the enveloped body the client would send', async () => {
      await run([
        'sheets',
        'merges',
        'set',
        'doc-1',
        '--data',
        '{"A1":{"rs":2,"cs":2}}',
        '--dry-run',
      ]);

      expect(setMerges).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${BASE}/documents/doc-1/tabs/tab-1/merges`,
        body: { merges: { A1: { rs: 2, cs: 2 } } },
      });
    });

    it('envelopes a rejected merge key instead of printing a body', async () => {
      setMerges.mockResolvedValue({ ok: false, status: 400, data: {} });

      await run([
        'sheets',
        'merges',
        'set',
        'doc-1',
        '--data',
        '{"A1:B2":{"rs":2,"cs":2}}',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });

    it('is reachable through the singular `merge` alias', async () => {
      getMerges.mockResolvedValue({ ok: true, status: 200, data: {} });

      await run(['sheets', 'merge', 'get', 'doc-1']);

      expect(getMerges).toHaveBeenCalledWith('doc-1', 'tab-1');
    });
  });

  describe('payload parsing', () => {
    it('names --data as the source of a malformed payload', async () => {
      await run(['sheets', 'freeze', 'set', 'doc-1', '--data', '{rows:2}']);

      expect(setFreeze).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { message: string; command: string };
      };
      expect(err.error.message).toMatch(/Invalid JSON freeze data in --data/);
      expect(err.error.command).toBe('sheets.freeze.set');
    });

    it('rejects a malformed payload BEFORE the dry-run branch', async () => {
      // A preview of a request that could never be assembled is worse than no
      // preview at all — the point of the flag is to show what would happen.
      await run([
        'sheets',
        'merges',
        'set',
        'doc-1',
        '--data',
        'not-json',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/Invalid JSON merge data in --data/);
    });
  });

  // `format()` throws on an unsupported `--format`. If that throw fires after
  // the request, a completed write reports exit 1 / INVALID_FORMAT with the
  // server's response discarded — so the guard has to run first.
  describe('--format validation ordering', () => {
    it('rejects a bad --format before reading', async () => {
      await run(['sheets', 'merges', 'get', 'doc-1', '--format', 'bogus']);

      expect(getMerges).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('rejects a bad --format before writing', async () => {
      await run([
        'sheets',
        'hidden',
        'set',
        'doc-1',
        '--data',
        '{"rows":[1]}',
        '--format',
        'bogus',
      ]);

      expect(setHidden).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('still previews under --dry-run with a bad --format', async () => {
      // `--format` narrows the *response*; a dry run has none, so the preview
      // must not depend on it.
      await run([
        'sheets',
        'freeze',
        'get',
        'doc-1',
        '--format',
        'bogus',
        '--dry-run',
      ]);

      expect(process.exitCode).toBeUndefined();
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ dry_run: true });
    });
  });

  describe('path segment safety', () => {
    it('envelopes a traversal id instead of previewing a walked-out URL', async () => {
      await run([
        'sheets',
        'merges',
        'set',
        'doc-1',
        '--tab',
        '..',
        '--data',
        '{}',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/Invalid/);
    });
  });
});

describe('sheets view-state command registration', () => {
  it('mounts get and set under freeze, hidden and merges', () => {
    const sheets = new Command('sheets');
    registerSheetsViewCommand(sheets);

    const names = sheets.commands.map((c) => c.name()).sort();
    expect(names).toEqual(['freeze', 'hidden', 'merges']);

    for (const group of ['freeze', 'hidden', 'merges']) {
      const cmd = sheets.commands.find((c) => c.name() === group);
      expect(cmd?.commands.map((c) => c.name()).sort()).toEqual(['get', 'set']);
    }
  });

  it('defaults --tab to tab-1 on every subcommand', () => {
    const sheets = new Command('sheets');
    registerSheetsViewCommand(sheets);

    for (const group of sheets.commands) {
      for (const sub of group.commands) {
        const tab = sub.options.find((o) => o.long === '--tab');
        expect(tab?.defaultValue).toBe('tab-1');
      }
    }
  });
});
