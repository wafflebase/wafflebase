import { describe, it, expect } from 'vitest';
import { applyRotate, snapAngle } from '../../../../src/view/editor/interactions/rotate';

const STEP = Math.PI / 12; // 15°

describe('applyRotate', () => {
  it('applies the angular delta to the start rotation', () => {
    expect(applyRotate(0, 0, Math.PI / 4, false)).toBeCloseTo(Math.PI / 4);
  });
  it('preserves a non-zero start rotation', () => {
    expect(applyRotate(Math.PI / 6, 0, Math.PI / 4, false)).toBeCloseTo(Math.PI / 6 + Math.PI / 4);
  });
  it('shift snaps to 15° increments', () => {
    // 0.30 rad ≈ 17.2° rounds to 15° = STEP
    expect(applyRotate(0, 0, 0.30, true)).toBeCloseTo(STEP);
    // π/9 ≈ 20° rounds to 15° = STEP
    expect(applyRotate(0, 0, Math.PI / 9, true)).toBeCloseTo(STEP);
  });
});

describe('snapAngle', () => {
  it('rounds to the nearest 15° step', () => {
    // 0.30 rad ≈ 17.2° → 15° = STEP
    expect(snapAngle(0.30)).toBeCloseTo(STEP);
    expect(snapAngle(STEP * 2.6)).toBeCloseTo(STEP * 3);
  });
  it('preserves negative angles', () => {
    expect(snapAngle(-STEP * 1.4)).toBeCloseTo(-STEP);
  });
});
