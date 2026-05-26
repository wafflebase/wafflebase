import { describe, it, expect } from 'vitest';
import { HEXAGON_HANDLES } from '../../../../../src/view/canvas/shapes/basic/hexagon';

describe('HEXAGON_HANDLES', () => {
  it('registers a single linear-x handle on the top edge', () => {
    expect(HEXAGON_HANDLES).toHaveLength(1);
    // notch = 25% * min(200, 100) = 25
    const p = HEXAGON_HANDLES[0].position({ w: 200, h: 100 }, [25000]);
    expect(p).toEqual({ x: 25, y: 0 });
  });
});
