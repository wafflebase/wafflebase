import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildCorner, CORNER_ADJUSTMENTS, CORNER_HANDLES } from '../../../../../src/view/canvas/shapes/basic/corner';

describe('buildCorner', () => {
  it('fills the bottom + left arms but not the NE quadrant interior', () => {
    const path = buildCorner({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Bottom arm interior.
    expect(ctx.isPointInPath(path, 50, 95)).toBe(true);
    // Left arm interior.
    expect(ctx.isPointInPath(path, 5, 50)).toBe(true);
    // NE quadrant — outside.
    expect(ctx.isPointInPath(path, 80, 20)).toBe(false);
  });

  it('arm thickness scales by ss = min(w,h), not the owning axis', () => {
    // 200×100 frame, ss=100, default 33333 → both arms ≈ 33.33 px.
    // Left arm width = ss*a2/100000 ≈ 33.33 (NOT w*a2/100000 ≈ 66.67).
    // So a point at (50, 30) lies in the EMPTY NE region with the
    // ss-based arm, but would be INSIDE the wider w-based left arm.
    const path = buildCorner({ w: 200, h: 100 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    // Inside the narrow ss-based left arm.
    expect(ctx.isPointInPath(path, 20, 30)).toBe(true);
    // Just outside it (x ≈ 50 > 33.33) and above the bottom arm.
    expect(ctx.isPointInPath(path, 50, 30)).toBe(false);
    // Bottom arm spans the full width.
    expect(ctx.isPointInPath(path, 150, 90)).toBe(true);
  });

  it('defaults are 33333 / 33333', () => {
    expect(CORNER_ADJUSTMENTS[0].defaultValue).toBe(33333);
    expect(CORNER_ADJUSTMENTS[1].defaultValue).toBe(33333);
  });
});

describe('CORNER_HANDLES', () => {
  it('exposes two handles', () => {
    expect(CORNER_HANDLES.length).toBe(2);
  });

  it('left-arm handle paints at x1 = ss*a2/100000', () => {
    // ss = min(200,100)=100, a2=33333 → x1 ≈ 33.33.
    const p = CORNER_HANDLES[1].position({ w: 200, h: 100 }, [33333, 33333]);
    expect(p.x).toBeCloseTo(33.333, 2);
    expect(p.y).toBe(0);
  });
});
