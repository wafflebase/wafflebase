import { describe, it, expect } from 'vitest';
import { serializeText } from '../../src/serialize/text.js';
import type {
  Block,
  BlockStyle,
  Document,
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

describe('serializeText', () => {
  it('joins paragraphs with newlines, one block per line', () => {
    const doc: Document = {
      blocks: [
        block('a', 'paragraph', [inline('Hello, ')]),
        block('b', 'paragraph', [inline('world!')]),
      ],
    };
    expect(serializeText(doc)).toBe('Hello, \nworld!');
  });

  it('strips inline styling but preserves the underlying text', () => {
    const doc: Document = {
      blocks: [
        block('a', 'paragraph', [
          inline('bold ', { bold: true }),
          inline('italic ', { italic: true }),
          inline('strike', { strikethrough: true }),
        ]),
      ],
    };
    expect(serializeText(doc)).toBe('bold italic strike');
  });

  it('drops list markers and just emits item text', () => {
    const doc: Document = {
      blocks: [
        block('a', 'list-item', [inline('first')], {
          listKind: 'unordered',
          listLevel: 0,
        }),
        block('b', 'list-item', [inline('second')], {
          listKind: 'ordered',
          listLevel: 0,
        }),
      ],
    };
    expect(serializeText(doc)).toBe('first\nsecond');
  });

  it('joins table cells with tabs and rows with newlines', () => {
    const tableData: TableData = {
      rows: [
        {
          cells: [
            { blocks: [block('c1', 'paragraph', [inline('A')])], style: {} },
            { blocks: [block('c2', 'paragraph', [inline('B')])], style: {} },
          ],
        },
        {
          cells: [
            { blocks: [block('c3', 'paragraph', [inline('1')])], style: {} },
            { blocks: [block('c4', 'paragraph', [inline('2')])], style: {} },
          ],
        },
      ],
      columnWidths: [0.5, 0.5],
    };
    const doc: Document = {
      blocks: [block('t', 'table', [], { tableData })],
    };
    expect(serializeText(doc)).toBe('A\tB\n1\t2');
  });

  it('renders horizontal-rule as a divider line and page-break as form feed', () => {
    const doc: Document = {
      blocks: [
        block('a', 'paragraph', [inline('Before')]),
        block('hr', 'horizontal-rule', []),
        block('p', 'page-break', []),
        block('b', 'paragraph', [inline('After')]),
      ],
    };
    expect(serializeText(doc)).toBe('Before\n----\n\f\nAfter');
  });

  it('omits header/footer by default and includes them when asked', () => {
    const doc: Document = {
      blocks: [block('a', 'paragraph', [inline('Body')])],
      header: {
        blocks: [block('h', 'paragraph', [inline('Page header')])],
        marginFromEdge: 24,
      },
      footer: {
        blocks: [block('f', 'paragraph', [inline('Page footer')])],
        marginFromEdge: 24,
      },
    };
    expect(serializeText(doc)).toBe('Body');
    expect(serializeText(doc, { includeHeaderFooter: true })).toBe(
      'Page header\nBody\nPage footer',
    );
  });

  it('substitutes the page-number marker with #', () => {
    const doc: Document = {
      blocks: [
        block('a', 'paragraph', [
          inline('Page '),
          inline('\uFFFC', { pageNumber: true }),
        ]),
      ],
    };
    expect(serializeText(doc)).toBe('Page #');
  });

  it('flattens nested-table cell content so newlines never break outer alignment', () => {
    // A cell containing a nested table would otherwise return a string
    // with embedded \n (one per inner row), which shreds the outer
    // table's tab alignment when joined into a row. The cell flattener
    // must collapse those line breaks.
    const innerTable: TableData = {
      rows: [
        {
          cells: [
            { blocks: [block('i1', 'paragraph', [inline('A')])], style: {} },
          ],
        },
        {
          cells: [
            { blocks: [block('i2', 'paragraph', [inline('B')])], style: {} },
          ],
        },
      ],
      columnWidths: [1],
    };
    const outerTable: TableData = {
      rows: [
        {
          cells: [
            {
              blocks: [
                block('nested', 'table', [], { tableData: innerTable }),
              ],
              style: {},
            },
            { blocks: [block('plain', 'paragraph', [inline('right')])], style: {} },
          ],
        },
      ],
      columnWidths: [0.5, 0.5],
    };
    const doc: Document = {
      blocks: [block('outer', 'table', [], { tableData: outerTable })],
    };

    const out = serializeText(doc);
    // Exactly one row -> exactly one tab and zero newlines anywhere.
    expect(out).not.toMatch(/\n/);
    expect(out.split('\t')).toHaveLength(2);
  });

  it('renders image inlines as a placeholder', () => {
    const doc: Document = {
      blocks: [
        block('a', 'paragraph', [
          inline('Before '),
          inline('\uFFFC', {
            image: { src: 'http://x/y.png', width: 10, height: 10, alt: 'pic' },
          }),
          inline(' after'),
        ]),
      ],
    };
    expect(serializeText(doc)).toBe('Before [image] after');
  });
});
