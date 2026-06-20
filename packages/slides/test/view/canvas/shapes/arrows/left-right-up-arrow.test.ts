import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildLeftRightUpArrow,
  LEFT_RIGHT_UP_ARROW_ADJUSTMENTS,
  LEFT_RIGHT_UP_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/left-right-up-arrow';

describe('buildLeftRightUpArrow', () => {
  it('produces a fillable 3-arm shape', () => {
    const path = buildLeftRightUpArrow({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // Centre of the horizontal bar (y4 = h − dx2 = 150 at defaults) —
    // clearly inside.
    expect(ctx.isPointInPath(path, 100, 150)).toBe(true);
    // The up arrow rises to the top of the frame: a point just below
    // the tip on the centre line is inside.
    expect(ctx.isPointInPath(path, 100, 20)).toBe(true);
  });

  it('has three adjustments', () => {
    expect(LEFT_RIGHT_UP_ARROW_ADJUSTMENTS).toHaveLength(3);
  });
});

describe('LEFT_RIGHT_UP_ARROW_HANDLES', () => {
  it('exposes three handles', () => {
    expect(LEFT_RIGHT_UP_ARROW_HANDLES.length).toBe(3);
  });

  it('head-width handle round-trips position → apply → position', () => {
    const headWidthIdx = 1;
    const start = [25000, 25000, 25000]; // spec defaults
    const frame = { w: 200, h: 200 };
    const p = LEFT_RIGHT_UP_ARROW_HANDLES[headWidthIdx].position(frame, start);
    const back = LEFT_RIGHT_UP_ARROW_HANDLES[headWidthIdx].apply(
      frame,
      start,
      p,
    );
    expect(back[headWidthIdx]).toBeCloseTo(start[headWidthIdx], -2);
  });
});
