import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { GroupElement, ShapeElement } from '../../src/model/element';
import {
  applyGroupTransform,
  applyInverseMatrix,
  applyInversePoint,
  findElementPath,
  groupToTransform,
  isGroupDescendantOf,
  normalizeToGroupLocal,
  worldChildrenAABB,
  worldTightFrame,
} from '../../src/model/group';
import { IDENTITY_GROUP_TRANSFORM } from '../../src/model/group';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function shape(
  id: string,
  frame: { x: number; y: number; w: number; h: number; rotation?: number },
): ShapeElement {
  return {
    id,
    type: 'shape',
    frame: { rotation: 0, ...frame },
    data: { kind: 'rect' },
  };
}

function group(
  id: string,
  frame: { x: number; y: number; w: number; h: number; rotation?: number },
  children: Array<ShapeElement | GroupElement>,
): GroupElement {
  return {
    id,
    type: 'group',
    frame: { rotation: 0, ...frame },
    data: { children },
  };
}

// ---------------------------------------------------------------------------
// 1. applyGroupTransform / normalizeToGroupLocal — round-trips
// ---------------------------------------------------------------------------

describe('applyGroupTransform / normalizeToGroupLocal', () => {
  it('round-trips an axis-aligned group (no rotation)', () => {
    const g = group('g1', { x: 100, y: 50, w: 200, h: 100 }, []);
    const child = { x: 20, y: 10, w: 60, h: 40, rotation: 0 };

    const world = applyGroupTransform(child, g);
    const back = normalizeToGroupLocal(world, g);

    expect(back.x).toBeCloseTo(child.x, 4);
    expect(back.y).toBeCloseTo(child.y, 4);
    expect(back.w).toBeCloseTo(child.w, 4);
    expect(back.h).toBeCloseTo(child.h, 4);
    expect(back.rotation).toBeCloseTo(child.rotation, 4);
  });

  it('round-trips a rotated group (Math.PI/6)', () => {
    const rotation = Math.PI / 6;
    const g = group('g2', { x: 50, y: 50, w: 200, h: 100, rotation }, []);
    const child = { x: 30, y: 20, w: 80, h: 50, rotation: 0 };

    const world = applyGroupTransform(child, g);
    const back = normalizeToGroupLocal(world, g);

    expect(back.x).toBeCloseTo(child.x, 5);
    expect(back.y).toBeCloseTo(child.y, 5);
    expect(back.w).toBeCloseTo(child.w, 5);
    expect(back.h).toBeCloseTo(child.h, 5);
    expect(back.rotation).toBeCloseTo(child.rotation, 5);
  });

  it('translates child origin correctly for an axis-aligned group', () => {
    const g = group('g3', { x: 100, y: 200, w: 300, h: 150 }, []);
    const child = { x: 0, y: 0, w: 50, h: 50, rotation: 0 };

    const world = applyGroupTransform(child, g);

    // child center is at (25, 25) group-local; group origin is at (100, 200).
    // World center = (125, 225), so world frame = (100, 200, 50, 50)
    expect(world.x).toBeCloseTo(100, 4);
    expect(world.y).toBeCloseTo(200, 4);
  });

  it('groupToTransform returns identity-scale (a=1, d=1) for unrotated group', () => {
    const g = group('g4', { x: 10, y: 20, w: 100, h: 60 }, []);
    const t = groupToTransform(g);
    expect(t.a).toBeCloseTo(1, 6);
    expect(t.d).toBeCloseTo(1, 6);
    expect(t.b).toBeCloseTo(0, 6);
    expect(t.c).toBeCloseTo(0, 6);
    expect(t.tx).toBeCloseTo(10, 6);
    expect(t.ty).toBeCloseTo(20, 6);
  });
});

// ---------------------------------------------------------------------------
// 2. findElementPath
// ---------------------------------------------------------------------------

