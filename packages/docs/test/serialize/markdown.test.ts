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
