import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildStatus,
  NOT_LOGGED_IN_MESSAGE,
  registerStatusCommand,
} from '../src/commands/status.js';
import { registerCtxCommand } from '../src/commands/ctx.js';
import { registerSchemaCommand } from '../src/commands/schema.js';
import { createProgram } from '../src/commands/root.js';
import { format } from '../src/output/formatter.js';
import type { Session } from '../src/config/session.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    server: 'http://localhost:3000',
    user: {
      id: 1,
      username: 'hackerwins',
      email: 'hackerwins@example.com',
      photo: null,
    },
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: '2099-01-01T00:00:00.000Z',
    activeWorkspace: 'e98ff707-1111-2222-3333-444444444444',
    workspaces: [
      {
        id: 'e98ff707-1111-2222-3333-444444444444',
        name: "hackerwins's Workspace",
      },
    ],
    ...overrides,
  };
}

describe('buildStatus', () => {
  it('reports loggedIn: false with a next-step message when there is no session', () => {
    expect(buildStatus(null)).toEqual({
      loggedIn: false,
      message: NOT_LOGGED_IN_MESSAGE,
    });
  });

  it('reports the full auth state for a valid session', () => {
    expect(buildStatus(makeSession())).toEqual({
      loggedIn: true,
      user: 'hackerwins',
      email: 'hackerwins@example.com',
      server: 'http://localhost:3000',
      workspaceId: 'e98ff707-1111-2222-3333-444444444444',
      workspaceName: "hackerwins's Workspace",
      session: 'valid',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
  });

  it('marks an elapsed session as expired', () => {
    const payload = buildStatus(
      makeSession({ expiresAt: '2000-01-01T00:00:00.000Z' }),
    );
    expect(payload.session).toBe('expired');
    expect(payload.expiresAt).toBe('2000-01-01T00:00:00.000Z');
  });

  it('reports workspaceName: null when the active workspace is unknown', () => {
    const payload = buildStatus(makeSession({ activeWorkspace: 'missing-id' }));
    expect(payload.workspaceId).toBe('missing-id');
    expect(payload.workspaceName).toBeNull();
  });

  it('is JSON-parseable in both states (the §8.1 contract)', () => {
    expect(JSON.parse(format(buildStatus(null), 'json')).loggedIn).toBe(false);
    expect(
      JSON.parse(format(buildStatus(makeSession()), 'json')).loggedIn,
    ).toBe(true);
  });

  it('renders every field under --format table', () => {
    const table = format(buildStatus(makeSession()), 'table');
    expect(table).toContain('hackerwins');
    expect(table).toContain('http://localhost:3000');
    expect(table).toContain('valid');
    expect(table).not.toContain('[object Object]');
  });
});

/**
 * End-to-end wiring: drive the real commander program so the
 * `--format` plumbing (the actual defect in #635) is covered, not just
 * the payload builders. `WAFFLEBASE_SESSION` points at a path that does
 * not exist, giving the logged-out branch without touching a real
 * session file.
 */
describe('status / ctx list command wiring', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;
  const originalSessionPath = process.env.WAFFLEBASE_SESSION;
  let tempDirs: string[] = [];

  beforeEach(() => {
    stdout = vi.spyOn(console, 'log').mockImplementation(() => {
      /* swallow */
    });
    stderr = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow */
    });
    process.env.WAFFLEBASE_SESSION = '/nonexistent/wafflebase-session.json';
    process.exitCode = 0;
    tempDirs = [];
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = originalExitCode;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    if (originalSessionPath === undefined) {
      delete process.env.WAFFLEBASE_SESSION;
    } else {
      process.env.WAFFLEBASE_SESSION = originalSessionPath;
    }
  });

  function run(argv: string[]): void {
    const program = createProgram();
    registerStatusCommand(program);
    registerCtxCommand(program);
    registerSchemaCommand(program);
    program.parse(argv, { from: 'user' });
  }

  /** Point `WAFFLEBASE_SESSION` at a real session file on disk. */
  function withSession(session: Session): string {
    const dir = mkdtempSync(join(tmpdir(), 'wafflebase-cli-test-'));
    const path = join(dir, 'session.json');
    writeFileSync(path, JSON.stringify(session));
    process.env.WAFFLEBASE_SESSION = path;
    tempDirs.push(dir);
    return path;
  }

  function lastStdout(): string {
    return String(stdout.mock.calls.at(-1)?.[0]);
  }

  function lastStderr(): string {
    return String(stderr.mock.calls.at(-1)?.[0]);
  }

  it('emits JSON from `status` by default', () => {
    run(['status']);
    expect(JSON.parse(lastStdout())).toEqual({
      loggedIn: false,
      message: NOT_LOGGED_IN_MESSAGE,
    });
    expect(process.exitCode).toBe(0);
  });

  it('honors `status --format csv`', () => {
    run(['status', '--format', 'csv']);
    expect(lastStdout().split('\n')[0]).toBe('loggedIn,message');
  });

  it('rejects `status --format bogus` with a JSON error and exit 1', () => {
    run(['status', '--format', 'bogus']);
    expect(stdout).not.toHaveBeenCalled();
    expect(JSON.parse(lastStderr()).error.code).toBe('INVALID_FORMAT');
    expect(process.exitCode).toBe(1);
  });

  it('reports NOT_LOGGED_IN from `ctx list` with exit 1', () => {
    run(['ctx', 'list']);
    expect(JSON.parse(lastStderr()).error.code).toBe('NOT_LOGGED_IN');
    expect(process.exitCode).toBe(1);
  });

  it('rejects `ctx list --format bogus`', () => {
    run(['ctx', 'list', '--format', 'bogus']);
    expect(JSON.parse(lastStderr()).error.code).toBe('INVALID_FORMAT');
    expect(process.exitCode).toBe(1);
  });

  it('emits the full auth state from `status` with a session on disk', () => {
    withSession(makeSession());
    run(['status']);
    expect(JSON.parse(lastStdout())).toMatchObject({
      loggedIn: true,
      user: 'hackerwins',
      workspaceName: "hackerwins's Workspace",
      session: 'valid',
    });
    expect(process.exitCode).toBe(0);
  });

  it('emits the workspace rows from `ctx list` with a session on disk', () => {
    withSession(makeSession());
    run(['ctx', 'list']);
    expect(JSON.parse(lastStdout())).toEqual([
      {
        id: 'e98ff707-1111-2222-3333-444444444444',
        name: "hackerwins's Workspace",
        active: true,
      },
    ]);
    expect(process.exitCode).toBe(0);
  });

  it('renders `ctx list --format table` with an active column', () => {
    withSession(makeSession());
    run(['ctx', 'list', '--format', 'table']);
    const lines = lastStdout().split('\n');
    expect(lines[0]).toContain('active');
    expect(lines[2]).toContain('true');
  });

  it('suppresses `status` output under --quiet', () => {
    withSession(makeSession());
    run(['status', '--quiet']);
    expect(stdout).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  // `schema` is the one other `output()` caller that renders a single
  // object; it must reject a bad --format as JSON rather than let the
  // throw escape to an uncaught exception (bin.ts has no top handler).
  it('rejects `schema --format bogus` with a JSON error', () => {
    run(['schema', '--format', 'bogus']);
    expect(JSON.parse(lastStderr()).error.code).toBe('INVALID_FORMAT');
    expect(process.exitCode).toBe(1);
  });

  it('renders nested schema payloads as JSON under --format table', () => {
    run(['schema', 'ctx.list', '--format', 'table']);
    const out = lastStdout();
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('"active"');
  });
});
