// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildEllipseRibbon,
  buildEllipseRibbon2,
  buildEllipseRibbonFaces,
  buildEllipseRibbon2Faces,
  ELLIPSE_RIBBON_ADJUSTMENTS,
  ELLIPSE_RIBBON_HANDLES,
  ELLIPSE_RIBBON2_HANDLES,
} from '../../../../../src/view/canvas/shapes/banners/ellipse-ribbon';

const SIZE = { w: 100, h: 100 };

/**
 * Geometry reference (w = h = 100, default adjustments), decoded from
 * the ECMA-376 `ellipseRibbon` preset:
 *   endY = 0 (ends raised at the top)   rh = 75 (fold base, bottom side)
 *   center top edge y3 ≈ 21.9, center bottom edge y6 ≈ 96.9
 *   fold lines at x3 = 37.5 and x4 = 62.5
 * `ellipseRibbon2` is the vertical mirror about y = h.
 */

describe('buildEllipseRibbon (ECMA-376 silhouette)', () => {
  it('keeps the ENDS raised at the top and dips the center body DOWN', () => {
    const path = buildEllipseRibbon(SIZE);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // The two ends are held high: a point near the top-left corner is
    // inside the band, since the end is anchored at y = 0.
    expect(ctx.isPointInPath(path, 2, 2)).toBe(true);
    // The center body dips down: at x = 50 the band sits LOW, so a point
    // high up (y = 5) is OUTSIDE while a point low down (y = 90) is IN.
    expect(ctx.isPointInPath(path, 50, 5)).toBe(false);
    expect(ctx.isPointInPath(path, 50, 90)).toBe(true);
    // Mid-body and ends straddle the band on both sides of center.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 20, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 80, 50)).toBe(true);
    // Far past the band edges is outside.
    expect(ctx.isPointInPath(path, 95, 40)).toBe(false);
  });
});

describe('buildEllipseRibbon2 (vertical mirror)', () => {
  it('raises the center body UP and drops the ENDS to the bottom', () => {
    const path = buildEllipseRibbon2(SIZE);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Ends are anchored low (y = 100): bottom-right corner is inside.
    expect(ctx.isPointInPath(path, 98, 98)).toBe(true);
    // Center body rides high: at x = 50 a point high up (y = 5) is IN
    // and a point low down (y = 90) is OUT — the mirror of ribbon.
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 90)).toBe(false);
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    // The raised top-left corner of ellipseRibbon is now OUTSIDE.
    expect(ctx.isPointInPath(path, 2, 2)).toBe(false);
  });
});

describe('buildEllipseRibbonFaces', () => {
  it('returns a darker center fold tab BEHIND the base body', () => {
    const faces = buildEllipseRibbonFaces(SIZE);
    expect(faces).toHaveLength(2);
    const [tab, body] = faces;
    // The fold tab is painted first (back) and darker; the body covers it.
    expect(tab.shade).toBeLessThan(0);
    expect(body.shade ?? 0).toBe(0);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // The tab is two narrow strips along the fold lines (x ≈ 37.5 / 62.5)
    // just below the raised center top edge.
    expect(ctx.isPointInPath(tab.path, 37, 18)).toBe(true);
    expect(ctx.isPointInPath(tab.path, 63, 18)).toBe(true);
    // The body covers the main band interior.
    expect(ctx.isPointInPath(body.path, 50, 50)).toBe(true);
  });
});

describe('buildEllipseRibbon2Faces', () => {
  it('returns a darker center fold tab mirrored to the bottom', () => {
    const faces = buildEllipseRibbon2Faces(SIZE);
    expect(faces).toHaveLength(2);
    const [tab, body] = faces;
    expect(tab.shade).toBeLessThan(0);
    expect(body.shade ?? 0).toBe(0);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Fold lines mirror to y ≈ 82.
    expect(ctx.isPointInPath(tab.path, 37, 82)).toBe(true);
    expect(ctx.isPointInPath(tab.path, 63, 82)).toBe(true);
    expect(ctx.isPointInPath(body.path, 50, 50)).toBe(true);
  });
});

describe('adjustments + handles', () => {
  it('exposes body height, center width, and arch defaults', () => {
    expect(ELLIPSE_RIBBON_ADJUSTMENTS.map((a) => a.defaultValue)).toEqual([
      25000, 50000, 12500,
    ]);
  });

  it('places the body-height handle at the fold base for each variant', () => {
    const r1 = ELLIPSE_RIBBON_HANDLES[0].position(SIZE, [25000, 50000, 12500]);
    expect(r1.y).toBeCloseTo(25, 5); // ellipseRibbon: q1 from the top
    const r2 = ELLIPSE_RIBBON2_HANDLES[0].position(SIZE, [
      25000, 50000, 12500,
    ]);
    expect(r2.y).toBeCloseTo(75, 5); // ellipseRibbon2: mirrored to bottom
  });
});
