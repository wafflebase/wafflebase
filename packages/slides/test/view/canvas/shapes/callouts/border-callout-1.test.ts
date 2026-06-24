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

  it('builds an open leader polyline to the target', () => {
    // Default target (x2,y2) = (200·-38333, 200·112500)/100000 = (-76.7, 225).
    const leader = buildBorderCallout1Leader({ w: 200, h: 200 });
    expect(leader).toBeInstanceOf(Path2D);
  });
});

describe('BORDER_CALLOUT_1_HANDLES', () => {
  it('exposes two leader-vertex handles', () => {
    expect(BORDER_CALLOUT_1_HANDLES.length).toBe(2);
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
