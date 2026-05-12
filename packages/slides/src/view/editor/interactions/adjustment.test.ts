import { describe, it, expect } from 'vitest';
import {
  adjustmentLocalToWorld,
  adjustmentWorldToLocal,
  defaultAdjustmentsFor,
  formatAdjustments,
  snapToDefaults,
} from './adjustment';
import { STAR_5_HANDLES } from '../../canvas/shapes/stars/star5';
import type { AdjustmentSpec } from '../../canvas/shapes/builder';

describe('defaultAdjustmentsFor', () => {
  it('returns the spec defaults for a registered kind', () => {
    expect(defaultAdjustmentsFor('roundRect')).toEqual([16667]);
    expect(defaultAdjustmentsFor('star5')).toEqual([19098]);
    expect(defaultAdjustmentsFor('wedgeRectCallout')).toEqual([-20833, 62500]);
  });

  it('returns [] for an unregistered kind', () => {
    expect(defaultAdjustmentsFor('rect')).toEqual([]);
  });
});

describe('snapToDefaults', () => {
  it('snaps when each adjustment is within 5% of (max - min) of default', () => {
    // roundRect default 16667, range 0..50000 → 5% = 2500
    expect(snapToDefaults('roundRect', [16000])).toEqual([16667]);
    expect(snapToDefaults('roundRect', [18000])).toEqual([16667]);
  });

  it('does not snap when farther than 5%', () => {
    expect(snapToDefaults('roundRect', [25000])).toEqual([25000]);
  });

  it('all adjustments must qualify (multi-index)', () => {
    // wedgeRectCallout defaults [-20833, 62500], ranges 200000 each → 5% = 10000
    // both close → snap
    expect(snapToDefaults('wedgeRectCallout', [-22000, 60000])).toEqual([-20833, 62500]);
    // first close, second far → no snap
    expect(snapToDefaults('wedgeRectCallout', [-22000, 0])).toEqual([-22000, 0]);
  });

  it('returns input unchanged for unregistered kind', () => {
    expect(snapToDefaults('rect', [42])).toEqual([42]);
  });
});

describe('adjustmentLocalToWorld / adjustmentWorldToLocal', () => {
  it('round-trip identity for rotation = 0 (axis-aligned frame)', () => {
    const frame = { x: 100, y: 50, w: 200, h: 100, rotation: 0 };
    const local = { x: 17, y: 13 };
    const world = adjustmentLocalToWorld(frame, local);
    const back = adjustmentWorldToLocal(frame, world);
    expect(back.x).toBeCloseTo(local.x, 6);
    expect(back.y).toBeCloseTo(local.y, 6);
  });

  it('rotation = 0 places local origin at the frame top-left in world coords', () => {
    const frame = { x: 100, y: 50, w: 200, h: 100, rotation: 0 };
    const topLeft = adjustmentLocalToWorld(frame, { x: 0, y: 0 });
    expect(topLeft).toEqual({ x: 100, y: 50 });
  });

  it('round-trip identity for rotation = 30° on a non-square frame', () => {
    const frame = { x: 100, y: 50, w: 200, h: 100, rotation: Math.PI / 6 };
    const samples = [
      { x: 0, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 50 }, // local center maps to world center
      { x: 25.4, y: 73.1 },
    ];
    for (const local of samples) {
      const world = adjustmentLocalToWorld(frame, local);
      const back = adjustmentWorldToLocal(frame, world);
      expect(back.x).toBeCloseTo(local.x, 6);
      expect(back.y).toBeCloseTo(local.y, 6);
    }
  });

  it('rotation = 90° rotates the local +X axis to the world +Y axis', () => {
    const frame = { x: 0, y: 0, w: 100, h: 50, rotation: Math.PI / 2 };
    // Local (w, h/2) is the right-middle edge. At 90° rotation around
    // the frame's center, the right edge maps to the bottom edge.
    const world = adjustmentLocalToWorld(frame, { x: 100, y: 25 });
    // Center is (50, 25). dx = 50, dy = 0. After 90° rotation:
    // world.x = cx + dx*cos90 - dy*sin90 = 50 + 0 - 0 = 50
    // world.y = cy + dx*sin90 + dy*cos90 = 25 + 50 + 0 = 75
    expect(world.x).toBeCloseTo(50, 6);
    expect(world.y).toBeCloseTo(75, 6);
  });

  it('star5 handle: paint-side world ↔ hit-test inverse round-trip on a 30°-rotated frame', () => {
    // Regression guard for the paint/hit-test divergence risk called
    // out in slides-shapes-p3a-adjustments.md §Risks. The star handle
    // position is computed in element-local coords; the overlay paints
    // it via adjustmentLocalToWorld; the drag loop inverse-transforms
    // pointer events via adjustmentWorldToLocal. A drift in either
    // direction would show up as "handle visually detaches from the
    // shape on rotated frames."
    const frame = {
      x: 250,
      y: 175,
      w: 200,
      h: 100,
      rotation: Math.PI / 6,
    };
    const handle = STAR_5_HANDLES[0];
    const adjustments = [25000];
    const local = handle.position({ w: frame.w, h: frame.h }, adjustments);
    const world = adjustmentLocalToWorld(frame, local);
    const backLocal = adjustmentWorldToLocal(frame, world);
    expect(backLocal.x).toBeCloseTo(local.x, 6);
    expect(backLocal.y).toBeCloseTo(local.y, 6);

    // And applying the handle's `apply` to the back-converted pointer
    // should recover the original adjustments.
    const next = handle.apply(
      { w: frame.w, h: frame.h },
      adjustments,
      backLocal,
    );
    expect(next[0]).toBeCloseTo(adjustments[0], -1);
  });
});

describe('formatAdjustments', () => {
  const SINGLE: AdjustmentSpec[] = [
    {
      name: 'Corner radius',
      defaultValue: 16667,
      min: 0,
      max: 50000,
      format: (v) => `${(v / 1000).toFixed(1)}%`,
    },
  ];

  const TAIL_XY: AdjustmentSpec[] = [
    { name: 'Tail x', defaultValue: 0, min: -100000, max: 100000 },
    { name: 'Tail y', defaultValue: 0, min: -100000, max: 100000 },
  ];

  const COLLIDING: AdjustmentSpec[] = [
    { name: 'Bar thickness', defaultValue: 0, min: 0, max: 50000, axisLabel: 'bar' },
    { name: 'Gap', defaultValue: 0, min: 0, max: 50000 },
    { name: 'Slash thickness', defaultValue: 0, min: 0, max: 50000, axisLabel: 'slash' },
  ];

  it('single-axis returns the formatted value with no label', () => {
    expect(formatAdjustments(SINGLE, [25000])).toBe('25.0%');
  });

  it('multi-axis falls back to lastWord when axisLabel is absent', () => {
    expect(formatAdjustments(TAIL_XY, [50000, -75000])).toBe(
      'x: 50000 / y: -75000',
    );
  });

  it('axisLabel overrides the lastWord heuristic when present', () => {
    // Without axisLabel both "Bar thickness" and "Slash thickness"
    // would collapse to "thickness". The explicit labels disambiguate.
    expect(formatAdjustments(COLLIDING, [20000, 10000, 5000])).toBe(
      'bar: 20000 / gap: 10000 / slash: 5000',
    );
  });
});
