import { describe, it, expect } from 'vitest';
import {
  anchorBounds,
  anchorRects,
  normalizeDragRect,
  rectToStyle,
} from '@/app/files/comments/rect';

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

  it('anchorRects yields the one box of a region', () => {
    expect(
      anchorRects({
        kind: 'pdf-region',
        pageIndex: 0,
        rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
      }),
    ).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }]);
  });

  it('anchorRects yields every line box of a text selection', () => {
    const rects = [
      { x: 0.1, y: 0.2, w: 0.5, h: 0.02 },
      { x: 0.1, y: 0.23, w: 0.3, h: 0.02 },
    ];
    expect(
      anchorRects({ kind: 'pdf-text', pageIndex: 0, rects, quote: 'q' }),
    ).toEqual(rects);
  });

  it('anchorBounds encloses every line of a text selection', () => {
    // Where the pin goes: the top-left of the whole selection, not of its
    // first line only, and wide enough to cover the longest line.
    const bounds = anchorBounds({
      kind: 'pdf-text',
      pageIndex: 0,
      rects: [
        { x: 0.2, y: 0.1, w: 0.5, h: 0.02 },
        { x: 0.1, y: 0.13, w: 0.3, h: 0.02 },
      ],
      quote: 'q',
    });

    expect(bounds.x).toBeCloseTo(0.1);
    expect(bounds.y).toBeCloseTo(0.1);
    expect(bounds.w).toBeCloseTo(0.6);
    expect(bounds.h).toBeCloseTo(0.05);
  });

  it('anchorBounds returns a region unchanged', () => {
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };
    expect(anchorBounds({ kind: 'pdf-region', pageIndex: 0, rect })).toEqual(rect);
  });

  it('anchorBounds degrades to an empty box for a rect-less text anchor', () => {
    // Unreachable through the UI, but a hand-edited CRDT could carry it, and
    // Math.min over nothing would otherwise place the pin at Infinity.
    expect(
      anchorBounds({ kind: 'pdf-text', pageIndex: 0, rects: [], quote: '' }),
    ).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
