import { describe, it, expect } from 'vitest';
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type { Element, Slide, SlidesDocument, TextBody } from '@wafflebase/slides/node';
import {
  parseSlidesContentFormat,
  runSlidesContent,
  SLIDES_LOSSY_NOTICE,
  type SlidesContentIO,
} from '../src/slides/content.js';

function paragraph(id: string, text: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  } as Block;
}

function heading(id: string, level: 1 | 2, text: string): Block {
  return {
    id,
    type: 'heading',
    headingLevel: level,
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  } as Block;
}

function textBody(blocks: Block[]): TextBody {
  return { blocks };
}

function textElement(id: string, blocks: Block[]): Element {
  return {
    id,
    type: 'text',
    frame: { x: 0, y: 0, w: 100, h: 100 },
    data: textBody(blocks),
  } as unknown as Element;
}

function shapeElement(id: string, blocks: Block[]): Element {
  return {
    id,
    type: 'shape',
    frame: { x: 0, y: 0, w: 100, h: 100 },
    data: { kind: 'rect', text: textBody(blocks) },
  } as unknown as Element;
}

function imageElement(id: string): Element {
  return {
    id,
    type: 'image',
    frame: { x: 0, y: 0, w: 100, h: 100 },
    data: { src: 'data:image/png;base64,xxx' },
  } as unknown as Element;
}

function tableElement(id: string, grid: string[][]): Element {
  return {
    id,
    type: 'table',
    frame: { x: 0, y: 0, w: 100, h: 100 },
    data: {
      columnWidths: grid[0].map(() => 50),
      rows: grid.map((row) => ({
        height: 20,
        cells: row.map((cellText, c) => ({
          body: textBody([paragraph(`${id}-c${c}`, cellText)]),
          style: {},
        })),
      })),
    },
  } as unknown as Element;
}

function groupElement(id: string, children: Element[]): Element {
  return {
    id,
    type: 'group',
    frame: { x: 0, y: 0, w: 100, h: 100 },
    data: { children },
  } as unknown as Element;
}

function slide(id: string, elements: Element[], notes: Block[] = []): Slide {
  return {
    id,
    layoutId: 'blank',
    background: { fill: { kind: 'role', role: 'background' } },
    elements,
    notes,
  } as unknown as Slide;
}

function makeDeck(slides: Slide[]): SlidesDocument {
  return {
    meta: { title: 'Test Deck', themeId: 'default-light', masterId: 'default' },
    themes: [],
    masters: [],
    layouts: [],
    slides,
    guides: [],
  } as unknown as SlidesDocument;
}

