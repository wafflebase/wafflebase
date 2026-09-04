import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/commands/root.js';
import { registerFoldersCommand } from '../src/commands/folders.js';
import { registerDocsCommand } from '../src/commands/docs.js';

/**
 * Drives the REAL commands through commander. What is worth guarding here is
 * the wiring: which client method each subcommand reaches for, and — the one
 * thing this namespace can get silently wrong — that "move to the root" goes
 * over the wire as an explicit `null` rather than an omitted field, since the
 * backend reads an absent `parentId` / `folderId` as "leave it alone".
 */

const listFolders = vi.fn();
const createFolder = vi.fn();
const renameFolder = vi.fn();
const moveFolder = vi.fn();
const deleteFolder = vi.fn();
const copyDocument = vi.fn();
const moveDocument = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    listFolders = (...a: unknown[]) => listFolders(...a);
    createFolder = (...a: unknown[]) => createFolder(...a);
    renameFolder = (...a: unknown[]) => renameFolder(...a);
    moveFolder = (...a: unknown[]) => moveFolder(...a);
    deleteFolder = (...a: unknown[]) => deleteFolder(...a);
    copyDocument = (...a: unknown[]) => copyDocument(...a);
    moveDocument = (...a: unknown[]) => moveDocument(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const BASE = `${SERVER}/api/v1/workspaces/${WORKSPACE}`;
const FOLDER = '11111111-2222-3333-4444-555555555555';
const PARENT = '99999999-8888-7777-6666-555555555555';
const DOC = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function run(argv: string[]) {
  const program = createProgram();
  registerFoldersCommand(program);
  registerDocsCommand(program);
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

const ok = (data: unknown) => ({ ok: true, status: 200, data });

describe('folders commands', () => {
  let stdout: string[];
  let stderr: string[];
  const originalEnv = {
    WAFFLEBASE_SESSION: process.env.WAFFLEBASE_SESSION,
    WAFFLEBASE_CONFIG: process.env.WAFFLEBASE_CONFIG,
  };

  beforeEach(() => {
    stdout = [];
    stderr = [];
    for (const m of [
      listFolders,
      createFolder,
      renameFolder,
      moveFolder,
      deleteFolder,
      copyDocument,
      moveDocument,
    ]) {
      m.mockReset();
    }
    // Never read the developer's real session/config: the flags above pin the
    // server and workspace, and an on-disk profile must not change what these
    // assertions see.
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
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.exitCode = undefined;
  });

  describe('list', () => {
    it('prints the flat tree the server returns', async () => {
      listFolders.mockResolvedValue(
        ok([{ id: FOLDER, name: 'Q1', parentId: null }]),
      );

      await run(['folders', 'list']);

      expect(listFolders).toHaveBeenCalledTimes(1);
      expect(JSON.parse(stdout.join('\n'))).toMatchObject([{ id: FOLDER }]);
      expect(process.exitCode).toBeUndefined();
    });

    it('previews the request under --dry-run', async () => {
      await run(['folders', 'list', '--dry-run']);

      expect(listFolders).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'GET',
        url: `${BASE}/folders`,
      });
    });

    it('accepts the singular `folder` alias', async () => {
      listFolders.mockResolvedValue(ok([]));
      await run(['folder', 'list']);
      expect(listFolders).toHaveBeenCalledTimes(1);
    });
  });

  describe('create', () => {
    it('creates at the workspace root when no parent is given', async () => {
      createFolder.mockResolvedValue(ok({ id: FOLDER, name: 'Q1' }));

      await run(['folders', 'create', 'Q1']);

      expect(createFolder).toHaveBeenCalledWith('Q1', undefined);
    });

    it('passes --parent through', async () => {
      createFolder.mockResolvedValue(ok({ id: FOLDER }));

      await run(['folders', 'create', 'Q1', '--parent', PARENT]);

      expect(createFolder).toHaveBeenCalledWith('Q1', PARENT);
    });

    it('omits parentId from the preview when there is no parent', async () => {
      await run(['folders', 'create', 'Q1', '--dry-run']);

      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${BASE}/folders`,
        body: { name: 'Q1' },
      });
    });

    it('previews the parent when one is given', async () => {
      await run(['folders', 'create', 'Q1', '--parent', PARENT, '--dry-run']);

      expect(JSON.parse(stdout.join('\n'))).toMatchObject({
        body: { name: 'Q1', parentId: PARENT },
      });
    });
  });

  describe('rename', () => {
    it('sends only the name', async () => {
      renameFolder.mockResolvedValue(ok({ id: FOLDER, name: 'Q2' }));

      await run(['folders', 'rename', FOLDER, 'Q2']);

      expect(renameFolder).toHaveBeenCalledWith(FOLDER, 'Q2');
    });

    it('previews the PATCH', async () => {
      await run(['folders', 'rename', FOLDER, 'Q2', '--dry-run']);

      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PATCH',
        url: `${BASE}/folders/${FOLDER}`,
        body: { name: 'Q2' },
      });
    });
  });

  describe('move', () => {
    it('sends the new parent id', async () => {
      moveFolder.mockResolvedValue(ok({ id: FOLDER, parentId: PARENT }));

      await run(['folders', 'move', FOLDER, PARENT]);

      expect(moveFolder).toHaveBeenCalledWith(FOLDER, PARENT);
    });

    // The one thing this namespace can get silently wrong: an omitted
    // `parentId` means "unchanged" to the server, so the root has to be an
    // explicit null or the move is a no-op that still reports success.
    it('sends an explicit null when the parent is omitted', async () => {
      moveFolder.mockResolvedValue(ok({ id: FOLDER, parentId: null }));

      await run(['folders', 'move', FOLDER]);

      expect(moveFolder).toHaveBeenCalledWith(FOLDER, null);
    });

    it('previews the null parent rather than dropping the field', async () => {
      await run(['folders', 'move', FOLDER, '--dry-run']);

      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PATCH',
        url: `${BASE}/folders/${FOLDER}`,
        body: { parentId: null },
      });
    });

    it('forwards a refused cycle verbatim', async () => {
      moveFolder.mockResolvedValue({
        ok: false,
        status: 400,
        data: {
          message: 'Cannot move a folder into itself or one of its descendants',
        },
      });

      await run(['folders', 'move', FOLDER, PARENT]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/descendants/);
    });
  });

  describe('delete', () => {
    it('deletes by id', async () => {
      deleteFolder.mockResolvedValue(ok({ id: FOLDER }));

      await run(['folders', 'delete', FOLDER]);

      expect(deleteFolder).toHaveBeenCalledWith(FOLDER);
    });

    it('previews the DELETE with no body', async () => {
      await run(['folders', 'delete', FOLDER, '--dry-run']);

      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'DELETE',
        url: `${BASE}/folders/${FOLDER}`,
      });
    });

    it('refuses a traversing id before any request', async () => {
      await run(['folders', 'delete', '..', '--dry-run']);

      expect(stdout).toEqual([]);
      expect(deleteFolder).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { command: string } }).error
          .command,
      ).toBe('folders.delete');
    });
  });
});

describe('docs copy and move', () => {
  let stdout: string[];
  const originalEnv = {
    WAFFLEBASE_SESSION: process.env.WAFFLEBASE_SESSION,
    WAFFLEBASE_CONFIG: process.env.WAFFLEBASE_CONFIG,
  };

  beforeEach(() => {
    stdout = [];
    copyDocument.mockReset();
    moveDocument.mockReset();
    process.env.WAFFLEBASE_SESSION = '/nonexistent/wafflebase-session.json';
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-config.yaml';
    vi.spyOn(console, 'log').mockImplementation((v) => {
      stdout.push(String(v));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.exitCode = undefined;
  });

  it('copies a document by id', async () => {
    copyDocument.mockResolvedValue(ok({ id: 'doc-2', title: 'Q1 (copy)' }));

    await run(['docs', 'copy', DOC]);

    expect(copyDocument).toHaveBeenCalledWith(DOC);
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({ id: 'doc-2' });
  });

  it('previews the copy POST', async () => {
    await run(['docs', 'copy', DOC, '--dry-run']);

    expect(copyDocument).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.join('\n'))).toEqual({
      dry_run: true,
      method: 'POST',
      url: `${BASE}/documents/${DOC}/copy`,
    });
  });

  it('files a document under a folder', async () => {
    moveDocument.mockResolvedValue(ok({ id: DOC, folderId: FOLDER }));

    await run(['docs', 'move', DOC, FOLDER]);

    expect(moveDocument).toHaveBeenCalledWith(DOC, FOLDER);
  });

  it('sends an explicit null when the folder is omitted', async () => {
    moveDocument.mockResolvedValue(ok({ id: DOC, folderId: null }));

    await run(['docs', 'move', DOC]);

    expect(moveDocument).toHaveBeenCalledWith(DOC, null);
  });

  it('previews the null folder rather than dropping the field', async () => {
    await run(['docs', 'move', DOC, '--dry-run']);

    expect(JSON.parse(stdout.join('\n'))).toEqual({
      dry_run: true,
      method: 'PATCH',
      url: `${BASE}/documents/${DOC}`,
      body: { folderId: null },
    });
  });

  // `copy`/`move` live on `docs` because they act on the document row, not on
  // a type's content — the aliases are how a deck or a note reaches them.
  it('is reachable through the documents alias', async () => {
    copyDocument.mockResolvedValue(ok({ id: 'doc-2' }));
    await run(['documents', 'copy', DOC]);
    expect(copyDocument).toHaveBeenCalledWith(DOC);
  });
});
