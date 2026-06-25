import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBorderCallout1,
  buildBorderCallout1Leader,
  BORDER_CALLOUT_1_ADJUSTMENTS,
  BORDER_CALLOUT_1_HANDLES,
} from '../../../../../src/view/canvas/shapes/callouts/border-callout-1';

describe('buildBorderCallout1', () => {
  it('fills the FULL frame as the text box (OOXML box geometry)', () => {
    const path = buildBorderCallout1({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 100)).toBe(true); // centre
    // The whole frame is the box — including the bottom, which the old
    // 75%-height body excluded.
    expect(ctx.isPointInPath(path, 100, 190)).toBe(true);
    expect(ctx.isPointInPath(path, 250, 100)).toBe(false); // outside
  });

  it('has 4 OOXML adjustments (two (y,x) leader points)', () => {
    expect(BORDER_CALLOUT_1_ADJUSTMENTS).toHaveLength(4);
  });

  it('builds an open leader polyline from point 1 to the target', () => {
    // Default leader runs (x1,y1)=(-16.7, 37.5) → (x2,y2)=(-76.7, 225);
    // its midpoint is (-46.7, 131.25). Stroke-hit-test the midpoint so an
    // empty/degenerate leader would fail.
    const leader = buildBorderCallout1Leader({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    ctx.lineWidth = 6;
    expect(ctx.isPointInStroke(leader, -46.7, 131.25)).toBe(true); // on segment
    expect(ctx.isPointInStroke(leader, 100, 100)).toBe(false); // far off
  });
});

describe('BORDER_CALLOUT_1_HANDLES', () => {
  it('exposes two leader-vertex handles', () => {
    expect(BORDER_CALLOUT_1_HANDLES.length).toBe(2);
  });

  it('positions the target handle on the real leader endpoint, not clamped inside the box', () => {
    // Default target (x2,y2) = (200·-38333, 200·112500)/100000 = (-76.7, 225),
    // i.e. down-left OUTSIDE the frame. The handle must land there (where the
    // line actually ends), not be clamped to the box interior.
    const start = BORDER_CALLOUT_1_ADJUSTMENTS.map((a) => a.defaultValue);
    const pos = BORDER_CALLOUT_1_HANDLES[1].position({ w: 200, h: 200 }, start);
    expect(pos.x).toBeCloseTo(-76.666, 1);
    expect(pos.y).toBeCloseTo(225, 1);
  });

  it('drag of the target handle writes its (y,x) pair (indices 2,3)', () => {
    const start = BORDER_CALLOUT_1_ADJUSTMENTS.map((a) => a.defaultValue);
    const next = BORDER_CALLOUT_1_HANDLES[1].apply(
      { w: 200, h: 200 },
      start,
      { x: 50, y: 150 },
    );
    expect(next[3]).toBe(25000); // x = 50/200
    expect(next[2]).toBe(75000); // y = 150/200
    expect(next[0]).toBe(start[0]); // first point untouched
  });
});
