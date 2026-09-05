import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createProgram } from '../src/commands/root.js';
import { registerTabsCommand } from '../src/commands/tabs.js';

/**
 * Drives the REAL command through commander rather than a stand-in, because
 * the behaviours worth guarding here — where the `--type` check sits relative
 * to the dry-run branch, and which client method each subcommand reaches for —
 * live in the action handler's wiring, not in any function it calls.
 */

const listTabs = vi.fn();
const createTab = vi.fn();
const renameTab = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    listTabs = (...a: unknown[]) => listTabs(...a);
    createTab = (...a: unknown[]) => createTab(...a);
    renameTab = (...a: unknown[]) => renameTab(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';

function run(argv: string[]) {
  const program = createProgram();
  // A `tabs` group hangs off `sheets` in the real CLI; the parent is
  // irrelevant to these assertions, so mount it on a bare namespace.
  registerTabsCommand(program.command('sheets'));
  return program.parseAsync(
    ['--server', SERVER, '--workspace', WORKSPACE, '--api-key', 'wfb_test', ...argv],
    { from: 'user' },
  );
}

describe('tabs commands', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    listTabs.mockReset();
    createTab.mockReset();
    renameTab.mockReset();
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

  describe('create', () => {
    it('posts the name and type to the tabs endpoint', async () => {
      createTab.mockResolvedValue({
        ok: true,
        status: 201,
        data: { id: 'tab-1', name: 'Budget', type: 'sheet' },
      });

      await run(['sheets', 'tabs', 'create', 'doc-1', 'Budget']);

      expect(createTab).toHaveBeenCalledWith('doc-1', {
        type: 'sheet',
        name: 'Budget',
      });
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ id: 'tab-1' });
    });

    it('omits name entirely so the server picks the next SheetN', async () => {
      createTab.mockResolvedValue({ ok: true, status: 201, data: {} });

      await run(['sheets', 'tabs', 'create', 'doc-1']);

      // `{ name: undefined }` is NOT the same request: it serializes away, but
      // an explicit `name: ''` or `null` would not, and the server's
      // "blank name" branch is a different outcome from "no name given".
      expect(createTab).toHaveBeenCalledWith('doc-1', { type: 'sheet' });
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'tabs', 'create', 'doc-1', 'Budget', '--dry-run']);

      expect(createTab).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/doc-1/tabs`,
        body: { type: 'sheet', name: 'Budget' },
      });
    });

    it('rejects a type the REST endpoint does not support', async () => {
      await run(['sheets', 'tabs', 'create', 'doc-1', '--type', 'datasource']);

      expect(createTab).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const err = JSON.parse(stderr.join('\n')) as {
        error: { message: string };
      };
      expect(err.error.message).toMatch(/only "sheet" is supported/);
    });

    it('rejects an unsupported type BEFORE the dry-run branch', async () => {
      // A dry run whose printed request the server would reject is worse than
      // no dry run at all — the point of the flag is to show what would happen.
      await run([
        'sheets',
        'tabs',
        'create',
        'doc-1',
        '--type',
        'datasource',
        '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
    });
  });

  describe('rename', () => {
    it('patches the tab with the new name', async () => {
      renameTab.mockResolvedValue({
        ok: true,
        status: 200,
        data: { id: 'tab-1', name: 'Q3', type: 'sheet' },
      });

      await run(['sheets', 'tabs', 'rename', 'doc-1', 'tab-1', 'Q3']);

      expect(renameTab).toHaveBeenCalledWith('doc-1', 'tab-1', 'Q3');
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({ name: 'Q3' });
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'tabs', 'rename', 'doc-1', 'tab-1', 'Q3', '--dry-run']);

      expect(renameTab).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PATCH',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/doc-1/tabs/tab-1`,
        body: { name: 'Q3' },
      });
    });

    it('envelopes a rejected rename instead of printing a body', async () => {
      // A duplicate name comes back 409; the CLI must surface that as the
      // error envelope, not as a success payload.
      renameTab.mockResolvedValue({ ok: false, status: 409, data: {} });

      await run(['sheets', 'tabs', 'rename', 'doc-1', 'tab-1', 'Q3']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/409/);
    });
  });

  // `format()` throws on an unsupported `--format`. If that throw fires
  // after the request, a completed write reports exit 1 / INVALID_FORMAT
  // with the server's response discarded — so the guard has to run first,
  // for the same reason the `--type` check precedes the dry-run branch.
  describe('--format validation ordering', () => {
    it('rejects a bad --format before creating the tab', async () => {
      await run([
        'sheets',
        'tabs',
        'create',
        'doc-1',
        'Budget',
        '--format',
        'bogus',
      ]);

      expect(createTab).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('rejects a bad --format before renaming the tab', async () => {
      await run([
        'sheets',
        'tabs',
        'rename',
        'doc-1',
        'tab-1',
        'Q3',
        '--format',
        'bogus',
      ]);

      expect(renameTab).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('list', () => {
    it('reads the tabs endpoint', async () => {
      listTabs.mockResolvedValue({
        ok: true,
        status: 200,
        data: [{ id: 'tab-1', name: 'Sheet1', type: 'sheet' }],
      });

      await run(['sheets', 'tabs', 'list', 'doc-1', '--format', 'json']);

      expect(listTabs).toHaveBeenCalledWith('doc-1');
      expect(JSON.parse(stdout.join('\n'))).toHaveLength(1);
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run(['sheets', 'tabs', 'list', 'doc-1', '--dry-run']);

      expect(listTabs).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/doc-1/tabs`,
      });
    });
  });
});

describe('tabs command registration', () => {
  it('mounts the whole tab verb set alongside list', () => {
    const sheets = new Command('sheets');
    registerTabsCommand(sheets);
    const tabs = sheets.commands.find((c) => c.name() === 'tabs');
    expect(tabs?.commands.map((c) => c.name()).sort()).toEqual([
      'create',
      'delete',
      'duplicate',
      'list',
      'move',
      'rename',
    ]);
  });
});
