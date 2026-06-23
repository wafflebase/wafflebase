import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildMathMultiply } from '../../../../../src/view/canvas/shapes/equation/math-multiply';

describe('buildMathMultiply', () => {
  it('produces an `×` glyph composed of two diagonal arms (square)', () => {
    const path = buildMathMultiply({ w: 60, h: 60 });
    const ctx = createTestCanvas(120, 120).getContext('2d');
    expect(ctx.isPointInPath(path, 30, 30)).toBe(true); // centre overlap
    expect(ctx.isPointInPath(path, 19.7, 24.7)).toBe(true); // mid TL→BR arm
    expect(ctx.isPointInPath(path, 30, 10)).toBe(false); // above centre, off arms
  });

  it('aligns the arms to the box corners (`at2 w h`, not a fixed 45°)', () => {
    // OOXML uses `a = at2 w h`, so on a non-square frame the arms point
    // toward the actual corners (angle ≈ 26.57° for 2:1), NOT 45°.
    const path = buildMathMultiply({ w: 120, h: 60 });
    const ctx = createTestCanvas(240, 240).getContext('2d');
    expect(ctx.isPointInPath(path, 60, 30)).toBe(true); // centre overlap
    // A point along the diagonal toward the top-left corner is inside…
    expect(ctx.isPointInPath(path, 42.8, 25.4)).toBe(true); // mid corner-arm
    expect(ctx.isPointInPath(path, 27, 21)).toBe(true); // near corner-arm tip
    // …but a point on a fixed-45° arm (dx = dy from centre) is OUTSIDE,
    // proving the X is no longer a 45° X.
    expect(ctx.isPointInPath(path, 40, 10)).toBe(false); // on the old 45° line
    expect(ctx.isPointInPath(path, 60, 10)).toBe(false); // above centre, off arms
  });
});
