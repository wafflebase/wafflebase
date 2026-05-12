import { describe, it, expect } from 'vitest';
import { WEDGE_ROUND_RECT_CALLOUT_HANDLES } from './wedge-round-rect-callout';

describe('WEDGE_ROUND_RECT_CALLOUT_HANDLES', () => {
  it('registers tail and corner-radius handles', () => {
    expect(WEDGE_ROUND_RECT_CALLOUT_HANDLES).toHaveLength(2);
  });

  it('corner-radius handle controls adjustments[2], leaving tail adjustments unchanged', () => {
    // r = 16667/100000 * min(200, 100) = 16.667 at default
    const p = WEDGE_ROUND_RECT_CALLOUT_HANDLES[1].position(
      { w: 200, h: 100 },
      [-20833, 62500, 16667],
    );
    expect(p.x).toBeCloseTo(16.667, 3);
    expect(p.y).toBe(0);

    // Dragging the radius handle preserves the tail at [-20833, 62500]
    const next = WEDGE_ROUND_RECT_CALLOUT_HANDLES[1].apply(
      { w: 200, h: 100 },
      [-20833, 62500, 16667],
      { x: 30, y: 0 },
    );
    expect(next[0]).toBe(-20833);
    expect(next[1]).toBe(62500);
    // r = 30; raw = 30/100 * 100000 = 30000
    expect(next[2]).toBe(30000);
  });
});
