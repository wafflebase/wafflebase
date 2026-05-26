// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  applyGroupTransform,
  composeGroupTransform,
} from '../../../src/import/pptx/group';
import { DEFAULT_WIDESCREEN_EMU, emuScale } from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';

const SCALE = emuScale(DEFAULT_WIDESCREEN_EMU);

function grpSp(xml: string): Element {
  return parseXml(
    `<root xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</root>`,
  ).documentElement.firstElementChild!;
}

describe('composeGroupTransform + applyGroupTransform', () => {
  it('translates children when chOff matches a non-zero local origin', () => {
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
    // Group centered at world (1000, 1000), 200×200 raw EMU, rotated 90°.
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

    const child = {
      x: 1050 * SCALE.sx - 10,
      y: 1000 * SCALE.sy - 10,
      w: 20,
      h: 20,
      rotation: 0,
    };
    const world = applyGroupTransform(child, t);

    expect(world.x + world.w / 2).toBeCloseTo(1000 * SCALE.sx, 6);
    expect(world.y + world.h / 2).toBeCloseTo(1050 * SCALE.sy, 6);
    expect(world.rotation).toBeCloseTo(Math.PI / 2, 9);
  });

  it('keeps a 90°-rotated child inside the group when chExt sizes the rotated bbox', () => {
    // Pattern emitted by PowerPoint / Google Slides when you rotate a
    // shape inside a group: the child's <a:ext> is the *unrotated* box
    // (wide), but the group's <a:chExt> matches the *rotated visual*
    // bbox (tall). The visible width/height of the child must equal
    // the group's `ext` after import — otherwise the rotated shape
    // overflows its enclosing group.
    const grp = grpSp(`<p:grpSp>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="4084750" y="2000661"/>
          <a:ext cx="1827900" cy="1404064"/>
          <a:chOff x="4572084" y="1597469"/>
          <a:chExt cx="1827900" cy="2399700"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:grpSp>`);
    const t = composeGroupTransform(IDENTITY_TRANSFORM, grp, SCALE);

    // Child shape: <a:xfrm rot="5400000">, off (4286184, 1883369),
    // ext (2399700, 1827900) — i.e. wide-then-rotated-tall.
    const child = {
      x: 4286184 * SCALE.sx,
      y: 1883369 * SCALE.sy,
      w: 2399700 * SCALE.sx,
      h: 1827900 * SCALE.sy,
      rotation: Math.PI / 2,
    };
    const world = applyGroupTransform(child, t);

    // The visual bbox (post-rotation) for a rect (w, h) rotated by θ is
    // (|w·cosθ| + |h·sinθ|) × (|w·sinθ| + |h·cosθ|). For θ = 90° that
    // simplifies to (h × w). The group's `ext` is (1827900, 1404064)
    // EMU — the post-import visual width and height must match.
    const visualW = Math.abs(world.h);
    const visualH = Math.abs(world.w);
    expect(visualW).toBeCloseTo(1827900 * SCALE.sx, 6);
    expect(visualH).toBeCloseTo(1404064 * SCALE.sy, 6);

    // Centre still lands at the group centre.
    expect(world.x + world.w / 2).toBeCloseTo(
      (4084750 + 1827900 / 2) * SCALE.sx,
      6,
    );
    expect(world.y + world.h / 2).toBeCloseTo(
      (2000661 + 1404064 / 2) * SCALE.sy,
      6,
    );
    expect(world.rotation).toBeCloseTo(Math.PI / 2, 9);
  });

  it('preserves the visual bbox for an off-axis rotation under non-uniform scale', () => {
    // Non-axis-aligned rotation actually exercises the general 2×2
    // solver (the 90° case is degenerate — cos·sin = 0 — and matches
    // the prior swap-scales behaviour).
    const grp = grpSp(`<p:grpSp>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="1200000" cy="900000"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="1000000" cy="1000000"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:grpSp>`);
    const t = composeGroupTransform(IDENTITY_TRANSFORM, grp, SCALE);

    const theta = Math.PI / 6; // 30°
    const w = 10 * SCALE.sx;
    const h = 10 * SCALE.sy;
    const child = { x: 0, y: 0, w, h, rotation: theta };
    const world = applyGroupTransform(child, t);

    // Group's per-axis scale is (1.2, 0.9). The visual bbox of the
    // rotated rectangle pre-transform is (w·cos + h·sin, w·sin + h·cos);
    // post-transform it should be that scaled per-axis.
    const cosA = Math.cos(theta);
    const sinA = Math.sin(theta);
    const expectedVisualW = (w * cosA + h * sinA) * 1.2;
    const expectedVisualH = (w * sinA + h * cosA) * 0.9;
    const actualVisualW = world.w * cosA + world.h * sinA;
    const actualVisualH = world.w * sinA + world.h * cosA;
    expect(actualVisualW).toBeCloseTo(expectedVisualW, 6);
    expect(actualVisualH).toBeCloseTo(expectedVisualH, 6);
    expect(world.w).toBeGreaterThan(0);
    expect(world.h).toBeGreaterThan(0);
  });

  it('falls back to per-axis scaling when the solver would produce a negative side', () => {
    // For sufficiently aspect-mismatched scale at off-axis rotations,
    // the closed-form solution turns negative — no axis-aligned
    // rectangle satisfies both visual extents under that scale + θ
    // combo. Fallback: scale unrotated dims, which is no-worse-than
    // the pre-fix behaviour for this degenerate case.
    const grp = grpSp(`<p:grpSp>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="1000000" cy="2000000"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="1000000" cy="1000000"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:grpSp>`);
    const t = composeGroupTransform(IDENTITY_TRANSFORM, grp, SCALE);

    const child = {
      x: 0,
      y: 0,
      w: 10 * SCALE.sx,
      h: 20 * SCALE.sy,
      rotation: Math.PI / 6,
    };
    const world = applyGroupTransform(child, t);

    // scaleX = 1, scaleY = 2 → fallback path: w' = w·scaleX, h' = h·scaleY.
    expect(world.w).toBeCloseTo(10 * SCALE.sx * 1, 6);
    expect(world.h).toBeCloseTo(20 * SCALE.sy * 2, 6);
  });

  it('composes nested rotated groups via full matrix multiplication', () => {
    // Outer group rotated 90° around (1000, 1000):
    //   any local point (lx, ly) → (1000 + (1000 - ly), 1000 + (lx - 1000))
    //   i.e. (2000 - ly, lx)
    // Inner group sits at (1100, 1000) (east of the outer's pivot),
    // rotated by another 90°. After outer rotation, the inner's center
    // lands at world (1000, 1100) → south of the outer pivot.
    // Then the inner's 90° spins its own children around that location.
    const outer = grpSp(`<p:grpSp>
      <p:grpSpPr>
        <a:xfrm rot="5400000">
          <a:off x="900" y="900"/>
          <a:ext cx="200" cy="200"/>
          <a:chOff x="900" y="900"/>
          <a:chExt cx="200" cy="200"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:grpSp>`);
    const inner = grpSp(`<p:grpSp>
      <p:grpSpPr>
        <a:xfrm rot="5400000">
          <a:off x="1090" y="990"/>
          <a:ext cx="20" cy="20"/>
          <a:chOff x="1090" y="990"/>
          <a:chExt cx="20" cy="20"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:grpSp>`);
    const tOuter = composeGroupTransform(IDENTITY_TRANSFORM, outer, SCALE);
    const tInner = composeGroupTransform(tOuter, inner, SCALE);

    // A point at the inner group's own center, in inner-local coords.
    const localCenterX = 1100 * SCALE.sx;
    const localCenterY = 1000 * SCALE.sy;
    const child = {
      x: localCenterX - 5,
      y: localCenterY - 5,
      w: 10,
      h: 10,
      rotation: 0,
    };
    const world = applyGroupTransform(child, tInner);

    // Inner's own center, after outer's 90° spin, lands at the outer
    // pivot's south point: world (1000 * sx, 1100 * sy).
    expect(world.x + world.w / 2).toBeCloseTo(1000 * SCALE.sx, 6);
    expect(world.y + world.h / 2).toBeCloseTo(1100 * SCALE.sy, 6);
    // Cumulative rotation = outer + inner = 180°.
    expect(world.rotation).toBeCloseTo(Math.PI, 6);
  });
});
