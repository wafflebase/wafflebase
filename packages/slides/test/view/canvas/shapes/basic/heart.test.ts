import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildHeart } from '../../../../../src/view/canvas/shapes/basic/heart';

describe('buildHeart', () => {
  const ctx = createTestCanvas(200, 200).getContext('2d')!;

  it('fills the lobes, body, and bottom tip (ECMA silhouette)', () => {
    const path = buildHeart({ w: 100, h: 100 });
    expect(ctx.isPointInPath(path, 50, 40)).toBe(true); // centre body
    expect(ctx.isPointInPath(path, 25, 30)).toBe(true); // left lobe
    expect(ctx.isPointInPath(path, 75, 30)).toBe(true); // right lobe
    expect(ctx.isPointInPath(path, 30, 18)).toBe(true); // left lobe top
    expect(ctx.isPointInPath(path, 70, 18)).toBe(true); // right lobe top
    expect(ctx.isPointInPath(path, 50, 95)).toBe(true); // just above tip
  });

  it('has the central dip notch and empty top corners', () => {
    const path = buildHeart({ w: 100, h: 100 });
    expect(ctx.isPointInPath(path, 50, 10)).toBe(false); // notch between lobes
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false); // top-left corner
    expect(ctx.isPointInPath(path, 95, 5)).toBe(false); // top-right corner
  });

  it('bulges out with curved sides, not a straight V', () => {
    // The OOXML Bézier sides reach the frame edges around mid-height; a
    // straight-V approximation narrows to x≈17 here, leaving these empty.
    const path = buildHeart({ w: 100, h: 100 });
    expect(ctx.isPointInPath(path, 10, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 90, 50)).toBe(true);
  });
});
