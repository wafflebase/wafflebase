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
});
