import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildPie, PIE_ADJUSTMENTS } from '../../../../../src/view/canvas/shapes/basic/pie';

describe('buildPie', () => {
  it('uses default angles when adjustments are missing', () => {
    const path = buildPie({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Default 270°→0° = NE quadrant.
    expect(ctx.isPointInPath(path, 70, 30)).toBe(true);
  });

  it('PIE_ADJUSTMENTS defaults match OOXML preset (270°, 0°)', () => {
    expect(PIE_ADJUSTMENTS[0].defaultValue).toBe(16200000);
    expect(PIE_ADJUSTMENTS[1].defaultValue).toBe(0);
  });
});
