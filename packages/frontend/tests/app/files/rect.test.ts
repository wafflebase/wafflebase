import { describe, it, expect } from 'vitest';
import { normalizeDragRect, rectToStyle } from '@/app/files/comments/rect';

describe('rect helpers', () => {
  it('normalizes a top-left→bottom-right drag to [0,1]', () => {
    expect(normalizeDragRect({ x: 20, y: 40 }, { x: 60, y: 80 }, 200, 400))
      .toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
  });

  it('normalizes a reversed (bottom-right→top-left) drag identically', () => {
    expect(normalizeDragRect({ x: 60, y: 80 }, { x: 20, y: 40 }, 200, 400))
      .toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
  });

  it('clamps out-of-page coordinates into [0,1]', () => {
    const r = normalizeDragRect({ x: -50, y: -50 }, { x: 999, y: 999 }, 200, 400);
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('renders CSS percentage strings', () => {
    expect(rectToStyle({ x: 0.1, y: 0.2, w: 0.3, h: 0.05 })).toEqual({
      left: '10%', top: '20%', width: '30%', height: '5%',
    });
  });
});
