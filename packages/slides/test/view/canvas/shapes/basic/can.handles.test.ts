import { describe, it, expect } from 'vitest';
import { CAN_HANDLES } from '../../../../../src/view/canvas/shapes/basic/can';

describe('CAN_HANDLES', () => {
  it('registers a single linear-y handle at the lid line centre', () => {
    expect(CAN_HANDLES).toHaveLength(1);
    // ry = 25% * h = 25; handle at (w/2, ry) = (100, 25)
    const p = CAN_HANDLES[0].position({ w: 200, h: 100 }, [25000]);
    expect(p).toEqual({ x: 100, y: 25 });
  });

  it('insets y on the boundary so the diamond stays off the top edge', () => {
    // adj=0 → ry=0 → handle would paint at (w/2, 0) = N midpoint.
    const p = CAN_HANDLES[0].position({ w: 200, h: 100 }, [0]);
    expect(p).toEqual({ x: 100, y: 8 });
  });

  it('apply inverts pointer.y back to adjustment thousandths', () => {
    const next = CAN_HANDLES[0].apply({ w: 200, h: 100 }, [25000], { x: 100, y: 40 });
    expect(next).toEqual([40000]);
  });

  it('apply clamps pointer past max to the spec max (50000)', () => {
    const next = CAN_HANDLES[0].apply({ w: 200, h: 100 }, [25000], { x: 100, y: 80 });
    // y/h*100000 = 80000 but spec.max = 50000
    expect(next).toEqual([50000]);
  });
});
