import { describe, it, expect } from 'vitest';
import { DONUT_HANDLES } from '../../../../../src/view/canvas/shapes/basic/donut';

describe('DONUT_HANDLES', () => {
  it('registers a single handle on the right side of the horizontal axis', () => {
    expect(DONUT_HANDLES).toHaveLength(1);
    // t = 25% * min(200, 100) = 25; handle at (w - t, h/2) = (175, 50)
    const p = DONUT_HANDLES[0].position({ w: 200, h: 100 }, [25000]);
    expect(p).toEqual({ x: 175, y: 50 });
  });

  it('insets x on the boundary so the diamond stays off the right edge', () => {
    // adj=1 (min) → t≈0 → handle would paint at (200, 50) = E midpoint.
    const p = DONUT_HANDLES[0].position({ w: 200, h: 100 }, [1]);
    expect(p.x).toBe(192); // w - INSET
    expect(p.y).toBe(50);
  });

  it('apply inverts pointer.x → t → adjustment thousandths', () => {
    // pointer.x = 150 → t = 50 → adj = 50000 (using min(w,h)=100)
    const next = DONUT_HANDLES[0].apply({ w: 200, h: 100 }, [25000], { x: 150, y: 50 });
    expect(next).toEqual([50000]);
  });

  it('apply clamps pointer past the inner ring boundary to the spec max', () => {
    // Dragging left past the centre would imply a ring thicker than the
    // shape — spec.max (50000) caps it.
    const next = DONUT_HANDLES[0].apply({ w: 200, h: 100 }, [25000], { x: 0, y: 50 });
    expect(next).toEqual([50000]);
  });
});
