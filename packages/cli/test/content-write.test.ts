import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { Readable } from 'node:stream';
import { createProgram } from '../src/commands/root.js';
import {
  registerDocsSetContentCommand,
  registerNotesSetContentCommand,
  registerSlidesSetContentCommand,
} from '../src/commands/content-write.js';

/**
 * Drives the REAL commands through commander rather than a stand-in, because
 * what is worth guarding here lives in the action handler's wiring: that each
 * namespace's `set-content` reaches its own typed client method, that a
 * `--dry-run` previews the exact PUT it would have sent without sending it,
 * and that a rejected write leaves the error envelope rather than a body.
 *
 * All three commands hit the same endpoint, so the client mock answers all
 * three methods and the assertions name which one was called.
 */

const putDocContent = vi.fn();
const putSlidesContent = vi.fn();
const putNoteContent = vi.fn();

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    putDocContent = (...a: unknown[]) => putDocContent(...a);
    putSlidesContent = (...a: unknown[]) => putSlidesContent(...a);
    putNoteContent = (...a: unknown[]) => putNoteContent(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';

function run(argv: string[]) {
  const program = createProgram();
  // The real CLI hangs these off the `docs` / `slides` / `notes` groups
  // created by their own register functions; the parents are irrelevant to
  // these assertions, so mount them on bare namespaces.
  registerDocsSetContentCommand(program.command('docs'));
  registerSlidesSetContentCommand(program.command('slides'));
  registerNotesSetContentCommand(program.command('notes'));
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

/**
 * Run `fn` with `process.stdin` replaced by a stream carrying `input`.
 *
 * The handler consumes stdin with `for await (const chunk of process.stdin)`,
 * so the substitute only has to be async-iterable; the property descriptor is
 * restored afterwards so nothing leaks into the next test.
 */
async function withStdin<T>(input: string, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin')!;
  Object.defineProperty(process, 'stdin', {
    value: Readable.from(input ? [Buffer.from(input, 'utf-8')] : []),
    configurable: true,
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'stdin', original);
  }
}

const DOC_BODY = {
  blocks: [
    {
      id: 'b1',
      type: 'paragraph',
      style: {},
      inlines: [{ text: 'hi', style: {} }],
    },
  ],
};

describe('set-content commands', () => {
  let stdout: string[];
  let stderr: string[];
  const originalEnv = {
    WAFFLEBASE_SESSION: process.env.WAFFLEBASE_SESSION,
    WAFFLEBASE_CONFIG: process.env.WAFFLEBASE_CONFIG,
  };

  beforeEach(() => {
    stdout = [];
    stderr = [];
    putDocContent.mockReset();
    putSlidesContent.mockReset();
    putNoteContent.mockReset();
    // Never let the developer's own session/config leak into a test run.
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

  describe('docs set-content', () => {
    it('puts the parsed --data payload and prints the echoed content', async () => {
      putDocContent.mockResolvedValue({
        ok: true,
        status: 200,
        data: DOC_BODY,
      });

      await run([
        'docs',
        'set-content',
        'doc-1',
        '--data',
        JSON.stringify(DOC_BODY),
      ]);

      expect(putDocContent).toHaveBeenCalledWith('doc-1', DOC_BODY);
      expect(putSlidesContent).not.toHaveBeenCalled();
      expect(putNoteContent).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual(DOC_BODY);
      expect(process.exitCode).toBeUndefined();
    });

    it('prints the request without sending it under --dry-run', async () => {
      await run([
        'docs',
        'set-content',
        'doc-1',
        '--data',
        JSON.stringify(DOC_BODY),
        '--dry-run',
      ]);

      expect(putDocContent).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/doc-1/content`,
        body: DOC_BODY,
      });
    });

    it('envelopes a rejected write instead of printing a body', async () => {
      // What the controller answers when the body's shape does not match the
      // stored document type.
      putDocContent.mockResolvedValue({
        ok: false,
        status: 400,
        data: {
          message: "Body shape 'doc' does not match document type 'note'",
        },
      });

      await run([
        'docs',
        'set-content',
        'doc-1',
        '--data',
        JSON.stringify(DOC_BODY),
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });

    it('relays the TYPE_MISMATCH envelope for a spreadsheet', async () => {
      putDocContent.mockResolvedValue({
        ok: false,
        status: 409,
        data: {
          error: {
            code: 'TYPE_MISMATCH',
            message: "Use 'sheets cells get' for spreadsheet documents",
          },
        },
      });

      await run([
        'docs',
        'set-content',
        'sheet-1',
        '--data',
        JSON.stringify(DOC_BODY),
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('TYPE_MISMATCH');
    });

    it('names --data as the source of a malformed payload', async () => {
      await run(['docs', 'set-content', 'doc-1', '--data', '{not json']);

      expect(putDocContent).not.toHaveBeenCalled();
      const envelope = JSON.parse(stderr.join('\n')) as {
        error: { message: string; command: string };
      };
      expect(envelope.error.message).toMatch(/--data/);
      expect(envelope.error.message).toMatch(/document content/);
      expect(envelope.error.command).toBe('docs.set-content');
      expect(process.exitCode).toBe(1);
    });

    it('rejects a bad --format before writing the document', async () => {
      await run([
        'docs',
        'set-content',
        'doc-1',
        '--data',
        JSON.stringify(DOC_BODY),
        '--format',
        'bogus',
      ]);

      expect(putDocContent).not.toHaveBeenCalled();
      expect(
        (JSON.parse(stderr.join('\n')) as { error: { code: string } }).error
          .code,
      ).toBe('INVALID_FORMAT');
      expect(process.exitCode).toBe(1);
    });

    it('refuses a dot-segment document id without sending anything', async () => {
      await run([
        'docs',
        'set-content',
        '..',
        '--data',
        JSON.stringify(DOC_BODY),
        '--dry-run',
      ]);

      expect(putDocContent).not.toHaveBeenCalled();
      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
    });
  });

  describe('slides set-content', () => {
    const DECK = {
      meta: { title: 'Deck', themeId: 't1', masterId: 'm1' },
      themes: [],
      masters: [],
      layouts: [],
      slides: [],
    };

    it('routes to the slides client method', async () => {
      putSlidesContent.mockResolvedValue({ ok: true, status: 200, data: DECK });

      await run([
        'slides',
        'set-content',
        'deck-1',
        '--data',
        JSON.stringify(DECK),
      ]);

      expect(putSlidesContent).toHaveBeenCalledWith('deck-1', DECK);
      expect(putDocContent).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual(DECK);
    });

    it('previews the same content endpoint under --dry-run', async () => {
      await run([
        'slides',
        'set-content',
        'deck-1',
        '--data',
        JSON.stringify(DECK),
        '--dry-run',
      ]);

      expect(putSlidesContent).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${SERVER}/api/v1/workspaces/${WORKSPACE}/documents/deck-1/content`,
        body: DECK,
      });
    });

    it('envelopes an upstream failure', async () => {
      putSlidesContent.mockResolvedValue({ ok: false, status: 500, data: {} });

      await run([
        'slides',
        'set-content',
        'deck-1',
        '--data',
        JSON.stringify(DECK),
      ]);

      expect(stdout).toEqual([]);
      // 5xx is a system error, not a user error.
      expect(process.exitCode).toBe(2);
      expect(stderr.join('\n')).toMatch(/500/);
    });
  });

  describe('notes set-content', () => {
    const NOTE = { content: '# Title\n' };

    it('routes to the notes client method', async () => {
      putNoteContent.mockResolvedValue({ ok: true, status: 200, data: NOTE });

      await run([
        'notes',
        'set-content',
        'note-1',
        '--data',
        JSON.stringify(NOTE),
      ]);

      expect(putNoteContent).toHaveBeenCalledWith('note-1', NOTE);
      expect(putDocContent).not.toHaveBeenCalled();
      expect(putSlidesContent).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual(NOTE);
    });

    it('reads the payload from stdin when --data is absent', async () => {
      putNoteContent.mockResolvedValue({ ok: true, status: 200, data: NOTE });

      await withStdin(JSON.stringify(NOTE), () =>
        run(['notes', 'set-content', 'note-1']),
      );

      expect(putNoteContent).toHaveBeenCalledWith('note-1', NOTE);
      expect(JSON.parse(stdout.join('\n'))).toEqual(NOTE);
    });

    it('names stdin as the source of a malformed payload', async () => {
      // No `--data`, so the handler reads stdin; an empty stream is not JSON.
      await withStdin('', () => run(['notes', 'set-content', 'note-1']));

      expect(putNoteContent).not.toHaveBeenCalled();
      const envelope = JSON.parse(stderr.join('\n')) as {
        error: { message: string };
      };
      expect(envelope.error.message).toMatch(/on stdin/);
      expect(envelope.error.message).toMatch(/note content/);
      expect(process.exitCode).toBe(1);
    });

    it('envelopes a rejected note write', async () => {
      putNoteContent.mockResolvedValue({
        ok: false,
        status: 400,
        data: {
          message: "Invalid note content payload: 'content' must be a string",
        },
      });

      await run([
        'notes',
        'set-content',
        'note-1',
        '--data',
        JSON.stringify({ content: 1 }),
      ]);

      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(stderr.join('\n')).toMatch(/400/);
    });
  });
});

describe('set-content command registration', () => {
  it('mounts set-content on each namespace', () => {
    const docs = new Command('docs');
    const slides = new Command('slides');
    const notes = new Command('notes');
    registerDocsSetContentCommand(docs);
    registerSlidesSetContentCommand(slides);
    registerNotesSetContentCommand(notes);

    for (const group of [docs, slides, notes]) {
      expect(group.commands.map((c) => c.name())).toEqual(['set-content']);
    }
    expect(docs.commands[0].description()).toMatch(/document content/);
    expect(slides.commands[0].description()).toMatch(/deck content/);
    expect(notes.commands[0].description()).toMatch(/note content/);
  });
});
