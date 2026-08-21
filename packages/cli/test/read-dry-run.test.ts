import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/commands/root.js';
import { registerDocsCommand } from '../src/commands/docs.js';
import { registerCellsCommand } from '../src/commands/cells.js';
import { registerNotesCommand } from '../src/commands/notes.js';
import { registerSlidesCommand } from '../src/commands/slides.js';
import { registerFilesCommand } from '../src/commands/files.js';
import { registerApiKeysCommand } from '../src/commands/api-keys.js';
import { registerSheetsExportCommand } from '../src/commands/sheets-export.js';

/**
 * `--dry-run` is documented as "prints the request that would be sent —
 * without executing it" (docs/design/cli.md §8.2). These read commands used
 * to accept the flag and fetch anyway, so the assertion that matters in every
 * case below is that the client method was NOT called: a preview that reaches
 * the network burns rate limit and emits an access log the caller was told
 * would not happen.
 *
 * `api-keys create` / `revoke` are here for a sharper reason: they are the
 * only commands whose real request mints a live credential (printing its
 * secret) or irreversibly destroys one, so "the flag was ignored" was not a
 * wasted request but an unrecoverable one.
 */

const listDocuments = vi.fn();
const getDocument = vi.fn();
const getCells = vi.fn();
const getCell = vi.fn();
const listApiKeys = vi.fn();
const createApiKey = vi.fn();
const revokeApiKey = vi.fn();

