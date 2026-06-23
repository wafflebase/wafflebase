import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartTerminator } from '../../../../../src/view/canvas/shapes/flowchart/terminator';

describe('buildFlowChartTerminator', () => {
  it('produces a stadium with half-ellipse caps on a wide box', () => {
    const path = buildFlowChartTerminator({ w: 100, h: 40 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 20)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 20)).toBe(true);
    expect(ctx.isPointInPath(path, 95, 20)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 99, 39)).toBe(false);
  });

  it('uses elliptical caps that reach only ~0.16w in from each side', () => {
    // Cap horizontal radius = w * 3475/21600 ≈ 16.09 on a 100-wide
    // box. The straight top/bottom edges therefore start at x ≈ 16.
    // A near-corner point at (8, 4) lies outside the squashed cap —
    // a true semicircular pill (r = h/2 = 20) would NOT cut it here,
    // so this distinguishes the elliptical caps from a pill.
    const path = buildFlowChartTerminator({ w: 100, h: 40 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // On the top edge, just inside the cap centre (x≈16) is filled.
    expect(ctx.isPointInPath(path, 20, 1)).toBe(true);
    // Outside the squashed cap toward the corner is empty.
    expect(ctx.isPointInPath(path, 3, 3)).toBe(false);
    // Vertical extent at the cap centre still spans the full height.
    expect(ctx.isPointInPath(path, 16, 38)).toBe(true);
  });
});
