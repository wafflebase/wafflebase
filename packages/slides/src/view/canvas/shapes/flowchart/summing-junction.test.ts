import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildFlowChartSummingJunction } from './summing-junction';

describe('buildFlowChartSummingJunction', () => {
  it('contains the centre and excludes outside the ellipse', () => {
    const path = buildFlowChartSummingJunction({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 99, 99)).toBe(false);
  });
});
