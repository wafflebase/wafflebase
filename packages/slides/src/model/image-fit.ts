import type { Crop, ImageFit } from './element';
import { cropToFull, type Rect } from './image-crop';

/**
 * Pure geometry for {@link ImageFit}, shared by the canvas renderer and the
 * PPTX exporter so a fitted image paints and exports from the same numbers.
 *
 * `nw × nh` is the bitmap's natural pixel size and `w × h` the element frame
 * in slide-logical px. Both helpers return `null` when the natural size is
 * unknown (0), which callers treat as `'fill'` (stretch).
 */

/**
 * `'cover'`: the largest centred sub-rectangle of the bitmap whose aspect
 * ratio matches the frame, as a normalized {@link Crop}. Stretched onto the
 * frame it fills it, cropping the overflow equally from both sides.
 */
export function coverCrop(
  nw: number,
  nh: number,
  w: number,
  h: number,
): Crop | null {
  if (!(nw > 0 && nh > 0 && w > 0 && h > 0)) return null;
  const frameAR = w / h;
  const imgAR = nw / nh;
  // Wider than the frame → crop left/right; otherwise crop top/bottom.
  const cw = imgAR > frameAR ? frameAR / imgAR : 1;
  const ch = imgAR > frameAR ? 1 : imgAR / frameAR;
  return { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
}

/**
 * `'contain'`: where the whole bitmap is drawn inside the frame, as a rect
 * in frame-local px. Aspect ratio is kept and the result centred; the scale
 * is clamped at 1, so a bitmap smaller than the frame is drawn at natural
 * size rather than upscaled.
 */
export function containRect(
  nw: number,
  nh: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  if (!(nw > 0 && nh > 0 && w > 0 && h > 0)) return null;
  const scale = Math.min(w / nw, h / nh, 1);
  const dw = nw * scale;
  const dh = nh * scale;
  return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh };
}

/**
 * The crop-session geometry that reproduces what a fitted, uncropped image
 * paints, so entering crop mode does not jump. `window` is the element's
 * frame rect (centred-local or world, the math is the same); the result is
 * the `full` bitmap rect and the visible `window` the session starts from:
 *   - `'cover'`  — the frame stays the window; `full` extends past it by the
 *                  centre crop (the same {@link coverCrop} the renderer uses).
 *   - `'contain'` — the window shrinks to the letterboxed rect, which shows
 *                  the whole bitmap, so `full` is that same rect.
 * Returns `null` for `'fill'` / absent / an unknown natural size, where the
 * plain stretch (`cropToFull(window, undefined)`) already matches the paint.
 */
export function fitCropSession(
  window: Rect,
  fit: ImageFit | undefined,
  nw: number,
  nh: number,
): { full: Rect; window: Rect } | null {
  if (fit === 'cover') {
    const c = coverCrop(nw, nh, window.w, window.h);
    return c ? { full: cropToFull(window, c), window } : null;
  }
  if (fit === 'contain') {
    const r = containRect(nw, nh, window.w, window.h);
    if (!r) return null;
    const shown = { x: window.x + r.x, y: window.y + r.y, w: r.w, h: r.h };
    return { full: shown, window: shown };
  }
  return null;
}
