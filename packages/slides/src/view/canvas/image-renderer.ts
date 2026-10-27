// Image placeholder colors are intentionally hard-coded; they represent a
// system fallback UI (broken/loading image) and don't follow the deck theme.
import type { ImageElement } from '../../model/element';
import { containRect, coverCrop } from '../../model/image-fit';
import { getOrLoadImage, isImageFailed } from './image-cache';
import type { FrameSize } from './shape-renderer';

/**
 * Draw an image element into element-local coordinates (top-left at
 * 0,0). Returns `true` if SOMETHING was painted (a real bitmap or a
 * load-failed placeholder), `false` only while the image is still
 * loading. Callers schedule a re-render once `onLoad` fires.
 *
 * The caller still owns the frame transform; this routine only knows
 * about (w, h).
 */
export function drawImage(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ImageElement['data'],
  onLoad: () => void,
): boolean {
  const img = getOrLoadImage(data.src, onLoad);
  if (img) {
    // `opacity < 1` comes from PPTX `<a:alphaModFix>`. Multiplying
    // into the existing `globalAlpha` (instead of replacing it) keeps
    // outer ghost/selection passes composing correctly.
    const opacity = data.opacity;
    const useAlpha = typeof opacity === 'number' && opacity < 1;
    // Recolor + brightness/contrast compose into a single `ctx.filter`.
    const filter = imageFilter(data);
    const useFilter = filter !== 'none';
    if (useAlpha || useFilter) {
      ctx.save();
      if (useAlpha) ctx.globalAlpha = ctx.globalAlpha * (opacity as number);
      if (useFilter) ctx.filter = filter;
    }
    if (data.crop) {
      // `crop` takes precedence over `fit` (documented on `ImageFit`):
      // an explicit crop rect is drawn stretched to the frame exactly as
      // before, so cropping behavior is unchanged when both are set.
      const sx = data.crop.x * img.naturalWidth;
      const sy = data.crop.y * img.naturalHeight;
      const sw = data.crop.w * img.naturalWidth;
      const sh = data.crop.h * img.naturalHeight;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      drawFitted(ctx, img, w, h, data.fit);
    }
    if (useAlpha || useFilter) ctx.restore();
    return true;
  }
  // Image failed to load — paint a placeholder so the user can see the
  // alt text instead of a blank rectangle. Spec: "Image load failure —
  // render a placeholder box with the alt text" (docs/design/slides/slides.md).
  if (isImageFailed(data.src)) {
    drawImageFailurePlaceholder(ctx, w, h, data.alt);
    return true;
  }
  return false;
}

/**
 * Paint a loaded bitmap into the `w × h` frame honoring its `fit` mode
 * (see {@link ImageFit}). Only reached on the non-cropped path.
 *
 * - `'fill'` / absent — stretch to the frame (historical behavior), one
 *   4-arg `drawImage(img, 0, 0, w, h)`.
 * - `'contain'` — scale by `min(w/nw, h/nh, 1)` (the `1` clamp is the
 *   no-upscale rule) and center. A bitmap smaller than the frame is drawn
 *   at natural size rather than upscaled/pixelated.
 * - `'cover'` — crop a frame-aspect-ratio rect from the center of the
 *   bitmap (source rect) and stretch it to the frame, so the frame is
 *   always filled. No-upscale does not apply: covering requires filling.
 *
 * Falls back to `'fill'` if natural dimensions are unavailable (0), which
 * would otherwise divide by zero.
 */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { naturalWidth: number; naturalHeight: number },
  w: number,
  h: number,
  fit: ImageElement['data']['fit'],
): void {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (fit === 'contain') {
    const r = containRect(nw, nh, w, h);
    if (r) {
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
      return;
    }
  } else if (fit === 'cover') {
    const c = coverCrop(nw, nh, w, h);
    if (c) {
      ctx.drawImage(img, c.x * nw, c.y * nh, c.w * nw, c.h * nh, 0, 0, w, h);
      return;
    }
  }
  ctx.drawImage(img, 0, 0, w, h);
}

