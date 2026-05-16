import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartTerminator } from '../../../../../src/view/canvas/shapes/flowchart/terminator';

describe('buildFlowChartTerminator', () => {
  it('produces a pill that contains the centre and excludes outside the curve', () => {
    const path = buildFlowChartTerminator({ w: 100, h: 40 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 20)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 20)).toBe(true);
    expect(ctx.isPointInPath(path, 95, 20)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 99, 39)).toBe(false);
  });
});