interface Capture {
  stdout: string;
  stderr: string[];
  files: Record<string, string>;
  io: SlidesContentIO;
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

describe('parseSlidesContentFormat', () => {
  it('accepts json/md/text', () => {
    expect(parseSlidesContentFormat('json')).toBe('json');
    expect(parseSlidesContentFormat('md')).toBe('md');
    expect(parseSlidesContentFormat('text')).toBe('text');
  });

  it('rejects anything else', () => {
    expect(() => parseSlidesContentFormat('pdf')).toThrow(/Invalid --format/);
    expect(() => parseSlidesContentFormat('')).toThrow(/Invalid --format/);
  });
});

describe('runSlidesContent (json)', () => {
  it('emits the raw deck JSON faithfully', () => {
    const deck = makeDeck([slide('s1', [textElement('t1', [paragraph('b1', 'hello')])])]);
    const cap = makeCapture();

    runSlidesContent({ deck, format: 'json' }, cap.io);

    const parsed = JSON.parse(cap.stdout);
    expect(parsed.meta.title).toBe('Test Deck');
    expect(parsed.slides).toHaveLength(1);
    expect(parsed.slides[0].elements[0].data.blocks[0].id).toBe('b1');
  });

  it('does not emit the lossy notice for json', () => {
    const deck = makeDeck([slide('s1', [])]);
    const cap = makeCapture();
    runSlidesContent({ deck, format: 'json' }, cap.io);
    expect(cap.stderr).not.toContain(SLIDES_LOSSY_NOTICE);
  });
});

describe('runSlidesContent (md)', () => {
  it('emits a heading per slide and extracts text', () => {
    const deck = makeDeck([
      slide('s1', [textElement('t1', [heading('h1', 1, 'Title'), paragraph('p1', 'Body')])]),
      slide('s2', [textElement('t2', [paragraph('p2', 'Second slide')])]),
    ]);
    const cap = makeCapture();

    runSlidesContent({ deck, format: 'md' }, cap.io);

    expect(cap.stdout).toContain('## Slide 1');
    expect(cap.stdout).toContain('# Title');
    expect(cap.stdout).toContain('Body');
    expect(cap.stdout).toContain('## Slide 2');
    expect(cap.stdout).toContain('Second slide');
  });

  it('extracts text from shapes, tables, and grouped elements', () => {
    const deck = makeDeck([
      slide('s1', [
        shapeElement('sh1', [paragraph('sp', 'shape label')]),
        tableElement('tb1', [
          ['A1', 'B1'],
          ['A2', 'B2'],
        ]),
        groupElement('g1', [textElement('gt', [paragraph('gp', 'grouped text')])]),
      ]),
    ]);
    const cap = makeCapture();

    runSlidesContent({ deck, format: 'text' }, cap.io);

    expect(cap.stdout).toContain('shape label');
    expect(cap.stdout).toContain('A1');
    expect(cap.stdout).toContain('B2');
    expect(cap.stdout).toContain('grouped text');
  });

  it('emits the lossy notice on stderr by default', () => {
    const deck = makeDeck([slide('s1', [textElement('t1', [paragraph('p', 'x')])])]);
    const cap = makeCapture();
    runSlidesContent({ deck, format: 'md' }, cap.io);
    expect(cap.stderr).toContain(SLIDES_LOSSY_NOTICE);
  });

  it('suppresses the lossy notice when quiet', () => {
    const deck = makeDeck([slide('s1', [])]);
    const cap = makeCapture();
    runSlidesContent({ deck, format: 'md', quiet: true }, cap.io);
    expect(cap.stderr).not.toContain(SLIDES_LOSSY_NOTICE);
  });

  it('ignores image elements (no text body)', () => {
    const deck = makeDeck([slide('s1', [imageElement('img1')])]);
    const cap = makeCapture();
    runSlidesContent({ deck, format: 'text' }, cap.io);
    // The slide header is still emitted, but no element text.
    expect(cap.stdout.trim()).toBe('Slide 1');
  });
});

describe('runSlidesContent (text + notes)', () => {
  it('includes speaker notes only when --notes is set', () => {
    const deck = makeDeck([
      slide('s1', [textElement('t1', [paragraph('p', 'body')])], [paragraph('n1', 'remember this')]),
    ]);

    const without = makeCapture();
    runSlidesContent({ deck, format: 'text' }, without.io);
    expect(without.stdout).not.toContain('remember this');

    const withNotes = makeCapture();
    runSlidesContent({ deck, format: 'text', notes: true }, withNotes.io);
    expect(withNotes.stdout).toContain('Notes:');
    expect(withNotes.stdout).toContain('remember this');
  });
});

describe('runSlidesContent --out', () => {
  it('writes to the given file via the IO surface', () => {
    const deck = makeDeck([slide('s1', [textElement('t1', [paragraph('b1', 'hi')])])]);
    const cap = makeCapture();

    runSlidesContent({ deck, format: 'json', out: 'deck.json' }, cap.io);

    expect(cap.stdout).toBe('');
    const written = JSON.parse(cap.files['deck.json'] as string);
    expect(written.slides[0].elements[0].data.blocks[0].id).toBe('b1');
    expect(cap.stderr).toContain('Wrote to deck.json');
  });

  it('passes the force flag through to writeFile', () => {
    const deck = makeDeck([slide('s1', [])]);
    const calls: Array<{ path: string; force: boolean }> = [];
    const io: SlidesContentIO = {
      stdout: () => {},
      stderr: () => {},
      writeFile: (path, _text, force) => {
        calls.push({ path, force });
      },
    };

    runSlidesContent({ deck, format: 'text', out: 'a.txt' }, io);
    runSlidesContent({ deck, format: 'text', out: 'a.txt', force: true }, io);

    expect(calls).toEqual([
      { path: 'a.txt', force: false },
      { path: 'a.txt', force: true },
    ]);
  });

  it('treats "-" as stdout', () => {
    const deck = makeDeck([slide('s1', [textElement('t1', [paragraph('b1', 'hello')])])]);
    const cap = makeCapture();
    runSlidesContent({ deck, format: 'text', out: '-' }, cap.io);
    expect(cap.stdout).toContain('hello');
  });
});
