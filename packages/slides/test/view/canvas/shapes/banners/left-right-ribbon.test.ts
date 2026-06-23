import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildLeftRightRibbon,
  buildLeftRightRibbonFaces,
  LEFT_RIGHT_RIBBON_ADJUSTMENTS,
  LEFT_RIGHT_RIBBON_HANDLES,
} from '../../../../../src/view/canvas/shapes/banners/left-right-ribbon';

// Decoded ECMA-376 geometry at the canonical test frame w=200, h=100,
// default adj (adj1=50000, adj2=50000, adj3=16667). ss = min(w,h) = 100.
//   left tip   = (0, ly2=41.67)   right tip = (200, ry3=58.33)
//   x1 = 50, x4 = 150 (inner arrowhead edges)
//   left body band  y in [ly1=16.67, ly4=83.33]
//   right body band y in [ry2=33.33, ry4=83.33]
//   fold band x in [x2=93.75, x3=106.25]; fold top y1=20.83

describe('buildLeftRightRibbon', () => {
  it('produces a Path2D', () => {
    expect(buildLeftRightRibbon({ w: 200, h: 100 })).toBeInstanceOf(Path2D);
  });

  it('has both arrowhead tips inside (left & right edges, vertical center)', () => {
    const path = buildLeftRightRibbon({ w: 200, h: 100 });
    const ctx = createTestCanvas(220, 120).getContext('2d');
    // Left tip: a couple px inside the left edge, at the head's center.
    expect(ctx.isPointInPath(path, 3, 41.67)).toBe(true);
    // Right tip: a couple px inside the right edge, at the head's center.
    expect(ctx.isPointInPath(path, 197, 58.33)).toBe(true);
  });

  it('fills the left and right body bands but not outside them', () => {
    const path = buildLeftRightRibbon({ w: 200, h: 100 });
    const ctx = createTestCanvas(220, 120).getContext('2d');
    // Left body interior (band y 16.67..83.33, x just right of x1=50).
    expect(ctx.isPointInPath(path, 70, 50)).toBe(true);
    // Right body interior (band y 33.33..83.33, x just left of x4=150).
    expect(ctx.isPointInPath(path, 130, 60)).toBe(true);
    // Above the right body top (ry2=33.33) is OUTSIDE — proves the body
    // steps DOWN on the right half (the fold step). The same y is INSIDE
    // the left half (whose top is ly1=16.67).
    expect(ctx.isPointInPath(path, 130, 25)).toBe(false);
    expect(ctx.isPointInPath(path, 70, 25)).toBe(true);
  });

  it('has three adjustments with OOXML defaults', () => {
    expect(LEFT_RIGHT_RIBBON_ADJUSTMENTS).toHaveLength(3);
    expect(LEFT_RIGHT_RIBBON_ADJUSTMENTS[0].defaultValue).toBe(50000);
    expect(LEFT_RIGHT_RIBBON_ADJUSTMENTS[1].defaultValue).toBe(50000);
    expect(LEFT_RIGHT_RIBBON_ADJUSTMENTS[2].defaultValue).toBe(16667);
  });
});

describe('buildLeftRightRibbonFaces', () => {
  it('returns the body (base) plus a darker center fold-shadow face', () => {
    const faces = buildLeftRightRibbonFaces({ w: 200, h: 100 });
    expect(faces).toHaveLength(2);
    const [body, flap] = faces;
    expect(body.shade ?? 0).toBe(0);
    expect(flap.shade).toBeLessThan(0); // darkenLess fold shadow

    const ctx = createTestCanvas(220, 120).getContext('2d');
    // Body face hit-tests inside the left body interior.
    expect(ctx.isPointInPath(body.path, 70, 50)).toBe(true);
    // The fold-shadow flap covers the center fold band [x2=93.75,
    // x3=106.25] around the fold; sample its interior.
    expect(ctx.isPointInPath(flap.path, 100, 27)).toBe(true);
    // …and not far outside the fold band.
    expect(ctx.isPointInPath(flap.path, 70, 50)).toBe(false);
  });
});

describe('LEFT_RIGHT_RIBBON_HANDLES', () => {
  it('exposes three handles', () => {
    expect(LEFT_RIGHT_RIBBON_HANDLES.length).toBe(3);
  });
});
