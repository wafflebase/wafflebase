// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { TableCell } from '../../src/model/types.js';
import { serializeClipboard, deserializeClipboard, cloneTableCells, serializeBlocks, deserializeBlocks, parseHtmlToInlines, parseHtmlToBlocks, parseHtmlTableToTableCells, parseMarkdownTableToTableCells, parseMarkdownWithTables } from '../../src/view/clipboard.js';

describe('clipboard JSON serialization', () => {
  it('should round-trip blocks with formatting', () => {
    const blocks = [
      {
        id: 'b1',
        type: 'paragraph' as const,
        inlines: [
          { text: 'Hello ', style: { bold: true } },
          { text: 'world', style: {} },
        ],
        style: {
          alignment: 'left' as const,
          lineHeight: 1.5,
          marginTop: 0,
          marginBottom: 8,
          textIndent: 0,
          marginLeft: 0,
        },
      },
    ];
    const json = serializeBlocks(blocks);
    const parsed = deserializeBlocks(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].inlines[0].style.bold).toBe(true);
    expect(parsed[0].inlines[1].text).toBe('world');
  });

  it('should include version in payload', () => {
    const json = serializeBlocks([]);
    const payload = JSON.parse(json);
    expect(payload.version).toBe(1);
  });

  it('should return empty array for unsupported version', () => {
    const json = JSON.stringify({ version: 2, blocks: [{ id: 'x' }] });
    expect(deserializeBlocks(json)).toEqual([]);
  });

  it('should preserve block type and heading level', () => {
    const blocks = [
      {
        id: 'h1',
        type: 'heading' as const,
        headingLevel: 2 as const,
        inlines: [{ text: 'Title', style: { bold: true, fontSize: 20 } }],
        style: {
          alignment: 'left' as const,
          lineHeight: 1.5,
          marginTop: 0,
          marginBottom: 8,
          textIndent: 0,
          marginLeft: 0,
        },
      },
    ];
    const parsed = deserializeBlocks(serializeBlocks(blocks));
    expect(parsed[0].type).toBe('heading');
    expect(parsed[0].headingLevel).toBe(2);
  });

  it('should preserve list-item properties', () => {
    const blocks = [
      {
        id: 'li1',
        type: 'list-item' as const,
        listKind: 'ordered' as const,
        listLevel: 1,
        inlines: [{ text: 'Item', style: {} }],
        style: {
          alignment: 'left' as const,
          lineHeight: 1.5,
          marginTop: 0,
          marginBottom: 8,
          textIndent: 0,
          marginLeft: 0,
        },
      },
    ];
    const parsed = deserializeBlocks(serializeBlocks(blocks));
    expect(parsed[0].listKind).toBe('ordered');
    expect(parsed[0].listLevel).toBe(1);
  });

  it('should round-trip tableCells payload', () => {
    const cells: TableCell[][] = [
      [
        {
          blocks: [{
            id: 'c1',
            type: 'paragraph' as const,
            inlines: [{ text: 'A1', style: { bold: true } }],
            style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
          }],
          style: { padding: 4 },
        },
        {
          blocks: [{
            id: 'c2',
            type: 'paragraph' as const,
            inlines: [{ text: 'B1', style: {} }],
            style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
          }],
          style: { padding: 4 },
        },
      ],
    ];
    const json = serializeClipboard({ blocks: [], tableCells: cells });
    const result = deserializeClipboard(json);
    expect(result.tableCells).toBeDefined();
    expect(result.tableCells).toHaveLength(1);
    expect(result.tableCells![0]).toHaveLength(2);
    expect(result.tableCells![0][0].blocks[0].inlines[0].text).toBe('A1');
    expect(result.tableCells![0][0].blocks[0].inlines[0].style.bold).toBe(true);
    expect(result.tableCells![0][1].blocks[0].inlines[0].text).toBe('B1');
  });

  it('should return empty tableCells when absent in payload', () => {
    const json = serializeClipboard({ blocks: [] });
    const result = deserializeClipboard(json);
    expect(result.tableCells).toBeUndefined();
  });

  it('should preserve inline style properties', () => {
    const blocks = [
      {
        id: 'b1',
        type: 'paragraph' as const,
        inlines: [
          {
            text: 'styled',
            style: {
              bold: true,
              italic: true,
              underline: true,
              strikethrough: true,
              fontSize: 14,
              fontFamily: 'Courier',
              color: '#ff0000',
              backgroundColor: '#00ff00',
              superscript: true,
              href: 'https://example.com',
            },
          },
        ],
        style: {
          alignment: 'center' as const,
          lineHeight: 2.0,
          marginTop: 4,
          marginBottom: 12,
          textIndent: 20,
          marginLeft: 36,
        },
      },
    ];
    const parsed = deserializeBlocks(serializeBlocks(blocks));
    const style = parsed[0].inlines[0].style;
    expect(style.bold).toBe(true);
    expect(style.italic).toBe(true);
    expect(style.superscript).toBe(true);
    expect(style.href).toBe('https://example.com');
    expect(parsed[0].style.alignment).toBe('center');
  });
});

