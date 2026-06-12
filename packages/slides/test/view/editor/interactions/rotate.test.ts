import { describe, it, expect } from 'vitest';
import {
  applyRotate,
  snapAngle,
  snapToCardinal,
} from '../../../../src/view/editor/interactions/rotate';

const STEP = Math.PI / 12; // 15°
const CARDINAL = Math.PI / 2; // 90°

describe('applyRotate', () => {
  it('applies the angular delta to the start rotation', () => {
    // 45° is far from any cardinal, so soft-snap does not engage.
    expect(applyRotate(0, 0, Math.PI / 4, false)).toBeCloseTo(Math.PI / 4);
  });
  it('preserves a non-zero start rotation', () => {
    // 30° + 45° = 75°, far from 90°, no cardinal snap.
    expect(applyRotate(Math.PI / 6, 0, Math.PI / 4, false)).toBeCloseTo(
      Math.PI / 6 + Math.PI / 4,
    );
  });
  it('shift snaps to 15° increments', () => {
    // 0.30 rad ≈ 17.2° rounds to 15° = STEP
    expect(applyRotate(0, 0, 0.3, true)).toBeCloseTo(STEP);
    // π/9 ≈ 20° rounds to 15° = STEP
    expect(applyRotate(0, 0, Math.PI / 9, true)).toBeCloseTo(STEP);
  });
  it('soft-snaps free drag to 0° when within ±3°', () => {
    // A 2° drag back toward 0° should stick at 0°.
    const twoDeg = (2 * Math.PI) / 180;
    expect(applyRotate(0, 0, twoDeg, false)).toBeCloseTo(0);
    expect(applyRotate(0, 0, -twoDeg, false)).toBeCloseTo(0);
  });
  it('soft-snaps free drag to 90° when within ±3°', () => {
    // 88° → snap to 90°
    const eightyEightDeg = (88 * Math.PI) / 180;
    expect(applyRotate(0, 0, eightyEightDeg, false)).toBeCloseTo(CARDINAL);
  });
  it('does not snap mid-range angles', () => {
    // 10° is outside the ±3° dead zone; pass through.
    const tenDeg = (10 * Math.PI) / 180;
    expect(applyRotate(0, 0, tenDeg, false)).toBeCloseTo(tenDeg);
  });
  it('targets the absolute rotation when startRotation is non-zero', () => {
    // Shape sits at 5°; user drags by −4° trying to land at ~1°. The
    // absolute (1°) is within the 3° dead zone, so it snaps to 0.
    const fiveDeg = (5 * Math.PI) / 180;
    const minusFourDeg = (-4 * Math.PI) / 180;
    expect(applyRotate(fiveDeg, 0, minusFourDeg, false)).toBe(0);
  });
});

describe('snapAngle', () => {
  it('rounds to the nearest 15° step', () => {
    // 0.30 rad ≈ 17.2° → 15° = STEP
    expect(snapAngle(0.3)).toBeCloseTo(STEP);
    expect(snapAngle(STEP * 2.6)).toBeCloseTo(STEP * 3);
  });
  it('preserves negative angles', () => {
    expect(snapAngle(-STEP * 1.4)).toBeCloseTo(-STEP);
  });
});

describe('snapToCardinal', () => {
  it('snaps within ±3° of a cardinal', () => {
    const twoDeg = (2 * Math.PI) / 180;
    expect(snapToCardinal(twoDeg)).toBe(0);
    expect(snapToCardinal(CARDINAL - twoDeg)).toBeCloseTo(CARDINAL);
    expect(snapToCardinal(Math.PI - twoDeg)).toBeCloseTo(Math.PI);
    expect(snapToCardinal(-CARDINAL + twoDeg)).toBeCloseTo(-CARDINAL);
  });
  it('passes through angles outside the dead zone', () => {
    const tenDeg = (10 * Math.PI) / 180;
    expect(snapToCardinal(tenDeg)).toBeCloseTo(tenDeg);
  });
  it('accepts a custom tolerance', () => {
    const tenDeg = (10 * Math.PI) / 180;
    // Generous 15° tolerance: 10° pulls to 0.
    expect(snapToCardinal(tenDeg, Math.PI / 12)).toBe(0);
  });
});