describe('findElementPath', () => {
  it('returns [el] for a single slide-root element', () => {
    const s = shape('s1', { x: 0, y: 0, w: 10, h: 10 });
    const path = findElementPath([s], 's1');
    expect(path).toEqual([s]);
  });

  it('returns full chain for a deeply nested element (group-group-leaf)', () => {
    const leaf = shape('leaf', { x: 5, y: 5, w: 20, h: 20 });
    const inner = group('inner', { x: 0, y: 0, w: 50, h: 50 }, [leaf]);
    const outer = group('outer', { x: 0, y: 0, w: 100, h: 100 }, [inner]);

    const path = findElementPath([outer], 'leaf');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.id)).toEqual(['outer', 'inner', 'leaf']);
  });

  it('returns null when the id is not present', () => {
    const s = shape('s1', { x: 0, y: 0, w: 10, h: 10 });
    const g = group('g1', { x: 0, y: 0, w: 50, h: 50 }, [s]);
    const path = findElementPath([g], 'missing');
    expect(path).toBeNull();
  });

  it('returns [group] when searching for the group itself at root', () => {
    const g = group('g1', { x: 0, y: 0, w: 50, h: 50 }, [
      shape('s1', { x: 0, y: 0, w: 10, h: 10 }),
    ]);
    const path = findElementPath([g], 'g1');
    expect(path).toEqual([g]);
  });
});

// ---------------------------------------------------------------------------
// 3. isGroupDescendantOf
// ---------------------------------------------------------------------------

