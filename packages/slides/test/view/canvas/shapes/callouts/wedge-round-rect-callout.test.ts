import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildWedgeRoundRectCallout } from '../../../../../src/view/canvas/shapes/callouts/wedge-round-rect-callout';

describe('buildWedgeRoundRectCallout', () => {
  it('sprouts a tail below the box when the target is below (default)', () => {
    const path = buildWedgeRoundRectCallout({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Default tail [-20833, 62500, 16667] places (tx, ty) ≈ (29.17, 67.5)
    // — below the frame bottom — so the bottom edge sprouts a tail.
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // bubble centre
    expect(ctx.isPointInPath(path, 29, 65)).toBe(true); // inside tail
    expect(ctx.isPointInPath(path, 200, 30)).toBe(false); // outside right
    expect(ctx.isPointInPath(path, 50, 100)).toBe(false); // far below tail
  });

  it('points the tail toward a target to the RIGHT of the box', () => {
    // tailX = +60000 → tx = 50 + 0.6·100 = 110 (right of w=100).
    // tailY = 0 → ty = 30 (vertical centre). Closest edge is right.
    const path = buildWedgeRoundRectCallout({ w: 100, h: 60 }, [60000, 0, 16667]);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // bubble centre
    expect(ctx.isPointInPath(path, 108, 30)).toBe(true); // inside right tail
    expect(ctx.isPointInPath(path, 50, 100)).toBe(false); // nothing below
  });

  it('points the tail toward a target ABOVE the box', () => {
    // tailY = -60000 → ty = 30 - 0.6·60 = -6 (above the frame top).
    // tailX = 0 → tx = 50. Closest edge is top.
    const path = buildWedgeRoundRectCallout({ w: 100, h: 60 }, [0, -60000, 16667]);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // bubble centre
    expect(ctx.isPointInPath(path, 50, -4)).toBe(true); // inside top tail
    expect(ctx.isPointInPath(path, 50, 100)).toBe(false); // nothing below
  });

  it('points the tail toward a target to the LEFT of the box', () => {
    // tailX = -60000 → tx = 50 - 0.6·100 = -10 (left of frame).
    // tailY = 0 → ty = 30. Closest edge is left.
    const path = buildWedgeRoundRectCallout({ w: 100, h: 60 }, [-60000, 0, 16667]);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // bubble centre
    expect(ctx.isPointInPath(path, -8, 30)).toBe(true); // inside left tail
    expect(ctx.isPointInPath(path, 50, 100)).toBe(false); // nothing below
  });
});
