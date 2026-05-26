import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartInternalStorage } from '../../../../../src/view/canvas/shapes/flowchart/internal-storage';

describe('buildFlowChartInternalStorage', () => {
  it('contains the centre and excludes points outside the rect', () => {
    const path = buildFlowChartInternalStorage({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 20, 20)).toBe(true);
    expect(ctx.isPointInPath(path, -1, -1)).toBe(false);
    expect(ctx.isPointInPath(path, 101, 101)).toBe(false);
  });
});
