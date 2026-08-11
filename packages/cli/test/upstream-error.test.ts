import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Command } from 'commander';
import { forwardUpstreamError } from '../src/output/formatter.js';
import { createProgram } from '../src/commands/root.js';
import { registerDocsCommand } from '../src/commands/docs.js';
import { registerSlidesCommand } from '../src/commands/slides.js';
import { registerNotesCommand } from '../src/commands/notes.js';

/** The documented envelope: `error` is an object carrying a string `code`. */
const ENVELOPE = {
  error: {
    code: 'TYPE_MISMATCH',
    message: "Use 'sheets cells get' for spreadsheet documents",
  },
};

/** What Express/Nest returns for an unrouted path — `error` is a string. */
const EXPRESS_404 = {
  message: 'Cannot GET /api/v1/workspaces//documents/doc-1/content',
  error: 'Not Found',
  statusCode: 404,
};

describe('forwardUpstreamError', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow */
    });
    process.exitCode = 0;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('forwards the documented envelope verbatim', () => {
    forwardUpstreamError({ status: 409, data: ENVELOPE });
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(stderrSpy.mock.calls[0]?.[0]))).toEqual(ENVELOPE);
    expect(process.exitCode).toBe(1);
  });

  it('keeps extra fields the backend attached to the envelope', () => {
    const body = { error: { code: 'X', message: 'm', command: 'docs content' } };
    forwardUpstreamError({ status: 400, data: body });
    expect(JSON.parse(String(stderrSpy.mock.calls[0]?.[0]))).toEqual(body);
  });

  // The bug: a truthiness test forwarded this as though it were the
  // envelope, so `error.code` and `error.message` both read `undefined`.
  it('rejects a framework body whose `error` is a string', () => {
    expect(() => forwardUpstreamError({ status: 404, data: EXPRESS_404 })).toThrow(
      'HTTP 404',
    );
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('rejects an `error` object without a string `code`', () => {
    expect(() =>
      forwardUpstreamError({ status: 500, data: { error: { message: 'boom' } } }),
    ).toThrow('HTTP 500');
    expect(() =>
      forwardUpstreamError({ status: 500, data: { error: { code: 42 } } }),
    ).toThrow('HTTP 500');
  });

  it('rejects bodies that are not objects at all', () => {
    expect(() => forwardUpstreamError({ status: 502, data: null })).toThrow(
      'HTTP 502',
    );
    expect(() =>
      forwardUpstreamError({ status: 502, data: '<html>bad gateway</html>' }),
    ).toThrow('HTTP 502');
    expect(() => forwardUpstreamError({ status: 502, data: undefined })).toThrow(
      'HTTP 502',
    );
  });
});

// End-to-end guard over the six command paths that forward upstream error
// bodies. Asserting on the helper alone cannot catch a site that stops
// calling it, so these drive real commands through commander with a
// stubbed fetch and watch what reaches stderr.
describe('content/export commands envelope non-envelope error bodies', () => {
  const ENV_KEYS = [
    'WAFFLEBASE_CONFIG',
    'WAFFLEBASE_API_KEY',
    'WAFFLEBASE_SERVER',
    'WAFFLEBASE_WORKSPACE',
  ] as const;

  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let savedEnv: Record<string, string | undefined>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.WAFFLEBASE_CONFIG = '/nonexistent/wafflebase-test.yaml';
    process.env.WAFFLEBASE_API_KEY = 'wfb_test';
    process.env.WAFFLEBASE_SERVER = 'https://api.test';
    process.env.WAFFLEBASE_WORKSPACE = 'ws-1';

    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* swallow */
    });
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow */
    });
    process.exitCode = 0;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.unstubAllGlobals();
    process.exitCode = originalExitCode;
  });

  function stubFetch(status: number, data: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
      }),
    );
  }

  function buildProgram(): Command {
    const program = createProgram();
    registerDocsCommand(program);
    registerSlidesCommand(program);
    registerNotesCommand(program);
    return program;
  }

  async function run(...argv: string[]): Promise<void> {
    await buildProgram().parseAsync(['node', 'wafflebase', ...argv]);
  }

  function emitted(): { error: { code: string; message: string } } {
    expect(stderrSpy).toHaveBeenCalledOnce();
    return JSON.parse(String(stderrSpy.mock.calls[0]?.[0]));
  }

  const CASES: Array<{ name: string; argv: string[] }> = [
    { name: 'docs content', argv: ['docs', 'content', 'doc-1'] },
    { name: 'docs export', argv: ['docs', 'export', 'doc-1', 'out.pdf'] },
    { name: 'slides content', argv: ['slides', 'content', 'doc-1'] },
    { name: 'slides export', argv: ['slides', 'export', 'doc-1', 'out.pptx'] },
    { name: 'notes content', argv: ['notes', 'content', 'doc-1'] },
    { name: 'notes export', argv: ['notes', 'export', 'doc-1', 'out.md'] },
  ];

  for (const { name, argv } of CASES) {
    it(`\`${name}\` reports an Express 404 body as the documented envelope`, async () => {
      stubFetch(404, EXPRESS_404);
      await run(...argv);
      expect(emitted().error).toEqual({ code: 'ERROR', message: 'HTTP 404' });
      expect(process.exitCode).toBe(1);
    });

    it(`\`${name}\` still forwards a backend-shaped error verbatim`, async () => {
      stubFetch(409, ENVELOPE);
      await run(...argv);
      expect(emitted()).toEqual(ENVELOPE);
      expect(process.exitCode).toBe(1);
    });
  }
});
