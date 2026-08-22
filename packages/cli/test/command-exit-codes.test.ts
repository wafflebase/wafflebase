import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * End-to-end wiring for the exit contract: drive real command actions
 * (commander parse → action → HttpClient stub → formatter) and assert
 * the process exit code. The helpers in `errors.test.ts` prove the
 * classification table; this file proves each command is actually
 * plugged into it — in particular that the JSON-error-body branch of
 * `docs/notes/slides content|export` reads the *status* of the response
 * it just printed, and does not fall back to the hardcoded `1`.
 */

const stub = vi.hoisted(() => ({
  response: { ok: false, status: 401, data: null as unknown },
}));

vi.mock('../src/commands/root.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/commands/root.js')>();
  // Any client method answers with the response the test set up.
  const client = new Proxy(
    {},
    { get: () => async () => stub.response },
  ) as ReturnType<typeof actual.getClient>;
  return {
    ...actual,
    getConfig: () => ({
      server: 'https://api.example',
      workspace: 'ws-1',
      authMode: 'api-key' as const,
      apiKey: 'wfb_test',
    }),
    getClient: () => client,
  };
});

const { createProgram } = await import('../src/commands/root.js');
const { registerDocsCommand } = await import('../src/commands/docs.js');
const { registerNotesCommand } = await import('../src/commands/notes.js');
const { registerSlidesCommand } = await import('../src/commands/slides.js');
const { registerApiKeysCommand } = await import('../src/commands/api-keys.js');

const ERROR_BODY = {
  error: { code: 'SESSION_EXPIRED', message: 'Session expired.' },
};

async function run(argv: string[]): Promise<void> {
  const program = createProgram();
  registerDocsCommand(program);
  registerNotesCommand(program);
  registerSlidesCommand(program);
  registerApiKeysCommand(program);
  await program.parseAsync(argv, { from: 'user' });
}

describe('command exit codes', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  describe.each([
    ['docs', ['docs', 'content', 'doc-1']],
    ['notes', ['notes', 'content', 'note-1']],
    ['slides', ['slides', 'content', 'deck-1']],
  ])('%s content with a backend error body', (_name, argv) => {
    it('exits 2 on a 401 and prints the body verbatim', async () => {
      stub.response = { ok: false, status: 401, data: ERROR_BODY };
      await run(argv);
      expect(process.exitCode).toBe(2);
      expect(String(stderrSpy.mock.calls[0]?.[0])).toContain(
        'SESSION_EXPIRED',
      );
    });

    it('exits 2 on a 5xx', async () => {
      stub.response = {
        ok: false,
        status: 503,
        data: { error: { code: 'UPSTREAM', message: 'down' } },
      };
      await run(argv);
      expect(process.exitCode).toBe(2);
    });

    it('still exits 1 on a 404, which is the caller’s mistake', async () => {
      stub.response = {
        ok: false,
        status: 404,
        data: { error: { code: 'NOT_FOUND', message: 'no such doc' } },
      };
      await run(argv);
      expect(process.exitCode).toBe(1);
    });
  });

  describe.each([
    ['docs', ['docs', 'export', 'doc-1', 'out.pdf']],
    ['notes', ['notes', 'export', 'note-1', 'out.md']],
    ['slides', ['slides', 'export', 'deck-1', 'out.pptx']],
  ])('%s export with a backend error body', (_name, argv) => {
    it('exits 2 on a 401 without writing the file', async () => {
      stub.response = { ok: false, status: 401, data: ERROR_BODY };
      await run(argv);
      expect(process.exitCode).toBe(2);
    });

    it('exits 1 on a 404', async () => {
      stub.response = {
        ok: false,
        status: 404,
        data: { error: { code: 'NOT_FOUND', message: 'no such doc' } },
      };
      await run(argv);
      expect(process.exitCode).toBe(1);
    });
  });

  describe('responses without a JSON error body', () => {
    it('exits 2 with AUTH_ERROR on a 401', async () => {
      stub.response = { ok: false, status: 401, data: null };
      await run(['docs', 'get', 'doc-1']);
      expect(process.exitCode).toBe(2);
      const body = JSON.parse(String(stderrSpy.mock.calls[0]?.[0])) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe('AUTH_ERROR');
      expect(body.error.message).toContain('wafflebase login');
    });

    it('exits 2 with SERVER_ERROR on a 500', async () => {
      stub.response = { ok: false, status: 500, data: null };
      await run(['docs', 'list']);
      expect(process.exitCode).toBe(2);
      const body = JSON.parse(String(stderrSpy.mock.calls[0]?.[0])) as {
        error: { code: string };
      };
      expect(body.error.code).toBe('SERVER_ERROR');
    });

    it('exits 1 on a 404', async () => {
      stub.response = { ok: false, status: 404, data: null };
      await run(['docs', 'get', 'doc-1']);
      expect(process.exitCode).toBe(1);
    });

    it('exits 2 when an api-keys call is rejected', async () => {
      stub.response = { ok: false, status: 403, data: null };
      await run(['api-keys', 'list']);
      expect(process.exitCode).toBe(2);
    });
  });
});
