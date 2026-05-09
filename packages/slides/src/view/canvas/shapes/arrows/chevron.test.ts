import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildChevron } from './chevron';

describe('buildChevron', () => {
  it('produces a right-pointing chevron with default notch', () => {
    const path = buildChevron({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    expect(ctx.isPointInPath(path, -1, -1)).toBe(false);
    expect(ctx.isPointInPath(path, 50, -1)).toBe(false);
  });
});
