import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildWedgeEllipseCallout } from '../../../../../src/view/canvas/shapes/callouts/wedge-ellipse-callout';

describe('buildWedgeEllipseCallout', () => {
  it('produces an elliptical bubble plus a triangular tail subpath', () => {
    const path = buildWedgeEllipseCallout({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Default tail [-20833, 62500] places (tx, ty) ≈ (29.17, 67.5);
    // the tail triangle reaches outside the ellipse.
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // ellipse centre
    expect(ctx.isPointInPath(path, 29, 65)).toBe(true); // inside tail
    expect(ctx.isPointInPath(path, 200, 100)).toBe(false); // far outside
  });

  it('keeps the body centred on a non-square frame', () => {
    // 2:1 frame: the body must be an ellipse centred at (100,50) with
    // radii (100,50). A point near the LEFT tip (5,50) is inside only when
    // the arc is centred correctly — a polar-angle arc would drift the
    // centre right (~125,60) and leave the left edge unfilled.
    const path = buildWedgeEllipseCallout({ w: 200, h: 100 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 50)).toBe(true); // centre
    expect(ctx.isPointInPath(path, 5, 50)).toBe(true); // left tip filled
    expect(ctx.isPointInPath(path, 195, 50)).toBe(true); // right tip filled
  });
});
