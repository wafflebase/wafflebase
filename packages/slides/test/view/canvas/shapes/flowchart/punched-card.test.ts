import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartPunchedCard } from '../../../../../src/view/canvas/shapes/flowchart/punched-card';

describe('buildFlowChartPunchedCard', () => {
  it('contains the centre and excludes the cut top-left corner', () => {
    const path = buildFlowChartPunchedCard({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 90, 1)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false); // cut corner
  });

  it('cuts 0.2 of each axis independently on a non-square box', () => {
    // Wide box: cut reaches x = w*0.2 (=40) along the top and
    // y = h*0.2 (=10) down the left side. The diagonal therefore
    // slants — the cut extents differ between axes.
    const path = buildFlowChartPunchedCard({ w: 200, h: 50 });
    const ctx = createTestCanvas(400, 200).getContext('2d');
    // Top edge: x just past the horizontal cut (40) is inside, before is out.
    expect(ctx.isPointInPath(path, 45, 1)).toBe(true);
    expect(ctx.isPointInPath(path, 35, 1)).toBe(false);
    // Left edge: y just past the vertical cut (10) is inside, before is out.
    expect(ctx.isPointInPath(path, 1, 12)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 8)).toBe(false);
  });
});
