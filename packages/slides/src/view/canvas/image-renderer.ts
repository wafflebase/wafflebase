// Image placeholder colors are intentionally hard-coded; they represent a
// system fallback UI (broken/loading image) and don't follow the deck theme.
import type { ImageElement } from '../../model/element';
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
      const sx = data.crop.x * img.naturalWidth;
      const sy = data.crop.y * img.naturalHeight;
      const sw = data.crop.w * img.naturalWidth;
      const sh = data.crop.h * img.naturalHeight;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      ctx.drawImage(img, 0, 0, w, h);
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
