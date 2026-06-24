import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { BLOCK_ARC_ADJUSTMENTS, buildBlockArc } from '../../../../../src/view/canvas/shapes/basic/block-arc';

describe('buildBlockArc', () => {
  it('default 180°→0° at 25% thickness fills the top semi-annulus', () => {
    const path = buildBlockArc({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Outer-band point near top edge (CW sweep 180°→0° goes through
    // 270° = top).
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    // Pivot is inside the inner hole — outside the band.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(false);
  });

  it('ring thickness is the absolute offset dr = ss*adj3/100000', () => {
    // 100×100, ss=100, adj3=25000 → dr=25. Outer r=50, inner r=25, so
    // the top band fills y∈[0,25] at x=50. The old multiplicative model
    // (innerScale=0.75 → inner r=37.5) only filled y∈[0,12.5], so a
    // point at (50,20) is INSIDE the ring only with the OOXML offset.
    const path = buildBlockArc({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 20)).toBe(true);
    // Deeper into the hole (inner r=25 → y=30 is inside the hole).
    expect(ctx.isPointInPath(path, 50, 30)).toBe(false);
  });

  it('ring thickness is uniform on a non-square frame', () => {
    // 200×100, ss=100, adj3=25000 → dr=25 subtracted from BOTH radii:
    // irx=100-25=75, iry=50-25=25 → uniform 25 thickness. The old
    // model scaled inner radius per axis (iry=37.5 → y-thickness 12.5).
    // At x=100 (centre) the top band fills y∈[0,25]; (100,20) is in the
    // ring only with the constant offset.
    const path = buildBlockArc({ w: 200, h: 100 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 20)).toBe(true);
    expect(ctx.isPointInPath(path, 100, 30)).toBe(false);
  });

  it('defaults match OOXML preset (180°, 0°, 25%)', () => {
    expect(BLOCK_ARC_ADJUSTMENTS[0].defaultValue).toBe(10800000);
    expect(BLOCK_ARC_ADJUSTMENTS[1].defaultValue).toBe(0);
    expect(BLOCK_ARC_ADJUSTMENTS[2].defaultValue).toBe(25000);
  });
});
