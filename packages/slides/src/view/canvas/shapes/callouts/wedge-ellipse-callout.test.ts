import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildWedgeEllipseCallout } from './wedge-ellipse-callout';

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
});
