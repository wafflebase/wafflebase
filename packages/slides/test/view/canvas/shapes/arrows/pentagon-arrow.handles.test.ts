import { describe, it, expect } from 'vitest';
import { PENTAGON_ARROW_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/pentagon-arrow';

describe('PENTAGON_ARROW_HANDLES', () => {
  it('registers a single linear-x handle where the arrowhead notch begins', () => {
    expect(PENTAGON_ARROW_HANDLES).toHaveLength(1);
    // point = 50% * 200 = 100; x = w - point = 100
    const p = PENTAGON_ARROW_HANDLES[0].position({ w: 200, h: 100 }, [50000]);
    expect(p).toEqual({ x: 100, y: 0 });
  });

  it('round-trips position ↔ apply at default', () => {
    // The pentagonArrow forward is reverse-direction (w - point) so
    // guard against the sign of the inverse specifically here.
    const frame = { w: 200, h: 100 };
    const start = [50000];
    const p = PENTAGON_ARROW_HANDLES[0].position(frame, start);
    const back = PENTAGON_ARROW_HANDLES[0].apply(frame, start, p);
    expect(back[0]).toBeCloseTo(start[0], -1);
  });
});
