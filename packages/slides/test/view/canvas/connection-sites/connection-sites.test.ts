import { describe, expect, it } from 'vitest';
import { fourCardinal } from '../../../../src/view/canvas/connection-sites/defaults';
import {
  getConnectionSites,
  siteWorldPos,
} from '../../../../src/view/canvas/connection-sites/index';
import type { Element } from '../../../../src/model/element';

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

  it.skip('placeholder', () => {});
});

describe('getConnectionSites overrides', () => {
  const rectFrame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };

  it('rect uses the 4-cardinal default', () => {
    const el: Element = { id: 'r', type: 'shape', frame: rectFrame, data: { kind: 'rect' } };
    expect(getConnectionSites(el)).toEqual(fourCardinal());
  });

  it('diamond override anchors all 4 vertices (not edge midpoints)', () => {
    const el: Element = { id: 'd', type: 'shape', frame: rectFrame, data: { kind: 'diamond' } };
    const sites = getConnectionSites(el);
    expect(sites).toHaveLength(4);
    // For diamond, edge midpoints are inset toward centre. We expect the
    // four vertices in N/E/S/W order — same coords as cardinal but the
    // semantic anchor is "vertex" not "edge midpoint".
    expect(sites[0]).toMatchObject({ x: 0.5, y: 0 });
    expect(sites[1]).toMatchObject({ x: 1,   y: 0.5 });
    expect(sites[2]).toMatchObject({ x: 0.5, y: 1 });
    expect(sites[3]).toMatchObject({ x: 0,   y: 0.5 });
  });

  it('parallelogram override skews top/bottom anchors with the 25% adj', () => {
    const el: Element = {
      id: 'p',
      type: 'shape',
      frame: rectFrame,
      data: { kind: 'parallelogram' },
    };
    const sites = getConnectionSites(el);
    expect(sites[0].x).toBeCloseTo(0.625); // top edge mid, shifted right
    expect(sites[2].x).toBeCloseTo(0.375); // bottom edge mid, shifted left
    // Sides stay at x=0 / x=1, midpoint y=0.5.
    expect(sites[1]).toMatchObject({ x: 1, y: 0.5 });
    expect(sites[3]).toMatchObject({ x: 0, y: 0.5 });
  });

  it('pentagon (n-gon) still falls back to cardinal — overrides held back', () => {
    // Pentagon / hexagon / octagon / star_n overrides are deferred until
    // a per-shape cxnLst→waffle index table exists. Until then the
    // default 4-cardinal keeps PPTX round-trip correct for idx 1/3.
    const el: Element = {
      id: 'p',
      type: 'shape',
      frame: rectFrame,
      data: { kind: 'pentagon' },
    };
    expect(getConnectionSites(el)).toEqual(fourCardinal());
  });

  it('non-shape elements always use cardinal', () => {
    const text: Element = {
      id: 't',
      type: 'text',
      frame: rectFrame,
      data: { kind: 'plain', blocks: [] } as never,
    };
    expect(getConnectionSites(text)).toEqual(fourCardinal());
  });

  it.skip('paint-order placeholder', () => {});
});

describe('siteWorldPos — paint-order interactions (continued)', () => {
  const frame = { x: 100, y: 200, w: 200, h: 100, rotation: 0 };

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
