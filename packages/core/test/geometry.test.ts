import { describe, it, expect } from 'vitest';
import {
  normalizeRect,
  rectsIntersect,
  unionRect,
  type Rect,
} from '../src/geometry/index.ts';

describe('normalizeRect', () => {
  it('keeps a top-left→bottom-right drag as-is', () => {
    expect(normalizeRect(10, 20, 40, 60)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it('normalises a bottom-right→top-left drag to non-negative w/h', () => {
    expect(normalizeRect(40, 60, 10, 20)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it('handles a zero-size drag (no movement)', () => {
    expect(normalizeRect(5, 5, 5, 5)).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });
});

describe('rectsIntersect', () => {
  const a: Rect = { x: 0, y: 0, w: 10, h: 10 };

  it('detects overlap', () => {
    expect(rectsIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('counts edge contact as intersection', () => {
    expect(rectsIntersect(a, { x: 10, y: 0, w: 5, h: 10 })).toBe(true);
  });

  it('returns false when fully separated', () => {
    expect(rectsIntersect(a, { x: 11, y: 0, w: 5, h: 10 })).toBe(false);
    expect(rectsIntersect(a, { x: 0, y: 11, w: 10, h: 5 })).toBe(false);
  });
});

describe('unionRect', () => {
  it('returns undefined for an empty list', () => {
    expect(unionRect([])).toBeUndefined();
  });

  it('returns the single rect unchanged', () => {
    const r: Rect = { x: 1, y: 2, w: 3, h: 4 };
    expect(unionRect([r])).toEqual(r);
  });

  it('encloses multiple rects', () => {
    expect(
      unionRect([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: 5, w: 10, h: 30 },
      ]),
    ).toEqual({ x: 0, y: 0, w: 30, h: 35 });
  });
});
