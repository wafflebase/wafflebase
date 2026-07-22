import { describe, it, expect } from 'vitest';
import { lineBaselineY, ptToPx } from '../../src/view/theme';

describe('lineBaselineY', () => {
  it('centers the baseline using the line max font size', () => {
    // lineY=0, lineHeight=72, max=48 → (72 + 48*0.8) / 2 = 55.2
    expect(lineBaselineY(0, 72, 48)).toBeCloseTo(55.2, 5);
  });

  it('is unrounded (PDF needs continuous coords)', () => {
    // Not an integer — proves the helper does not round internally.
    expect(Number.isInteger(lineBaselineY(0, 72, 48))).toBe(false);
  });

  it('offsets by lineY', () => {
    expect(lineBaselineY(10, 72, 48) - lineBaselineY(0, 72, 48)).toBeCloseTo(10, 5);
  });

  it('a taller max font lowers the baseline (larger y = further down)', () => {
    expect(lineBaselineY(0, 72, ptToPx(36))).toBeGreaterThan(
      lineBaselineY(0, 72, ptToPx(11)),
    );
  });
});
