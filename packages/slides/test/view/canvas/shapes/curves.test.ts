import { describe, it, expect } from 'vitest';
import { DEFAULT_ARC_SEGMENTS, polylineArc } from '../../../../src/view/canvas/shapes/curves';

describe('polylineArc', () => {
  it('returns segments + 1 points (inclusive endpoints)', () => {
    const pts = polylineArc(0, 0, 100, 100, 0, Math.PI / 2, 8);
    expect(pts).toHaveLength(9);
  });

  it('defaults to 33 points (DEFAULT_ARC_SEGMENTS + 1)', () => {
    const pts = polylineArc(0, 0, 100, 100, 0, Math.PI / 2);
    expect(pts).toHaveLength(DEFAULT_ARC_SEGMENTS + 1);
  });

  it('matches the analytical endpoint at theta1', () => {
    const pts = polylineArc(0, 0, 100, 100, 0, Math.PI / 2, 8);
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(0, 9);
    expect(last.y).toBeCloseTo(100, 9);
  });

  it('starts exactly at the analytical theta0 point', () => {
    const pts = polylineArc(10, 20, 100, 50, 0, Math.PI / 2, 8);
    expect(pts[0].x).toBeCloseTo(110, 9);
    expect(pts[0].y).toBeCloseTo(20, 9);
  });

  it('advances monotonically along the sweep direction', () => {
    // CW quarter arc from 0 to π/2: x decreases, y increases.
    const pts = polylineArc(0, 0, 100, 100, 0, Math.PI / 2, 16);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x).toBeLessThanOrEqual(pts[i - 1].x);
      expect(pts[i].y).toBeGreaterThanOrEqual(pts[i - 1].y);
    }
  });

  it('handles reverse sweep when theta1 < theta0', () => {
    // CCW from π/2 to 0: x increases, y decreases.
    const pts = polylineArc(0, 0, 100, 100, Math.PI / 2, 0, 8);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x).toBeGreaterThanOrEqual(pts[i - 1].x);
      expect(pts[i].y).toBeLessThanOrEqual(pts[i - 1].y);
    }
  });

  it('full circle (theta0=0, theta1=2π) closes within numerical noise', () => {
    const pts = polylineArc(0, 0, 100, 100, 0, 2 * Math.PI, 32);
    const first = pts[0];
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(first.x, 9);
    expect(last.y).toBeCloseTo(first.y, 9);
  });

  it('respects distinct rx vs ry for elliptical sweep', () => {
    const pts = polylineArc(0, 0, 200, 50, 0, Math.PI / 2, 4);
    // At theta = π/2: x = 0, y = ry = 50.
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(0, 9);
    expect(last.y).toBeCloseTo(50, 9);
  });

  it('rejects non-positive segment counts', () => {
    expect(() => polylineArc(0, 0, 1, 1, 0, 1, 0)).toThrow(RangeError);
    expect(() => polylineArc(0, 0, 1, 1, 0, 1, -1)).toThrow(RangeError);
  });

  it('rejects non-integer segment counts', () => {
    expect(() => polylineArc(0, 0, 1, 1, 0, 1, 1.5)).toThrow(RangeError);
  });
});
