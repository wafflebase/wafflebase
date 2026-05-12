import { describe, it, expect } from 'vitest';
import { PLUS_HANDLES } from './plus';

describe('PLUS_HANDLES', () => {
  it('registers a single linear-x handle at the left edge of the vertical arm', () => {
    expect(PLUS_HANDLES).toHaveLength(1);
    // t = 25% * min(200, 100) = 25; xL = (200-25)/2 = 87.5
    const p = PLUS_HANDLES[0].position({ w: 200, h: 100 }, [25000]);
    expect(p).toEqual({ x: 87.5, y: 0 });
  });

  it('round-trips position ↔ apply at default', () => {
    // The plus inverse is non-standard (t = w - 2*x) so guard against
    // sign errors specifically here rather than only at the factory level.
    const frame = { w: 200, h: 100 };
    const start = [25000];
    const p = PLUS_HANDLES[0].position(frame, start);
    const back = PLUS_HANDLES[0].apply(frame, start, p);
    expect(back[0]).toBeCloseTo(start[0], -1);
  });
});
