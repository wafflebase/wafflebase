import { describe, it, expect } from 'vitest';
import { OCTAGON_HANDLES } from '../../../../../src/view/canvas/shapes/basic/octagon';

describe('OCTAGON_HANDLES', () => {
  it('registers a single linear-x handle on the top edge', () => {
    expect(OCTAGON_HANDLES).toHaveLength(1);
    // cut = 29289/100000 * min(200, 100) = 29.289
    const p = OCTAGON_HANDLES[0].position({ w: 200, h: 100 }, [29289]);
    expect(p.x).toBeCloseTo(29.289, 3);
    expect(p.y).toBe(0);
  });
});
