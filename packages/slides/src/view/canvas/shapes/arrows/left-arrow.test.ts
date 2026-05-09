import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildLeftArrow } from './left-arrow';

describe('buildLeftArrow', () => {
  it('produces a left-pointing arrow with default head dimensions', () => {
    const path = buildLeftArrow({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 5, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 90, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 5, 59)).toBe(false);
  });
});
