// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serializeBlocks, deserializeBlocks, parseHtmlToInlines } from '../../src/view/clipboard.js';

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
    expect(inlines[0].style.fontSize).toBe(16);
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
});
