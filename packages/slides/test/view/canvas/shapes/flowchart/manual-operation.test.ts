import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartManualOperation } from '../../../../../src/view/canvas/shapes/flowchart/manual-operation';

describe('buildFlowChartManualOperation', () => {
  it('contains the centre and excludes the cut bottom corners', () => {
    const path = buildFlowChartManualOperation({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 99)).toBe(false);
    expect(ctx.isPointInPath(path, 95, 99)).toBe(false);
  });

  it('tapers the bottom by w * 0.2 per side', () => {
    // Bottom corners sit at x = w*0.2 (=20) and x = w*0.8 (=80).
    // A point at x = 15 on the bottom edge is now outside the taper
    // (it was inside under the old 0.125 inset).
    const path = buildFlowChartManualOperation({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 15, 99)).toBe(false);
    expect(ctx.isPointInPath(path, 85, 99)).toBe(false);
    expect(ctx.isPointInPath(path, 25, 99)).toBe(true);
  });
});
