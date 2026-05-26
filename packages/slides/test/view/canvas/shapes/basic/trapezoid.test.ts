import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildTrapezoid } from '../../../../../src/view/canvas/shapes/basic/trapezoid';

describe('buildTrapezoid', () => {
  it('produces a trapezoid with default 25% top inset', () => {
    const path = buildTrapezoid({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 55)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false);
    expect(ctx.isPointInPath(path, 95, 5)).toBe(false);
  });
});
