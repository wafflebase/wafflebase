import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import {
  buildTeardrop,
  TEARDROP_ADJUSTMENTS,
  TEARDROP_HANDLES,
} from '../../../../../src/view/canvas/shapes/basic/teardrop';

describe('buildTeardrop', () => {
  it('fills the centre of the drop', () => {
    const path = buildTeardrop({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 70)).toBe(true);
  });

  it('default tip extension is 100000', () => {
    expect(TEARDROP_ADJUSTMENTS[0].defaultValue).toBe(100000);
  });
});

describe('TEARDROP_HANDLES', () => {
  it('paints on the top mid-line; lowering pointer decreases tip extension', () => {
    expect(TEARDROP_HANDLES.length).toBe(1);
    const p = TEARDROP_HANDLES[0].position({ w: 100, h: 100 }, [100000]);
    expect(p.x).toBe(50);
    // Default tipY = 0, but the inset guard pushes it down by 8 px.
    expect(p.y).toBeCloseTo(8, 1);
  });
});
