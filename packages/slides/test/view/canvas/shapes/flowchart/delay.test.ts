import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartDelay } from '../../../../../src/view/canvas/shapes/flowchart/delay';

describe('buildFlowChartDelay', () => {
  it('contains the centre and excludes outside the D', () => {
    const path = buildFlowChartDelay({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 10, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 99, 1)).toBe(false); // top-right cut by D curve
    expect(ctx.isPointInPath(path, 99, 99)).toBe(false);
  });

  it('caps the right half with a semi-ellipse of radius w/2', () => {
    // Cap centre is at hc = w/2; the flat top/bottom run only to
    // mid-width. The curve reaches x = w exactly at the vertical
    // centre (vc) and pulls in sharply above/below it.
    const path = buildFlowChartDelay({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Just left of mid-width on the top edge is inside the flat part.
    expect(ctx.isPointInPath(path, 49, 1)).toBe(true);
    // Far right at vertical centre is inside (curve reaches x≈w there).
    expect(ctx.isPointInPath(path, 99, 50)).toBe(true);
    // Right of mid-width near the top is outside the cap's ellipse.
    expect(ctx.isPointInPath(path, 90, 5)).toBe(false);
  });
});
