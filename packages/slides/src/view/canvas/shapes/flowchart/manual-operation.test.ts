import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildFlowChartManualOperation } from './manual-operation';

describe('buildFlowChartManualOperation', () => {
  it('contains the centre and excludes the cut bottom corners', () => {
    const path = buildFlowChartManualOperation({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 99)).toBe(false);
    expect(ctx.isPointInPath(path, 95, 99)).toBe(false);
  });
});
