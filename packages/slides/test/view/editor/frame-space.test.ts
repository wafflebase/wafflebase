import { describe, expect, it } from 'vitest';
import {
  scopeAncestorTransform,
  toWorldFrame,
  fromWorldFrame,
} from '../../../src/view/editor/frame-space';
import type { Slide } from '../../../src/model/presentation';
import type { GroupElement, ShapeElement } from '../../../src/model/element';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shape(id: string, frame: { x: number; y: number; w: number; h: number; rotation?: number }): ShapeElement {
  return { id, type: 'shape', frame: { rotation: 0, ...frame }, data: { kind: 'rect' } };
}

function group(
  id: string,
  frame: { x: number; y: number; w: number; h: number; rotation?: number },
  children: Array<ShapeElement | GroupElement>,
): GroupElement {
  return { id, type: 'group', frame: { rotation: 0, ...frame }, data: { children } };
}

function slide(elements: Slide['elements']): Slide {
  return {
    id: 'sl',
    layoutId: 'blank',
    background: { fill: { kind: 'srgb' as const, value: '#fff' } },
    elements,
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// scopeAncestorTransform
// ---------------------------------------------------------------------------

describe('scopeAncestorTransform', () => {
  it('empty scope returns identity transform', () => {
    const sl = slide([]);
    const t = scopeAncestorTransform(sl, []);
    expect(t.a).toBe(1);
    expect(t.b).toBe(0);
    expect(t.c).toBe(0);
    expect(t.d).toBe(1);
    expect(t.tx).toBe(0);
    expect(t.ty).toBe(0);
    expect(t.rotation).toBe(0);
  });

  it('one-level scope returns the group transform', () => {
    const g = group('g', { x: 100, y: 200, w: 300, h: 400 }, []);
    const sl = slide([g]);
    const t = scopeAncestorTransform(sl, ['g']);
    // For a non-rotated group at (100, 200), the transform should
    // translate by (100, 200) — child origin (0,0) maps to (100, 200).
    expect(t.tx).toBeCloseTo(100, 5);
    expect(t.ty).toBeCloseTo(200, 5);
    expect(t.rotation).toBe(0);
  });

  it('two-level scope composes outer + inner transforms', () => {
    const inner = group('inner', { x: 50, y: 50, w: 100, h: 100 }, []);
    const outer = group('outer', { x: 100, y: 100, w: 200, h: 200 }, [inner]);
    const sl = slide([outer]);
    const t = scopeAncestorTransform(sl, ['outer', 'inner']);
    // outer at (100,100) then inner at (50,50) local → world (150, 150).
    expect(t.tx).toBeCloseTo(150, 5);
    expect(t.ty).toBeCloseTo(150, 5);
  });

  it('throws on unknown scope id', () => {
    const sl = slide([]);
    expect(() => scopeAncestorTransform(sl, ['nope'])).toThrow();
  });

  it('throws when scope id is not a group element', () => {
    const s = shape('s1', { x: 0, y: 0, w: 100, h: 100 });
    const sl = slide([s]);
    expect(() => scopeAncestorTransform(sl, ['s1'])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// toWorldFrame / fromWorldFrame
// ---------------------------------------------------------------------------

describe('toWorldFrame / fromWorldFrame', () => {
  it('scope=[] is a no-op (identity round-trip)', () => {
    const sl = slide([]);
    const f = { x: 10, y: 20, w: 50, h: 30, rotation: 0 };
    const world = toWorldFrame(f, [], sl);
    expect(world).toEqual(f);
    const back = fromWorldFrame(world, [], sl);
    expect(back).toEqual(f);
  });

  it('translates frame through a non-rotated group', () => {
    const child = shape('c', { x: 10, y: 20, w: 50, h: 30 });
    const g = group('g', { x: 100, y: 200, w: 400, h: 300 }, [child]);
    const sl = slide([g]);
    const world = toWorldFrame(child.frame, ['g'], sl);
    // group at (100, 200), child local at (10, 20) → world at (110, 220)
    expect(world.x).toBeCloseTo(110, 4);
    expect(world.y).toBeCloseTo(220, 4);
    expect(world.w).toBeCloseTo(50, 4);
    expect(world.h).toBeCloseTo(30, 4);
  });

  it('round-trips local frame through rotated single-level scope', () => {
    const g = group('g', { x: 100, y: 100, w: 200, h: 200, rotation: Math.PI / 4 }, []);
    const sl = slide([g]);
    const local = { x: 30, y: 10, w: 40, h: 20, rotation: 0.5 };
    const world = toWorldFrame(local, ['g'], sl);
    const back = fromWorldFrame(world, ['g'], sl);
    expect(back.x).toBeCloseTo(local.x, 3);
    expect(back.y).toBeCloseTo(local.y, 3);
    expect(back.w).toBeCloseTo(local.w, 3);
    expect(back.h).toBeCloseTo(local.h, 3);
    expect(Math.sin(back.rotation)).toBeCloseTo(Math.sin(local.rotation), 3);
    expect(Math.cos(back.rotation)).toBeCloseTo(Math.cos(local.rotation), 3);
  });

  it('round-trips local frame through two-level rotated scope', () => {
    const inner = group('inner', { x: 50, y: 50, w: 100, h: 100, rotation: Math.PI / 6 }, []);
    const outer = group('outer', { x: 100, y: 100, w: 200, h: 200, rotation: Math.PI / 4 }, [inner]);
    const sl = slide([outer]);
    const local = { x: 30, y: 10, w: 40, h: 20, rotation: 0 };
    const world = toWorldFrame(local, ['outer', 'inner'], sl);
    const back = fromWorldFrame(world, ['outer', 'inner'], sl);
    expect(back.x).toBeCloseTo(local.x, 3);
    expect(back.y).toBeCloseTo(local.y, 3);
    expect(back.w).toBeCloseTo(local.w, 3);
    expect(back.h).toBeCloseTo(local.h, 3);
    expect(Math.sin(back.rotation)).toBeCloseTo(Math.sin(local.rotation), 3);
    expect(Math.cos(back.rotation)).toBeCloseTo(Math.cos(local.rotation), 3);
  });

  it('toWorldFrame and fromWorldFrame are mutual inverses for identity scope', () => {
    const sl = slide([]);
    const f = { x: 50, y: 75, w: 100, h: 80, rotation: 1.2 };
    const back = fromWorldFrame(toWorldFrame(f, [], sl), [], sl);
    expect(back.x).toBeCloseTo(f.x, 5);
    expect(back.y).toBeCloseTo(f.y, 5);
    expect(back.w).toBeCloseTo(f.w, 5);
    expect(back.h).toBeCloseTo(f.h, 5);
    expect(Math.sin(back.rotation)).toBeCloseTo(Math.sin(f.rotation), 5);
  });

  it('fromWorldFrame correctly inverts a 90-degree rotation', () => {
    // Group rotated 90° at origin 0,0 (well, center at 50,50, size 100,100).
    const g = group('g', { x: 0, y: 0, w: 100, h: 100, rotation: Math.PI / 2 }, []);
    const sl = slide([g]);
    const local = { x: 10, y: 0, w: 20, h: 20, rotation: 0 };
    const world = toWorldFrame(local, ['g'], sl);
    const back = fromWorldFrame(world, ['g'], sl);
    expect(back.x).toBeCloseTo(local.x, 3);
    expect(back.y).toBeCloseTo(local.y, 3);
    expect(back.w).toBeCloseTo(local.w, 3);
    expect(back.h).toBeCloseTo(local.h, 3);
  });

  it('world frame of center element at scope root matches naive translate', () => {
    // Non-rotated group: world position = local position + group origin.
    const g = group('g', { x: 200, y: 300, w: 400, h: 200 }, []);
    const sl = slide([g]);
    const local = { x: 50, y: 60, w: 80, h: 40, rotation: 0 };
    const world = toWorldFrame(local, ['g'], sl);
    expect(world.x).toBeCloseTo(250, 3); // 200 + 50
    expect(world.y).toBeCloseTo(360, 3); // 300 + 60
    expect(world.w).toBeCloseTo(80, 3);
    expect(world.h).toBeCloseTo(40, 3);
    expect(world.rotation).toBeCloseTo(0, 3);
  });
});
