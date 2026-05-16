import { describe, it, expect } from 'vitest';
import { WEDGE_ELLIPSE_CALLOUT_HANDLES } from '../../../../../src/view/canvas/shapes/callouts/wedge-ellipse-callout';

describe('WEDGE_ELLIPSE_CALLOUT_HANDLES', () => {
  it('registers one point-axis tail handle', () => {
    expect(WEDGE_ELLIPSE_CALLOUT_HANDLES).toHaveLength(1);
    // default tail (-20833, 62500) on 200×100: tx = 100 + (-0.20833)*200 = 58.33,
    // ty = 50 + 0.625*100 = 112.5 (outside the frame, no inset)
    const p = WEDGE_ELLIPSE_CALLOUT_HANDLES[0].position(
      { w: 200, h: 100 },
      [-20833, 62500],
    );
    expect(p.x).toBeCloseTo(58.334, 2);
    expect(p.y).toBeCloseTo(112.5, 2);
  });
});
