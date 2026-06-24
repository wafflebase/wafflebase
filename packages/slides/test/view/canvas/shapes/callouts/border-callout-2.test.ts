import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBorderCallout2,
  buildBorderCallout2Leader,
  BORDER_CALLOUT_2_ADJUSTMENTS,
  BORDER_CALLOUT_2_HANDLES,
} from '../../../../../src/view/canvas/shapes/callouts/border-callout-2';

describe('buildBorderCallout2', () => {
  it('produces a full-frame box and an open leader', () => {
    expect(buildBorderCallout2({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
    expect(buildBorderCallout2Leader({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });

  it('has 6 OOXML adjustments (three (y,x) leader points)', () => {
    expect(BORDER_CALLOUT_2_ADJUSTMENTS).toHaveLength(6);
  });
});

describe('BORDER_CALLOUT_2_HANDLES', () => {
  it('exposes three leader-vertex handles', () => {
    expect(BORDER_CALLOUT_2_HANDLES.length).toBe(3);
  });

  it('each handle writes BOTH its y and x index per drag', () => {
    const start = BORDER_CALLOUT_2_ADJUSTMENTS.map((a) => a.defaultValue);
    const frame = { w: 1000, h: 1000 };
    // Handle 1 controls the bend point at indices (y=2, x=3).
    const next = BORDER_CALLOUT_2_HANDLES[1].apply(frame, start, {
      x: 250,
      y: 400,
    });
    expect(next[3]).toBeCloseTo(25000, -2); // x = 25%
    expect(next[2]).toBeCloseTo(40000, -2); // y = 40%
    expect(next[0]).toBe(start[0]); // first point untouched
    expect(next[4]).toBe(start[4]); // target untouched
  });
});
