import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  BEVEL_ADJUSTMENTS,
  buildBevel,
  buildBevelFaces,
  BEVEL_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/bevel';

describe('buildBevel', () => {
  it('silhouette fills the whole outer rectangle, including the centre', () => {
    // OOXML bevel is a solid raised button, not a hollow frame: the
    // silhouette is the full outer rect. A hollow-frame shape (outer CW
    // + inner CCW) would FAIL the centre assertion.
    const path = buildBevel({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true); // centre filled
    expect(ctx.isPointInPath(path, 2, 2)).toBe(true); // top-left corner
    expect(ctx.isPointInPath(path, 98, 98)).toBe(true); // bottom-right corner
    expect(ctx.isPointInPath(path, 50, 2)).toBe(true); // top edge
  });

  it('default size is 12500', () => {
    expect(BEVEL_ADJUSTMENTS[0].defaultValue).toBe(12500);
  });
});

describe('buildBevelFaces', () => {
  it('returns 5 faces: inner base, lit top/left, shadowed right/bottom', () => {
    const faces = buildBevelFaces({ w: 100, h: 100 });
    expect(faces).toHaveLength(5);
    const [inner, top, left, right, bottom] = faces;
    // Inner inset rect is the flat base fill (no shade).
    expect(inner.shade ?? 0).toBe(0);
    // Lit faces lighter, shadowed faces darker; top lighter than bottom.
    expect(top.shade).toBeGreaterThan(0);
    expect(left.shade).toBeGreaterThan(0);
    expect(right.shade).toBeLessThan(0);
    expect(bottom.shade).toBeLessThan(0);
    expect(top.shade!).toBeGreaterThan(bottom.shade!);
  });

  it('each bevel face hit-tests in its own edge band (inset x1 = 12.5)', () => {
    const faces = buildBevelFaces({ w: 100, h: 100 });
    const [inner, top, left, right, bottom] = faces;
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Inner inset rectangle owns the centre.
    expect(ctx.isPointInPath(inner.path, 50, 50)).toBe(true);
    // Each bevel trapezoid owns its outer edge band.
    expect(ctx.isPointInPath(top.path, 50, 6)).toBe(true);
    expect(ctx.isPointInPath(bottom.path, 50, 94)).toBe(true);
    expect(ctx.isPointInPath(left.path, 6, 50)).toBe(true);
    expect(ctx.isPointInPath(right.path, 94, 50)).toBe(true);
    // Bevel faces do not claim the centre; the inner rect does not
    // claim the edge bands.
    expect(ctx.isPointInPath(top.path, 50, 50)).toBe(false);
    expect(ctx.isPointInPath(inner.path, 50, 6)).toBe(false);
  });
});

describe('BEVEL_HANDLES', () => {
  it('exposes one top-edge handle', () => {
    expect(BEVEL_HANDLES.length).toBe(1);
  });
});
