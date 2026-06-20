import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildPie, PIE_ADJUSTMENTS } from '../../../../../src/view/canvas/shapes/basic/pie';

describe('buildPie', () => {
  it('uses default angles when adjustments are missing', () => {
    const path = buildPie({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Default 0°→270° = 3/4 pie; the bite is the top-right quadrant.
    expect(ctx.isPointInPath(path, 30, 70)).toBe(true); // bottom-left: filled
    expect(ctx.isPointInPath(path, 75, 25)).toBe(false); // top-right: bite
  });

  it('PIE_ADJUSTMENTS defaults match OOXML preset (0°, 270°)', () => {
    expect(PIE_ADJUSTMENTS[0].defaultValue).toBe(0);
    expect(PIE_ADJUSTMENTS[1].defaultValue).toBe(16200000);
  });
});
