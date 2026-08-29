import { describe, it, expect } from 'vitest';
import { serializeMarkdown } from '../../src/serialize/markdown.js';
import type {
  Block,
  BlockStyle,
  Document,
  HeadingLevel,
  Inline,
  TableData,
} from '../../src/model/types.js';

const baseStyle: BlockStyle = {
  alignment: 'left',
  lineHeight: 1.5,
  marginTop: 0,
  marginBottom: 0,
  textIndent: 0,
  marginLeft: 0,
};

function inline(text: string, style: Inline['style'] = {}): Inline {
  return { text, style };
}

function block(
  id: string,
  type: Block['type'],
  inlines: Inline[],
  extras: Partial<Block> = {},
): Block {
  return {
    id,
    type,
    inlines,
    style: { ...baseStyle },
    ...extras,
  };
}

function doc(blocks: Block[], rest: Partial<Document> = {}): Document {
  return { blocks, ...rest };
}

describe('serializeMarkdown — block mapping', () => {
  it('renders title with `# `', () => {
    expect(serializeMarkdown(doc([block('a', 'title', [inline('Hello')])])))
      .toBe('# Hello');
  });

  it('renders subtitle as italic paragraph', () => {
    expect(serializeMarkdown(doc([block('a', 'subtitle', [inline('Sub')])])))
      .toBe('*Sub*');
  });

  it('renders an empty subtitle as nothing rather than a stray *', () => {
    expect(serializeMarkdown(doc([block('a', 'subtitle', [])]))).toBe('');
  });

  it('does not insert extra spacing when an empty subtitle sits between paragraphs', () => {
    // Empty-rendered blocks must not cause separator inflation. A
    // paragraph -> empty subtitle -> paragraph sequence should join with
    // a single blank line, not two — and must not carry stray `*`
    // markers from the subtitle.
    const md = serializeMarkdown(
      doc([
        block('p1', 'paragraph', [inline('before')]),
        block('s', 'subtitle', []),
        block('p2', 'paragraph', [inline('after')]),
      ]),
    );
    expect(md).toBe('before\n\nafter');
  });

  it('renders headings 1 through 6 with the right hash count', () => {
    for (let level = 1 as HeadingLevel; level <= 6; level = (level + 1) as HeadingLevel) {
      const md = serializeMarkdown(
        doc([
          block('a', 'heading', [inline(`H${level}`)], { headingLevel: level }),
        ]),
      );
      expect(md).toBe(`${'#'.repeat(level)} H${level}`);
    }
  });

  it('renders paragraph as plain text', () => {
    expect(serializeMarkdown(doc([block('a', 'paragraph', [inline('hi')])])))
      .toBe('hi');
  });

  it('renders ordered list-items with `1. `', () => {
    const md = serializeMarkdown(
      doc([
        block('a', 'list-item', [inline('first')], {
          listKind: 'ordered',
          listLevel: 0,
        }),
        block('b', 'list-item', [inline('second')], {
          listKind: 'ordered',
          listLevel: 0,
        }),
      ]),
    );
    expect(md).toBe('1. first\n1. second');
  });

  it('renders unordered list-items with `- `', () => {
    const md = serializeMarkdown(
      doc([
        block('a', 'list-item', [inline('alpha')], {
          listKind: 'unordered',
          listLevel: 0,
        }),
      ]),
    );
    expect(md).toBe('- alpha');
  });

  it('indents nested list-items with 2 spaces per level', () => {
    const md = serializeMarkdown(
      doc([
        block('a', 'list-item', [inline('top')], {
          listKind: 'unordered',
          listLevel: 0,
        }),
        block('b', 'list-item', [inline('nested')], {
          listKind: 'unordered',
          listLevel: 1,
        }),
        block('c', 'list-item', [inline('deeper')], {
          listKind: 'unordered',
          listLevel: 2,
        }),
      ]),
    );
    expect(md).toBe('- top\n  - nested\n    - deeper');
  });

  it('renders horizontal-rule as `---`', () => {
    expect(serializeMarkdown(doc([block('a', 'horizontal-rule', [])])))
      .toBe('---');
  });

  it('renders page-break as the standard pagebreak comment', () => {
    expect(serializeMarkdown(doc([block('a', 'page-break', [])])))
      .toBe('<!-- pagebreak -->');
  });

  it('separates adjacent paragraphs with a blank line', () => {
    const md = serializeMarkdown(
      doc([
        block('a', 'paragraph', [inline('first')]),
        block('b', 'paragraph', [inline('second')]),
      ]),
    );
    expect(md).toBe('first\n\nsecond');
  });

  it('separates a paragraph and a table with a blank line', () => {
    const tableData: TableData = {
      rows: [
        {
          cells: [
            { blocks: [block('h', 'paragraph', [inline('Header')])], style: {} },
          ],
        },
      ],
      columnWidths: [1],
    };
    const md = serializeMarkdown(
      doc([
        block('p', 'paragraph', [inline('intro')]),
        block('t', 'table', [], { tableData }),
      ]),
    );
    expect(md).toBe('intro\n\n| Header |\n| --- |');
  });

  it('keeps consecutive list items tight but separates surrounding paragraphs', () => {
    const md = serializeMarkdown(
      doc([
        block('p1', 'paragraph', [inline('before')]),
        block('l1', 'list-item', [inline('one')], {
          listKind: 'unordered',
          listLevel: 0,
        }),
        block('l2', 'list-item', [inline('two')], {
          listKind: 'unordered',
          listLevel: 0,
        }),
        block('p2', 'paragraph', [inline('after')]),
      ]),
    );
    expect(md).toBe('before\n\n- one\n- two\n\nafter');
  });
});

