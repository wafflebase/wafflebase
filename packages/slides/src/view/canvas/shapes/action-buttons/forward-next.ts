import type { FrameSize } from '../builder';

/**
 * `actionButtonForwardNext` glyph — right-pointing triangle.
 */
export function buildForwardNextGlyph({ w, h }: FrameSize): Path2D {
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  path.moveTo(cx + m * 0.22, cy);
  path.lineTo(cx - m * 0.18, cy - m * 0.2);
  path.lineTo(cx - m * 0.18, cy + m * 0.2);
  path.closePath();
  return path;
}
