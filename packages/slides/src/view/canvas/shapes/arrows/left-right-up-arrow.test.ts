import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import {
  buildLeftRightUpArrow,
  LEFT_RIGHT_UP_ARROW_ADJUSTMENTS,
  LEFT_RIGHT_UP_ARROW_HANDLES,
} from './left-right-up-arrow';

describe('buildLeftRightUpArrow', () => {
  it('produces a fillable 3-arm shape', () => {
    const path = buildLeftRightUpArrow({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // Centre of horizontal shaft near the bottom — clearly inside.
    expect(ctx.isPointInPath(path, 100, 175)).toBe(true);
  });

  it('has three adjustments', () => {
    expect(LEFT_RIGHT_UP_ARROW_ADJUSTMENTS).toHaveLength(3);
  });
});

describe('LEFT_RIGHT_UP_ARROW_HANDLES', () => {
  it('exposes three handles', () => {
    expect(LEFT_RIGHT_UP_ARROW_HANDLES.length).toBe(3);
  });
});
