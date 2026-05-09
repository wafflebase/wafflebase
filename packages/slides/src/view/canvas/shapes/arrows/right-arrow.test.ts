import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildRightArrow } from './right-arrow';

describe('buildRightArrow', () => {
  it('produces a right-pointing arrow with default head dimensions', () => {
    const path = buildRightArrow({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 10, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 95, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 95, 1)).toBe(false);
  });
});