describe('serializeMarkdown — tables', () => {
  it('emits a GFM table with the first row as the header', () => {
    const tableData: TableData = {
      rows: [
        {
          cells: [
            { blocks: [block('h1', 'paragraph', [inline('Name')])], style: {} },
            { blocks: [block('h2', 'paragraph', [inline('Age')])], style: {} },
          ],
        },
        {
          cells: [
            { blocks: [block('c1', 'paragraph', [inline('Ada')])], style: {} },
            { blocks: [block('c2', 'paragraph', [inline('36')])], style: {} },
          ],
        },
      ],
      columnWidths: [0.5, 0.5],
    };
    const md = serializeMarkdown(
      doc([block('t', 'table', [], { tableData })]),
    );
    expect(md).toBe('| Name | Age |\n| --- | --- |\n| Ada | 36 |');
  });

  it('represents nested tables with a placeholder', () => {
    const innerTable: TableData = {
      rows: [
        {
          cells: [
            { blocks: [block('i1', 'paragraph', [inline('inner')])], style: {} },
          ],
        },
      ],
      columnWidths: [1],
    };
    const outerTable: TableData = {
      rows: [
        {
          cells: [
            { blocks: [block('h', 'paragraph', [inline('Header')])], style: {} },
          ],
        },
        {
          cells: [
            {
              blocks: [
                block('nested', 'table', [], { tableData: innerTable }),
              ],
              style: {},
            },
          ],
        },
      ],
      columnWidths: [1],
    };
    const md = serializeMarkdown(
      doc([block('t', 'table', [], { tableData: outerTable })]),
    );
    expect(md).toBe('| Header |\n| --- |\n| [nested table] |');
  });
});

