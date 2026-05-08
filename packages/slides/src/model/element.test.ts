import { describe, it, expect } from 'vitest';
import type { ImageElement, ShapeElement, TextElement } from './element';
import { isElementEmpty } from './element';

const baseFrame = { x: 0, y: 0, w: 10, h: 10, rotation: 0 };

describe('isElementEmpty', () => {
  it('returns true for a text element whose every inline is empty', () => {
    const el: TextElement = {
      id: 'a',
      type: 'text',
      frame: baseFrame,
      data: {
        blocks: [
          { id: 'b1', type: 'paragraph', inlines: [{ text: '', style: {} }], style: {} },
        ] as never,
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
        blocks: [
          { id: 'b1', type: 'paragraph', inlines: [{ text: 'hi', style: {} }], style: {} },
        ] as never,
      },
    };
    expect(isElementEmpty(el)).toBe(false);
  });

  it('returns false for non-text elements (image/shape) — they are never treated as empty in v1', () => {
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
});
