import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildLeftRightArrow } from '../../../../../src/view/canvas/shapes/arrows/left-right-arrow';

describe('buildLeftRightArrow', () => {
  it('produces a double-headed horizontal arrow', () => {
    const path = buildLeftRightArrow({ w: 120, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 60, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 1)).toBe(false);
  });
});
