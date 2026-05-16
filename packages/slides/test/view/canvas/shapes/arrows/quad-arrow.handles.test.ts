import { describe, it, expect } from 'vitest';
import { QUAD_ARROW_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/quad-arrow';

describe('QUAD_ARROW_HANDLES', () => {
  it('registers three handles (headLen, headWidth, shaft)', () => {
    expect(QUAD_ARROW_HANDLES).toHaveLength(3);
  });

  it('all three handles cluster near the top arrowhead at defaults', () => {
    const frame = { w: 200, h: 100 };
    const adj = [22500, 22500, 22500];
    // dim = min(200,100) = 100; head/headHalf/shaft = 22.5
    const p0 = QUAD_ARROW_HANDLES[0].position(frame, adj); // headLen
    const p1 = QUAD_ARROW_HANDLES[1].position(frame, adj); // headWidth
    const p2 = QUAD_ARROW_HANDLES[2].position(frame, adj); // shaft
    expect(p0).toEqual({ x: 100, y: 22.5 });
    expect(p1).toEqual({ x: 122.5, y: 22.5 });
    expect(p2).toEqual({ x: 122.5, y: 50 });
  });

  it('shaft apply preserves the head adjustments unchanged', () => {
    const next = QUAD_ARROW_HANDLES[2].apply(
      { w: 200, h: 100 },
      [30000, 35000, 22500],
      { x: 140, y: 50 },
    );
    // shaft = |140 - 100| = 40; raw = 40/100 * 100000 = 40000
    expect(next).toEqual([30000, 35000, 40000]);
  });
});
