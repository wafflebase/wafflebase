/**
 * OOXML ↔ CSS px unit conversions.
 *
 * 1 inch = 1440 twips = 914400 EMUs = 72 points = 96 CSS px
 */

/** Twips (1/1440 inch) → CSS pixels (1/96 inch). */
export function twipsToPx(twips: number): number {
  return twips * 96 / 1440;
}

/** CSS pixels → twips. */
export function pxToTwips(px: number): number {
  return px * 1440 / 96;
}

/** EMUs (1/914400 inch) → CSS pixels. */
export function emusToPx(emus: number): number {
  return emus * 96 / 914400;
}

/** CSS pixels → EMUs. */
export function pxToEmus(px: number): number {
  return px * 914400 / 96;
}

/** OOXML half-points → points. */
export function halfPointsToPoints(halfPts: number): number {
  return halfPts / 2;
}

/** Points → OOXML half-points. */
export function pointsToHalfPoints(pts: number): number {
  return pts * 2;
}
