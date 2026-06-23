import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildSun, SUN_ADJUSTMENTS, SUN_HANDLES } from '../../../../../src/view/canvas/shapes/basic/sun';

describe('buildSun', () => {
  it('fills the central disc', () => {
    const path = buildSun({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // OOXML sun has a central circle (radius w/4 at the default adj),
    // so the exact centre is filled.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
  });

  it('fills the tip of the east ray', () => {
    const path = buildSun({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // The east ray apex sits at (100, 50); a point just inside it is
    // covered by that discrete triangle sub-path.
    expect(ctx.isPointInPath(path, 95, 50)).toBe(true);
  });

  it('leaves the gap between rays empty', () => {
    const path = buildSun({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // (82.3, 36.6) is 22.5deg off the +x axis at radius ~35 — outside
    // the central disc (radius 25) and in the wedge between the east and
    // north-east rays, so it must NOT be filled. Discrete rays (not a
    // connected star) are what make this empty.
    expect(ctx.isPointInPath(path, 82.3, 36.6)).toBe(false);
  });

  it('default ray length is 25000', () => {
    expect(SUN_ADJUSTMENTS[0].defaultValue).toBe(25000);
  });
});

describe('SUN_HANDLES', () => {
  it('exposes one handle on the disc radius', () => {
    expect(SUN_HANDLES.length).toBe(1);
  });
});
