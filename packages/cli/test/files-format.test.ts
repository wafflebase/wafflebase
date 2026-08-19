import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/commands/root.js';
import { registerFilesCommand } from '../src/commands/files.js';

/**
 * `format()` throws on an unsupported `--format`. Every `output()` call
 * site therefore narrows the raw flag *before* it issues its request:
 * otherwise a typo turns a completed rename or delete into exit 1 /
 * INVALID_FORMAT with the server's response thrown away, and the caller
 * cannot tell whether retrying is safe.
 *
 * These tests pin that ordering by asserting no request is ever made.
 * Move `parseOutputFormat` back below the call in `files.ts` and they
 * fail.
 */
const listDocuments = vi.fn();
const getDocument = vi.fn();
const updateDocument = vi.fn();
const deleteDocument = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    listDocuments = (...a: unknown[]) => listDocuments(...a);
    getDocument = (...a: unknown[]) => getDocument(...a);
    updateDocument = (...a: unknown[]) => updateDocument(...a);
    deleteDocument = (...a: unknown[]) => deleteDocument(...a);
  },
}));

function run(argv: string[]) {
  const program = createProgram();
  registerFilesCommand(program);
  return program.parseAsync(
    [
      '--server',
      'https://api.example.test',
      '--workspace',
      'ws-1',
      '--api-key',
      'wfb_test',
      ...argv,
    ],
    { from: 'user' },
  );
}

describe('files commands reject a bad --format before the request', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    listDocuments.mockReset();
    getDocument.mockReset();
    updateDocument.mockReset();
    deleteDocument.mockReset();
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

  function errorCode(): string {
    return (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
      .code;
  }

  it('rejects `files rename --format bogus` without renaming', async () => {
    await run(['files', 'rename', 'doc-1', 'Report', '--format', 'bogus']);

    expect(updateDocument).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
    expect(errorCode()).toBe('INVALID_FORMAT');
    expect(process.exitCode).toBe(1);
  });

  it('rejects `files delete --format bogus` without deleting', async () => {
    await run(['files', 'delete', 'doc-1', '--format', 'bogus']);

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(errorCode()).toBe('INVALID_FORMAT');
    expect(process.exitCode).toBe(1);
  });

  it('rejects `files list --format bogus` without a request', async () => {
    await run(['files', 'list', '--format', 'bogus']);

    expect(listDocuments).not.toHaveBeenCalled();
    expect(errorCode()).toBe('INVALID_FORMAT');
    expect(process.exitCode).toBe(1);
  });

  it('rejects `files get --format bogus` without a request', async () => {
    await run(['files', 'get', 'doc-1', '--format', 'bogus']);

    expect(getDocument).not.toHaveBeenCalled();
    expect(errorCode()).toBe('INVALID_FORMAT');
    expect(process.exitCode).toBe(1);
  });

  it('still renders the body for a format main added (yaml)', async () => {
    updateDocument.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'doc-1', title: 'Report' },
    });

    await run(['files', 'rename', 'doc-1', 'Report', '--format', 'yaml']);

    expect(updateDocument).toHaveBeenCalledWith('doc-1', 'Report');
    expect(stdout.join('\n')).toContain('title: Report');
    expect(process.exitCode).toBeUndefined();
  });
});
