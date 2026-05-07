import type { Element } from '../../model/element';
import { drawShape } from './shape-renderer';
import { drawText } from './text-renderer';
import { drawImage } from './image-renderer';

/**
 * Draw an element in world coordinates. Sets up the frame transform
 * (translate + rotate around frame centre), dispatches to the
 * type-specific painter, and restores the ctx state. Per-type painters
 * always work in element-local coordinates.
 *
 * `onAssetLoad` is invoked the first time an async resource (currently
 * only images) finishes loading. The slide-renderer (T6) wires this
 * to a re-render request so the slide repaints once the asset arrives.
 */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  element: Element,
  onAssetLoad: () => void,
): void {
  const { frame } = element;
  ctx.save();
  // try/finally so the ctx state is always restored, even if a
  // per-type painter throws. Without this, a single corrupted element
  // (e.g. malformed image data) leaks the rotate / translate transform
  // into every subsequent element on the slide.
  try {
    if (frame.rotation === 0) {
      ctx.translate(frame.x, frame.y);
    } else {
      ctx.translate(frame.x + frame.w / 2, frame.y + frame.h / 2);
      ctx.rotate(frame.rotation);
      ctx.translate(-frame.w / 2, -frame.h / 2);
    }
    const size = { w: frame.w, h: frame.h };
    switch (element.type) {
      case 'shape':
        drawShape(ctx, size, element.data);
        break;
      case 'text':
        drawText(ctx, size, element.data);
        break;
      case 'image':
        drawImage(ctx, size, element.data, onAssetLoad);
        break;
    }
  } finally {
    ctx.restore();
  }
}
