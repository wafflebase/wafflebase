/**
 * OOXML ↔ CSS px unit conversions.
 *
 * 1 inch = 1440 twips = 914400 EMUs = 72 points = 96 CSS px
 */

/** Twips (1/1440 inch) → CSS pixels (1/96 inch). */
export function twipsToPx(twips: number): number {
  return twips * 96 / 1440;
}

/**
 * CSS pixels → twips. Rounded because OOXML attributes expect integer values.
 */
export function pxToTwips(px: number): number {
  return Math.round(px * 1440 / 96);
}

/** EMUs (1/914400 inch) → CSS pixels. */
export function emusToPx(emus: number): number {
  return emus * 96 / 914400;
}

/**
 * CSS pixels → EMUs. Rounded because OOXML drawing extents expect integer
 * EMU values.
 */
export function pxToEmus(px: number): number {
  return Math.round(px * 914400 / 96);
}

/** OOXML half-points → points. */
export function halfPointsToPoints(halfPts: number): number {
  return halfPts / 2;
}

/**
 * Points → OOXML half-points. Rounded because OOXML size attributes expect
 * integer half-point values.
 */
export function pointsToHalfPoints(pts: number): number {
  return Math.round(pts * 2);
}
