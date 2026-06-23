import { describe, it, expect } from 'vitest';
import { LEFT_RIGHT_ARROW_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/left-right-arrow';

describe('LEFT_RIGHT_ARROW_HANDLES', () => {
  it('registers head-length and head-width handles on the left arrowhead', () => {
    expect(LEFT_RIGHT_ARROW_HANDLES).toHaveLength(2);
    // ss = min(200, 100) = 100; head = 50% * ss = 50
    // back at (head, h/2) = (50, 50)
    const p = LEFT_RIGHT_ARROW_HANDLES[0].position(
      { w: 200, h: 100 },
      [50000, 50000],
    );
    expect(p).toEqual({ x: 50, y: 50 });
  });

  it('head-length apply scales by the shorter side (ss)', () => {
    // ss=100; pointer.x = 50 → head/ss = 50/100 = 0.5 → 50000
    const next = LEFT_RIGHT_ARROW_HANDLES[0].apply(
      { w: 200, h: 100 },
      [50000, 50000],
      { x: 50, y: 50 },
    );
    expect(next[0]).toBe(50000);
  });
});
