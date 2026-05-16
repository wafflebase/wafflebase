import { describe, it, expect } from 'vitest';
import { TRIANGLE_HANDLES } from '../../../../../src/view/canvas/shapes/basic/triangle';

describe('TRIANGLE_HANDLES', () => {
  it('registers a single linear-x handle on the top edge', () => {
    expect(TRIANGLE_HANDLES).toHaveLength(1);
    const p = TRIANGLE_HANDLES[0].position({ w: 200, h: 100 }, [50000]);
    expect(p).toEqual({ x: 100, y: 0 }); // apex centred at default
  });
});
