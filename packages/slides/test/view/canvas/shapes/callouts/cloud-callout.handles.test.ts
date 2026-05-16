import { describe, it, expect } from 'vitest';
import { CLOUD_CALLOUT_HANDLES } from '../../../../../src/view/canvas/shapes/callouts/cloud-callout';

describe('CLOUD_CALLOUT_HANDLES', () => {
  it('registers one point-axis tail handle', () => {
    expect(CLOUD_CALLOUT_HANDLES).toHaveLength(1);
    const p = CLOUD_CALLOUT_HANDLES[0].position(
      { w: 200, h: 100 },
      [0, 0],
    );
    expect(p).toEqual({ x: 100, y: 50 }); // tail at frame centre
  });
});
