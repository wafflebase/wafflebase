import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildFlowChartDelay } from './delay';

describe('buildFlowChartDelay', () => {
  it('contains the centre and excludes outside the D', () => {
    const path = buildFlowChartDelay({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 10, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 99, 1)).toBe(false); // top-right cut by D curve
    expect(ctx.isPointInPath(path, 99, 99)).toBe(false);
  });
});
