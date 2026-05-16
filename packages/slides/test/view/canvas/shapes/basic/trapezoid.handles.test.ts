import { describe, it, expect } from 'vitest';
import { TRAPEZOID_HANDLES } from '../../../../../src/view/canvas/shapes/basic/trapezoid';

describe('TRAPEZOID_HANDLES', () => {
  it('registers a single linear-x handle on the top edge', () => {
    expect(TRAPEZOID_HANDLES).toHaveLength(1);
    const p = TRAPEZOID_HANDLES[0].position({ w: 200, h: 100 }, [25000]);
    expect(p).toEqual({ x: 50, y: 0 }); // top-left corner inset at default
  });
});
