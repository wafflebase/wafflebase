import { describe, expect, it } from 'vitest';
import { fourCardinal } from '../../../../src/view/canvas/connection-sites/defaults';
import { siteWorldPos } from '../../../../src/view/canvas/connection-sites/index';

describe('fourCardinal', () => {
  it('returns 4 sites in N, E, S, W order', () => {
    const sites = fourCardinal();
    expect(sites).toHaveLength(4);
    expect(sites[0]).toMatchObject({ x: 0.5, y: 0 });    // N
    expect(sites[1]).toMatchObject({ x: 1,   y: 0.5 });  // E
    expect(sites[2]).toMatchObject({ x: 0.5, y: 1 });    // S
    expect(sites[3]).toMatchObject({ x: 0,   y: 0.5 });  // W
  });
});

describe('siteWorldPos', () => {
  const frame = { x: 100, y: 200, w: 200, h: 100, rotation: 0 };

  it('with rotation=0: returns local-projected world coords', () => {
    const e = siteWorldPos({ frame }, { x: 1, y: 0.5, angle: 0 });
    expect(e.x).toBeCloseTo(300);
    expect(e.y).toBeCloseTo(250);
    expect(e.angle).toBeCloseTo(0);
  });

  it('with 90° rotation: E site rotates to S side', () => {
    const rotated = { ...frame, rotation: Math.PI / 2 };
    // Local center is (100, 50). E local = (200, 50), so vector from
    // center is (100, 0). Canvas-convention rotation by +π/2 maps
    // (x, y) → (-y, x), so (100, 0) → (0, 100); add center → (100, 150)
    // local → world (100 + 100, 200 + 150) = (200, 350).
    const e = siteWorldPos({ frame: rotated }, { x: 1, y: 0.5, angle: 0 });
    expect(e.x).toBeCloseTo(200);
    expect(e.y).toBeCloseTo(350);
    expect(e.angle).toBeCloseTo(Math.PI / 2);
  });

  it('with 180° rotation: position mirrors through center', () => {
    const rotated = { ...frame, rotation: Math.PI };
    const e = siteWorldPos({ frame: rotated }, { x: 1, y: 0.5, angle: 0 });
    // E (300, 250) flips through center (200, 250) → (100, 250)
    expect(e.x).toBeCloseTo(100);
    expect(e.y).toBeCloseTo(250);
    expect(e.angle).toBeCloseTo(Math.PI);
  });

  // OOXML `<a:xfrm flipH/flipV>` mirrors the painted path around the
  // frame centre, but the connection-site lookup is in pre-flip local
  // coords (matches OOXML cxnLst semantics — the connector idx points
  // at the unflipped logical site). `siteWorldPos` must apply the same
  // mirror so attached connectors land on the visually-correct edge.
  it('with flipH: mirrors site around the horizontal centre + flips angle', () => {
    const flipped = { ...frame, flipH: true };
    // E site (x=1, angle=0). Local E = (200, 50); centre = (100, 50);
    // flipH around centre → (0, 50). World = (100 + 0, 200 + 50) = (100, 250).
    // Angle: 0 (right) → π (left).
    const e = siteWorldPos({ frame: flipped }, { x: 1, y: 0.5, angle: 0 });
    expect(e.x).toBeCloseTo(100);
    expect(e.y).toBeCloseTo(250);
    expect(e.angle).toBeCloseTo(Math.PI);
  });

  it('with flipV: mirrors site around the vertical centre + flips angle', () => {
    const flipped = { ...frame, flipV: true };
    // N site (x=0.5, y=0, angle=-π/2). Local N = (100, 0); centre = (100, 50);
    // flipV around centre → (100, 100). World = (100 + 100, 200 + 100) = (200, 300).
    // Angle: -π/2 (up) → π/2 (down).
    const e = siteWorldPos({ frame: flipped }, { x: 0.5, y: 0, angle: -Math.PI / 2 });
    expect(e.x).toBeCloseTo(200);
    expect(e.y).toBeCloseTo(300);
    expect(e.angle).toBeCloseTo(Math.PI / 2);
  });

  it('with flipH=flipV=true: position mirrors through both axes', () => {
    const flipped = { ...frame, flipH: true, flipV: true };
    // E site at (200, 50); double-flip around centre (100, 50) → (0, 50).
    // (Vertical centre passes through the site so flipV is a no-op for E.)
    const e = siteWorldPos({ frame: flipped }, { x: 1, y: 0.5, angle: 0 });
    expect(e.x).toBeCloseTo(100);
    expect(e.y).toBeCloseTo(250);
    // angle 0 → flipH → π → flipV → -π (≡ π).
    expect(Math.abs(Math.abs(e.angle) - Math.PI)).toBeLessThan(1e-9);
  });

  it('with flipH and rotation: applies flip first, then rotation (matches paint order)', () => {
    // Paint order in element-renderer.ts: translate(centre) → rotate →
    // scale(flip) → translate(-w/2,-h/2). siteWorldPos must mirror that
    // ordering so attached endpoints land where the path was actually
    // painted.
    const rf = { ...frame, flipH: true, rotation: Math.PI / 2 };
    // E site (1, 0.5, angle=0). Local (200, 50); centre (100, 50).
    // flipH → (0, 50). Rotate +π/2 about centre: (lx-cx, ly-cy) = (-100, 0)
    //   → canvas-convention (x,y)→(-y,x) → (0, -100); add centre → (100, -50).
    // World = (frame.x + 100, frame.y + -50) = (200, 150).
    const e = siteWorldPos({ frame: rf }, { x: 1, y: 0.5, angle: 0 });
    expect(e.x).toBeCloseTo(200);
    expect(e.y).toBeCloseTo(150);
    // Angle: flipH(0) = π, then add rotation π/2 → 3π/2 (≡ -π/2).
    const a = ((e.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(a).toBeCloseTo((3 * Math.PI) / 2);
  });
});
