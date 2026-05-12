import { describe, it, expect } from 'vitest';
import { LEFT_ARROW_HANDLES } from './left-arrow';

describe('LEFT_ARROW_HANDLES', () => {
  it('registers head-length and head-width handles on the left side', () => {
    expect(LEFT_ARROW_HANDLES).toHaveLength(2);
    // headLen = 50% * 200 = 100; back at (headLen, h/2) = (100, 50)
    const p = LEFT_ARROW_HANDLES[0].position({ w: 200, h: 100 }, [50000, 50000]);
    expect(p).toEqual({ x: 100, y: 50 });
  });
});
