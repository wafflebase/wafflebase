import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartOr } from '../../../../../src/view/canvas/shapes/flowchart/or';

describe('buildFlowChartOr', () => {
  it('contains the centre and excludes outside the ellipse', () => {
    const path = buildFlowChartOr({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 40)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
  });
});
