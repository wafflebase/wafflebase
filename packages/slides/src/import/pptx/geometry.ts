import type { Frame } from '../../model/element';
import type { ShapeKind } from '../../model/element';
import { PATH_BUILDERS } from '../../view/canvas/shapes';
import { attr, attrInt, child } from './xml';

/** EMU per inch — fundamental OOXML constant. */
export const EMU_PER_INCH = 914_400;
/** Default 16:9 widescreen size in EMU. Used as fallback when sldSz is missing. */
export const DEFAULT_WIDESCREEN_EMU = { cx: 12_192_000, cy: 6_858_000 } as const;

/** Per-axis EMU→px scale derived from the deck's `<p:sldSz>` and our 1920×1080 canvas. */
export interface EmuScale {
  sx: number;
  sy: number;
}

export function emuScale(slideSizeEmu: { cx: number; cy: number }): EmuScale {
  // Defensively guard against a deck whose `<p:sldSz>` is missing,
  // zero, or NaN. Without this, every frame multiplies by Infinity /
  // NaN and the entire import is unrecoverable. Fall through to the
  // widescreen default so the slides still render.
  const cx =
    Number.isFinite(slideSizeEmu.cx) && slideSizeEmu.cx > 0
      ? slideSizeEmu.cx
      : DEFAULT_WIDESCREEN_EMU.cx;
  const cy =
    Number.isFinite(slideSizeEmu.cy) && slideSizeEmu.cy > 0
      ? slideSizeEmu.cy
      : DEFAULT_WIDESCREEN_EMU.cy;
  return { sx: 1920 / cx, sy: 1080 / cy };
}

/** OOXML rotation is in 60000ths of a degree (`rot="5400000"` = 90°). */
export function rotEmuToRad(rot: number): number {
  return (rot / 60_000) * (Math.PI / 180);
}

/**
 * Convert an EMU stroke width to px using the deck's own scale.
 *
 * Frames are scaled per-axis (`sx`, `sy`), but stroke width is a single
 * scalar — we use the mean of the two scales so a flipped or non-16:9
 * deck still produces a stroke that's proportional to the rendered
 * frame rather than the 96-dpi default the importer used to assume.
 */
export function emuToStrokePx(emuWidth: number, scale: EmuScale): number {
  if (!Number.isFinite(emuWidth) || emuWidth < 0) return 0;
  return emuWidth * ((scale.sx + scale.sy) / 2);
}

/**
 * Build a `Frame` from a `<a:xfrm>` element using the per-axis scale.
 * Returns the zero frame when no geometry is present — the caller can
 * inherit from a placeholder or report it.
 */
export function parseXfrm(xfrm: Element | undefined, scale: EmuScale): Frame {
  if (!xfrm) return { x: 0, y: 0, w: 0, h: 0, rotation: 0 };
  const off = child(xfrm, 'off');
  const ext = child(xfrm, 'ext');
  const x = off ? (attrInt(off, 'x') ?? 0) : 0;
  const y = off ? (attrInt(off, 'y') ?? 0) : 0;
  const cx = ext ? (attrInt(ext, 'cx') ?? 0) : 0;
  const cy = ext ? (attrInt(ext, 'cy') ?? 0) : 0;
  const rot = attrInt(xfrm, 'rot') ?? 0;
  const flipH = attr(xfrm, 'flipH') === '1';
  const flipV = attr(xfrm, 'flipV') === '1';
  const frame: Frame = {
    x: x * scale.sx,
    y: y * scale.sy,
    w: cx * scale.sx,
    h: cy * scale.sy,
    rotation: rot ? rotEmuToRad(rot) : 0,
  };
  // Only carry the flip fields when set so unflipped frames keep their
  // existing JSON shape (Yorkie state and snapshots stay stable).
  if (flipH) frame.flipH = true;
  if (flipV) frame.flipV = true;
  return frame;
}

/**
 * Look up an OOXML preset-geometry name in the registered `ShapeKind`
 * set. Most prst names are identical to our kind ids — when they are,
 * the cast is valid because the strings match.
 *
 * Returns `undefined` for unknown names (rare custom OOXML prsts, or
 * connector prsts handled by `<p:cxnSp>` dispatch). Callers fall back
 * to `rect` and bump `report.unknownShapes`.
 */
export function prstToShapeKind(prst: string): ShapeKind | undefined {
  const candidate = prst as ShapeKind;
  if (PATH_BUILDERS.has(candidate)) return candidate;
  return undefined;
}
