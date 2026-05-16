import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildEllipse } from '../../../../../src/view/canvas/shapes/basic/ellipse';

describe('buildEllipse', () => {
  it('returns an ellipse Path2D inscribed in the frame', () => {
    const path = buildEllipse({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // centre
    expect(ctx.isPointInPath(path, 5, 30)).toBe(true); // near left edge
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true); // near top edge
    expect(ctx.isPointInPath(path, 0, 0)).toBe(false); // corner (outside)
    expect(ctx.isPointInPath(path, 99, 59)).toBe(false); // corner (outside)
  });
});
