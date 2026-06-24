import { describe, it, expect } from 'vitest';
import {
  MATH_NOT_EQUAL_ADJUSTMENTS,
  MATH_NOT_EQUAL_HANDLES,
} from '../../../../../src/view/canvas/shapes/equation/math-not-equal';

const DEF = MATH_NOT_EQUAL_ADJUSTMENTS.map((a) => a.defaultValue);

describe('MATH_NOT_EQUAL_HANDLES', () => {
  it('registers bar-thickness, slash-angle, and gap handles', () => {
    expect(MATH_NOT_EQUAL_HANDLES).toHaveLength(3);
  });

  it('bar-thickness handle (0) round-trips its drag', () => {
    const frame = { w: 200, h: 100 };
    const pos = MATH_NOT_EQUAL_HANDLES[0].position(frame, [...DEF]);
    const next = MATH_NOT_EQUAL_HANDLES[0].apply(frame, [...DEF], pos);
    expect(next[0]).toBeCloseTo(DEF[0], 0);
    expect(next[1]).toBe(DEF[1]); // angle untouched
    expect(next[2]).toBe(DEF[2]); // gap untouched
  });

  it('slash-angle handle (1) stores raw 60000ths and round-trips', () => {
    const frame = { w: 200, h: 100 };
    const pos = MATH_NOT_EQUAL_HANDLES[1].position(frame, [...DEF]);
    const next = MATH_NOT_EQUAL_HANDLES[1].apply(frame, [...DEF], pos);
    expect(next[1]).toBeCloseTo(DEF[1], -4); // ≈6600000 within angular tol
    expect(next[1]).toBeGreaterThanOrEqual(MATH_NOT_EQUAL_ADJUSTMENTS[1].min);
    expect(next[1]).toBeLessThanOrEqual(MATH_NOT_EQUAL_ADJUSTMENTS[1].max);
    expect(next[0]).toBe(DEF[0]);
    expect(next[2]).toBe(DEF[2]);
  });

  it('gap handle (2) round-trips and is clamped by bar thickness', () => {
    const frame = { w: 200, h: 100 };
    const pos = MATH_NOT_EQUAL_HANDLES[2].position(frame, [...DEF]);
    const next = MATH_NOT_EQUAL_HANDLES[2].apply(frame, [...DEF], pos);
    expect(next[2]).toBeCloseTo(DEF[2], 0);
    // maxAdj3 = 100000 - 2*a1; dragging the gap huge cannot exceed it.
    const big = MATH_NOT_EQUAL_HANDLES[2].apply(frame, [...DEF], {
      x: 100,
      y: 0,
    });
    expect(big[2]).toBeLessThanOrEqual(100000 - 2 * DEF[0]);
  });
});
