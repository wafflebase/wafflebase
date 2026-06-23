// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildRibbon2,
  buildRibbon2Faces,
  RIBBON2_HANDLES,
} from '../../../../../src/view/canvas/shapes/banners/ribbon2';

// ribbon2 is the vertical mirror of ribbon: the band sits at the top
// (t..y2 = 0..83.33) and the swallowtail tails point downward.
const W = 200;
const H = 100;

describe('buildRibbon2', () => {
  const path = buildRibbon2({ w: W, h: H });
  const ctx = createTestCanvas(W * 2, H * 2).getContext('2d');

  it('fills the raised centre band', () => {
    expect(ctx.isPointInPath(path, 100, 40)).toBe(true); // band middle
    expect(ctx.isPointInPath(path, 100, 10)).toBe(true); // band upper area
  });

  it('fills the swallowtail tail bodies near the outer corners', () => {
    expect(ctx.isPointInPath(path, 195, 97)).toBe(true); // right tail, bottom
    expect(ctx.isPointInPath(path, 5, 97)).toBe(true); // left tail, bottom
  });

  it('excludes the V-notched tail ends', () => {
    // The tail tips are cut by an inward V (apex at y3 = 58.33), so points
    // on the notch centreline near the outer edge are outside.
    expect(ctx.isPointInPath(path, 190, 58)).toBe(false); // right V notch
    expect(ctx.isPointInPath(path, 10, 58)).toBe(false); // left V notch
  });
});

describe('buildRibbon2Faces', () => {
  const faces = buildRibbon2Faces({ w: W, h: H });
  const ctx = createTestCanvas(W * 2, H * 2).getContext('2d');

  it('paints the body first at base fill, then darker fold tabs', () => {
    expect(faces.length).toBe(3);
    expect(faces[0].shade ?? 0).toBe(0);
    expect(faces[1].shade).toBeLessThan(0);
    expect(faces[2].shade).toBeLessThan(0);
  });

  it('locates the fold tabs at the band bottom seams (upward fold)', () => {
    // Left fold tab centroid ≈ (68.75, 90.28): inside the band bottom,
    // between the band bottom edge (y2 = 83.33) and the rounded corner.
    expect(ctx.isPointInPath(faces[1].path, 68, 90)).toBe(true);
    // Right fold tab centroid ≈ (131.25, 90.28).
    expect(ctx.isPointInPath(faces[2].path, 132, 90)).toBe(true);
    // Tabs sit near the BOTTOM of the band (large y) — the upward fold.
    expect(ctx.isPointInPath(faces[1].path, 68, 30)).toBe(false);
  });
});

describe('RIBBON2_HANDLES', () => {
  it('exposes two adjustment handles', () => {
    expect(RIBBON2_HANDLES.length).toBe(2);
  });
});
