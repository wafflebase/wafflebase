import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBentArrow,
  BENT_ARROW_ADJUSTMENTS,
  BENT_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/bent-arrow';

describe('buildBentArrow', () => {
  it('fills the horizontal arm + vertical tail with the head pointing right', () => {
    const path = buildBentArrow({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // Horizontal arm at the top, mid-span.
    expect(ctx.isPointInPath(path, 120, 50)).toBe(true);
    // Vertical tail at the bottom-left.
    expect(ctx.isPointInPath(path, 25, 180)).toBe(true);
    // Arrow tip at the right edge, vertical-center of the arm.
    expect(ctx.isPointInPath(path, 195, 50)).toBe(true);
    // Bottom-right is empty (open inside the bend).
    expect(ctx.isPointInPath(path, 180, 180)).toBe(false);
  });

  it('has 4 adjustments (shaft, head width, head length, bend radius)', () => {
    expect(BENT_ARROW_ADJUSTMENTS).toHaveLength(4);
  });
});

describe('BENT_ARROW_HANDLES', () => {
  it('exposes four handles', () => {
    expect(BENT_ARROW_HANDLES.length).toBe(4);
  });
});
