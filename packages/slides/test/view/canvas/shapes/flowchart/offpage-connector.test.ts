import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartOffpageConnector } from '../../../../../src/view/canvas/shapes/flowchart/offpage-connector';

describe('buildFlowChartOffpageConnector', () => {
  it('contains the centre and excludes the V-cut corners', () => {
    const path = buildFlowChartOffpageConnector({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 85)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 99)).toBe(false);
    expect(ctx.isPointInPath(path, 99, 99)).toBe(false);
  });
});
