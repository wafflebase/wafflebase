import { describe, it, expect } from 'vitest';
import { UP_ARROW_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/up-arrow';

describe('UP_ARROW_HANDLES', () => {
  it('registers head-length and head-width handles, head on top', () => {
    expect(UP_ARROW_HANDLES).toHaveLength(2);
    // ss = min(200, 100) = 100; headLen = 50% * ss = 50
    // back at (w/2, headLen) = (100, 50)
    const p = UP_ARROW_HANDLES[0].position({ w: 200, h: 100 }, [50000, 50000]);
    expect(p).toEqual({ x: 100, y: 50 });
  });
});
