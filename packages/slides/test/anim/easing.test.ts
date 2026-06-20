import { describe, it, expect } from 'vitest';
import { applyEasing } from '../../src/anim/easing';

describe('applyEasing', () => {
  it('pins endpoints for every mode', () => {
    for (const m of ['linear','easeIn','easeOut','easeInOut'] as const) {
      expect(applyEasing(m, 0)).toBeCloseTo(0);
      expect(applyEasing(m, 1)).toBeCloseTo(1);
    }
  });
  it('linear is identity', () => {
    expect(applyEasing('linear', 0.3)).toBeCloseTo(0.3);
  });
  it('easeIn is below linear at the midpoint, easeOut above', () => {
    expect(applyEasing('easeIn', 0.5)).toBeLessThan(0.5);
    expect(applyEasing('easeOut', 0.5)).toBeGreaterThan(0.5);
  });
  it('defaults to easeInOut when undefined', () => {
    expect(applyEasing(undefined, 0.5)).toBeCloseTo(0.5);
  });
});
