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
    expect(pxToTwips(96)).toBeCloseTo(1440, 1);
  });

  it('should convert px to EMUs (reverse)', () => {
    expect(pxToEmus(96)).toBeCloseTo(914400, 1);
  });

  it('should convert points to half-points (reverse)', () => {
    expect(pointsToHalfPoints(12)).toBe(24);
  });
});
