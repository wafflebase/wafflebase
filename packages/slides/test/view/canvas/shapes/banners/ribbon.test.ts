// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildRibbon,
  buildRibbonFaces,
  RIBBON_HANDLES,
} from '../../../../../src/view/canvas/shapes/banners/ribbon';

// Frame matches the OOXML w=2*h aspect used elsewhere; default adjustments.
const W = 200;
const H = 100;

describe('buildRibbon', () => {
  const path = buildRibbon({ w: W, h: H });
  const ctx = createTestCanvas(W * 2, H * 2).getContext('2d');

  it('fills the raised centre band', () => {
    // Band spans x2..x9 = 50..150 below the band top (y2 = 16.67).
    expect(ctx.isPointInPath(path, 100, 60)).toBe(true); // band middle
    expect(ctx.isPointInPath(path, 100, 30)).toBe(true); // band upper area
  });

  it('fills the swallowtail tail bodies near the outer corners', () => {
    expect(ctx.isPointInPath(path, 195, 3)).toBe(true); // right tail, top
    expect(ctx.isPointInPath(path, 195, 80)).toBe(true); // right tail, bottom
    expect(ctx.isPointInPath(path, 5, 3)).toBe(true); // left tail, top
  });

  it('excludes the V-notched tail ends', () => {
    // The tail tips are cut by an inward V (apex at x10/wd8, y3 = 41.67),
    // so points on the notch centreline near the outer edge are outside.
    expect(ctx.isPointInPath(path, 190, 42)).toBe(false); // right V notch
    expect(ctx.isPointInPath(path, 10, 42)).toBe(false); // left V notch
  });
});

describe('buildRibbonFaces', () => {
  const faces = buildRibbonFaces({ w: W, h: H });
  const ctx = createTestCanvas(W * 2, H * 2).getContext('2d');

  it('paints the body first at base fill, then darker fold tabs', () => {
    expect(faces.length).toBe(3);
    // Body face is the silhouette at base fill (shade 0 / absent).
    expect(faces[0].shade ?? 0).toBe(0);
    // The two fold tabs are darker (shade < 0).
    expect(faces[1].shade).toBeLessThan(0);
    expect(faces[2].shade).toBeLessThan(0);
  });

  it('locates the fold tabs at the band top seams (downward fold)', () => {
    // Left fold tab centroid ≈ (68.75, 9.72): inside the band top, between
    // the band's top edge (y2 = 16.67) and the rounded corner (hR).
    expect(ctx.isPointInPath(faces[1].path, 68, 10)).toBe(true);
    // Right fold tab centroid ≈ (131.25, 9.72).
    expect(ctx.isPointInPath(faces[2].path, 132, 10)).toBe(true);
    // Tabs sit near the TOP of the band (small y) — the downward fold.
    expect(ctx.isPointInPath(faces[1].path, 68, 70)).toBe(false);
  });
});

describe('RIBBON_HANDLES', () => {
  it('exposes two adjustment handles', () => {
    expect(RIBBON_HANDLES.length).toBe(2);
  });
});
