import type { ImageElement } from '../../model/element';
import { getOrLoadImage } from './image-cache';
import type { FrameSize } from './shape-renderer';

/**
 * Draw an image element into element-local coordinates (top-left at
 * 0,0). Returns `true` if the image was actually painted, `false` if
 * the bitmap is still loading. Callers can use the return value to
 * decide whether they need to schedule a re-render once `onLoad`
 * fires.
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
  if (!img) return false;
  if (data.crop) {
    const sx = data.crop.x * img.naturalWidth;
    const sy = data.crop.y * img.naturalHeight;
    const sw = data.crop.w * img.naturalWidth;
    const sh = data.crop.h * img.naturalHeight;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }
  return true;
}
