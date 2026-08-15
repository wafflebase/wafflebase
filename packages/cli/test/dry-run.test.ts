import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/commands/root.js';
import { registerCellsCommand } from '../src/commands/cells.js';

/**
 * `--dry-run` is the second place a request URL is built (`printDryRun`), and
 * it is the one an agent reads before deciding to run the command for real. So
 * it has to obey the same rule the real request does: every id is pinned to
 * one path segment, and a `.` / `..` id is refused rather than previewed.
 *
 * Driven through the real command, because the encoding happens where the
 * command assembles the path — not inside the printer. `cells batch` carries
 * the refusal cases: its dry-run branch sits inside the handler's own
 * try/catch, so the throw becomes the error envelope here rather than in
 * `runCli` (importing which would pull in every namespace, docs and slides
 * included, for a check that needs neither).
 */

// No request is ever sent on this path; a throwing stub keeps a regression
// from silently reaching the network instead of failing.
vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    setCell = () => {
      throw new Error('dry run must not send a request');
    };
    batchCells = () => {
      throw new Error('dry run must not send a request');
    };
  },
}));

const SERVER = 'https://api.example.test';
const TRAVERSAL = '../../../../workspaces/other-ws/api-keys/key-1';
const ENCODED = '..%2F..%2F..%2F..%2Fworkspaces%2Fother-ws%2Fapi-keys%2Fkey-1';

function run(argv: string[], workspace = 'ws-1') {
  const program = createProgram();
  registerCellsCommand(program.command('sheets'));
  return program.parseAsync(
    [
      '--server',
      SERVER,
      '--workspace',
      workspace,
      '--api-key',
      'wfb_test',
      ...argv,
    ],
    { from: 'user' },
  );
}

describe('dry-run URL building', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
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

  it('previews the URL that would actually be sent, ids encoded', async () => {
    await run(['sheets', 'cells', 'set', TRAVERSAL, 'A1', '1', '--dry-run']);

    const { url } = JSON.parse(stdout.join('\n'));
    expect(url).toBe(
      `${SERVER}/api/v1/workspaces/ws-1/documents/${ENCODED}/tabs/tab-1/cells/A1`,
    );
    // The previewed URL survives WHATWG normalization unchanged — an agent
    // that copies it reaches the endpoint the command named.
    expect(new URL(url).pathname).toBe(
      `/api/v1/workspaces/ws-1/documents/${ENCODED}/tabs/tab-1/cells/A1`,
    );
  });

  it('encodes the configured workspace too', async () => {
    await run(['sheets', 'cells', 'set', 'doc-1', 'A1', '1', '--dry-run'], '../..');

    const { url } = JSON.parse(stdout.join('\n'));
    expect(url).toBe(
      `${SERVER}/api/v1/workspaces/..%2F../documents/doc-1/tabs/tab-1/cells/A1`,
    );
  });

  it('refuses a dot-segment id instead of previewing a walked-up URL', async () => {
    await run(['sheets', 'cells', 'batch', '..', '--data', '{}', '--dry-run']);

    expect(stdout).toEqual([]);
    expect(stderr.join('\n')).toContain('Invalid path segment');
    expect(process.exitCode).toBe(1);
  });

  it('refuses a dot-segment workspace as well', async () => {
    await run(['sheets', 'cells', 'batch', 'doc-1', '--data', '{}', '--dry-run'], '..');

    expect(stdout).toEqual([]);
    expect(stderr.join('\n')).toContain('Invalid path segment');
    expect(process.exitCode).toBe(1);
  });
});
