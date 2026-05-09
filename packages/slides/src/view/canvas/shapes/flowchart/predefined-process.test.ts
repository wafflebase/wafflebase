import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildFlowChartPredefinedProcess } from './predefined-process';

describe('buildFlowChartPredefinedProcess', () => {
  it('contains the centre and excludes points outside the rect', () => {
    const path = buildFlowChartPredefinedProcess({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 10)).toBe(true);
    expect(ctx.isPointInPath(path, -1, 50)).toBe(false);
    expect(ctx.isPointInPath(path, 101, 50)).toBe(false);
  });
});
