import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { GroupElement, ShapeElement } from '../../src/model/element';
import {
  applyGroupTransform,
  findElementPath,
  groupToTransform,
  isGroupDescendantOf,
  normalizeToGroupLocal,
} from '../../src/model/group';

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
