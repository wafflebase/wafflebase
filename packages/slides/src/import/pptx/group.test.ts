// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  applyGroupTransform,
  composeGroupTransform,
} from './group';
import { DEFAULT_WIDESCREEN_EMU, emuScale } from './geometry';
import { parseXml } from './xml';

const SCALE = emuScale(DEFAULT_WIDESCREEN_EMU);

function grpSp(xml: string): Element {
  return parseXml(
    `<root xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</root>`,
  ).documentElement.firstElementChild!;
}

describe('composeGroupTransform + applyGroupTransform', () => {
  it('translates children when chOff matches a non-zero local origin', () => {
    // Group at world (300, 400), 600 wide × 200 tall.
    // Local space starts at (100, 100), extent 600×200 → no scale change.
    // A child at local (200, 100) should land at world (400, 400).
    const grp = grpSp(`<p:grpSp>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="2400000" y="3200000"/>
          <a:ext cx="4800000" cy="1600000"/>
          <a:chOff x="800000" y="800000"/>
          <a:chExt cx="4800000" cy="1600000"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:grpSp>`);
    const t = composeGroupTransform(IDENTITY_TRANSFORM, grp, SCALE);
    const local = {
      x: 1_600_000 * SCALE.sx,
      y: 800_000 * SCALE.sy,
      w: 800_000 * SCALE.sx,
      h: 400_000 * SCALE.sy,
      rotation: 0,
    };
    const world = applyGroupTransform(local, t);
    expect(world.x).toBeCloseTo(3_200_000 * SCALE.sx, 6);
    expect(world.y).toBeCloseTo(3_200_000 * SCALE.sy, 6);
    expect(world.w).toBeCloseTo(800_000 * SCALE.sx, 6);
    expect(world.h).toBeCloseTo(400_000 * SCALE.sy, 6);
  });

  it('rescales when chExt differs from ext', () => {
    // Group at world (0,0), 1000×1000 px-EMU.
    // Local space 0..2000 → child halves in world.
    const grp = grpSp(`<p:grpSp>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="1000000" cy="1000000"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="2000000" cy="2000000"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:grpSp>`);
    const t = composeGroupTransform(IDENTITY_TRANSFORM, grp, SCALE);
    const local = {
      x: 1_000_000 * SCALE.sx,
      y: 500_000 * SCALE.sy,
      w: 400_000 * SCALE.sx,
      h: 400_000 * SCALE.sy,
      rotation: 0,
    };
    const world = applyGroupTransform(local, t);
    expect(world.x).toBeCloseTo(500_000 * SCALE.sx, 6);
    expect(world.y).toBeCloseTo(250_000 * SCALE.sy, 6);
    expect(world.w).toBeCloseTo(200_000 * SCALE.sx, 6);
    expect(world.h).toBeCloseTo(200_000 * SCALE.sy, 6);
  });

  it('returns the parent transform when the group has no xfrm', () => {
    const grp = grpSp(`<p:grpSp><p:grpSpPr/></p:grpSp>`);
    const t = composeGroupTransform(IDENTITY_TRANSFORM, grp, SCALE);
    expect(t).toBe(IDENTITY_TRANSFORM);
  });

  it('rotates child centers around the group pivot when rot ≠ 0', () => {
    // Group centered at world (1000, 1000), 200×200 in raw EMU,
    // rotated 90° (`rot=5400000`). chOff/chExt identity → localScale 1.
    const grp = grpSp(`<p:grpSp>
      <p:grpSpPr>
        <a:xfrm rot="5400000">
          <a:off x="900" y="900"/>
          <a:ext cx="200" cy="200"/>
          <a:chOff x="900" y="900"/>
          <a:chExt cx="200" cy="200"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:grpSp>`);
    const t = composeGroupTransform(IDENTITY_TRANSFORM, grp, SCALE);

    // A child sitting at the right edge of the group (center at the
    // east point) should after a +90° rotation land at the south point.
    const child = {
      x: 1050 * SCALE.sx - 10,
      y: 1000 * SCALE.sy - 10,
      w: 20,
      h: 20,
      rotation: 0,
    };
    const world = applyGroupTransform(child, t);

    const expectedCenterX = 1000 * SCALE.sx;
    const expectedCenterY = 1050 * SCALE.sy;
    expect(world.x + world.w / 2).toBeCloseTo(expectedCenterX, 6);
    expect(world.y + world.h / 2).toBeCloseTo(expectedCenterY, 6);
    expect(world.rotation).toBeCloseTo(Math.PI / 2, 9);
  });
});
