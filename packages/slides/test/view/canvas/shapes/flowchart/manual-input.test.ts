import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartManualInput } from '../../../../../src/view/canvas/shapes/flowchart/manual-input';

describe('buildFlowChartManualInput', () => {
  it('contains the centre and excludes the top-left wedge', () => {
    const path = buildFlowChartManualInput({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 90, 10)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false); // top-left wedge — excluded
  });

  it('pulls the top-left vertex down to y = h/5', () => {
    // The slanted top runs from (0, h/5) up to (w, 0). A point just
    // below y = h/5 at the left edge is inside; just above is out.
    const path = buildFlowChartManualInput({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 1, 21)).toBe(true); // below h/5 (=20)
    expect(ctx.isPointInPath(path, 1, 19)).toBe(false); // above h/5 — excluded
  });
});