describe('serializeMarkdown — inline mapping', () => {
  it('emits **bold** for bold runs', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [
            inline('plain '),
            inline('strong', { bold: true }),
          ]),
        ]),
      ),
    ).toBe('plain **strong**');
  });

  it('emits *italic* for italic runs', () => {
    expect(
      serializeMarkdown(
        doc([block('a', 'paragraph', [inline('em', { italic: true })])]),
      ),
    ).toBe('*em*');
  });

  it('emits ~~strikethrough~~ for struck-through runs', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [inline('gone', { strikethrough: true })]),
        ]),
      ),
    ).toBe('~~gone~~');
  });

  it('drops underline / color / size / sup / sub formatting', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [
            inline('u', { underline: true }),
            inline('-'),
            inline('big', { fontSize: 32 }),
            inline('-'),
            inline('red', { color: '#ff0000' }),
            inline('-'),
            inline('hi', { superscript: true }),
            inline('-'),
            inline('lo', { subscript: true }),
          ]),
        ]),
      ),
    ).toBe('u-big-red-hi-lo');
  });

  it('renders links as [text](href)', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [
            inline('Anthropic', { href: 'https://anthropic.com' }),
          ]),
        ]),
      ),
    ).toBe('[Anthropic](https://anthropic.com)');
  });

  it('emits ![alt](src) for image inlines', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [
            inline('\uFFFC', {
              image: {
                src: 'https://x/y.png',
                width: 10,
                height: 10,
                alt: 'logo',
              },
            }),
          ]),
        ]),
      ),
    ).toBe('![logo](https://x/y.png)');
  });

  it('replaces data: image URLs with [image] when inlineImages is false', () => {
    const md = serializeMarkdown(
      doc([
        block('a', 'paragraph', [
          inline('\uFFFC', {
            image: {
              src: 'data:image/png;base64,AAAA',
              width: 10,
              height: 10,
              alt: 'pic',
            },
          }),
        ]),
      ]),
    );
    expect(md).toBe('[image]');
  });

  it('keeps data: image URLs when inlineImages is true', () => {
    const md = serializeMarkdown(
      doc([
        block('a', 'paragraph', [
          inline('\uFFFC', {
            image: {
              src: 'data:image/png;base64,AAAA',
              width: 10,
              height: 10,
              alt: 'pic',
            },
          }),
        ]),
      ]),
      { inlineImages: true },
    );
    expect(md).toBe('![pic](data:image/png;base64,AAAA)');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['a scripting data: payload', 'data:text/html;base64,PHNjcmlwdD4='],
    ['an SVG data: payload', 'data:image/svg+xml;base64,PHN2Zz4='],
    ['file:', 'file:///etc/passwd'],
  ])('never writes %s as an image target, even with inlineImages', (_label, src) => {
    // The produced `.md` is opened by a renderer that will fetch — or, for
    // the first two, execute — whatever the target is. Nothing validates an
    // image `src` on the way into the model (DOCX/HTML import, a pasted
    // document, the CRDT itself), so it is gated here.
    const md = serializeMarkdown(
      doc([
        block('a', 'paragraph', [
          inline('\uFFFC', { image: { src, width: 10, height: 10, alt: 'pic' } }),
        ]),
      ]),
      { inlineImages: true },
    );
    expect(md).toBe('[image]');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html;base64,PHNjcmlwdD4='],
    ['a relative href', '/not/absolute'],
  ])('drops the link but keeps the text for %s', (_label, href) => {
    const md = serializeMarkdown(
      doc([block('a', 'paragraph', [inline('click me', { href })])]),
    );
    expect(md).toBe('click me');
  });

  it('still links a safe href', () => {
    const md = serializeMarkdown(
      doc([
        block('a', 'paragraph', [inline('mail', { href: 'mailto:a@b.com' })]),
      ]),
    );
    expect(md).toBe('[mail](mailto:a@b.com)');
  });

  it('renders the page-number marker as a literal #', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [
            inline('Page '),
            inline('\uFFFC', { pageNumber: true }),
          ]),
        ]),
      ),
    ).toBe('Page #');
  });
});

describe('serializeMarkdown — escaping', () => {
  it('escapes Markdown special characters in plain text runs', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [
            inline('Use * _ [ ] \\ ` ~ < for emphasis'),
          ]),
        ]),
      ),
    ).toBe('Use \\* \\_ \\[ \\] \\\\ \\` \\~ \\< for emphasis');
  });

  it('escapes ] in link body', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [
            inline('weird]label', { href: 'https://example.com' }),
          ]),
        ]),
      ),
    ).toBe('[weird\\]label](https://example.com)');
  });

  it('escapes ) and \\ in link href', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [
            inline('go', { href: 'https://x.test/a)b\\c' }),
          ]),
        ]),
      ),
    ).toBe('[go](https://x.test/a\\)b\\\\c)');
  });

  it('escapes ] in image alt', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [
            inline('\uFFFC', {
              image: {
                src: 'https://x/y.png',
                width: 10,
                height: 10,
                alt: 'foo]bar',
              },
            }),
          ]),
        ]),
      ),
    ).toBe('![foo\\]bar](https://x/y.png)');
  });
});

