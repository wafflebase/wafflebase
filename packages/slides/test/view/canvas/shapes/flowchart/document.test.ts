import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartDocument } from '../../../../../src/view/canvas/shapes/flowchart/document';

describe('buildFlowChartDocument', () => {
  it('contains the centre and excludes outside the wave', () => {
    const path = buildFlowChartDocument({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 90, 10)).toBe(true);
    expect(ctx.isPointInPath(path, -1, -1)).toBe(false);
    expect(ctx.isPointInPath(path, 50, 99)).toBe(false); // wave dip
  });
});