/**
 * Build the CSS `ctx.filter` string for an image's recolor + brightness
 * + contrast adjustments, or `'none'` when no adjustment applies.
 * Brightness / contrast are stored as `[-1, 1]` deltas; CSS expects a
 * multiplier where `1` is unchanged, so each maps to `1 + clamp(v)`.
 */
export function imageFilter(data: ImageElement['data']): string {
  const parts: string[] = [];
  if (data.recolor === 'grayscale') parts.push('grayscale(1)');
  else if (data.recolor === 'sepia') parts.push('sepia(1)');
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
  if (typeof data.brightness === 'number' && data.brightness !== 0) {
    parts.push(`brightness(${(1 + clamp(data.brightness)).toFixed(3)})`);
  }
  if (typeof data.contrast === 'number' && data.contrast !== 0) {
    parts.push(`contrast(${(1 + clamp(data.contrast)).toFixed(3)})`);
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * Crop-session preview. `full`/`window` are in the element's CENTRED-
 * LOCAL space (origin at the frame centre, rotation removed); the
 * preview applies `center` + `rotation` so a rotated image crops in its
 * own rotated frame. The `full` rect is the whole bitmap at the current
 * display scale; the `window` rect is the bright crop window over it.
 * The region of `full` outside `window` is dimmed so the user sees what
 * is being trimmed away (Google-Slides crop mode).
 */
export interface CropPreview {
  /** Element being cropped — masked from the normal element pass. */
  elementId: string;
  src: string;
  /** Fixed world rotation centre of the session. */
  center: { x: number; y: number };
  /** Frame rotation in radians (0 for axis-aligned images). */
  rotation: number;
  full: { x: number; y: number; w: number; h: number };
  window: { x: number; y: number; w: number; h: number };
  /** Opacity of the dimmed (trimmed-away) region. Default 0.4. */
  dimAlpha?: number;
}

/**
 * Paint a crop-session preview: the full bitmap dimmed, then the crop
 * window re-painted at full opacity through a clip. No-op while the
 * image is still loading (caller re-renders on load).
 */
export function drawCropPreview(
  ctx: CanvasRenderingContext2D,
  preview: CropPreview,
  onLoad: () => void,
): void {
  const img = getOrLoadImage(preview.src, onLoad);
  if (!img) return;
  const { full, window, center, rotation } = preview;
  ctx.save();
  // Move into the element's rotated, centre-origin local frame so the
  // centred-local full/window rects paint in the right place.
  ctx.translate(center.x, center.y);
  if (rotation !== 0) ctx.rotate(rotation);
  // 1. Dimmed full bitmap — the trimmed-away region shows through here.
  ctx.save();
  ctx.globalAlpha = ctx.globalAlpha * (preview.dimAlpha ?? 0.4);
  ctx.drawImage(img, full.x, full.y, full.w, full.h);
  ctx.restore();
  // 2. Bright window — clip to the crop window, repaint the full bitmap.
  ctx.save();
  ctx.beginPath();
  ctx.rect(window.x, window.y, window.w, window.h);
  ctx.clip();
  ctx.drawImage(img, full.x, full.y, full.w, full.h);
  ctx.restore();
  ctx.restore();
}

function drawImageFailurePlaceholder(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  alt: string | undefined,
): void {
  ctx.save();
  // Light fill + dashed border so the placeholder is visually distinct
  // from a real shape but still gives a sense of the image's frame.
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.setLineDash([]);
  // Centred text, two lines max: a "broken image" hint and the alt
  // text (if any). Keep the font intentionally simple — we don't want
  // CJK fallback complications to leak into the placeholder path.
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '14px system-ui, sans-serif';
  const cx = w / 2;
  const cy = h / 2;
  if (alt) {
    ctx.fillText('Image unavailable', cx, cy - 10);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(alt, cx, cy + 10);
  } else {
    ctx.fillText('Image unavailable', cx, cy);
  }
  ctx.restore();
}
