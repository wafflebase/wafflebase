import { describe, it, expect } from 'vitest';
import { RIGHT_ARROW_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/right-arrow';

describe('RIGHT_ARROW_HANDLES', () => {
  it('registers head-length and head-width handles', () => {
    expect(RIGHT_ARROW_HANDLES).toHaveLength(2);
  });

  it('handle 0 (head length) sits at the back of the head on centerline', () => {
    // headLen = 50% * 200 = 100; back at (w - headLen, h/2) = (100, 50)
    const p = RIGHT_ARROW_HANDLES[0].position({ w: 200, h: 100 }, [50000, 50000]);
    expect(p).toEqual({ x: 100, y: 50 });
  });

  it('handle 1 (head width) sits at the upper-outer back corner', () => {
    // headLen=100, headHalf=50% * 50 = 25; pos = (100, 50-25) = (100, 25)
    const p = RIGHT_ARROW_HANDLES[1].position({ w: 200, h: 100 }, [50000, 50000]);
    expect(p).toEqual({ x: 100, y: 25 });
  });

  it('head-length apply preserves head-width index from start', () => {
    const next = RIGHT_ARROW_HANDLES[0].apply({ w: 200, h: 100 }, [50000, 30000], { x: 50, y: 50 });
    expect(next).toEqual([75000, 30000]);
  });

  it('head-width apply preserves head-length index from start', () => {
    const next = RIGHT_ARROW_HANDLES[1].apply({ w: 200, h: 100 }, [40000, 50000], { x: 100, y: 0 });
    // y=0 → headHalf=50, raw = 50/50 * 100000 = 100000
    expect(next).toEqual([40000, 100000]);
  });
});
