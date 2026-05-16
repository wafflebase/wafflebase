import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildHeptagon } from '../../../../../src/view/canvas/shapes/basic/heptagon';

describe('buildHeptagon', () => {
  it('produces a regular heptagon inscribed in the frame', () => {
    const path = buildHeptagon({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Centre is inside.
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    // Apex (top edge midpoint) is on the boundary — fudge slightly inward.
    expect(ctx.isPointInPath(path, 50, 1)).toBe(true);
    // Frame corners are outside the heptagon.
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    expect(ctx.isPointInPath(path, 99, 99)).toBe(false);
  });
});
