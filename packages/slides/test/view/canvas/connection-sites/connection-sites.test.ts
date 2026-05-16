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
});
