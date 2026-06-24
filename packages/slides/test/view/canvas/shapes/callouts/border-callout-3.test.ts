import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBorderCallout3,
  buildBorderCallout3Leader,
  BORDER_CALLOUT_3_ADJUSTMENTS,
  BORDER_CALLOUT_3_HANDLES,
} from '../../../../../src/view/canvas/shapes/callouts/border-callout-3';

describe('buildBorderCallout3', () => {
  it('produces a full-frame box and an open leader', () => {
    expect(buildBorderCallout3({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
    expect(buildBorderCallout3Leader({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });

  it('has 8 OOXML adjustments (four (y,x) leader points)', () => {
    expect(BORDER_CALLOUT_3_ADJUSTMENTS).toHaveLength(8);
  });
});

describe('BORDER_CALLOUT_3_HANDLES', () => {
  it('exposes four leader-vertex handles', () => {
    expect(BORDER_CALLOUT_3_HANDLES.length).toBe(4);
  });

  it('the target handle writes its (y,x) pair (indices 6,7)', () => {
    const start = BORDER_CALLOUT_3_ADJUSTMENTS.map((a) => a.defaultValue);
    const next = BORDER_CALLOUT_3_HANDLES[3].apply(
      { w: 1000, h: 1000 },
      start,
      { x: 600, y: 800 },
    );
    expect(next[7]).toBeCloseTo(60000, -2); // x = 60%
    expect(next[6]).toBeCloseTo(80000, -2); // y = 80%
    expect(next[0]).toBe(start[0]);
  });
});
