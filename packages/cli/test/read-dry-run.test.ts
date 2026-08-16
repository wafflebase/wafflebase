import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/commands/root.js';
import { registerDocsCommand } from '../src/commands/docs.js';
import { registerCellsCommand } from '../src/commands/cells.js';

/**
 * `--dry-run` is documented as "prints the request that would be sent —
 * without executing it" (docs/design/cli.md §8.2). These read commands used
 * to accept the flag and fetch anyway, so the assertion that matters in every
 * case below is that the client method was NOT called: a preview that reaches
 * the network burns rate limit and emits an access log the caller was told
 * would not happen.
 */

const listDocuments = vi.fn();
const getDocument = vi.fn();
const getCells = vi.fn();
const getCell = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    listDocuments = (...a: unknown[]) => listDocuments(...a);
    getDocument = (...a: unknown[]) => getDocument(...a);
    getCells = (...a: unknown[]) => getCells(...a);
    getCell = (...a: unknown[]) => getCell(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const BASE = `${SERVER}/api/v1/workspaces/${WORKSPACE}`;

function run(argv: string[]) {
  const program = createProgram();
  registerDocsCommand(program);
  // `cells` hangs off `sheets` in the real CLI; the parent name is irrelevant
  // to the printed request, which is built from the config, not the command.
  registerCellsCommand(program.command('sheets'));
  return program.parseAsync(
    ['--server', SERVER, '--workspace', WORKSPACE, '--api-key', 'wfb_test', ...argv],
    { from: 'user' },
  );
}

describe('--dry-run on read commands', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    listDocuments.mockReset();
    getDocument.mockReset();
    getCells.mockReset();
    getCell.mockReset();
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

  describe('docs list', () => {
    it('prints the request without sending it', async () => {
      await run(['docs', 'list', '--dry-run']);

      expect(listDocuments).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents`,
      });
    });

    it('prints the same request with --type, which filters client-side', async () => {
      await run(['docs', 'list', '--type', 'doc', '--dry-run']);

      expect(listDocuments).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents`,
      });
    });

    it('rejects an invalid --type BEFORE the dry-run branch', async () => {
      // A dry run validates inputs; printing a preview for a command that
      // could never run would be worse than no preview at all.
      await run(['docs', 'list', '--type', 'slides', '--dry-run']);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/Invalid --type/);
    });
  });

  describe('docs get', () => {
    it('prints the request without sending it', async () => {
      await run(['docs', 'get', 'doc-1', '--dry-run']);

      expect(getDocument).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1`,
      });
    });
  });

  describe('sheets cells get', () => {
    it('prints the whole-tab endpoint when no range is given', async () => {
      await run(['sheets', 'cells', 'get', 'doc-1', '--dry-run']);

      expect(getCells).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1/tabs/tab-1/cells`,
      });
    });

    it('prints the single-cell endpoint for a bare ref', async () => {
      await run(['sheets', 'cells', 'get', 'doc-1', 'A1', '--tab', 'tab-2', '--dry-run']);

      expect(getCell).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1/tabs/tab-2/cells/A1`,
      });
    });

    it('encodes the range the way the client would', async () => {
      await run(['sheets', 'cells', 'get', 'doc-1', 'A1:C10', '--dry-run']);

      expect(getCells).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1/tabs/tab-1/cells?range=A1%3AC10`,
      });
    });
  });
});
