import { describe, it, expect } from 'vitest';
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type { ImageElement, ShapeElement, TextElement } from './element';
import { isElementEmpty } from './element';

const baseFrame = { x: 0, y: 0, w: 10, h: 10, rotation: 0 };

function textBlock(text: string): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

describe('isElementEmpty', () => {
  it('returns true for a text element whose every inline is empty', () => {
    const el: TextElement = {
      id: 'a',
      type: 'text',
      frame: baseFrame,
      data: {
        blocks: [textBlock('')],
      },
    };
    expect(isElementEmpty(el)).toBe(true);
  });

  it('returns false for a text element with any non-empty inline', () => {
    const el: TextElement = {
      id: 'a',
      type: 'text',
      frame: baseFrame,
      data: {
        blocks: [textBlock('hi')],
      },
    };
    expect(isElementEmpty(el)).toBe(false);
  });

  it('returns false for non-text elements (image and shape)', () => {
    const img: ImageElement = {
      id: 'i',
      type: 'image',
      frame: baseFrame,
      data: { src: 'x.png' },
    };
    const shape: ShapeElement = {
      id: 's',
      type: 'shape',
      frame: baseFrame,
      data: { kind: 'rect' },
    };
    expect(isElementEmpty(img)).toBe(false);
    expect(isElementEmpty(shape)).toBe(false);
  });

  it('returns true for a text element with no blocks (vacuous truth)', () => {
    const el: TextElement = {
      id: 'a',
      type: 'text',
      frame: baseFrame,
      data: { blocks: [] },
    };
    expect(isElementEmpty(el)).toBe(true);
  });

  it('returns true for a text element with a block whose inlines array is empty', () => {
    const el: TextElement = {
      id: 'a',
      type: 'text',
      frame: baseFrame,
      data: {
        blocks: [
          { id: 'b1', type: 'paragraph', inlines: [], style: { ...DEFAULT_BLOCK_STYLE } },
        ],
      },
    };
    expect(isElementEmpty(el)).toBe(true);
  });

  it('returns false when at least one of multiple blocks has non-empty text', () => {
    const el: TextElement = {
      id: 'a',
      type: 'text',
      frame: baseFrame,
      data: {
        blocks: [textBlock(''), textBlock('something'), textBlock('')],
      },
    };
    expect(isElementEmpty(el)).toBe(false);
  });
});

