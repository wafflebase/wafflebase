import { describe, it, expect } from 'vitest';
import { buildFreeformInit } from '../../../../src/view/editor/interactions/insert-freeform';
import type { ShapeElement } from '../../../../src/model/element';

describe('buildFreeformInit', () => {
  it('returns null for a degenerate (single-point) gesture', () => {
    expect(buildFreeformInit([])).toBeNull();
    expect(buildFreeformInit([{ x: 5, y: 5 }])).toBeNull();
  });

  it('builds a smoothed stroke-only freeform from the captured bbox', () => {
    const init = buildFreeformInit([
      { x: 100, y: 200 },
      { x: 150, y: 250 },
      { x: 200, y: 200 },
    ]);
    expect(init).not.toBeNull();
    expect(init!.type).toBe('shape');
    expect(init!.frame).toEqual({ x: 100, y: 200, w: 100, h: 50, rotation: 0 });
    const data = (init as ShapeElement).data;
    expect(data.kind).toBe('freeform');
    expect(data.fill).toBeUndefined();
    expect(data.stroke?.width).toBe(2);
    // Midpoint quadratic smoothing: the captured middle point is the
    // control point, the ends are hit exactly; all normalized [0,1].
    expect(data.path!.commands).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'Q', x1: 0.5, y1: 1, x: 1, y: 0 },
    ]);
  });

  it('clamps a perfectly horizontal scribble to a 1px-tall frame', () => {
    const init = buildFreeformInit([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(init!.frame.h).toBe(1);
    expect(init!.frame.w).toBe(100);
    const data = (init as ShapeElement).data;
    // Two points stay a straight line; all collapse to y=0, no NaN.
    expect(data.path!.commands).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'L', x: 1, y: 0 },
    ]);
  });

  it('uses a host stroke and commits a tap as a dot when asked', () => {
    const stroke = { color: '#ff0000', width: 8, cap: 'round' as const };
    const init = buildFreeformInit([{ x: 10, y: 20 }], { stroke, allowDot: true });
    expect(init).not.toBeNull();
    const data = (init as ShapeElement).data;
    expect(data.stroke).toEqual(stroke);
    expect(data.path!.commands).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'L', x: 0, y: 0 },
    ]);
  });
});
