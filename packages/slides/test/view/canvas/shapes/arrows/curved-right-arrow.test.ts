import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildCurvedRightArrow,
  CURVED_RIGHT_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/curved-right-arrow';

describe('buildCurvedRightArrow', () => {
  it('produces a Path2D', () => {
    expect(buildCurvedRightArrow({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });

  it('fills a flared arrowhead near the right tip (not a point)', () => {
    // Default adj: aw = ss·0.5 = 100 ⇒ head tip at (r, b − aw/2) ≈
    // (200, 150). The old "single point" tip never reached here; the
    // OOXML head flares to the frame's right edge.
    const path = buildCurvedRightArrow({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    expect(ctx.isPointInPath(path, 196, 150)).toBe(true);
  });
});

describe('CURVED_RIGHT_ARROW_HANDLES', () => {
  it('exposes three handles (thickness + head width + head length)', () => {
    expect(CURVED_RIGHT_ARROW_HANDLES.length).toBe(3);
  });
});
