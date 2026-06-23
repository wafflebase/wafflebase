import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBorderCallout2,
  buildBorderCallout2Outline,
  BORDER_CALLOUT_2_ADJUSTMENTS,
  BORDER_CALLOUT_2_HANDLES,
} from '../../../../../src/view/canvas/shapes/callouts/border-callout-2';

describe('buildBorderCallout2', () => {
  it('fills the FULL frame body (incl. center, top and bottom edges)', () => {
    const path = buildBorderCallout2({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 100)).toBe(true);
    expect(ctx.isPointInPath(path, 100, 10)).toBe(true);
    expect(ctx.isPointInPath(path, 100, 190)).toBe(true);
  });

  it('outline contains the one-bend leader (anchor → bend → target)', () => {
    const path = buildBorderCallout2Outline({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    ctx.lineWidth = 6;
    // Interior anchor: (-8333%,18750%) → (-16.7, 37.5).
    expect(ctx.isPointInStroke(path, -16.7, 37.5)).toBe(true);
    // Bend: (18750%,90000%) → (37.5, 180).
    expect(ctx.isPointInStroke(path, 37.5, 180)).toBe(true);
    // Target: (18750%,112500%) → (37.5, 225).
    expect(ctx.isPointInStroke(path, 37.5, 225)).toBe(true);
    // A point on the bend → target segment.
    expect(ctx.isPointInStroke(path, 37.5, 200)).toBe(true);
  });

  it('outline includes the rectangle border', () => {
    const path = buildBorderCallout2Outline({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    ctx.lineWidth = 6;
    expect(ctx.isPointInStroke(path, 100, 0)).toBe(true);
  });

  it('has 4 adjustments', () => {
    expect(BORDER_CALLOUT_2_ADJUSTMENTS).toHaveLength(4);
  });
});

describe('BORDER_CALLOUT_2_HANDLES', () => {
  it('exposes two handles (bend + target)', () => {
    expect(BORDER_CALLOUT_2_HANDLES.length).toBe(2);
  });

  it('apply updates BOTH x and y indices per drag', () => {
    // Regression: the original `indexHandle` only wrote one axis per
    // handle (X or Y, picked from `index % 2`). Drags then slid
    // horizontally only because each bend / target handle controls
    // a coordinate PAIR, not a single value.
    const start = [18750, 90000, 18750, 112500];
    const frame = { w: 1000, h: 1000 };
    // First handle controls (adj0, adj1) — bend point.
    const next = BORDER_CALLOUT_2_HANDLES[0].apply(frame, start, {
      x: 250,
      y: 400,
    });
    expect(next[0]).toBeCloseTo(25000, -2); // x = 25%
    expect(next[1]).toBeCloseTo(40000, -2); // y = 40% (was 90000 before fix)
    expect(next[2]).toBe(18750);
    expect(next[3]).toBe(112500);
  });
});
