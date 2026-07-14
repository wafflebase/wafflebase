import type { Crop } from './element';
import type { Rect } from '@wafflebase/core/geometry';

/**
 * Pure geometry for interactive image crop (P0 — rectangular).
 *
 * Coordinate model (all rects in slide-logical coords, axis-aligned;
 * crop is only entered on top-level, non-rotated images):
 *
 * - `Crop = { x, y, w, h }` is a normalized `0..1` sub-rectangle of the
 *   source bitmap. The renderer stretches that source-rect onto the
 *   element frame (`drawImage(img, sx,sy,sw,sh, 0,0,w,h)`).
 * - The **full** rect is the box the WHOLE bitmap would occupy on the
 *   slide at the current display scale, given that `crop` maps onto
 *   `frame`. During a crop session the full rect is the dimmed bitmap
 *   and the element `frame` is the bright crop **window** over it.
 *
 * These functions are renderer-agnostic of the image's natural pixel
 * size: `crop` is a normalized fraction, so `full`/`window` derive from
 * `frame` + `crop` alone. The natural size only matters to the
 * source-rect renderer, which stays the source of truth for committed
 * paint and remains consistent (full-bitmap-into-full clipped to window
 * == source-rect-crop into frame).
 */

export type { Rect };

export type CropHandle =
  | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Minimum crop-window size, in slide-logical px (slide is 1920 wide). */
export const MIN_CROP_PX = 20;

const IDENTITY_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** `crop` defaulting to the whole image when absent. */
export function effectiveCrop(crop: Crop | undefined): Crop {
  return crop ?? IDENTITY_CROP;
}

/**
 * The full-bitmap rect: where the whole image would be drawn at the
 * current scale, given `crop` maps onto `frame`.
 */
export function cropToFull(frame: Rect, crop: Crop | undefined): Rect {
  const c = effectiveCrop(crop);
  const w = frame.w / c.w;
  const h = frame.h / c.h;
  return { x: frame.x - c.x * w, y: frame.y - c.y * h, w, h };
}

/** Derive a normalized crop from a window rect over the full rect. */
export function windowToCrop(full: Rect, window: Rect): Crop {
  return {
    x: (window.x - full.x) / full.w,
    y: (window.y - full.y) / full.h,
    w: window.w / full.w,
    h: window.h / full.h,
  };
}

/**
 * Move the dragged edges of the crop window by `(dx, dy)`, keeping the
 * anchor (opposite) edges fixed. Moved edges are clamped to the full
 * rect and to `min` size so the window never escapes the bitmap or
 * collapses.
 */
export function applyCropHandle(
  full: Rect,
  window: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  min: number = MIN_CROP_PX,
): Rect {
  let left = window.x;
  let top = window.y;
  let right = window.x + window.w;
  let bottom = window.y + window.h;
  const fullRight = full.x + full.w;
  const fullBottom = full.y + full.h;
  // A bitmap smaller than `min` on an axis would otherwise invert the
  // clamp range (`left + min > fullRight`) and let the edge escape the
  // bitmap. Cap the min size to the available extent.
  const minW = Math.min(min, full.w);
  const minH = Math.min(min, full.h);

  const movesLeft = handle === 'nw' || handle === 'w' || handle === 'sw';
  const movesRight = handle === 'ne' || handle === 'e' || handle === 'se';
  const movesTop = handle === 'nw' || handle === 'n' || handle === 'ne';
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se';

  if (movesLeft) left = clamp(left + dx, full.x, right - minW);
  if (movesRight) right = clamp(right + dx, left + minW, fullRight);
  if (movesTop) top = clamp(top + dy, full.y, bottom - minH);
  if (movesBottom) bottom = clamp(bottom + dy, top + minH, fullBottom);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Pan the full bitmap under a fixed crop window by `(dx, dy)`, clamped
 * so the window stays inside the bitmap.
 */
export function panFull(full: Rect, window: Rect, dx: number, dy: number): Rect {
  const x = clamp(full.x + dx, window.x + window.w - full.w, window.x);
  const y = clamp(full.y + dy, window.y + window.h - full.h, window.y);
  return { x, y, w: full.w, h: full.h };
}

/**
 * Clamp a crop to `[0,1]` on each axis and collapse a near-identity
 * crop to `undefined` so an "uncropped" image stays uncropped in the
 * model (and the renderer takes its cheaper no-crop path).
 */
export function normalizeCrop(crop: Crop, eps = 1e-4): Crop | undefined {
  const near = (a: number, b: number) => Math.abs(a - b) < eps;
  if (near(crop.x, 0) && near(crop.y, 0) && near(crop.w, 1) && near(crop.h, 1)) {
    return undefined;
  }
  const x = clamp(crop.x, 0, 1);
  const y = clamp(crop.y, 0, 1);
  return {
    x,
    y,
    w: clamp(crop.w, 0, 1 - x),
    h: clamp(crop.h, 0, 1 - y),
  };
}

// --- rotation support ---------------------------------------------------
//
// Crop is edited in the element's LOCAL frame (rotation removed), centred
// on the frame centre, so the rect math above is reused verbatim. Only
// the editor's pointer input, the renderer preview, and the overlay
// handles apply the rotation transform. These helpers convert between
// that centred-local space and stored world frames.

/** Rotate the vector `(x, y)` by the angle whose cos/sin are given. */
export function rotateVec(
  x: number,
  y: number,
  cos: number,
  sin: number,
): { x: number; y: number } {
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/** The centred-local crop window for an element's frame (rotation aside). */
export function frameToLocalWindow(frame: {
  w: number;
  h: number;
}): Rect {
  return { x: -frame.w / 2, y: -frame.h / 2, w: frame.w, h: frame.h };
}

/**
 * Convert a centred-local crop window back to a stored frame (world
 * axis-aligned `x/y/w/h`; the caller re-attaches `rotation`). `center` is
 * the session's fixed world rotation centre; `cos`/`sin` are of the
 * rotation angle. For an unrotated frame (`cos=1, sin=0`) this reduces to
 * `x = center.x + window.x` etc.
 */
export function windowToFrame(
  window: Rect,
  center: { x: number; y: number },
  cos: number,
  sin: number,
): Rect {
  const lcx = window.x + window.w / 2;
  const lcy = window.y + window.h / 2;
  const wc = rotateVec(lcx, lcy, cos, sin);
  return {
    x: center.x + wc.x - window.w / 2,
    y: center.y + wc.y - window.h / 2,
    w: window.w,
    h: window.h,
  };
}