describe('HTML paste parsing', () => {
  it('should parse bold tags', () => {
    const inlines = parseHtmlToInlines('<b>hello</b> world');
    expect(inlines[0].style.bold).toBe(true);
    expect(inlines[0].text).toBe('hello');
    expect(inlines[1].text).toBe(' world');
  });

  it('should parse strong tags as bold', () => {
    const inlines = parseHtmlToInlines('<strong>text</strong>');
    expect(inlines[0].style.bold).toBe(true);
    expect(inlines[0].text).toBe('text');
  });

  it('should parse italic tags', () => {
    const inlines = parseHtmlToInlines('<em>text</em>');
    expect(inlines[0].style.italic).toBe(true);
  });

  it('should parse i tag as italic', () => {
    const inlines = parseHtmlToInlines('<i>text</i>');
    expect(inlines[0].style.italic).toBe(true);
  });

  it('should parse underline tag', () => {
    const inlines = parseHtmlToInlines('<u>text</u>');
    expect(inlines[0].style.underline).toBe(true);
  });

  it('should parse strikethrough tags', () => {
    for (const tag of ['s', 'del', 'strike']) {
      const inlines = parseHtmlToInlines(`<${tag}>text</${tag}>`);
      expect(inlines[0].style.strikethrough).toBe(true);
      expect(inlines[0].text).toBe('text');
    }
  });

  it('should parse anchor tags as href', () => {
    const inlines = parseHtmlToInlines('<a href="https://example.com">link</a>');
    expect(inlines[0].style.href).toBe('https://example.com');
    expect(inlines[0].text).toBe('link');
  });

  it('should parse inline style attributes', () => {
    const inlines = parseHtmlToInlines('<span style="color: red; font-size: 16px">styled</span>');
    expect(inlines[0].style.color).toBe('red');
    expect(inlines[0].style.fontSize).toBe(12);
  });

  it('should parse background-color style', () => {
    const inlines = parseHtmlToInlines('<span style="background-color: yellow">highlighted</span>');
    expect(inlines[0].style.backgroundColor).toBe('yellow');
    expect(inlines[0].text).toBe('highlighted');
  });

  it('should handle nested formatting', () => {
    const inlines = parseHtmlToInlines('<b><i>bold italic</i></b>');
    expect(inlines[0].style.bold).toBe(true);
    expect(inlines[0].style.italic).toBe(true);
    expect(inlines[0].text).toBe('bold italic');
  });

  it('should fall back to plain text for unknown tags', () => {
    const inlines = parseHtmlToInlines('<div><custom>text</custom></div>');
    expect(inlines[0].text).toBe('text');
  });

  it('should return empty array for empty HTML', () => {
    const inlines = parseHtmlToInlines('');
    expect(inlines).toHaveLength(0);
  });

  it('should handle plain text without tags', () => {
    const inlines = parseHtmlToInlines('plain text');
    expect(inlines[0].text).toBe('plain text');
  });

  it('should merge adjacent inlines with same style', () => {
    const inlines = parseHtmlToInlines('<span>hello </span><span>world</span>');
    expect(inlines).toHaveLength(1);
    expect(inlines[0].text).toBe('hello world');
  });

  it('should not insert empty paragraphs between list items', () => {
    const blocks = parseHtmlToBlocks('<ul>\n<li>Item 1</li>\n<li>Item 2</li>\n</ul>');
    // Should produce exactly 2 list-item blocks, no empty paragraphs between them
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('list-item');
    expect(blocks[0].inlines[0].text).toBe('Item 1');
    expect(blocks[1].type).toBe('list-item');
    expect(blocks[1].inlines[0].text).toBe('Item 2');
  });

  it('should preserve spaces between inline elements', () => {
    const inlines = parseHtmlToInlines('<b>hello</b> <i>world</i>');
    expect(inlines).toHaveLength(3);
    expect(inlines[0].text).toBe('hello');
    expect(inlines[1].text).toBe(' ');
    expect(inlines[2].text).toBe('world');
  });
});

