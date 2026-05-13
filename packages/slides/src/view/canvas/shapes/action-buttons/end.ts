import type { FrameSize } from '../builder';

/**
 * `actionButtonEnd` glyph — right triangle + vertical bar.
 */
export function buildEndGlyph({ w, h }: FrameSize): Path2D {
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Triangle.
  path.moveTo(cx + m * 0.15, cy);
  path.lineTo(cx - m * 0.22, cy - m * 0.22);
  path.lineTo(cx - m * 0.22, cy + m * 0.22);
  path.closePath();
  // Right bar.
  path.moveTo(cx + m * 0.17, cy - m * 0.22);
  path.lineTo(cx + m * 0.25, cy - m * 0.22);
  path.lineTo(cx + m * 0.25, cy + m * 0.22);
  path.lineTo(cx + m * 0.17, cy + m * 0.22);
  path.closePath();
  return path;
}
