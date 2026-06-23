import { describe, it, expect } from 'vitest';
import { PLUS_HANDLES } from '../../../../../src/view/canvas/shapes/basic/plus';

describe('PLUS_HANDLES', () => {
  it('registers a single linear-x handle at the OOXML edge inset x1', () => {
    expect(PLUS_HANDLES).toHaveLength(1);
    // x1 = ss*adj/100000; ss = min(200,100) = 100 → x1 = 25.
    const p = PLUS_HANDLES[0].position({ w: 200, h: 100 }, [25000]);
    expect(p).toEqual({ x: 25, y: 0 });
  });

  it('round-trips position ↔ apply at default', () => {
    const frame = { w: 200, h: 100 };
    const start = [25000];
    const p = PLUS_HANDLES[0].position(frame, start);
    const back = PLUS_HANDLES[0].apply(frame, start, p);
    expect(back[0]).toBeCloseTo(start[0], -1);
  });
});
