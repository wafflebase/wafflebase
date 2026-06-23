import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildTeardrop,
  TEARDROP_ADJUSTMENTS,
  TEARDROP_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/teardrop';

describe('buildTeardrop', () => {
  it('fills the lobe and extends the point to the upper-right (OOXML)', () => {
    const path = buildTeardrop({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 70)).toBe(true);
    // Upper-right corner region is filled (the tip points there).
    expect(ctx.isPointInPath(path, 90, 10)).toBe(true);
    // The opposite upper-left corner stays empty (asymmetric tip).
    expect(ctx.isPointInPath(path, 10, 10)).toBe(false);
  });

  it('default tip extension is 100000', () => {
    expect(TEARDROP_ADJUSTMENTS[0].defaultValue).toBe(100000);
  });
});

describe('TEARDROP_HANDLES', () => {
  it('paints on the top edge toward the tip (upper-right)', () => {
    expect(TEARDROP_HANDLES.length).toBe(1);
    const p = TEARDROP_HANDLES[0].position({ w: 100, h: 100 }, [100000]);
    expect(p.y).toBe(0);
    expect(p.x).toBeGreaterThan(50); // toward the upper-right tip
  });
});
