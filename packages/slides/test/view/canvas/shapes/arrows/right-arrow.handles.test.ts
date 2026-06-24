import { describe, it, expect } from 'vitest';
import { RIGHT_ARROW_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/right-arrow';

describe('RIGHT_ARROW_HANDLES', () => {
  it('registers head-length and head-width handles', () => {
    expect(RIGHT_ARROW_HANDLES).toHaveLength(2);
  });

  it('handle 0 (head length) sits at the back of the head on centerline', () => {
    // ss = min(200, 100) = 100; headLen = 50% * ss = 50
    // back at (w - headLen, h/2) = (150, 50)
    const p = RIGHT_ARROW_HANDLES[0].position({ w: 200, h: 100 }, [50000, 50000]);
    expect(p).toEqual({ x: 150, y: 50 });
  });

  it('handle 1 (head width) sits at the upper-outer back corner', () => {
    // headLen=50, headHalf=50% * 50 = 25; pos = (150, 50-25) = (150, 25)
    const p = RIGHT_ARROW_HANDLES[1].position({ w: 200, h: 100 }, [50000, 50000]);
    expect(p).toEqual({ x: 150, y: 25 });
  });

  it('head-length apply preserves head-width index from start', () => {
    // ss=100; pointer.x=150 → headLen = w - x = 50 → 50/ss = 50000
    const next = RIGHT_ARROW_HANDLES[0].apply({ w: 200, h: 100 }, [50000, 30000], { x: 150, y: 50 });
    expect(next).toEqual([50000, 30000]);
  });

  it('head-width apply preserves head-length index from start', () => {
    const next = RIGHT_ARROW_HANDLES[1].apply({ w: 200, h: 100 }, [40000, 50000], { x: 100, y: 0 });
    // y=0 → headHalf=50, raw = 50/50 * 100000 = 100000
    expect(next).toEqual([40000, 100000]);
  });
});
