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

  it('places stripe boundaries at OOXML ss divisions', () => {
    // ss = min(w, h) = 100. Stripe 1 spans [0 .. ss/32 = 3.125];
    // the gap [ss/32 .. ss/16 = 6.25] is hollow; stripe 2 spans
    // [ss/16 .. ss/8 = 12.5]; the gap [ss/8 .. 5*ss/32 = 15.625] is
    // hollow; the body starts at 5*ss/32.
    const path = buildStripedRightArrow({ w: 200, h: 100 });
    const ctx = createTestCanvas(400, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 2, 50)).toBe(true); // inside stripe 1
    expect(ctx.isPointInPath(path, 5, 50)).toBe(false); // gap after stripe 1
    expect(ctx.isPointInPath(path, 9, 50)).toBe(true); // inside stripe 2
    expect(ctx.isPointInPath(path, 14, 50)).toBe(false); // gap before body
    expect(ctx.isPointInPath(path, 20, 50)).toBe(true); // body
  });

  it('reuses ARROW_ADJUSTMENTS defaults', () => {
    expect(STRIPED_RIGHT_ARROW_ADJUSTMENTS[0].defaultValue).toBe(50000);
  });
});
