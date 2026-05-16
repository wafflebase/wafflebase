import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildPlaque, PLAQUE_ADJUSTMENTS, PLAQUE_HANDLES } from '../../../../../src/view/canvas/shapes/basic/plaque';

describe('buildPlaque', () => {
  it('fills the centre but excludes the four chamfered corner triangles', () => {
    const path = buildPlaque({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    // Corner triangle area (NW corner cut off).
    expect(ctx.isPointInPath(path, 3, 3)).toBe(false);
  });

  it('default corner notch is 16667', () => {
    expect(PLAQUE_ADJUSTMENTS[0].defaultValue).toBe(16667);
  });
});

describe('PLAQUE_HANDLES', () => {
  it('exposes one handle on the top edge', () => {
    expect(PLAQUE_HANDLES.length).toBe(1);
    const p = PLAQUE_HANDLES[0].position({ w: 100, h: 100 }, [16667]);
    expect(p.y).toBe(0);
  });
});
