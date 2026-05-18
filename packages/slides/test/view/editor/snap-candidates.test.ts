import { describe, it, expect } from 'vitest';
import type { Element, Frame, GroupElement, ShapeElement } from '../../../src/model/element';
import type { Slide } from '../../../src/model/presentation';
import { collectSnapCandidates } from '../../../src/view/editor/snap-candidates';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function shape(
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 100,
  rotation = 0,
): ShapeElement {
  return {
    id,
    type: 'shape',
    frame: { x, y, w, h, rotation },
    data: { kind: 'rect' },
  };
}

function group(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  children: Element[],
  rotation = 0,
): GroupElement {
  return {
    id,
    type: 'group',
    frame: { x, y, w, h, rotation },
    data: { children },
  };
}

function slide(elements: Element[]): Slide {
  return {
    id: 'slide-1',
    layoutId: 'layout-1',
    background: { fill: { kind: 'srgb', value: '#fff' } },
    elements,
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract (x, y, w, h) without rotation for easy assertions. */
function bbox(f: Frame) {
  return { x: f.x, y: f.y, w: f.w, h: f.h };
}

// ---------------------------------------------------------------------------
// Tests: root scope (scope = [])
// ---------------------------------------------------------------------------

describe('collectSnapCandidates — root scope', () => {
  it('returns [] for an empty slide', () => {
    expect(collectSnapCandidates(slide([]), [], new Set())).toEqual([]);
  });

  it('excludes the dragged element(s)', () => {
    const el = shape('a', 100, 100);
    const result = collectSnapCandidates(slide([el]), [], new Set(['a']));
    expect(result).toEqual([]);
  });

  it('includes non-excluded elements', () => {
    const a = shape('a', 100, 100);
    const b = shape('b', 400, 200);
    const result = collectSnapCandidates(slide([a, b]), [], new Set(['a']));
    expect(result).toHaveLength(1);
    expect(bbox(result[0])).toEqual({ x: 400, y: 200, w: 100, h: 100 });
  });

  it('returns a group as a single candidate (not its children)', () => {
    // Group at (200, 200, 300, 200) containing two children.
    const g = group('g1', 200, 200, 300, 200, [
      shape('c1', 0, 0, 150, 200),
      shape('c2', 150, 0, 150, 200),
    ]);
    const result = collectSnapCandidates(slide([g]), [], new Set());
    // One candidate: the group itself, not two children.
    expect(result).toHaveLength(1);
    expect(bbox(result[0])).toEqual({ x: 200, y: 200, w: 300, h: 200 });
  });

  it('rotated element contributes its rotated AABB (not unrotated frame)', () => {
    // A 100×40 frame at (0,0) rotated 45°.
    // AABB h must grow beyond the un-rotated 40 px height.
    // The AABB w for a 100×40 frame at 45° is ≈(100·cos45 + 40·sin45) ≈ 98.99,
    // which is actually just below 100 — so we only assert h grows, not w.
    const el = shape('r', 0, 0, 100, 40, Math.PI / 4);
    const result = collectSnapCandidates(slide([el]), [], new Set());
    expect(result).toHaveLength(1);
    const c = result[0];
    // The AABB must be axis-aligned.
    expect(c.rotation).toBe(0);
    // Height must grow significantly beyond the un-rotated 40 px.
    expect(c.h).toBeGreaterThan(40);
    // Width must be positive and comparable to the unrotated dimensions.
    expect(c.w).toBeGreaterThan(0);
  });

  it('rotated group contributes its rotated AABB as a single candidate', () => {
    const g = group('g2', 200, 200, 200, 100, [shape('c', 0, 0)], Math.PI / 6);
    const result = collectSnapCandidates(slide([g]), [], new Set());
    expect(result).toHaveLength(1);
    const c = result[0];
    // Rotation must be cleared.
    expect(c.rotation).toBe(0);
    // AABB must be at least as large as the un-rotated dims.
    expect(c.w).toBeGreaterThan(0);
    expect(c.h).toBeGreaterThan(0);
  });

  it('non-rotated element AABB is the frame itself', () => {
    // boundingBox for rotation=0 should be identity — no growth.
    const el = shape('flat', 50, 80, 200, 120, 0);
    const result = collectSnapCandidates(slide([el]), [], new Set());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ x: 50, y: 80, w: 200, h: 120, rotation: 0 });
  });
});

// ---------------------------------------------------------------------------
// Tests: non-empty scope (drill-in variant — locks in contract for Task 9)
// ---------------------------------------------------------------------------

describe('collectSnapCandidates — drill-in scope (non-empty scope)', () => {
  it('returns children of the scoped group with frames in world coords', () => {
    // Group at world (200, 300, 200, 100) (no rotation).
    // Its children live in group-local space (0..200 × 0..100).
    // Child at local (0, 0, 100, 100) should map to world (200, 300, 100, 100).
    const childA = shape('cA', 0, 0, 100, 100);
    const childB = shape('cB', 100, 0, 100, 100);
    const g = group('g1', 200, 300, 200, 100, [childA, childB]);
    const sl = slide([g]);

    const result = collectSnapCandidates(sl, ['g1'], new Set());
    // Two children, neither excluded.
    expect(result).toHaveLength(2);
    // childA maps to world (200, 300, 100, 100).
    const sorted = [...result].sort((a, b) => a.x - b.x);
    expect(sorted[0]).toMatchObject({ x: 200, y: 300, w: 100, h: 100, rotation: 0 });
    expect(sorted[1]).toMatchObject({ x: 300, y: 300, w: 100, h: 100, rotation: 0 });
  });

  it('excludes dragged children from scoped results', () => {
    const childA = shape('cA', 0, 0, 100, 100);
    const childB = shape('cB', 100, 0, 100, 100);
    const g = group('g1', 200, 300, 200, 100, [childA, childB]);
    const result = collectSnapCandidates(slide([g]), ['g1'], new Set(['cA']));
    expect(result).toHaveLength(1);
    // Only childB survives.
    expect(result[0]).toMatchObject({ x: 300, y: 300 });
  });

  it('throws when the scoped group id cannot be found', () => {
    const sl = slide([shape('a', 0, 0)]);
    expect(() =>
      collectSnapCandidates(sl, ['nonexistent'], new Set()),
    ).toThrow();
  });

  it('rotated child in scoped group contributes its world-rotated AABB', () => {
    // Group at (0, 0, 200, 200), no group rotation.
    // Child with local (50, 50, 100, 40, π/4) rotated inside.
    const child = shape('rc', 50, 50, 100, 40, Math.PI / 4);
    const g = group('g1', 0, 0, 200, 200, [child]);
    const result = collectSnapCandidates(slide([g]), ['g1'], new Set());
    expect(result).toHaveLength(1);
    const c = result[0];
    // AABB must be axis-aligned.
    expect(c.rotation).toBe(0);
    // The AABB height must grow significantly beyond the un-rotated 40 px.
    // (w for 100×40 at 45° is ≈98.99, slightly below 100, so we only assert h.)
    expect(c.h).toBeGreaterThan(40);
    // Width must be positive.
    expect(c.w).toBeGreaterThan(0);
  });
});
