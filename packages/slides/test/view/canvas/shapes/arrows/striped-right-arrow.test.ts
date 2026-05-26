import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildStripedRightArrow,
  STRIPED_RIGHT_ARROW_ADJUSTMENTS,
} from '../../../../../src/view/canvas/shapes/arrows/striped-right-arrow';

describe('buildStripedRightArrow', () => {
  it('fills the third (widest) stripe + arrowhead silhouette', () => {
    const path = buildStripedRightArrow({ w: 200, h: 100 });
    const ctx = createTestCanvas(400, 200).getContext('2d');
    // Far-right inside the head triangle.
    expect(ctx.isPointInPath(path, 180, 50)).toBe(true);
  });

  it('reuses ARROW_ADJUSTMENTS defaults', () => {
    expect(STRIPED_RIGHT_ARROW_ADJUSTMENTS[0].defaultValue).toBe(50000);
  });
});