describe('serializeMarkdown — URL safety', () => {
  const linked = (href: string) =>
    serializeMarkdown(
      doc([block('a', 'paragraph', [inline('click me', { href })])]),
    );

  const pictured = (src: string, opts = { inlineImages: true }) =>
    serializeMarkdown(
      doc([
        block('a', 'paragraph', [
          inline('\uFFFC', { image: { src, width: 10, height: 10, alt: 'pic' } }),
        ]),
      ]),
      opts,
    );

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:text/html', 'data:text/html;base64,PHNjcmlwdD4='],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['a relative path with no scheme', '/local/path'],
  ])('drops a %s link target, keeping the text', (_label, href) => {
    expect(linked(href)).toBe('click me');
  });

  it.each([
    ['http', 'http://example.com/a'],
    ['https', 'https://example.com/a'],
    ['mailto', 'mailto:someone@example.com'],
    ['tel', 'tel:+15551234'],
  ])('keeps a %s link target', (_label, href) => {
    expect(linked(href)).toBe(`[click me](${href})`);
  });

  it('still wraps the unlinked text in its other formatting', () => {
    expect(
      serializeMarkdown(
        doc([
          block('a', 'paragraph', [
            inline('click me', { href: 'javascript:alert(1)', bold: true }),
          ]),
        ]),
      ),
    ).toBe('**click me**');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:text/html', 'data:text/html;base64,PHNjcmlwdD4='],
    ['file:', 'file:///etc/passwd'],
  ])('replaces a %s image source with the [image] placeholder', (_label, src) => {
    expect(pictured(src)).toBe('[image]');
  });

  it('keeps a data:image source, which is what inlineImages is for', () => {
    expect(pictured('data:image/png;base64,AAAA')).toBe(
      '![pic](data:image/png;base64,AAAA)',
    );
  });

  it('keeps an https image source', () => {
    expect(pictured('https://x/y.png')).toBe('![pic](https://x/y.png)');
  });

  // ── The parser differential ───────────────────────────────────────────────
  // `isSafeUrl` parses with WHATWG `new URL()`, which *deletes* every tab, LF
  // and CR from its input before it looks at the scheme. A gate that
  // validates the normalized form and then writes the raw string therefore
  // passes characters that the validator never saw — and a newline or a space
  // ends a CommonMark link destination, so everything after it lands in the
  // exported `.md` as live Markdown or raw HTML.
  const BREAKOUT_PAYLOADS: Array<[string, string]> = [
    ['a tab', 'https://example.com/a\tb'],
    ['a line feed', 'https://example.com/a\nb'],
    ['a carriage return', 'https://example.com/a\rb'],
    ['a CRLF', 'https://example.com/a\r\nb'],
    ['a space', 'https://example.com/a b'],
    // The payload as an attacker would actually spell it: close the
    // destination, then open a raw HTML tag in the exported document.
    [
      'a newline that opens raw HTML',
      'https://example.com/\n\n<img src=x onerror=alert(1)>',
    ],
    // Normalization strips the newline mid-scheme, so the *validated* string
    // reads `javascript:` — but the raw one is written as-is.
    ['a scheme split by a newline', 'java\nscript:alert(1)'],
  ];

  it.each(BREAKOUT_PAYLOADS)(
    'refuses a link destination containing %s',
    (_label, href) => {
      const md = linked(href);
      expect(md).toBe('click me');
      // Belt and braces: whatever the fallback text is, nothing that came
      // from the URL may survive into the output.
      expect(md).not.toContain('example.com');
      expect(md).not.toMatch(/[\t\n\r]/);
    },
  );

  it.each(BREAKOUT_PAYLOADS)(
    'refuses an image source containing %s',
    (_label, src) => {
      const md = pictured(src);
      expect(md).toBe('[image]');
      expect(md).not.toMatch(/[\t\n\r]/);
    },
  );

  it('refuses a data:image source padded with whitespace', () => {
    // The `data:image/...` allowance is the one path that bypasses
    // `isSafeUrl` entirely, so it needs the same character gate.
    expect(pictured('data:image/png;base64,AA\nAA')).toBe('[image]');
    expect(pictured(' data:image/png;base64,AAAA')).toBe('[image]');
  });

  it('refuses a link destination wrapped in the whitespace URL() trims', () => {
    // Leading/trailing C0-or-space is trimmed by `new URL()`, so the
    // validated string differs from the raw one here too.
    expect(linked('  https://example.com/a  ')).toBe('click me');
    // …while the same URL without the padding still links.
    expect(linked('https://example.com/a')).toBe('[click me](https://example.com/a)');
  });
});

describe('serializeMarkdown — header / footer toggle', () => {
  const sample: Document = {
    blocks: [block('a', 'paragraph', [inline('Body')])],
    header: {
      blocks: [block('h', 'paragraph', [inline('Top')])],
      marginFromEdge: 24,
    },
    footer: {
      blocks: [block('f', 'paragraph', [inline('Bottom')])],
      marginFromEdge: 24,
    },
  };

  it('omits header and footer by default', () => {
    expect(serializeMarkdown(sample)).toBe('Body');
  });

  it('includes header and footer when toggled on', () => {
    expect(
      serializeMarkdown(sample, { includeHeaderFooter: true }),
    ).toBe('Top\n\nBody\n\nBottom');
  });
});
