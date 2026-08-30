import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_BLOCK_STYLE,
  type Block,
  type Document,
} from '@wafflebase/docs';
import {
  LOSSY_NOTICE,
  parseContentFormat,
  runDocsContent,
  type ContentIO,
} from '../src/docs/content.js';

function makeDoc(blocks: Block[]): Document {
  return { blocks };
}

function paragraph(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

function heading(id: string, level: 1 | 2, text: string): Block {
  return {
    id,
    type: 'heading',
    headingLevel: level,
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

/** A paragraph whose single run carries `href`. */
function link(id: string, text: string, href: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: { href } }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

/** A paragraph holding a single image inline. */
function image(id: string, src: string, alt: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [
      { text: '￼', style: { image: { src, alt, width: 10, height: 10 } } },
    ],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

interface Capture {
  stdout: string;
  stderr: string[];
  files: Record<string, string>;
  io: ContentIO;
}

function makeCapture(): Capture {
  const cap: Capture = {
    stdout: '',
    stderr: [],
    files: {},
    io: {
      stdout: (text) => {
        cap.stdout += text;
      },
      stderr: (line) => {
        cap.stderr.push(line);
      },
      writeFile: (path, text) => {
        cap.files[path] = text;
      },
    },
  };
  return cap;
}

describe('parseContentFormat', () => {
  it('accepts json/md/text', () => {
    expect(parseContentFormat('json')).toBe('json');
    expect(parseContentFormat('md')).toBe('md');
    expect(parseContentFormat('text')).toBe('text');
  });

  it('rejects anything else', () => {
    expect(() => parseContentFormat('csv')).toThrow(/Invalid --format/);
    expect(() => parseContentFormat('')).toThrow(/Invalid --format/);
  });
});

describe('runDocsContent (json)', () => {
  it('emits valid JSON for the supplied document', () => {
    const doc = makeDoc([paragraph('b1', 'hello')]);
    const cap = makeCapture();

    runDocsContent({ doc, format: 'json' }, cap.io);

    const parsed = JSON.parse(cap.stdout);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].id).toBe('b1');
    // No layout supplied → no _pageMeta field
    expect(parsed._pageMeta).toBeUndefined();
  });

  it('does not emit the lossy notice for json', () => {
    const cap = makeCapture();
    runDocsContent({ doc: makeDoc([paragraph('b1', 'x')]), format: 'json' }, cap.io);
    expect(cap.stderr).not.toContain(LOSSY_NOTICE);
  });
});

describe('runDocsContent (md)', () => {
  it('renders headings and paragraphs as Markdown', () => {
    const doc = makeDoc([
      heading('h1', 1, 'Title'),
      paragraph('p1', 'Body text.'),
    ]);
    const cap = makeCapture();

    runDocsContent({ doc, format: 'md' }, cap.io);

    expect(cap.stdout).toContain('# Title');
    expect(cap.stdout).toContain('Body text.');
  });

  it('emits the lossy notice on stderr by default', () => {
    const cap = makeCapture();
    runDocsContent({ doc: makeDoc([paragraph('b', 'x')]), format: 'md' }, cap.io);
    expect(cap.stderr).toContain(LOSSY_NOTICE);
  });

  it('suppresses the lossy notice when quiet', () => {
    const cap = makeCapture();
    runDocsContent(
      { doc: makeDoc([paragraph('b', 'x')]), format: 'md', quiet: true },
      cap.io,
    );
    expect(cap.stderr).not.toContain(LOSSY_NOTICE);
  });
});

/**
 * The URL gate is the serializer's, and `packages/docs` tests it there. This
 * suite exists because `docs content --format md` is a *separate* consumer of
 * it: the CLI resolves `@wafflebase/docs` through the built package, so a
 * regression that only reached this command — a changed option default, an
 * `inlineImages` wire-up, a serializer swapped for a local one — would pass
 * every docs-package test and still change what users get in a `.md` file.
 * These assertions pin the emitted bytes at the command boundary.
 *
 * The rule itself is documented in `docs/design/cli.md` § 6.5.
 */
describe('runDocsContent (md) — link and image targets', () => {
  it('drops an unsafe href and keeps the text it wrapped', () => {
    const cap = makeCapture();
    runDocsContent(
      { doc: makeDoc([link('l', 'Click me', 'javascript:alert(1)')]), format: 'md' },
      cap.io,
    );
    expect(cap.stdout).toContain('Click me');
    expect(cap.stdout).not.toContain('javascript:');
    expect(cap.stdout).not.toContain('](');
  });

  it('keeps a relative href as a live link', () => {
    const cap = makeCapture();
    runDocsContent(
      { doc: makeDoc([link('l', 'Report', '/uploads/report.pdf')]), format: 'md' },
      cap.io,
    );
    expect(cap.stdout).toContain('[Report](/uploads/report.pdf)');
  });

  it('keeps a relative image src as a live image', () => {
    const cap = makeCapture();
    runDocsContent(
      { doc: makeDoc([image('i', './diagram.png', 'Diagram')]), format: 'md' },
      cap.io,
    );
    expect(cap.stdout).toContain('![Diagram](./diagram.png)');
  });

  it('drops a scheme-relative href, which changes origin', () => {
    const cap = makeCapture();
    runDocsContent(
      { doc: makeDoc([link('l', 'Elsewhere', '//evil.example/x')]), format: 'md' },
      cap.io,
    );
    expect(cap.stdout).toContain('Elsewhere');
    expect(cap.stdout).not.toContain('evil.example');
  });

  it('writes the same targets to a file as it prints to stdout', () => {
    const cap = makeCapture();
    const doc = makeDoc([
      link('safe', 'Home', 'https://example.com/a(b)'),
      link('rel', 'Report', '/uploads/report.pdf'),
      link('bad', 'Click me', 'javascript:alert(1)'),
      image('img', './diagram.png', 'Diagram'),
      image('data', 'data:image/png;base64,AAAA', 'Pasted'),
    ]);

    runDocsContent({ doc, format: 'md', out: 'out.md' }, cap.io);

    const written = cap.files['out.md'];
    expect(written).toContain('[Home](https://example.com/a\\(b\\))');
    expect(written).toContain('[Report](/uploads/report.pdf)');
    expect(written).toContain('Click me');
    expect(written).not.toContain('javascript:');
    expect(written).toContain('![Diagram](./diagram.png)');
    // `--inline-images` is off by default, so pasted bytes stay out of the file.
    expect(written).toContain('[image]');
    expect(written).not.toContain('base64');
  });

  it('carries a data:image src only when --inline-images is set', () => {
    const cap = makeCapture();
    runDocsContent(
      {
        doc: makeDoc([image('i', 'data:image/png;base64,AAAA', 'Pasted')]),
        format: 'md',
        inlineImages: true,
      },
      cap.io,
    );
    expect(cap.stdout).toContain('![Pasted](data:image/png;base64,AAAA)');
  });
});

describe('runDocsContent (text)', () => {
  it('strips formatting and emits one block per line', () => {
    const doc = makeDoc([
      heading('h1', 1, 'Big Title'),
      paragraph('p1', 'first'),
      paragraph('p2', 'second'),
    ]);
    const cap = makeCapture();

    runDocsContent({ doc, format: 'text' }, cap.io);

    const lines = cap.stdout.trim().split('\n');
    expect(lines).toEqual(['Big Title', 'first', 'second']);
  });

  it('does not emit the lossy notice for text', () => {
    const cap = makeCapture();
    runDocsContent({ doc: makeDoc([paragraph('b', 'x')]), format: 'text' }, cap.io);
    expect(cap.stderr).not.toContain(LOSSY_NOTICE);
  });
});

describe('runDocsContent --pages', () => {
  // Build a document large enough that pagination produces multiple pages
  // even with the FontkitMeasurer fallback estimate. The default Letter
  // page has ~624px content height; at the fallback rate, a single
  // paragraph wraps to several lines. We use ~30 paragraphs of 200-char
  // text to guarantee >=2 pages.
  function bigDoc(): Document {
    const blocks: Block[] = [];
    for (let i = 0; i < 30; i++) {
      blocks.push(paragraph(`p${i}`, 'lorem '.repeat(40).trim()));
    }
    return makeDoc(blocks);
  }

  it('selects only blocks on requested pages', () => {
    const doc = bigDoc();
    const cap = makeCapture();

    runDocsContent({ doc, format: 'text', pages: '1' }, cap.io);

    const lines = cap.stdout.trim().split('\n');
    // Should be a strict subset of the original 30 blocks
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(30);
  });

  it('attaches _pageMeta when format is json and --pages is set', () => {
    const doc = bigDoc();
    const cap = makeCapture();

    runDocsContent({ doc, format: 'json', pages: '1' }, cap.io);

    const parsed = JSON.parse(cap.stdout);
    expect(parsed._pageMeta).toBeDefined();
    expect(parsed._pageMeta.length).toBe(parsed.blocks.length);
    for (const meta of parsed._pageMeta) {
      expect(typeof meta.blockId).toBe('string');
      expect(Array.isArray(meta.lines)).toBe(true);
    }
  });

  it('emits parsePageRange warnings to stderr', () => {
    const doc = bigDoc();
    const cap = makeCapture();

    runDocsContent({ doc, format: 'text', pages: '1-999' }, cap.io);

    const clampWarning = cap.stderr.find((l) => /clamped/i.test(l));
    expect(clampWarning).toBeDefined();
  });

  it('throws on malformed --pages input', () => {
    const doc = bigDoc();
    const cap = makeCapture();

    expect(() =>
      runDocsContent({ doc, format: 'text', pages: 'abc' }, cap.io),
    ).toThrow(/Invalid page token/);
  });
});

describe('runDocsContent --out', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfb-docs-content-'));
  });

  it('writes output to the given file via the IO surface', () => {
    const doc = makeDoc([paragraph('b1', 'hello')]);
    const cap = makeCapture();
    const target = join(dir, 'out.json');

    runDocsContent({ doc, format: 'json', out: target }, cap.io);

    expect(cap.stdout).toBe('');
    // Parse the file contents instead of regexing on whitespace —
    // a future change to compact JSON output (or the indent step)
    // would silently slip past a `toContain('"id": "b1"')` check.
    const written = JSON.parse(cap.files[target] as string);
    expect(written.blocks?.[0]?.id).toBe('b1');
  });

  it('reports the write to stderr unless quiet', () => {
    const doc = makeDoc([paragraph('b1', 'x')]);
    const cap = makeCapture();
    const target = join(dir, 'out.txt');

    runDocsContent({ doc, format: 'text', out: target }, cap.io);

    expect(cap.stderr).toContain(`Wrote to ${target}`);
  });

  it('treats "-" as stdout', () => {
    const doc = makeDoc([paragraph('b1', 'hello')]);
    const cap = makeCapture();

    runDocsContent({ doc, format: 'text', out: '-' }, cap.io);

    expect(cap.stdout.trim()).toBe('hello');
  });

  it('passes the force flag through to the IO writeFile', () => {
    const doc = makeDoc([paragraph('b1', 'x')]);
    const calls: Array<{ path: string; force: boolean }> = [];
    const io: ContentIO = {
      stdout: () => {},
      stderr: () => {},
      writeFile: (path, _text, force) => {
        calls.push({ path, force });
      },
    };

    runDocsContent({ doc, format: 'text', out: 'a.txt' }, io);
    runDocsContent({ doc, format: 'text', out: 'a.txt', force: true }, io);

    expect(calls).toEqual([
      { path: 'a.txt', force: false },
      { path: 'a.txt', force: true },
    ]);
  });
});

