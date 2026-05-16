import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildBentArrow,
  BENT_ARROW_ADJUSTMENTS,
  BENT_ARROW_HANDLES,
} from '../../../../../src/view/canvas/shapes/arrows/bent-arrow';

describe('buildBentArrow', () => {
  it('fills the horizontal arm + vertical arm', () => {
    const path = buildBentArrow({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // Top-left of horizontal arm.
    expect(ctx.isPointInPath(path, 30, 15)).toBe(true);
  });

  it('has 2 adjustments', () => {
    expect(BENT_ARROW_ADJUSTMENTS).toHaveLength(2);
  });
});

describe('BENT_ARROW_HANDLES', () => {
  it('exposes two handles', () => {
    expect(BENT_ARROW_HANDLES.length).toBe(2);
  });
});
