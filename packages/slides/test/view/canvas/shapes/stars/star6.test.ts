import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildStar6 } from '../../../../../src/view/canvas/shapes/stars/star6';

describe('buildStar6', () => {
  it('contains the centre and excludes corners', () => {
    const path = buildStar6({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);  // centre
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);   // corner
    expect(ctx.isPointInPath(path, 99, 99)).toBe(false); // corner
  });

  it('apex-up vertex sits on the top edge', () => {
    const path = buildStar6({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // apex tip is at (50, 0); 1px in is inside
    expect(ctx.isPointInPath(path, 50, 1)).toBe(true);
  });

  it('honours custom inner-radius adjustment', () => {
    // inner radius 5% (very thin star) — points are sliver-thin,
    // so the centre is still inside but a generous off-axis point
    // corners remain outside
    const path = buildStar6({ w: 100, h: 100 }, [5000]);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
  });
});