describe('isGroupDescendantOf', () => {
  it('detects self', () => {
    const g = group('g1', { x: 0, y: 0, w: 50, h: 50 }, []);
    expect(isGroupDescendantOf(g, g)).toBe(true);
  });

  it('detects direct group child', () => {
    const inner = group('inner', { x: 0, y: 0, w: 50, h: 50 }, []);
    const outer = group('outer', { x: 0, y: 0, w: 100, h: 100 }, [inner]);
    expect(isGroupDescendantOf(outer, inner)).toBe(true);
  });

  it('detects descendant across nesting', () => {
    const inner = group('inner', { x: 0, y: 0, w: 30, h: 30 }, []);
    const outer = group('outer', { x: 0, y: 0, w: 100, h: 100 }, [inner]);
    expect(isGroupDescendantOf(outer, inner)).toBe(true);
  });

  it('returns false for sibling groups', () => {
    const g1 = group('g1', { x: 0, y: 0, w: 50, h: 50 }, []);
    const g2 = group('g2', { x: 60, y: 0, w: 50, h: 50 }, []);
    expect(isGroupDescendantOf(g1, g2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Property test — round-trip for random group frames and child frames
// ---------------------------------------------------------------------------

describe('round-trip property test (fast-check)', () => {
  it('child frame survives apply→normalize for any valid group and child (200 runs)', () => {
    // Arbitrary positive dimension (values must be 32-bit floats for fc.float)
    const posNum = fc.float({ min: Math.fround(1), max: Math.fround(1000), noNaN: true });
    // Reasonable coordinate range
    const coord = fc.float({ min: Math.fround(-500), max: Math.fround(500), noNaN: true });
    // Rotation in (-π, π) using double arithmetic, then use fc.double instead
    const rot = fc.double({ min: -Math.PI + 0.01, max: Math.PI - 0.01, noNaN: true });

    const frameArb = fc.record({
      x: coord,
      y: coord,
      w: posNum,
      h: posNum,
      rotation: rot,
    });

    fc.assert(
      fc.property(frameArb, frameArb, (groupFrame, childFrame) => {
        const g = group('g', groupFrame, []);
        const world = applyGroupTransform(childFrame, g);
        const back = normalizeToGroupLocal(world, g);

        expect(back.x).toBeCloseTo(childFrame.x, 3);
        expect(back.y).toBeCloseTo(childFrame.y, 3);
        expect(back.w).toBeCloseTo(childFrame.w, 3);
        expect(back.h).toBeCloseTo(childFrame.h, 3);
        // Rotation: compare mod 2π to handle wrapping
        const diff = Math.abs(back.rotation - childFrame.rotation) % (2 * Math.PI);
        expect(Math.min(diff, 2 * Math.PI - diff)).toBeLessThan(1e-3);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. groupToTransform — refSize scaling
// ---------------------------------------------------------------------------

describe('groupToTransform — refSize scaling', () => {
  it('scale = 1 when frame.w/h matches refSize (unrotated)', () => {
    const g = group('g', { x: 100, y: 100, w: 200, h: 100 }, []);
    g.data.refSize = { w: 200, h: 100 };
    const t = groupToTransform(g);
    expect(t.a).toBeCloseTo(1, 6);
    expect(t.d).toBeCloseTo(1, 6);
    expect(t.b).toBeCloseTo(0, 6);
    expect(t.c).toBeCloseTo(0, 6);
    expect(t.tx).toBeCloseTo(100, 6);
    expect(t.ty).toBeCloseTo(100, 6);
  });

  it('scale doubles along X when frame.w doubles relative to refSize.w', () => {
    const g = group('g', { x: 0, y: 0, w: 400, h: 100 }, []);
    g.data.refSize = { w: 200, h: 100 };
    const t = groupToTransform(g);
    expect(t.a).toBeCloseTo(2, 6);
    expect(t.d).toBeCloseTo(1, 6);
  });

  it('fallback: refSize undefined → scale = 1, identical to prior behavior', () => {
    const g = group('g', { x: 100, y: 100, w: 200, h: 100 }, []);
    // No refSize set.
    const t = groupToTransform(g);
    expect(t.a).toBeCloseTo(1, 6);
    expect(t.d).toBeCloseTo(1, 6);
    expect(t.tx).toBeCloseTo(100, 6);
    expect(t.ty).toBeCloseTo(100, 6);
  });

  it('rotation-only (scale=1) produces the same matrix as before refSize was added', () => {
    const rotation = Math.PI / 4;
    const g = group('g', { x: 50, y: 50, w: 200, h: 100, rotation }, []);
    g.data.refSize = { w: 200, h: 100 };
    const t = groupToTransform(g);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    // Pure rotation matrix around the group center.
    expect(t.a).toBeCloseTo(cos, 6);
    expect(t.b).toBeCloseTo(sin, 6);
    expect(t.c).toBeCloseTo(-sin, 6);
    expect(t.d).toBeCloseTo(cos, 6);
    // tx / ty via the original closed-form: x + (w/2)*(1-cos) + (h/2)*sin
    const expectedTx = 50 + 100 * (1 - cos) + 50 * sin;
    const expectedTy = 50 + 50 * (1 - cos) - 100 * sin;
    expect(t.tx).toBeCloseTo(expectedTx, 5);
    expect(t.ty).toBeCloseTo(expectedTy, 5);
  });
});

// ---------------------------------------------------------------------------
// M2. applyInverseMatrix / applyInversePoint — singular guard
// ---------------------------------------------------------------------------

describe('applyInverseMatrix / applyInversePoint — singular guard', () => {
  it('applyInverseMatrix throws on a zero-width (singular) transform', () => {
    // A transform built from a group with w=0 has a=0, so det=0.
    const singularTransform = { ...IDENTITY_GROUP_TRANSFORM, a: 0, d: 0 };
    const frame = { x: 10, y: 10, w: 50, h: 50, rotation: 0 };
    expect(() => applyInverseMatrix(frame, singularTransform)).toThrow(
      'cannot invert singular group transform',
    );
  });

  it('applyInversePoint throws on a singular transform', () => {
    const singularTransform = { ...IDENTITY_GROUP_TRANSFORM, a: 0, d: 0 };
    expect(() => applyInversePoint(10, 20, singularTransform)).toThrow(
      'cannot invert singular group transform',
    );
  });

  it('applyInverseMatrix succeeds for a valid (non-singular) transform', () => {
    const t = { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 50, rotation: 0 };
    const frame = { x: 110, y: 60, w: 50, h: 50, rotation: 0 };
    const result = applyInverseMatrix(frame, t);
    expect(result.x).toBeCloseTo(10, 5);
    expect(result.y).toBeCloseTo(10, 5);
  });

  it('applyInversePoint succeeds for a valid (non-singular) transform', () => {
    const t = { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 50, rotation: 0 };
    const result = applyInversePoint(110, 60, t);
    expect(result.x).toBeCloseTo(10, 5);
    expect(result.y).toBeCloseTo(10, 5);
  });
});

// ---------------------------------------------------------------------------
// 6. applyGroupTransform — resize semantics
// ---------------------------------------------------------------------------

describe('applyGroupTransform — resize semantics', () => {
  it('child scales proportionally when group.frame.w doubles (unrotated)', () => {
    const g = group('g', { x: 0, y: 0, w: 200, h: 100 }, []);
    g.data.refSize = { w: 200, h: 100 };
    const child = { x: 50, y: 25, w: 100, h: 50, rotation: 0 };
    const before = applyGroupTransform(child, g);

    // Resize: double the width.
    g.frame.w = 400;
    const after = applyGroupTransform(child, g);

    // x and w should double; y and h should be unchanged.
    expect(after.x).toBeCloseTo(before.x * 2, 4);
    expect(after.w).toBeCloseTo(before.w * 2, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
    expect(after.h).toBeCloseTo(before.h, 4);
  });

  it('no change in child world frame when group frame equals refSize', () => {
    const g = group('g', { x: 10, y: 20, w: 200, h: 100 }, []);
    g.data.refSize = { w: 200, h: 100 };
    const child = { x: 30, y: 10, w: 80, h: 40, rotation: 0 };
    const world = applyGroupTransform(child, g);
    // Child at local (30, 10) → world (10+30, 20+10) = (40, 30)
    expect(world.x).toBeCloseTo(40, 4);
    expect(world.y).toBeCloseTo(30, 4);
    expect(world.w).toBeCloseTo(80, 4);
    expect(world.h).toBeCloseTo(40, 4);
  });
});

// ---------------------------------------------------------------------------
// 6. worldChildrenAABB — used by the editor overlay so selection handles
// stay tight around the children's current visual extent even after a
// child was moved inside drill-in (group.frame goes stale).
// ---------------------------------------------------------------------------

describe('worldChildrenAABB', () => {
  it('returns the AABB of two axis-aligned children in an identity group', () => {
    // Group at origin, scale 1 — children's local frames map to world 1:1.
    const g = group('g', { x: 0, y: 0, w: 100, h: 100 }, [
      shape('a', { x: 0, y: 0, w: 40, h: 30 }),
      shape('b', { x: 60, y: 60, w: 40, h: 40 }),
    ]);
    g.data.refSize = { w: 100, h: 100 };

    const aabb = worldChildrenAABB(g);
    expect(aabb.x).toBeCloseTo(0, 4);
    expect(aabb.y).toBeCloseTo(0, 4);
    expect(aabb.w).toBeCloseTo(100, 4);
    expect(aabb.h).toBeCloseTo(100, 4);
    expect(aabb.rotation).toBe(0);
  });

  it('expands past group.frame when a child moves outside the original bounds', () => {
    // group.frame = (0,0,100,100), but child b sits at (60, 110) — outside.
    // The dynamic AABB must reach to 150x150, not stay at 100x100.
    const g = group('g', { x: 0, y: 0, w: 100, h: 100 }, [
      shape('a', { x: 0, y: 0, w: 40, h: 30 }),
      shape('b', { x: 60, y: 110, w: 40, h: 40 }),
    ]);
    g.data.refSize = { w: 100, h: 100 };

    const aabb = worldChildrenAABB(g);
    expect(aabb.x).toBeCloseTo(0, 4);
    expect(aabb.y).toBeCloseTo(0, 4);
    expect(aabb.w).toBeCloseTo(100, 4);
    expect(aabb.h).toBeCloseTo(150, 4);
  });

  it('accounts for a rotated child (its world bbox is larger than its frame)', () => {
    // A 100×20 rectangle rotated 90° has a 20×100 axis-aligned bbox.
    const g = group('g', { x: 0, y: 0, w: 200, h: 200 }, [
      shape('a', { x: 50, y: 90, w: 100, h: 20, rotation: Math.PI / 2 }),
    ]);
    g.data.refSize = { w: 200, h: 200 };

    const aabb = worldChildrenAABB(g);
    // 100×20 rotated 90° around its centre (100, 100) → bbox (90, 50)–(110, 150).
    expect(aabb.x).toBeCloseTo(90, 4);
    expect(aabb.y).toBeCloseTo(50, 4);
    expect(aabb.w).toBeCloseTo(20, 4);
    expect(aabb.h).toBeCloseTo(100, 4);
  });

  it('recurses into nested groups', () => {
    // Inner group at local (50, 50, 50x50) with a single 40x40 child at (5, 5).
    // Outer group is identity scale at origin.
    const inner = group('inner', { x: 50, y: 50, w: 50, h: 50 }, [
      shape('c', { x: 5, y: 5, w: 40, h: 40 }),
    ]);
    inner.data.refSize = { w: 50, h: 50 };

    const outer = group('outer', { x: 0, y: 0, w: 100, h: 100 }, [
      shape('a', { x: 0, y: 0, w: 20, h: 20 }),
      inner,
    ]);
    outer.data.refSize = { w: 100, h: 100 };

    // Outer leaves at world space:
    //   a: (0, 0, 20, 20)
    //   c (via inner): inner translates by (50, 50), so c lands at (55, 55, 40, 40).
    // AABB: (0, 0, 95, 95).
    const aabb = worldChildrenAABB(outer);
    expect(aabb.x).toBeCloseTo(0, 4);
    expect(aabb.y).toBeCloseTo(0, 4);
    expect(aabb.w).toBeCloseTo(95, 4);
    expect(aabb.h).toBeCloseTo(95, 4);
  });

  it('falls back to group.frame bbox when children are empty', () => {
    const g = group('g', { x: 10, y: 20, w: 30, h: 40 }, []);
    const aabb = worldChildrenAABB(g);
    expect(aabb.x).toBeCloseTo(10, 4);
    expect(aabb.y).toBeCloseTo(20, 4);
    expect(aabb.w).toBeCloseTo(30, 4);
    expect(aabb.h).toBeCloseTo(40, 4);
  });
});

// ---------------------------------------------------------------------------
// 7. worldTightFrame — rotation-preserving tight frame for selection overlay
//    and refit math. Children's world positions stay invariant when the
//    group's frame is swapped to `worldFrame` AND each child's local frame
//    is shifted by `-localShift`.
// ---------------------------------------------------------------------------

describe('worldTightFrame', () => {
  it('returns the existing frame when children fit tightly at the local origin', () => {
    const g = group('g', { x: 10, y: 20, w: 100, h: 100 }, [
      shape('a', { x: 0, y: 0, w: 40, h: 30 }),
      shape('b', { x: 60, y: 60, w: 40, h: 40 }),
    ]);
    g.data.refSize = { w: 100, h: 100 };
    const { worldFrame, localShift, newRefSize } = worldTightFrame(g);
    expect(worldFrame.x).toBeCloseTo(10, 4);
    expect(worldFrame.y).toBeCloseTo(20, 4);
    expect(worldFrame.w).toBeCloseTo(100, 4);
    expect(worldFrame.h).toBeCloseTo(100, 4);
    expect(worldFrame.rotation).toBe(0);
    expect(localShift).toEqual({ x: 0, y: 0 });
    expect(newRefSize).toEqual({ w: 100, h: 100 });
  });

  it('preserves rotation when a child moved past the original refSize', () => {
    // Rotated group (π/6) at world center (140, 130); refSize (80, 60).
    // Move child b to local (-20, -10, 40, 30) — local AABB grows past
    // the refSize bounds.
    const rotation = Math.PI / 6;
    const g = group(
      'g',
      { x: 100, y: 100, w: 80, h: 60, rotation },
      [
        shape('a', { x: 40, y: 30, w: 40, h: 30 }),
        shape('b', { x: -20, y: -10, w: 40, h: 30 }),
      ],
    );
    g.data.refSize = { w: 80, h: 60 };

    // Capture each child's world position via the OLD group transform.
    const aWorldBefore = applyGroupTransform(g.data.children[0].frame, g);
    const bWorldBefore = applyGroupTransform(g.data.children[1].frame, g);

    const { worldFrame, localShift, newRefSize } = worldTightFrame(g);

    // Rotation preserved.
    expect(worldFrame.rotation).toBeCloseTo(rotation, 6);
    // Local shift matches the children's local min corner.
    expect(localShift.x).toBeCloseTo(-20, 4);
    expect(localShift.y).toBeCloseTo(-10, 4);
    // refSize matches the tight local extent.
    expect(newRefSize.w).toBeCloseTo(100, 4); // -20..80 = 100 wide
    expect(newRefSize.h).toBeCloseTo(70, 4);  // -10..60 = 70 tall

    // After applying the new group state, each child's world position
    // stays invariant. We simulate refit on a temporary group: same
    // `worldFrame`, new refSize, children shifted by -localShift.
    const newGroup: typeof g = {
      ...g,
      frame: { ...worldFrame },
      data: {
        ...g.data,
        refSize: { ...newRefSize },
        children: g.data.children.map((ch) => ({
          ...ch,
          frame: {
            ...ch.frame,
            x: ch.frame.x - localShift.x,
            y: ch.frame.y - localShift.y,
          },
        })),
      },
    };
    const aWorldAfter = applyGroupTransform(newGroup.data.children[0].frame, newGroup);
    const bWorldAfter = applyGroupTransform(newGroup.data.children[1].frame, newGroup);

    expect(aWorldAfter.x).toBeCloseTo(aWorldBefore.x, 3);
    expect(aWorldAfter.y).toBeCloseTo(aWorldBefore.y, 3);
    expect(aWorldAfter.w).toBeCloseTo(aWorldBefore.w, 3);
    expect(aWorldAfter.h).toBeCloseTo(aWorldBefore.h, 3);
    expect(bWorldAfter.x).toBeCloseTo(bWorldBefore.x, 3);
    expect(bWorldAfter.y).toBeCloseTo(bWorldBefore.y, 3);
  });
});
