import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartDocument } from '../../../../../src/view/canvas/shapes/flowchart/document';

describe('buildFlowChartDocument', () => {
  it('contains the centre and excludes outside the document curve', () => {
    const path = buildFlowChartDocument({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 90, 10)).toBe(true);
    expect(ctx.isPointInPath(path, -1, -1)).toBe(false);
  });

  it('renders the OOXML asymmetric bottom edge (dip left-of-centre)', () => {
    // The bottom edge is a single asymmetric cubic Bézier, not a
    // symmetric sine: it starts high on the right (y1 = 17322/21600·h)
    // and hangs lowest left-of-centre. A symmetric wave would be mirror-
    // symmetric about x = 50; this asserts the asymmetry by sampling the
    // same depth on each side.
    const path = buildFlowChartDocument({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // At depth y = 85 the curve hangs below the baseline on the left
    // (still inside at x = 30) but has already risen on the right
    // (outside at x = 70).
    expect(ctx.isPointInPath(path, 30, 85)).toBe(true);
    expect(ctx.isPointInPath(path, 70, 85)).toBe(false);
  });
});