// `sheets export` is the one command here whose live path also writes to disk,
// so the preview has to be shown not to touch the file either.
const writeFileSync = vi.fn();

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  writeFileSync: (...a: unknown[]) => writeFileSync(...a),
}));

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    listDocuments = (...a: unknown[]) => listDocuments(...a);
    getDocument = (...a: unknown[]) => getDocument(...a);
    getCells = (...a: unknown[]) => getCells(...a);
    getCell = (...a: unknown[]) => getCell(...a);
    listApiKeys = (...a: unknown[]) => listApiKeys(...a);
    createApiKey = (...a: unknown[]) => createApiKey(...a);
    revokeApiKey = (...a: unknown[]) => revokeApiKey(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const BASE = `${SERVER}/api/v1/workspaces/${WORKSPACE}`;
// API-key management is not under the v1 API base — it is the workspace route.
const KEYS_BASE = `${SERVER}/workspaces/${WORKSPACE}/api-keys`;

function run(argv: string[], workspace = WORKSPACE) {
  const program = createProgram();
  registerDocsCommand(program);
  registerNotesCommand(program);
  registerSlidesCommand(program);
  registerFilesCommand(program);
  registerApiKeysCommand(program);
  // `cells` hangs off `sheets` in the real CLI; the parent name is irrelevant
  // to the printed request, which is built from the config, not the command.
  const sheets = program.command('sheets');
  registerCellsCommand(sheets);
  registerSheetsExportCommand(sheets);
  return program.parseAsync(
    ['--server', SERVER, '--workspace', workspace, '--api-key', 'wfb_test', ...argv],
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
    listApiKeys.mockReset();
    createApiKey.mockReset();
    revokeApiKey.mockReset();
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

  describe('sheets export', () => {
    it('prints the GET without fetching or writing the file', async () => {
      await run(['sheets', 'export', 'doc-1', 'out.csv', '--dry-run']);

      expect(getCells).not.toHaveBeenCalled();
      // The title's second half: the write is downstream of the fetch, so a
      // preview must leave the file alone. Asserted, not just claimed.
      expect(writeFileSync).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1/tabs/tab-1/cells`,
      });
    });

    it('prints the range-scoped GET for --range', async () => {
      await run(['sheets', 'export', 'doc-1', 'out.csv', '--range', 'A1:C10', '--dry-run']);

      expect(getCells).not.toHaveBeenCalled();
      expect(writeFileSync).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/doc-1/tabs/tab-1/cells?range=A1%3AC10`,
      });
    });

    it('rejects an unsupported --file-format BEFORE the dry-run branch', async () => {
      await run([
        'sheets', 'export', 'doc-1', 'out.csv', '--file-format', 'xlsx', '--dry-run',
      ]);

      expect(stdout).toEqual([]);
      expect(stderr.join('\n')).toMatch(/Unsupported format/);
    });
  });

  describe.each([
    ['notes', 'note-1'],
    ['slides', 'deck-1'],
    ['files', 'file-1'],
  ])('%s list/get', (ns, docId) => {
    it('prints the list request without sending it', async () => {
      await run([ns, 'list', '--dry-run']);

      expect(listDocuments).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents`,
      });
    });

    it('prints the get request without sending it', async () => {
      await run([ns, 'get', docId, '--dry-run']);

      expect(getDocument).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/documents/${docId}`,
      });
    });
  });

  describe('api-keys', () => {
    it('previews the create POST without minting a key', async () => {
      await run(['api-keys', 'create', 'ci-key', '--dry-run']);

      expect(createApiKey).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: KEYS_BASE,
        body: { name: 'ci-key' },
      });
    });

    it('previews the revoke DELETE without revoking', async () => {
      await run(['api-keys', 'revoke', 'key-1', '--dry-run']);

      expect(revokeApiKey).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'DELETE',
        url: `${KEYS_BASE}/key-1`,
      });
    });

    it('previews the list GET without sending it', async () => {
      await run(['api-keys', 'list', '--dry-run']);

      expect(listApiKeys).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: KEYS_BASE,
      });
    });
  });

  describe('identifier encoding', () => {
    it('encodes a traversal-shaped doc id, matching the real request', async () => {
      // `fetch` collapses dot segments, so an unencoded `../../..` would
      // retarget the credentialed request off the workspace prefix. The
      // preview has to show the escaped path the client actually sends.
      await run(['docs', 'get', '../../../admin', '--dry-run']);

      expect(getDocument).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n')).url).toBe(
        `${BASE}/documents/..%2F..%2F..%2Fadmin`,
      );
    });

    // The workspace is not a trusted constant either: `--workspace` (used
    // here), `WAFFLEBASE_WORKSPACE` and the YAML profile all feed it, and it
    // forms the prefix every other segment is meant to stay inside.
    it('encodes a traversal-shaped workspace in the v1 preview', async () => {
      await run(['docs', 'get', 'doc-1', '--dry-run'], '../../admin');

      expect(getDocument).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n')).url).toBe(
        `${SERVER}/api/v1/workspaces/..%2F..%2Fadmin/documents/doc-1`,
      );
    });

    it('encodes a traversal-shaped workspace in the api-keys preview', async () => {
      await run(['api-keys', 'list', '--dry-run'], '../../admin');

      expect(listApiKeys).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n')).url).toBe(
        `${SERVER}/workspaces/..%2F..%2Fadmin/api-keys`,
      );
    });

    // A bare `..` cannot be escaped into data — the URL parser resolves it
    // however it is written — so it is refused. Printing a preview of
    // `.../api-keys/..` would be worse than no preview: `fetch` would send
    // `DELETE /workspaces/<ws>/`, the workspace-delete route.
    it('refuses a bare `..` key id instead of previewing a URL fetch would resolve', async () => {
      await run(['api-keys', 'revoke', '..', '--dry-run']);

      expect(revokeApiKey).not.toHaveBeenCalled();
      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/Invalid identifier/);
    });

    it('refuses a bare `..` doc id', async () => {
      // `docs get` previews before its try/catch, so the throw surfaces to
      // `runCli`, which envelopes it. Either way nothing is printed or sent.
      await expect(run(['docs', 'get', '..', '--dry-run'])).rejects.toThrow(
        /Invalid identifier/,
      );

      expect(getDocument).not.toHaveBeenCalled();
      expect(stdout).toEqual([]);
    });
  });
});
