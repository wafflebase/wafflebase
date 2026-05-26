import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartDisplay } from '../../../../../src/view/canvas/shapes/flowchart/display';

describe('buildFlowChartDisplay', () => {
  it('contains the centre and excludes outside the shape', () => {
    const path = buildFlowChartDisplay({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 0, 1)).toBe(false); // above left wedge
    expect(ctx.isPointInPath(path, 99, 1)).toBe(false); // outside right cap
  });
});
