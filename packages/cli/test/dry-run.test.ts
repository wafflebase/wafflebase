import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/commands/root.js';
import { registerCellsCommand } from '../src/commands/cells.js';
import { printDryRun } from '../src/client/dry-run.js';
import type { CliConfig } from '../src/config/config.js';

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

/**
 * The command-driven tests above reach `printDryRun` through call sites that
 * already applied `seg()`, so `seg()` is what refuses there. `printDryRun`'s
 * own guard is the backstop for a *future* call site that forgets — the case
 * no command can currently produce — so it is exercised directly, by handing
 * the printer a raw path the way a forgetful caller would.
 */
describe('printDryRun path guard', () => {
  const config: CliConfig = {
    server: SERVER,
    apiKey: 'wfb_test',
    workspace: 'ws-1',
    authMode: 'api-key',
  };

  let stdout: string[];

  beforeEach(() => {
    stdout = [];
    vi.spyOn(console, 'log').mockImplementation((v) => {
      stdout.push(String(v));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a raw ".." segment a call site failed to encode', () => {
    expect(() =>
      printDryRun(config, 'DELETE', '/documents/../../workspaces/other-ws'),
    ).toThrow('Invalid path segment: ".."');
    expect(stdout).toEqual([]);
  });

  it('refuses a raw "." segment too', () => {
    expect(() => printDryRun(config, 'GET', '/documents/./tabs')).toThrow(
      'Invalid path segment: "."',
    );
    expect(stdout).toEqual([]);
  });

  it('prints a dot-free path, ids encoded by the caller', () => {
    printDryRun(config, 'GET', '/documents/doc%2F1/tabs/tab-1');

    expect(JSON.parse(stdout.join('\n'))).toEqual({
      dry_run: true,
      method: 'GET',
      url: `${SERVER}/api/v1/workspaces/ws-1/documents/doc%2F1/tabs/tab-1`,
    });
  });

  it('leaves the query string alone — it cannot move the endpoint', () => {
    // `?range=A1:C10` is the shipped shape; the `..` value is the reason the
    // exemption is scoped to the query rather than applied to the whole string.
    printDryRun(
      config,
      'GET',
      '/documents/doc-1/tabs/tab-1/cells?range=A1:C10&x=..',
    );

    const { url } = JSON.parse(stdout.join('\n'));
    expect(url).toBe(
      `${SERVER}/api/v1/workspaces/ws-1/documents/doc-1/tabs/tab-1/cells?range=A1:C10&x=..`,
    );
  });
});