describe('runDocsContent default IO writeFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfb-docs-content-default-'));
  });

  it('refuses to overwrite without --force', async () => {
    const { defaultIO } = await import('../src/docs/content.js');
    const target = join(dir, 'existing.txt');
    writeFileSync(target, 'old content', 'utf-8');
    expect(() => defaultIO.writeFile(target, 'new', false)).toThrow(
      /Refusing to overwrite/,
    );
    // Original content untouched
    expect(readFileSync(target, 'utf-8')).toBe('old content');
  });

  it('overwrites with --force', async () => {
    const { defaultIO } = await import('../src/docs/content.js');
    const target = join(dir, 'existing.txt');
    writeFileSync(target, 'old content', 'utf-8');
    defaultIO.writeFile(target, 'new', true);
    expect(readFileSync(target, 'utf-8')).toBe('new\n');
  });
});

describe('http client TYPE_MISMATCH passthrough', () => {
  // The command surfaces backend `TYPE_MISMATCH` errors verbatim by
  // checking `res.data.error.code`. Test that the response shape the
  // backend emits (per docs-content.controller.spec.ts) is preserved as
  // the CLI client sees it.
  it('preserves the error.code field through the response data', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'TYPE_MISMATCH',
            message: "Use 'sheets cells get' for spreadsheet documents",
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const { HttpClient } = await import('../src/client/http-client.js');
      const client = new HttpClient({
        server: 'http://localhost:3000',
        workspace: 'wid',
        authMode: 'api-key',
        apiKey: 'wfb_test',
      } as any);
      const res = await client.getDocContent('did');
      expect(res.ok).toBe(false);
      expect(res.status).toBe(409);
      const body = res.data as any;
      expect(body.error.code).toBe('TYPE_MISMATCH');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
