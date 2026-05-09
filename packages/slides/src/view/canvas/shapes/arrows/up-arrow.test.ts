import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildUpArrow } from './up-arrow';

describe('buildUpArrow', () => {
  it('produces an up-pointing arrow with default head dimensions', () => {
    const path = buildUpArrow({ w: 60, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 30, 95)).toBe(true);
    expect(ctx.isPointInPath(path, 30, 5)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 95)).toBe(false);
  });
});
