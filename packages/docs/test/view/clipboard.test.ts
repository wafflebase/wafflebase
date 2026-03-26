import { describe, it, expect } from 'vitest';
import { serializeBlocks, deserializeBlocks } from '../../src/view/clipboard.js';

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
