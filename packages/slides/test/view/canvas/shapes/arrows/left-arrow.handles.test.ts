import { describe, it, expect } from 'vitest';
import { LEFT_ARROW_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/left-arrow';

describe('LEFT_ARROW_HANDLES', () => {
  it('registers head-length and head-width handles on the left side', () => {
    expect(LEFT_ARROW_HANDLES).toHaveLength(2);
    // ss = min(200, 100) = 100; headLen = 50% * ss = 50
    // back at (headLen, h/2) = (50, 50)
    const p = LEFT_ARROW_HANDLES[0].position({ w: 200, h: 100 }, [50000, 50000]);
    expect(p).toEqual({ x: 50, y: 50 });
  });
});
