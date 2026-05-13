import type { FrameSize } from '../builder';

/**
 * `actionButtonHome` glyph — house silhouette (triangular roof +
 * rectangular body).
 */
export function buildHomeGlyph({ w, h }: FrameSize): Path2D {
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Roof + body outline.
  path.moveTo(cx, cy - m * 0.3);
  path.lineTo(cx + m * 0.3, cy);
  path.lineTo(cx + m * 0.22, cy);
  path.lineTo(cx + m * 0.22, cy + m * 0.3);
  path.lineTo(cx - m * 0.22, cy + m * 0.3);
  path.lineTo(cx - m * 0.22, cy);
  path.lineTo(cx - m * 0.3, cy);
  path.closePath();
  return path;
}
