import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAgentCommand } from '../src/commands/agent.js';
import { createProgram } from '../src/commands/root.js';
import {
  agentFilePath,
  saveAgentFile,
  type AgentCredential,
} from '../src/config/agents.js';

const AGENT: AgentCredential = {
  server: 'https://bots.example.com',
  workspaceId: 'ws-bot',
  botId: 42,
  botName: 'deck-bot',
  apiKey: 'wfb_bot_secret',
  pairedAt: '2026-11-28T00:00:00.000Z',
};

/**
 * `agent *` authenticates only from `~/.wafflebase/agents/<bot>.json`. Every
 * test runs with a member's API key in the environment and a member session
 * on disk, so a command that fell back to either would send the wrong
 * credential — and the header assertions would catch it.
 */
describe('agent command', () => {
  let home: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;
  const saved = {
    HOME: process.env.HOME,
    WAFFLEBASE_SESSION: process.env.WAFFLEBASE_SESSION,
    WAFFLEBASE_CONFIG: process.env.WAFFLEBASE_CONFIG,
    WAFFLEBASE_API_KEY: process.env.WAFFLEBASE_API_KEY,
    WAFFLEBASE_SERVER: process.env.WAFFLEBASE_SERVER,
    WAFFLEBASE_WORKSPACE: process.env.WAFFLEBASE_WORKSPACE,
  };

  function respond(status: number, body: unknown) {
    fetchMock.mockImplementation(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'wafflebase-agent-cmd-'));
    process.env.HOME = home;
    const sessionPath = join(home, 'session.json');
    writeFileSync(
      sessionPath,
      JSON.stringify({
        server: 'https://member.example.com',
        accessToken: 'member-jwt',
        refreshToken: 'member-refresh',
        expiresAt: '2999-01-01T00:00:00.000Z',
        activeWorkspace: 'ws-member',
        workspaces: [],
        user: { id: 1, username: 'me', email: 'me@x', photo: null },
      }),
    );
    process.env.WAFFLEBASE_SESSION = sessionPath;
    process.env.WAFFLEBASE_CONFIG = join(home, 'nonexistent-config.yaml');
    process.env.WAFFLEBASE_API_KEY = 'wfb_member_key';
    delete process.env.WAFFLEBASE_SERVER;
    process.env.WAFFLEBASE_WORKSPACE = 'ws-member';
    stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock = vi.fn();
    respond(200, {});
    vi.stubGlobal('fetch', fetchMock);
    process.exitCode = 0;
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    vi.unstubAllGlobals();
    process.exitCode = originalExitCode;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });

  function run(argv: string[]): Promise<unknown> {
    const program = createProgram();
    registerAgentCommand(program);
    return program.parseAsync(argv, { from: 'user' });
  }

  function lastRequest() {
    const [url, init] = fetchMock.mock.calls.at(-1) as [
      string,
      { method: string; body?: string; headers?: Record<string, string> },
    ];
    return {
      url,
      method: init.method,
      auth: init.headers?.Authorization,
      body: init.body ? (JSON.parse(init.body) as unknown) : undefined,
    };
  }

  function lastStdout(): unknown {
    return JSON.parse(String(stdout.mock.calls.at(-1)?.[0]));
  }

  function lastError(): { code: string; message: string; command?: string } {
    return JSON.parse(String(stderr.mock.calls.at(-1)?.[0])).error;
  }

  describe('pair', () => {
    const PAIRED = {
      botId: 42,
      botName: 'deck-bot',
      workspaceId: 'ws-bot',
      apiKey: 'wfb_bot_secret',
    };

    it('posts the code unauthenticated and stores the key 0600', async () => {
      respond(201, PAIRED);

      await run([
        '--server',
        'https://bots.example.com/',
        'agent',
        'pair',
        '4f2k-9qxd',
        '--host-name',
        'laptop',
      ]);

      const req = lastRequest();
      expect(req.url).toBe('https://bots.example.com/auth/pair');
      expect(req.method).toBe('POST');
      // Normalized to the code's printed form.
      expect(req.body).toEqual({ code: '4F2K-9QXD', hostName: 'laptop' });
      // Neither the env key nor the session token goes to /auth/pair.
      expect(req.auth).toBeUndefined();

      const path = agentFilePath('deck-bot');
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const stored = JSON.parse(readFileSync(path, 'utf8'));
      expect(stored).toMatchObject({
        server: 'https://bots.example.com',
        workspaceId: 'ws-bot',
        botId: 42,
        botName: 'deck-bot',
        apiKey: 'wfb_bot_secret',
      });
      expect(typeof stored.pairedAt).toBe('string');

      // The key never reaches stdout.
      const out = lastStdout() as Record<string, unknown>;
      expect(JSON.stringify(out)).not.toContain('wfb_bot_secret');
      expect(out).toMatchObject({
        botName: 'deck-bot',
        botId: 42,
        workspaceId: 'ws-bot',
        server: 'https://bots.example.com',
        file: path,
      });
      expect(process.exitCode).toBe(0);
    });

    it('defaults the host name to this machine and the server to the normal resolution', async () => {
      respond(201, PAIRED);
      process.env.WAFFLEBASE_SERVER = 'https://env.example.com';

      await run(['agent', 'pair', '4F2K-9QXD']);

      const req = lastRequest();
      expect(req.url).toBe('https://env.example.com/auth/pair');
      expect(req.body).toEqual({ code: '4F2K-9QXD', hostName: hostname() });
    });

    it('reports a rejected code and writes nothing', async () => {
      respond(400, {
        message: 'Pairing code is invalid or expired',
        error: 'Bad Request',
        statusCode: 400,
      });

      await run(['agent', 'pair', 'AAAA-BBBB']);

      const err = lastError();
      expect(err.code).toBe('HTTP_ERROR');
      expect(err.message).toContain('Pairing code is invalid or expired');
      expect(err.command).toBe('agent.pair');
      expect(process.exitCode).toBe(1);
      expect(() => statSync(agentFilePath('deck-bot'))).toThrow();
    });

    it('refuses a response that does not carry a usable credential', async () => {
      respond(201, { ...PAIRED, botName: '../session' });

      await run(['agent', 'pair', 'AAAA-BBBB']);

      expect(lastError().code).toBe('INVALID_RESPONSE');
      expect(process.exitCode).toBe(2);
    });

    it('re-pairs the same bot over its old file', async () => {
      saveAgentFile({ ...AGENT, apiKey: 'wfb_old_key' });
      respond(201, PAIRED);

      await run(['--server', AGENT.server, 'agent', 'pair', 'AAAA-BBBB']);

      expect(process.exitCode).toBe(0);
      const stored = JSON.parse(readFileSync(agentFilePath('deck-bot'), 'utf8'));
      expect(stored.apiKey).toBe('wfb_bot_secret');
    });

    it('refuses to replace a same-named bot of another workspace', async () => {
      saveAgentFile(AGENT);
      respond(201, { ...PAIRED, workspaceId: 'ws-other', botId: 77, apiKey: 'wfb_new' });

      await run(['--server', AGENT.server, 'agent', 'pair', 'AAAA-BBBB']);

      const err = lastError();
      expect(err.code).toBe('AGENT_NAME_TAKEN');
      expect(err.message).toContain('ws-bot');
      expect(err.message).toContain('--replace');
      expect(err.message).not.toContain('wfb_');
      expect(process.exitCode).toBe(1);
      // The first bot's key is still the one on disk.
      const stored = JSON.parse(readFileSync(agentFilePath('deck-bot'), 'utf8'));
      expect(stored).toMatchObject({ workspaceId: 'ws-bot', apiKey: 'wfb_bot_secret' });
    });

    it('refuses a same-named bot of another server too', async () => {
      saveAgentFile(AGENT);
      respond(201, PAIRED);

      await run(['--server', 'https://other.example.com', 'agent', 'pair', 'AAAA-BBBB']);

      expect(lastError().code).toBe('AGENT_NAME_TAKEN');
      const stored = JSON.parse(readFileSync(agentFilePath('deck-bot'), 'utf8'));
      expect(stored.server).toBe(AGENT.server);
    });

    it('replaces a same-named bot with --replace', async () => {
      saveAgentFile(AGENT);
      respond(201, { ...PAIRED, workspaceId: 'ws-other', botId: 77, apiKey: 'wfb_new' });

      await run(['--server', AGENT.server, 'agent', 'pair', 'AAAA-BBBB', '--replace']);

      expect(process.exitCode).toBe(0);
      const stored = JSON.parse(readFileSync(agentFilePath('deck-bot'), 'utf8'));
      expect(stored).toMatchObject({ workspaceId: 'ws-other', botId: 77, apiKey: 'wfb_new' });
    });

    it('previews under --dry-run without sending or writing', async () => {
      await run([
        '--server',
        'https://bots.example.com',
        '--dry-run',
        'agent',
        'pair',
        'AAAA-BBBB',
        '--host-name',
        'ci',
      ]);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(lastStdout()).toEqual({
        dry_run: true,
        method: 'POST',
        url: 'https://bots.example.com/auth/pair',
        body: { code: 'AAAA-BBBB', hostName: 'ci' },
      });
    });
  });

  describe('list', () => {
    it('lists paired bots without keys and without a request', async () => {
      saveAgentFile(AGENT);

      await run(['agent', 'list']);

      expect(fetchMock).not.toHaveBeenCalled();
      const rows = lastStdout() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].botName).toBe('deck-bot');
      expect(JSON.stringify(rows)).not.toContain('wfb_bot_secret');
    });
  });

  describe('task commands', () => {
    const BASE = 'https://bots.example.com/api/v1/workspaces/ws-bot/agent/tasks';

    beforeEach(() => {
      saveAgentFile(AGENT);
    });

    it('next long-polls with the bot key, not the member credential', async () => {
      respond(200, { task: null });

      await run(['agent', 'next', 'deck-bot', '--wait', '240']);

      const req = lastRequest();
      expect(req.url).toBe(`${BASE}/next?wait=240`);
      expect(req.method).toBe('GET');
      expect(req.auth).toBe('Bearer wfb_bot_secret');
      expect(lastStdout()).toEqual({ task: null });
    });

    it('next ignores --server, --workspace and --api-key', async () => {
      respond(200, { task: null });

      await run([
        '--server',
        'https://elsewhere.example.com',
        '--workspace',
        'ws-other',
        '--api-key',
        'wfb_flag_key',
        'agent',
        'next',
        'deck-bot',
      ]);

      const req = lastRequest();
      expect(req.url).toBe(`${BASE}/next?wait=0`);
      expect(req.auth).toBe('Bearer wfb_bot_secret');
    });

    it.each(['-1', '241', '1.5', 'soon'])(
      'next refuses --wait %s locally',
      async (wait) => {
        await run(['agent', 'next', 'deck-bot', '--wait', wait]);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(lastError().code).toBe('INVALID_ARGUMENT');
      },
    );

    it('thread reads the task thread', async () => {
      respond(200, [{ id: 'm1', body: 'hi' }]);

      await run(['agent', 'thread', 'deck-bot', 'task-1']);

      const req = lastRequest();
      expect(req.url).toBe(`${BASE}/task-1/thread`);
      expect(req.method).toBe('GET');
      expect(req.auth).toBe('Bearer wfb_bot_secret');
      expect(lastStdout()).toEqual([{ id: 'm1', body: 'hi' }]);
    });

    it('reply posts the body as the bot', async () => {
      respond(201, { id: 'm2' });

      await run(['agent', 'reply', 'deck-bot', 'task-1', 'Done: 3 slides']);

      const req = lastRequest();
      expect(req.url).toBe(`${BASE}/task-1/reply`);
      expect(req.method).toBe('POST');
      expect(req.auth).toBe('Bearer wfb_bot_secret');
      expect(req.body).toEqual({ body: 'Done: 3 slides' });
    });

    it('reply reads --body-file', async () => {
      respond(201, { id: 'm2' });
      const file = join(home, 'reply.txt');
      writeFileSync(file, 'line one\nline two\n');

      await run(['agent', 'reply', 'deck-bot', 'task-1', '--body-file', file]);

      expect(lastRequest().body).toEqual({ body: 'line one\nline two\n' });
    });

    it.each([
      [['agent', 'reply', 'deck-bot', 'task-1']],
      [['agent', 'reply', 'deck-bot', 'task-1', 'x', '--body-file', 'f']],
    ])('reply wants exactly one of <body> or --body-file', async (argv) => {
      await run(argv);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(lastError().code).toBe('INVALID_ARGUMENT');
    });

    it('reply refuses an empty body', async () => {
      await run(['agent', 'reply', 'deck-bot', 'task-1', '   ']);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(lastError().code).toBe('INVALID_ARGUMENT');
    });

    it('complete marks the task done, and --failed marks it failed', async () => {
      respond(204, null);

      await run(['agent', 'complete', 'deck-bot', 'task-1']);
      expect(lastRequest()).toMatchObject({
        url: `${BASE}/task-1/complete`,
        method: 'POST',
        auth: 'Bearer wfb_bot_secret',
        body: { status: 'done' },
      });
      expect(lastStdout()).toEqual({ ok: true });

      await run(['agent', 'complete', 'deck-bot', 'task-1', '--failed']);
      expect(lastRequest().body).toEqual({ status: 'failed' });
    });

    it('previews a reply under --dry-run without the key', async () => {
      await run(['--dry-run', 'agent', 'reply', 'deck-bot', 'task-1', 'hi']);

      expect(fetchMock).not.toHaveBeenCalled();
      const out = lastStdout();
      expect(out).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${BASE}/task-1/reply`,
        body: { body: 'hi' },
      });
      expect(JSON.stringify(out)).not.toContain('wfb_bot_secret');
    });

    it('escapes the task id into one path segment', async () => {
      await run(['agent', 'thread', 'deck-bot', '..']);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('reports a bot that is not paired here', async () => {
      await run(['agent', 'next', 'other-bot']);

      expect(fetchMock).not.toHaveBeenCalled();
      const err = lastError();
      expect(err.code).toBe('AGENT_NOT_PAIRED');
      expect(err.message).toContain('wafflebase agent pair');
      expect(process.exitCode).toBe(1);
    });

    it('says to pair again when the bot key is rejected', async () => {
      respond(401, { message: 'Unauthorized', statusCode: 401 });

      await run(['agent', 'next', 'deck-bot']);

      const err = lastError();
      expect(err.code).toBe('AUTH_ERROR');
      expect(err.message).toContain('agent pair');
      expect(err.message).not.toContain('wafflebase login');
      expect(process.exitCode).toBe(2);
    });
  });
});
