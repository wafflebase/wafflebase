import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildDecagon } from '../../../../../src/view/canvas/shapes/basic/decagon';

describe('buildDecagon', () => {
  it('points left/right with a vertex on the horizontal axis (OOXML)', () => {
    const path = buildDecagon({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    // Vertices flush with the left & right edges at vertical center.
    expect(ctx.isPointInPath(path, 2, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 98, 50)).toBe(true);
    // No apex at the top-edge midpoint (that was the old wrong orientation).
    expect(ctx.isPointInPath(path, 50, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
  });
});