describe('cloneTableCells', () => {
  it('should deep clone cells with new block IDs', () => {
    const cells: TableCell[][] = [
      [
        {
          blocks: [{
            id: 'original-id',
            type: 'paragraph' as const,
            inlines: [{ text: 'hello', style: { bold: true } }],
            style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
          }],
          style: { padding: 4 },
        },
      ],
    ];
    const cloned = cloneTableCells(cells);

    // Different block ID
    expect(cloned[0][0].blocks[0].id).not.toBe('original-id');
    // Same content
    expect(cloned[0][0].blocks[0].inlines[0].text).toBe('hello');
    expect(cloned[0][0].blocks[0].inlines[0].style.bold).toBe(true);
    // Deep clone — mutating original does not affect clone
    cells[0][0].blocks[0].inlines[0].text = 'mutated';
    expect(cloned[0][0].blocks[0].inlines[0].text).toBe('hello');
  });

  it('should clone cell style independently', () => {
    const cells: TableCell[][] = [
      [{
        blocks: [{
          id: 'b1',
          type: 'paragraph' as const,
          inlines: [{ text: '', style: {} }],
          style: { alignment: 'left' as const, lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
        }],
        style: { padding: 8 },
      }],
    ];
    const cloned = cloneTableCells(cells);
    cells[0][0].style.padding = 99;
    expect(cloned[0][0].style.padding).toBe(8);
  });
});

describe('parseHtmlTableToTableCells', () => {
  it('should parse a simple HTML table', () => {
    const html = '<table><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table>';
    const cells = parseHtmlTableToTableCells(html);
    expect(cells).not.toBeNull();
    expect(cells).toHaveLength(2);
    expect(cells![0]).toHaveLength(2);
    expect(cells![0][0].blocks[0].inlines[0].text).toBe('A1');
    expect(cells![0][1].blocks[0].inlines[0].text).toBe('B1');
    expect(cells![1][0].blocks[0].inlines[0].text).toBe('A2');
    expect(cells![1][1].blocks[0].inlines[0].text).toBe('B2');
  });

  it('should preserve inline formatting in cells', () => {
    const html = '<table><tr><td><b>bold</b></td><td><i>italic</i></td></tr></table>';
    const cells = parseHtmlTableToTableCells(html);
    expect(cells).not.toBeNull();
    expect(cells![0][0].blocks[0].inlines[0].style.bold).toBe(true);
    expect(cells![0][1].blocks[0].inlines[0].style.italic).toBe(true);
  });

  it('should handle th elements', () => {
    const html = '<table><tr><th>Header</th></tr><tr><td>Data</td></tr></table>';
    const cells = parseHtmlTableToTableCells(html);
    expect(cells).not.toBeNull();
    expect(cells).toHaveLength(2);
    expect(cells![0][0].blocks[0].inlines[0].text).toBe('Header');
    expect(cells![1][0].blocks[0].inlines[0].text).toBe('Data');
  });

  it('should handle thead/tbody wrappers', () => {
    const html = '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>';
    const cells = parseHtmlTableToTableCells(html);
    expect(cells).not.toBeNull();
    expect(cells).toHaveLength(2);
    expect(cells![0][0].blocks[0].inlines[0].text).toBe('H');
    expect(cells![1][0].blocks[0].inlines[0].text).toBe('D');
  });

  it('should pad ragged rows', () => {
    const html = '<table><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td></tr></table>';
    const cells = parseHtmlTableToTableCells(html);
    expect(cells).not.toBeNull();
    expect(cells![0]).toHaveLength(3);
    expect(cells![1]).toHaveLength(3);
    expect(cells![1][1].blocks[0].inlines[0].text).toBe('');
  });

  it('should return null for non-table HTML', () => {
    const html = '<p>Just a paragraph</p>';
    expect(parseHtmlTableToTableCells(html)).toBeNull();
  });

  it('should return null for mixed table + paragraph content', () => {
    const html = '<p>Some text</p><table><tr><td>A</td></tr></table>';
    expect(parseHtmlTableToTableCells(html)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseHtmlTableToTableCells('')).toBeNull();
  });

  it('should allow meta/style tags alongside table (Google Sheets)', () => {
    const html = '<meta charset="utf-8"><style>td{}</style><table><tr><td>A</td></tr></table>';
    const cells = parseHtmlTableToTableCells(html);
    expect(cells).not.toBeNull();
    expect(cells![0][0].blocks[0].inlines[0].text).toBe('A');
  });

  it('should handle empty cells', () => {
    const html = '<table><tr><td></td><td>B</td></tr></table>';
    const cells = parseHtmlTableToTableCells(html);
    expect(cells).not.toBeNull();
    expect(cells![0][0].blocks[0].inlines[0].text).toBe('');
    expect(cells![0][1].blocks[0].inlines[0].text).toBe('B');
  });

  it('should handle links in cells', () => {
    const html = '<table><tr><td><a href="https://example.com">link</a></td></tr></table>';
    const cells = parseHtmlTableToTableCells(html);
    expect(cells).not.toBeNull();
    expect(cells![0][0].blocks[0].inlines[0].style.href).toBe('https://example.com');
    expect(cells![0][0].blocks[0].inlines[0].text).toBe('link');
  });
});

describe('parseHtmlToBlocks with tables', () => {
  it('should convert inline <table> to table block in mixed HTML', () => {
    const html = '<p>Before</p><table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table><p>After</p>';
    const blocks = parseHtmlToBlocks(html);
    const tableBlock = blocks.find(b => b.type === 'table');
    expect(tableBlock).toBeDefined();
    expect(tableBlock!.tableData).toBeDefined();
    expect(tableBlock!.tableData!.rows).toHaveLength(2);
    expect(tableBlock!.tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('A');
    expect(tableBlock!.tableData!.rows[1].cells[1].blocks[0].inlines[0].text).toBe('2');

    // Text blocks should also exist
    const textBlocks = blocks.filter(b => b.type === 'paragraph' && b.inlines[0].text.length > 0);
    const texts = textBlocks.map(b => b.inlines[0].text);
    expect(texts).toContain('Before');
    expect(texts).toContain('After');
  });

  it('should handle multiple tables in mixed HTML', () => {
    const html = '<p>Intro</p><table><tr><td>T1</td></tr></table><p>Middle</p><table><tr><td>T2</td></tr></table>';
    const blocks = parseHtmlToBlocks(html);
    const tables = blocks.filter(b => b.type === 'table');
    expect(tables).toHaveLength(2);
    expect(tables[0].tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('T1');
    expect(tables[1].tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('T2');
  });

  it('should preserve inline formatting inside table cells', () => {
    const html = '<table><tr><td><strong>bold</strong> text</td></tr></table>';
    const blocks = parseHtmlToBlocks(html);
    const tableBlock = blocks.find(b => b.type === 'table');
    expect(tableBlock).toBeDefined();
    const inlines = tableBlock!.tableData!.rows[0].cells[0].blocks[0].inlines;
    expect(inlines[0].style.bold).toBe(true);
    expect(inlines[0].text).toBe('bold');
    expect(inlines[1].text).toBe(' text');
  });

  it('should handle thead/tbody wrappers in mixed HTML', () => {
    const html = '<h1>Title</h1><table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>';
    const blocks = parseHtmlToBlocks(html);
    const tableBlock = blocks.find(b => b.type === 'table');
    expect(tableBlock).toBeDefined();
    expect(tableBlock!.tableData!.rows).toHaveLength(2);
  });
});

describe('parseMarkdownTableToTableCells', () => {
  it('should parse a simple markdown table', () => {
    const text = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const cells = parseMarkdownTableToTableCells(text);
    expect(cells).not.toBeNull();
    expect(cells).toHaveLength(2); // header + 1 data row
    expect(cells![0][0].blocks[0].inlines[0].text).toBe('A');
    expect(cells![0][1].blocks[0].inlines[0].text).toBe('B');
    expect(cells![1][0].blocks[0].inlines[0].text).toBe('1');
    expect(cells![1][1].blocks[0].inlines[0].text).toBe('2');
  });

  it('should handle multiple data rows', () => {
    const text = '| H1 | H2 |\n| --- | --- |\n| A | B |\n| C | D |';
    const cells = parseMarkdownTableToTableCells(text);
    expect(cells).not.toBeNull();
    expect(cells).toHaveLength(3);
    expect(cells![2][0].blocks[0].inlines[0].text).toBe('C');
    expect(cells![2][1].blocks[0].inlines[0].text).toBe('D');
  });

  it('should handle alignment separators', () => {
    const text = '| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |';
    const cells = parseMarkdownTableToTableCells(text);
    expect(cells).not.toBeNull();
    expect(cells).toHaveLength(2);
  });

  it('should pad ragged rows', () => {
    const text = '| A | B | C |\n| --- | --- | --- |\n| 1 |';
    const cells = parseMarkdownTableToTableCells(text);
    expect(cells).not.toBeNull();
    expect(cells![1]).toHaveLength(3);
    expect(cells![1][1].blocks[0].inlines[0].text).toBe('');
  });

  it('should return null for non-table text', () => {
    expect(parseMarkdownTableToTableCells('Just some text')).toBeNull();
  });

  it('should return null for text without separator line', () => {
    expect(parseMarkdownTableToTableCells('| A | B |\n| C | D |')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseMarkdownTableToTableCells('')).toBeNull();
  });

  it('should return null for single line', () => {
    expect(parseMarkdownTableToTableCells('| A | B |')).toBeNull();
  });

  it('should handle tables without leading/trailing pipes', () => {
    const text = 'A | B\n--- | ---\n1 | 2';
    const cells = parseMarkdownTableToTableCells(text);
    expect(cells).not.toBeNull();
    expect(cells![0][0].blocks[0].inlines[0].text).toBe('A');
    expect(cells![1][1].blocks[0].inlines[0].text).toBe('2');
  });

  it('should handle empty cells in markdown', () => {
    const text = '| A | |\n| --- | --- |\n| | B |';
    const cells = parseMarkdownTableToTableCells(text);
    expect(cells).not.toBeNull();
    expect(cells![0][1].blocks[0].inlines[0].text).toBe('');
    expect(cells![1][0].blocks[0].inlines[0].text).toBe('');
    expect(cells![1][1].blocks[0].inlines[0].text).toBe('B');
  });
});

describe('parseMarkdownWithTables', () => {
  it('should parse mixed text and table', () => {
    const text = 'Some intro text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nSome outro text';
    const blocks = parseMarkdownWithTables(text);
    expect(blocks).not.toBeNull();

    // Find the table block
    const tableBlock = blocks!.find(b => b.type === 'table');
    expect(tableBlock).toBeDefined();
    expect(tableBlock!.tableData).toBeDefined();
    expect(tableBlock!.tableData!.rows).toHaveLength(2);
    expect(tableBlock!.tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('A');
    expect(tableBlock!.tableData!.rows[1].cells[1].blocks[0].inlines[0].text).toBe('2');

    // Text blocks should exist
    const textBlocks = blocks!.filter(b => b.type === 'paragraph' && b.inlines[0].text.length > 0);
    const texts = textBlocks.map(b => b.inlines[0].text);
    expect(texts).toContain('Some intro text');
    expect(texts).toContain('Some outro text');
  });

  it('should handle multiple tables in text', () => {
    const text = 'Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nMiddle\n\n| C | D |\n| --- | --- |\n| 3 | 4 |\n\nAfter';
    const blocks = parseMarkdownWithTables(text);
    expect(blocks).not.toBeNull();

    const tables = blocks!.filter(b => b.type === 'table');
    expect(tables).toHaveLength(2);
    expect(tables[0].tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('A');
    expect(tables[1].tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('C');
  });

  it('should return null when no tables present', () => {
    const text = 'Just some plain text\nWith multiple lines';
    expect(parseMarkdownWithTables(text)).toBeNull();
  });

  it('should pad with empty paragraph when table is first', () => {
    const text = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter text';
    const blocks = parseMarkdownWithTables(text);
    expect(blocks).not.toBeNull();
    // First block should be an empty paragraph (padding for insertBlocks)
    expect(blocks![0].type).toBe('paragraph');
    expect(blocks![0].inlines[0].text).toBe('');
  });

  it('should pad with empty paragraph when table is last', () => {
    const text = 'Before text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    const blocks = parseMarkdownWithTables(text);
    expect(blocks).not.toBeNull();
    const last = blocks![blocks!.length - 1];
    expect(last.type).toBe('paragraph');
    expect(last.inlines[0].text).toBe('');
  });

  it('should return null for empty string', () => {
    expect(parseMarkdownWithTables('')).toBeNull();
  });

  it('should handle table at start and end of text', () => {
    const text = '| A |\n| --- |\n| 1 |\n\n| B |\n| --- |\n| 2 |';
    const blocks = parseMarkdownWithTables(text);
    expect(blocks).not.toBeNull();
    const tables = blocks!.filter(b => b.type === 'table');
    expect(tables).toHaveLength(2);
    // Should be padded at start and end
    expect(blocks![0].type).toBe('paragraph');
    expect(blocks![blocks!.length - 1].type).toBe('paragraph');
  });

  it('should preserve blank lines as empty paragraphs', () => {
    const text = 'Line 1\n\nLine 2\n\n| A |\n| --- |\n| 1 |';
    const blocks = parseMarkdownWithTables(text);
    expect(blocks).not.toBeNull();
    // Should have paragraphs for text and empty lines
    const nonTableBlocks = blocks!.filter(b => b.type !== 'table');
    expect(nonTableBlocks.length).toBeGreaterThanOrEqual(3);
  });
});
