import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildDownArrow } from '../../../../../src/view/canvas/shapes/arrows/down-arrow';

describe('buildDownArrow', () => {
  it('produces a down-pointing arrow with default head dimensions', () => {
    const path = buildDownArrow({ w: 60, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 30, 5)).toBe(true);
    expect(ctx.isPointInPath(path, 30, 95)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 5)).toBe(false);
  });
});
