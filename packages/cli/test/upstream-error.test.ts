import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Command } from 'commander';
import { DEFAULT_BLOCK_STYLE, DocxExporter, type Document } from '@wafflebase/docs';
import { ImportReport, type SlidesDocument } from '@wafflebase/slides/node';
import {
  forwardUpstreamError,
  outputError,
  upstreamErrorJson,
} from '../src/output/formatter.js';
import { createProgram } from '../src/commands/root.js';
import { registerDocsCommand } from '../src/commands/docs.js';
import { registerSlidesCommand } from '../src/commands/slides.js';
import { registerNotesCommand } from '../src/commands/notes.js';
import { runDocsImport } from '../src/docs/import.js';
import { runNotesImport } from '../src/notes/import.js';
import {
  runSlidesImport,
  type SlidesImportParser,
} from '../src/slides/import.js';
import { runFilesUpload } from '../src/files/upload.js';
import { runFilesDownload } from '../src/files/download.js';

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

  // The backend has no global exception filter, so a stock Nest exception
  // body is what nearly every real failure looks like. Its `message` is the
  // only text saying what went wrong; rejecting the shape must not discard it.
  it("keeps the framework body's own message", () => {
    expect(() =>
      forwardUpstreamError({
        status: 404,
        data: { message: 'Document has no file', error: 'Not Found', statusCode: 404 },
      }),
    ).toThrow('HTTP 404: Document has no file');
  });

  it('joins a class-validator message array', () => {
    expect(() =>
      forwardUpstreamError({
        status: 400,
        data: { message: ['name must be a string', 'name should not be empty'] },
      }),
    ).toThrow('HTTP 400: name must be a string; name should not be empty');
  });

  it('reports the same code as `upstreamErrorJson` for the same body', () => {
    let thrown: unknown;
    try {
      forwardUpstreamError({ status: 404, data: EXPRESS_404 });
    } catch (error) {
      thrown = error;
    }
    outputError(thrown);
    expect(JSON.parse(String(stderrSpy.mock.calls[0]?.[0]))).toEqual(
      JSON.parse(upstreamErrorJson({ status: 404, data: EXPRESS_404 })),
    );
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
      expect(emitted().error).toEqual({
        code: 'HTTP_ERROR',
        message: `HTTP 404: ${EXPRESS_404.message}`,
      });
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

describe('upstreamErrorJson', () => {
  it('forwards the documented envelope verbatim', () => {
    expect(JSON.parse(upstreamErrorJson({ status: 409, data: ENVELOPE }))).toEqual(
      ENVELOPE,
    );
  });

  it('replaces a framework body with the documented HTTP_ERROR envelope', () => {
    expect(JSON.parse(upstreamErrorJson({ status: 404, data: EXPRESS_404 }))).toEqual({
      error: { code: 'HTTP_ERROR', message: `HTTP 404: ${EXPRESS_404.message}` },
    });
  });

  it("keeps the framework body's own message", () => {
    expect(
      JSON.parse(
        upstreamErrorJson({ status: 403, data: { message: 'Forbidden resource' } }),
      ),
    ).toEqual({
      error: { code: 'HTTP_ERROR', message: 'HTTP 403: Forbidden resource' },
    });
  });

  it('does not quote an HTML error page as a message', () => {
    expect(
      JSON.parse(upstreamErrorJson({ status: 502, data: '<html>bad gateway</html>' })),
    ).toEqual({ error: { code: 'HTTP_ERROR', message: 'HTTP 502' } });
  });

  it('carries the status for a missing or unparseable body', () => {
    for (const data of [null, undefined, '<html>bad gateway</html>', { error: 42 }]) {
      expect(JSON.parse(upstreamErrorJson({ status: 502, data }))).toEqual({
        error: { code: 'HTTP_ERROR', message: 'HTTP 502' },
      });
    }
  });
});

// The import/upload/download commands report through their own injected
// `io.stderr` + exit code rather than throwing into `outputError`, so they
// need their own guard: before `upstreamErrorJson` they printed `res.data`
// verbatim and only substituted `HTTP_ERROR` for a null body.
describe('import/upload/download commands envelope non-envelope error bodies', () => {
  const fail = (status: number, data: unknown) => ({ ok: false, status, data });
  const created = { ok: true, status: 201, data: { id: 'new-1' } };

  async function docxBytes(): Promise<Uint8Array> {
    const doc: Document = {
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          inlines: [{ text: 'hi', style: {} }],
          style: { ...DEFAULT_BLOCK_STYLE },
        },
      ],
    };
    const blob = await DocxExporter.export(doc);
    return new Uint8Array(await blob.arrayBuffer());
  }

  const stubParser: SlidesImportParser = async () => ({
    document: {
      meta: { title: 'Deck', themeId: 'default-light', masterId: 'default' },
      themes: [],
      masters: [],
      layouts: [],
      slides: [],
    } as unknown as SlidesDocument,
    report: new ImportReport(),
  });

  /** stderr + exit code from one orchestrator run whose upstream call failed. */
  type Runner = (
    status: number,
    data: unknown,
  ) => Promise<{ stderr: string[]; exitCode: number }>;

  function textIO(stderr: string[]) {
    return {
      stdout: () => {
        /* swallow */
      },
      stderr: (line: string) => stderr.push(line),
      confirm: async () => true,
      isTTY: false,
    };
  }

  const CASES: Array<{ name: string; run: Runner }> = [
    {
      name: 'docs import --replace',
      run: async (status, data) => {
        const stderr: string[] = [];
        const bytes = await docxBytes();
        const res = await runDocsImport(
          { file: 'a.docx', replace: 'doc-1', yes: true },
          {
            createDocument: async () => created,
            putDocContent: async () => fail(status, data),
          },
          { ...textIO(stderr), readBytes: async () => bytes },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
    {
      name: 'docs import (create)',
      run: async (status, data) => {
        const stderr: string[] = [];
        const bytes = await docxBytes();
        const res = await runDocsImport(
          { file: 'a.docx' },
          {
            createDocument: async () => fail(status, data),
            putDocContent: async () => created,
          },
          { ...textIO(stderr), readBytes: async () => bytes },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
    {
      name: 'docs import (content PUT)',
      run: async (status, data) => {
        const stderr: string[] = [];
        const bytes = await docxBytes();
        const res = await runDocsImport(
          { file: 'a.docx' },
          {
            createDocument: async () => created,
            putDocContent: async () => fail(status, data),
          },
          { ...textIO(stderr), readBytes: async () => bytes },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
    {
      name: 'notes import --replace',
      run: async (status, data) => {
        const stderr: string[] = [];
        const res = await runNotesImport(
          { file: 'a.md', replace: 'doc-1', yes: true },
          {
            createDocument: async () => created,
            putNoteContent: async () => fail(status, data),
          },
          { ...textIO(stderr), readText: async () => '# hi' },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
    {
      name: 'notes import (create)',
      run: async (status, data) => {
        const stderr: string[] = [];
        const res = await runNotesImport(
          { file: 'a.md' },
          {
            createDocument: async () => fail(status, data),
            putNoteContent: async () => created,
          },
          { ...textIO(stderr), readText: async () => '# hi' },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
    {
      name: 'notes import (content PUT)',
      run: async (status, data) => {
        const stderr: string[] = [];
        const res = await runNotesImport(
          { file: 'a.md' },
          {
            createDocument: async () => created,
            putNoteContent: async () => fail(status, data),
          },
          { ...textIO(stderr), readText: async () => '# hi' },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
    {
      name: 'slides import --replace',
      run: async (status, data) => {
        const stderr: string[] = [];
        const res = await runSlidesImport(
          { file: 'a.pptx', replace: 'doc-1', yes: true, parser: stubParser },
          {
            createDocument: async () => created,
            putSlidesContent: async () => fail(status, data),
          },
          { ...textIO(stderr), readBytes: async () => new Uint8Array([1]) },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
    {
      name: 'slides import (create)',
      run: async (status, data) => {
        const stderr: string[] = [];
        const res = await runSlidesImport(
          { file: 'a.pptx', parser: stubParser },
          {
            createDocument: async () => fail(status, data),
            putSlidesContent: async () => created,
          },
          { ...textIO(stderr), readBytes: async () => new Uint8Array([1]) },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
    {
      name: 'slides import (content PUT)',
      run: async (status, data) => {
        const stderr: string[] = [];
        const res = await runSlidesImport(
          { file: 'a.pptx', parser: stubParser },
          {
            createDocument: async () => created,
            putSlidesContent: async () => fail(status, data),
          },
          { ...textIO(stderr), readBytes: async () => new Uint8Array([1]) },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
    {
      name: 'files upload',
      run: async (status, data) => {
        const stderr: string[] = [];
        const res = await runFilesUpload(
          { file: 'a.zip' },
          {
            uploadFileDocument: async () =>
              fail(status, data) as unknown as {
                ok: boolean;
                status: number;
                data: never;
              },
          },
          {
            stdout: () => {
              /* swallow */
            },
            stderr: (line) => stderr.push(line),
            readBytes: () => new Uint8Array([1]),
            sizeOf: () => 1,
          },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
    {
      name: 'files download',
      run: async (status, data) => {
        const stderr: string[] = [];
        const res = await runFilesDownload(
          { docId: 'doc-1' },
          { downloadFileDocument: async () => fail(status, data) },
          {
            stdout: () => {
              throw new Error('should not write bytes');
            },
            stderr: (line) => stderr.push(line),
            writeFile: () => {
              throw new Error('should not write bytes');
            },
          },
        );
        return { stderr, exitCode: res.exitCode };
      },
    },
  ];

  for (const { name, run } of CASES) {
    it(`\`${name}\` reports an Express 404 body as the documented envelope`, async () => {
      const { stderr, exitCode } = await run(404, EXPRESS_404);
      expect(exitCode).toBe(1);
      const bodies = stderr.map((l) => tryParse(l)).filter((b) => b !== null);
      expect(bodies.at(-1)).toEqual({
        error: { code: 'HTTP_ERROR', message: `HTTP 404: ${EXPRESS_404.message}` },
      });
    });

    it(`\`${name}\` still forwards a backend-shaped error verbatim`, async () => {
      const { stderr, exitCode } = await run(409, ENVELOPE);
      expect(exitCode).toBe(1);
      const bodies = stderr.map((l) => tryParse(l)).filter((b) => b !== null);
      expect(bodies.at(-1)).toEqual(ENVELOPE);
    });
  }
});

/** Non-JSON stderr lines (progress notices) are not error bodies. */
function tryParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
