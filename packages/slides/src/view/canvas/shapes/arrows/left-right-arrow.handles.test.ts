import { describe, it, expect } from 'vitest';
import { LEFT_RIGHT_ARROW_HANDLES } from './left-right-arrow';

describe('LEFT_RIGHT_ARROW_HANDLES', () => {
  it('registers head-length and head-width handles on the left arrowhead', () => {
    expect(LEFT_RIGHT_ARROW_HANDLES).toHaveLength(2);
    // head = 50% * (w/2) = 50; back at (head, h/2) = (50, 50)
    const p = LEFT_RIGHT_ARROW_HANDLES[0].position(
      { w: 200, h: 100 },
      [50000, 50000],
    );
    expect(p).toEqual({ x: 50, y: 50 });
  });

  it('head-length apply scales by w/2, not w, because each head is half-width', () => {
    // pointer.x = 50 on w=200 → head/half = 50/100 = 0.5 → 50000
    const next = LEFT_RIGHT_ARROW_HANDLES[0].apply(
      { w: 200, h: 100 },
      [50000, 50000],
      { x: 50, y: 50 },
    );
    expect(next[0]).toBe(50000);
  });
});
