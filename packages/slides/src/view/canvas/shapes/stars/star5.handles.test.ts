import { describe, it, expect } from 'vitest';
import { STAR_5_HANDLES } from './star5';

const FRAME = { w: 200, h: 100 };
// star5 builder: rx=100, ry=50, innerRotation = -π/2 + π/5
// Handle position: (cx + ratio*rx*cos(θ), cy + ratio*ry*sin(θ))
const cx = 100, cy = 50, rx = 100, ry = 50;
const theta = -Math.PI / 2 + Math.PI / 5;

describe('STAR_5_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(STAR_5_HANDLES).toHaveLength(1);
  });

  describe('position (default ratio 19098)', () => {
    const handle = STAR_5_HANDLES[0];
    const ratio = 19098 / 100000;

    it('matches (cx + ratio*rx*cos θ, cy + ratio*ry*sin θ)', () => {
      const p = handle.position(FRAME, [19098]);
      expect(p.x).toBeCloseTo(cx + ratio * rx * Math.cos(theta), 4);
      expect(p.y).toBeCloseTo(cy + ratio * ry * Math.sin(theta), 4);
    });

    it('zero ratio → handle at frame center', () => {
      const p = handle.position(FRAME, [0]);
      expect(p.x).toBeCloseTo(cx, 4);
      expect(p.y).toBeCloseTo(cy, 4);
    });
  });

  describe('apply', () => {
    const handle = STAR_5_HANDLES[0];

    it('pointer along ray at unit-ellipse radius 0.5 → adj0 = 50000', () => {
      // unit-ellipse pointer at 0.5 along (cos θ, sin θ) means
      // element-local pointer = (cx + 0.5*rx*cos θ, cy + 0.5*ry*sin θ)
      const px = cx + 0.5 * rx * Math.cos(theta);
      const py = cy + 0.5 * ry * Math.sin(theta);
      const next = handle.apply(FRAME, [19098], { x: px, y: py });
      expect(next[0]).toBe(50000);
    });

    it('pointer past unit-ellipse outer edge → clamps to 50000 (max)', () => {
      const px = cx + 5 * rx * Math.cos(theta);
      const py = cy + 5 * ry * Math.sin(theta);
      const next = handle.apply(FRAME, [19098], { x: px, y: py });
      // ratio in unit space = 5; clamped to 1 → 100000; spec max = 50000
      expect(next[0]).toBe(50000);
    });

    it('pointer at center → 0', () => {
      const next = handle.apply(FRAME, [19098], { x: cx, y: cy });
      expect(next[0]).toBe(0);
    });

    it('pointer perpendicular to handle ray → does not move ratio', () => {
      // ratio is the projection along (cos θ, sin θ); perpendicular
      // pointer should give projection 0, hence adj0 = 0
      const perpX = cx + rx * Math.sin(theta);   // perpendicular vector
      const perpY = cy - ry * Math.cos(theta);
      const next = handle.apply(FRAME, [19098], { x: perpX, y: perpY });
      expect(next[0]).toBe(0);
    });

    it('round-trip identity inside clamp range', () => {
      const adj = [30000];
      const p = handle.position(FRAME, adj);
      const back = handle.apply(FRAME, adj, p);
      expect(back[0]).toBeCloseTo(adj[0], -1);
    });
  });
});
