import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildPentagon } from '../../../../../src/view/canvas/shapes/basic/pentagon';

describe('buildPentagon', () => {
  it('produces a regular pentagon inscribed in the frame', () => {
    const path = buildPentagon({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 99, 1)).toBe(false);
  });
});
