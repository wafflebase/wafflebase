import { SLIDE_WIDTH } from '../../model/presentation.js';

// The logical canvas width (1920 px) maps to a fixed 13.333" (12192000
// EMU) page, i.e. 6350 EMU/px. The mapping is **isotropic**: Y uses the
// same factor as X, so a non-16:9 deck (taller logical height) exports
// with square pixels and its true aspect. The deck's `<p:sldSz cy>` is
// derived from the same factor (see presentation.ts).
const EMU_W = 12_192_000;

export function pxToEmuX(px: number): number {
  return Math.round((px / SLIDE_WIDTH) * EMU_W);
}
export function pxToEmuY(px: number): number {
  return Math.round((px / SLIDE_WIDTH) * EMU_W);
}
/** Uniform px→EMU using the X factor; for stroke widths and square extents. */
export function pxToEmu(px: number): number {
  return Math.round((px / SLIDE_WIDTH) * EMU_W);
}
export function radToRot60k(rad: number): number {
  return Math.round(rad * (180 / Math.PI) * 60_000);
}
export function ptToHundredths(pt: number): number {
  return Math.round(pt * 100);
}
