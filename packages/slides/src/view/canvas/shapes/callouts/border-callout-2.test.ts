import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import {
  buildBorderCallout2,
  BORDER_CALLOUT_2_ADJUSTMENTS,
  BORDER_CALLOUT_2_HANDLES,
} from './border-callout-2';

describe('buildBorderCallout2', () => {
  it('produces a Path2D', () => {
    expect(buildBorderCallout2({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
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
