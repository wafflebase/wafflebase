import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildDecagon } from '../../../../../src/view/canvas/shapes/basic/decagon';

describe('buildDecagon', () => {
  it('produces a regular decagon inscribed in the frame', () => {
    const path = buildDecagon({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 1)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 99, 99)).toBe(false);
  });
});
