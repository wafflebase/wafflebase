import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../model/presentation.js';

const EMU_W = 12_192_000;
const EMU_H = 6_858_000;

export function pxToEmuX(px: number): number {
  return Math.round((px / SLIDE_WIDTH) * EMU_W);
}
export function pxToEmuY(px: number): number {
  return Math.round((px / SLIDE_HEIGHT) * EMU_H);
}
/** Uniform px→EMU using the X factor; for stroke widths and square extents. */
export function pxToEmu(px: number): number {
  return Math.round((px / SLIDE_WIDTH) * EMU_W);
}
export function degToRot60k(deg: number): number {
  return Math.round(deg * 60_000);
}
export function ptToHundredths(pt: number): number {
  return Math.round(pt * 100);
}
