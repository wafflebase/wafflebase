import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import {
  buildCircularArrow,
  CIRCULAR_ARROW_ADJUSTMENTS,
  CIRCULAR_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/circular-arrow';

describe('buildCircularArrow', () => {
  it('produces a Path2D', () => {
    expect(buildCircularArrow({ w: 200, h: 200 })).toBeInstanceOf(Path2D);
  });

  it('has three adjustments incl. an angular start angle', () => {
    expect(CIRCULAR_ARROW_ADJUSTMENTS).toHaveLength(3);
    expect(CIRCULAR_ARROW_ADJUSTMENTS[2].axisLabel).toBe('start');
  });
});

describe('CIRCULAR_ARROW_HANDLES', () => {
  it('exposes three handles (shaft + head + start angle)', () => {
    expect(CIRCULAR_ARROW_HANDLES.length).toBe(3);
  });
});
