import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildFlowChartManualInput } from '../../../../../src/view/canvas/shapes/flowchart/manual-input';

describe('buildFlowChartManualInput', () => {
  it('contains the centre and excludes the top-left wedge', () => {
    const path = buildFlowChartManualInput({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 90, 10)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false); // top-left wedge — excluded
  });
});
