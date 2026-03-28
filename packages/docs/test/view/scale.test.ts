import { describe, it, expect } from 'vitest';
import { computeScaleFactor, MOBILE_PADDING } from '../../src/view/scale.js';

describe('computeScaleFactor', () => {
  const PAGE_WIDTH = 816; // Letter

  it('returns 1 when container is wider than page', () => {
    expect(computeScaleFactor(1200, PAGE_WIDTH)).toBe(1);
  });

  it('returns 1 when container exactly fits page + padding', () => {
    const containerWidth = PAGE_WIDTH + MOBILE_PADDING * 2;
    expect(computeScaleFactor(containerWidth, PAGE_WIDTH)).toBe(1);
  });

  it('scales down for narrow container (iPhone SE, 375px)', () => {
    const factor = computeScaleFactor(375, PAGE_WIDTH);
    // (375 - 32) / 816 ≈ 0.4204
    expect(factor).toBeCloseTo(0.4204, 3);
  });

  it('scales down for medium container (iPhone 14, 390px)', () => {
    const factor = computeScaleFactor(390, PAGE_WIDTH);
    // (390 - 32) / 816 ≈ 0.4387
    expect(factor).toBeCloseTo(0.4387, 3);
  });

  it('handles zero container width', () => {
    expect(computeScaleFactor(0, PAGE_WIDTH)).toBeGreaterThan(0);
  });

  it('handles zero page width', () => {
    expect(computeScaleFactor(375, 0)).toBe(1);
  });

  it('never exceeds 1', () => {
    expect(computeScaleFactor(2000, PAGE_WIDTH)).toBe(1);
  });
});
