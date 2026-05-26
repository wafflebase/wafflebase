import { describe, it, expect } from 'vitest';
import { DOWN_ARROW_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/down-arrow';

describe('DOWN_ARROW_HANDLES', () => {
  it('registers head-length and head-width handles, head on bottom', () => {
    expect(DOWN_ARROW_HANDLES).toHaveLength(2);
    // headLen = 50% * 100 = 50; back at (w/2, h - headLen) = (100, 50)
    const p = DOWN_ARROW_HANDLES[0].position({ w: 200, h: 100 }, [50000, 50000]);
    expect(p).toEqual({ x: 100, y: 50 });
  });
});
