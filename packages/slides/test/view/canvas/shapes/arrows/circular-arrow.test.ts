import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildCircularArrow,
  CIRCULAR_ARROW_ADJUSTMENTS,
  CIRCULAR_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/circular-arrow';

describe('buildCircularArrow', () => {
  it('produces a Path2D', () => {
    expect(buildCircularArrow({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });

  it('fills the band but not the centre hole', () => {
    // Default adj ⇒ band radii ≈ [62.5, 87.5] about centre (100,100),
    // sweeping left→top→right (the C opens at the bottom). A point on
    // the band's top is filled; the centre is hollow.
    const path = buildCircularArrow({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 25)).toBe(true); // on band (top)
    expect(ctx.isPointInPath(path, 100, 100)).toBe(false); // centre hole
  });

  it('has the five OOXML adjustments incl. start/end angles', () => {
    expect(CIRCULAR_ARROW_ADJUSTMENTS).toHaveLength(5);
    expect(CIRCULAR_ARROW_ADJUSTMENTS[2].axisLabel).toBe('end');
    expect(CIRCULAR_ARROW_ADJUSTMENTS[3].axisLabel).toBe('start');
  });
});

describe('CIRCULAR_ARROW_HANDLES', () => {
  it('exposes five handles (start/end angle, spread, thickness, head)', () => {
    expect(CIRCULAR_ARROW_HANDLES.length).toBe(5);
  });
});
