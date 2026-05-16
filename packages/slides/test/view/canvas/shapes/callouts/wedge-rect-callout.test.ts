import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildWedgeRectCallout } from '../../../../../src/view/canvas/shapes/callouts/wedge-rect-callout';

describe('buildWedgeRectCallout', () => {
  it('produces a rectangular bubble plus a tail on the closest edge', () => {
    const path = buildWedgeRectCallout({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Default tail [-20833, 62500] places (tx, ty) ≈ (29.17, 67.5).
    // Closest edge is the bottom (distance 7.5 vs 29.17/67.5/70.83);
    // the tail therefore extends below the body.
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // bubble centre
    expect(ctx.isPointInPath(path, 29, 65)).toBe(true); // inside tail
    expect(ctx.isPointInPath(path, 200, 30)).toBe(false); // outside right
    expect(ctx.isPointInPath(path, 50, 100)).toBe(false); // far below tail
  });
});
