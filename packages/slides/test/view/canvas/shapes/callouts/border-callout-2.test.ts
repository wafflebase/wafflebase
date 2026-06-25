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

  it.each([0, 1, 2])(
    'handle %i writes its own (y,x) pair and leaves the others untouched',
    (i) => {
      const start = BORDER_CALLOUT_2_ADJUSTMENTS.map((a) => a.defaultValue);
      const frame = { w: 1000, h: 1000 };
      const next = BORDER_CALLOUT_2_HANDLES[i].apply(frame, start, {
        x: 250,
        y: 400,
      });
      const yIndex = 2 * i;
      const xIndex = 2 * i + 1;
      expect(next[xIndex]).toBeCloseTo(25000, -2); // x = 25%
      expect(next[yIndex]).toBeCloseTo(40000, -2); // y = 40%
      // Every other index is passed through unchanged.
      next.forEach((v, idx) => {
        if (idx !== xIndex && idx !== yIndex) expect(v).toBe(start[idx]);
      });
  });
});
