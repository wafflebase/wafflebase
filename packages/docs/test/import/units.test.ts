import { describe, it, expect } from 'vitest';
import { twipsToPx, emusToPx, halfPointsToPoints, pxToTwips, pxToEmus, pointsToHalfPoints } from '../../src/import/units.js';

describe('OOXML unit conversions', () => {
  it('should convert twips to px', () => {
    expect(twipsToPx(1440)).toBeCloseTo(96, 1);    // 1 inch
    expect(twipsToPx(720)).toBeCloseTo(48, 1);      // 0.5 inch
  });

  it('should convert EMUs to px', () => {
    expect(emusToPx(914400)).toBeCloseTo(96, 1);    // 1 inch
    expect(emusToPx(457200)).toBeCloseTo(48, 1);     // 0.5 inch
  });

  it('should convert half-points to points', () => {
    expect(halfPointsToPoints(24)).toBe(12);
    expect(halfPointsToPoints(30)).toBe(15);
  });

  it('should convert px to twips (reverse)', () => {
    expect(pxToTwips(96)).toBe(1440);
  });

  it('should convert px to EMUs (reverse)', () => {
    expect(pxToEmus(96)).toBe(914400);
  });

  it('should convert points to half-points (reverse)', () => {
    expect(pointsToHalfPoints(12)).toBe(24);
  });

  it('should round reverse conversions to integers for OOXML', () => {
    // Non-integer inputs previously produced fractional values, which are
    // invalid for OOXML attributes that must be whole numbers.
    expect(pxToTwips(100)).toBe(Math.round(100 * 1440 / 96));
    expect(Number.isInteger(pxToTwips(100))).toBe(true);

    expect(pxToEmus(100)).toBe(Math.round(100 * 914400 / 96));
    expect(Number.isInteger(pxToEmus(100))).toBe(true);

    expect(pointsToHalfPoints(10.25)).toBe(21);
    expect(Number.isInteger(pointsToHalfPoints(10.25))).toBe(true);
  });
});
