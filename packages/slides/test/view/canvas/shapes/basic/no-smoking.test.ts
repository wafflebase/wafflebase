import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildNoSmoking,
  NO_SMOKING_ADJUSTMENTS,
  NO_SMOKING_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/no-smoking';

describe('buildNoSmoking', () => {
  it('paints the outer ring + diagonal slash', () => {
    const path = buildNoSmoking({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Ring at top — inside the ring's outer arc.
    expect(ctx.isPointInPath(path, 50, 2)).toBe(true);
    // Slash midpoint — inside the diagonal band.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
  });

  it('default thickness is 18750', () => {
    expect(NO_SMOKING_ADJUSTMENTS[0].defaultValue).toBe(18750);
  });
});

describe('NO_SMOKING_HANDLES', () => {
  it('exposes one handle on the top edge', () => {
    expect(NO_SMOKING_HANDLES.length).toBe(1);
  });
});
