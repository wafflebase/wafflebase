import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import {
  formatWorkspaceList,
  findWorkspace,
  registerCtxCommand,
} from '../src/commands/ctx.js';
import type { WorkspaceInfo } from '../src/config/session.js';

const workspaces: WorkspaceInfo[] = [
  { id: 'e98ff707-1111-2222-3333-444444444444', name: "hackerwins's Workspace" },
  { id: 'abc12345-aaaa-bbbb-cccc-dddddddddddd', name: 'Team Workspace' },
];

describe('formatWorkspaceList', () => {
  it('marks the active workspace with *', () => {
    const output = formatWorkspaceList(workspaces, workspaces[0].id);
    const lines = output.split('\n');
    expect(lines[0]).toMatch(/^\*/);
    expect(lines[1]).toMatch(/^ /);
  });

  it('shows truncated IDs and workspace names', () => {
    const output = formatWorkspaceList(workspaces, workspaces[0].id);
    expect(output).toContain('e98ff707');
    expect(output).toContain("hackerwins's Workspace");
    expect(output).toContain('abc12345');
    expect(output).toContain('Team Workspace');
  });

  it('marks the second workspace when it is active', () => {
    const output = formatWorkspaceList(workspaces, workspaces[1].id);
    const lines = output.split('\n');
    expect(lines[0]).toMatch(/^ /);
    expect(lines[1]).toMatch(/^\*/);
  });
});

describe('findWorkspace', () => {
  it('finds by exact ID', () => {
    const ws = findWorkspace(workspaces, workspaces[0].id);
    expect(ws).toBe(workspaces[0]);
  });

  it('finds by exact name (case-insensitive)', () => {
    const ws = findWorkspace(workspaces, 'team workspace');
    expect(ws).toBe(workspaces[1]);
  });

  it('finds by exact name (original case)', () => {
    const ws = findWorkspace(workspaces, 'Team Workspace');
    expect(ws).toBe(workspaces[1]);
  });

  it('finds by ID prefix', () => {
    const ws = findWorkspace(workspaces, 'e98ff707');
    expect(ws).toBe(workspaces[0]);
  });

  it('returns undefined for an unknown query', () => {
    const ws = findWorkspace(workspaces, 'unknown-workspace');
    expect(ws).toBeUndefined();
  });

  it('returns undefined when prefix matches multiple workspaces', () => {
    const ambiguous: WorkspaceInfo[] = [
      { id: 'aabbccdd-1111-2222-3333-444444444444', name: 'Workspace A' },
      { id: 'aabbccdd-5555-6666-7777-888888888888', name: 'Workspace B' },
    ];
    const ws = findWorkspace(ambiguous, 'aabbccdd');
    expect(ws).toBeUndefined();
  });
});

// `ctx switch` used to print prose here. It is on the session path an agent
// walks before anything else, so its failures carry the same one-line,
// `command`-attributed envelope as the data commands (docs/design/cli.md §9).
describe('ctx switch failures', () => {
  const sessionPath = join(tmpdir(), `wb-ctx-test-${process.pid}.json`);

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.WAFFLEBASE_SESSION;
    rmSync(sessionPath, { force: true });
  });

  /** Run `ctx switch <query>` to its `process.exit`, returning stderr. */
  async function runSwitch(query: string): Promise<string[]> {
    const errs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errs.push(args.map(String).join(' '));
    });
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);

    const program = new Command();
    program.name('wafflebase').exitOverride();
    registerCtxCommand(program);

    await expect(
      program.parseAsync(['ctx', 'switch', query], { from: 'user' }),
    ).rejects.toThrow('process.exit');
    return errs;
  }

  it('reports a missing session as an UNAUTHORIZED envelope', async () => {
    process.env.WAFFLEBASE_SESSION = sessionPath;

    const errs = await runSwitch('anything');

    expect(errs).toHaveLength(1);
    expect(errs[0]).not.toContain('\n');
    expect(JSON.parse(errs[0])).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Not logged in. Run `wafflebase login`.',
        command: 'ctx.switch',
      },
    });
  });

  it('reports an unknown workspace as a NOT_FOUND envelope', async () => {
    process.env.WAFFLEBASE_SESSION = sessionPath;
    writeFileSync(
      sessionPath,
      JSON.stringify({
        server: 'http://localhost:3000',
        user: { id: 1, username: 'bob', email: 'b@e.com', photo: null },
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: '2099-01-01T00:00:00.000Z',
        activeWorkspace: workspaces[0].id,
        workspaces,
      }),
    );

    const errs = await runSwitch('nope');

    expect(JSON.parse(errs[0])).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Workspace not found: nope',
        command: 'ctx.switch',
      },
    });
  });
});
