import { describe, it, expect } from 'vitest';
import type { Slide } from '../../../model/presentation';
import type { Element } from '../../../model/element';
import { selectInRect, normalizeRect } from './lasso';

const blank = (elements: Element[]): Slide => ({
  id: 's1', layoutId: 'blank',
  background: { fill: '#fff' },
  elements, notes: [],
});
const at = (id: string, x: number, y: number, w = 100, h = 100): Element => ({
  id, type: 'shape',
  frame: { x, y, w, h, rotation: 0 },
  data: { kind: 'rect', fill: '#abc' },
});

describe('selectInRect — bbox intersection', () => {
  const slide = blank([
    at('a', 0,   0,   100, 100),
    at('b', 200, 0,   100, 100),
    at('c', 0,   200, 100, 100),
  ]);

  it('selects only elements whose bbox intersects the rect', () => {
    expect(selectInRect(slide, { x: 50, y: 50, w: 100, h: 100 }))
      .toEqual(['a']);
  });

  it('selects multiple elements when the rect spans them', () => {
    expect(selectInRect(slide, { x: 0, y: 0, w: 350, h: 50 }))
      .toEqual(['a', 'b']);
  });

  it('returns empty when the rect intersects nothing', () => {
    expect(selectInRect(slide, { x: 500, y: 500, w: 50, h: 50 }))
      .toEqual([]);
  });

  it('treats edge contact as intersection', () => {
    // rect's right edge at x=100 just touches element a's right edge.
    expect(selectInRect(slide, { x: 0, y: 0, w: 100, h: 100 }))
      .toEqual(['a']);
  });
});

describe('normalizeRect', () => {
  it('returns positive width/height regardless of drag direction', () => {
    expect(normalizeRect(100, 100, 50, 50))
      .toEqual({ x: 50, y: 50, w: 50, h: 50 });
  });
  it('handles zero-size rectangles', () => {
    expect(normalizeRect(10, 10, 10, 10))
      .toEqual({ x: 10, y: 10, w: 0, h: 0 });
  });
});
