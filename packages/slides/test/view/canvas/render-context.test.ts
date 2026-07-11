import { describe, it, expect } from 'vitest';
import type { Fill, Theme } from '../../../src/model/theme';
import { resolveFillStyle, resolveStrokeColor } from '../../../src/view/canvas/render-context';

const THEME: Theme = {
  id: 't',
  name: 't',
  colors: {
    text: '#000000',
    background: '#ffffff',
    textSecondary: '#444444',
    backgroundAlt: '#f3f3f3',
    accent1: '#FF9900',
    accent2: '#00AAEE',
    accent3: '#33CC33',
    accent4: '#CC3333',
    accent5: '#9966CC',
    accent6: '#666666',
    hyperlink: '#1155CC',
    visitedHyperlink: '#7733AA',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

describe('resolveStrokeColor', () => {
  it('returns plain string colors unchanged', () => {
    expect(resolveStrokeColor('#ff0000', THEME)).toBe('#ff0000');
  });

  it('resolves ThemeColor srgb objects via resolveColor', () => {
    expect(resolveStrokeColor({ kind: 'srgb', value: '#abcdef' }, THEME)).toBe('#abcdef');
  });

  it('resolves ThemeColor role objects via the active theme', () => {
    expect(resolveStrokeColor({ kind: 'role', role: 'accent1' }, THEME)).toBe('#FF9900');
  });
});

/** Minimal CanvasGradient/context stub — jsdom has no 2D context. */
function fakeCtx() {
  const calls: { start: [number, number, number, number]; stops: [number, string][] } = {
    start: [0, 0, 0, 0],
    stops: [],
  };
  const ctx = {
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
      calls.start = [x0, y0, x1, y1];
      return {
        addColorStop(pos: number, color: string) {
          calls.stops.push([pos, color]);
        },
      };
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('resolveFillStyle', () => {
  it('returns a CSS string for a solid ThemeColor', () => {
    const { ctx } = fakeCtx();
    expect(resolveFillStyle(ctx, { kind: 'srgb', value: '#123456' }, THEME, 100, 50)).toBe('#123456');
  });

  it('builds a horizontal (0°) gradient spanning the box width', () => {
    const { ctx, calls } = fakeCtx();
    const fill: Fill = {
      kind: 'gradient',
      type: 'linear',
      angle: 0, // left→right
      stops: [
        { pos: 0, color: { kind: 'srgb', value: '#0093FF' } },
        { pos: 1, color: { kind: 'role', role: 'accent1' } },
      ],
    };
    const result = resolveFillStyle(ctx, fill, THEME, 100, 50);
    expect(typeof result).toBe('object'); // CanvasGradient stub
    // Axis centered, extended across the width: x from 0 → 100 at mid height.
    expect(calls.start[0]).toBeCloseTo(0, 6);
    expect(calls.start[2]).toBeCloseTo(100, 6);
    expect(calls.start[1]).toBeCloseTo(25, 6);
    expect(calls.start[3]).toBeCloseTo(25, 6);
    // Stops resolved through the theme (role → hex).
    expect(calls.stops).toEqual([
      [0, '#0093FF'],
      [1, '#FF9900'],
    ]);
  });

  it('collapses a single-stop gradient to its solid color', () => {
    const { ctx } = fakeCtx();
    const fill: Fill = {
      kind: 'gradient',
      type: 'linear',
      angle: 0,
      stops: [{ pos: 0, color: { kind: 'srgb', value: '#abcdef' } }],
    };
    expect(resolveFillStyle(ctx, fill, THEME, 10, 10)).toBe('#abcdef');
  });

  it('collapses a zero-size box (degenerate axis) to a solid instead of a flat last-stop', () => {
    const { ctx, calls } = fakeCtx();
    const fill: Fill = {
      kind: 'gradient',
      type: 'linear',
      angle: 0,
      stops: [
        { pos: 0, color: { kind: 'srgb', value: '#111111' } },
        { pos: 1, color: { kind: 'srgb', value: '#222222' } },
      ],
    };
    // 0×0 box → zero-length axis; must return the representative solid and
    // never call createLinearGradient (which would paint only the last stop).
    expect(resolveFillStyle(ctx, fill, THEME, 0, 0)).toBe('#111111');
    expect(calls.stops).toHaveLength(0);
  });
});
