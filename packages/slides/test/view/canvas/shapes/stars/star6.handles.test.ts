import { describe, it, expect } from 'vitest';
import { STAR_6_HANDLES } from '../../../../../src/view/canvas/shapes/stars/star6';

const FRAME = { w: 200, h: 100 };
const DEFAULT_RATIO = 28868;

describe('STAR_6_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(STAR_6_HANDLES).toHaveLength(1);
  });

  it('position at default sits inside the frame bounding box', () => {
    const p = STAR_6_HANDLES[0].position(FRAME, [DEFAULT_RATIO]);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(FRAME.w);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(FRAME.h);
  });

  it('round-trip identity inside clamp range', () => {
    const adj = [25000];
    const p = STAR_6_HANDLES[0].position(FRAME, adj);
    const back = STAR_6_HANDLES[0].apply(FRAME, adj, p);
    expect(back[0]).toBeCloseTo(adj[0], -1);
  });
});
