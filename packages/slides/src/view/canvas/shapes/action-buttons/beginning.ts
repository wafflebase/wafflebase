import type { FrameSize } from '../builder';

/**
 * `actionButtonBeginning` glyph — left triangle + vertical bar.
 */
export function buildBeginningGlyph({ w, h }: FrameSize): Path2D {
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Left bar.
  path.moveTo(cx - m * 0.25, cy - m * 0.22);
  path.lineTo(cx - m * 0.17, cy - m * 0.22);
  path.lineTo(cx - m * 0.17, cy + m * 0.22);
  path.lineTo(cx - m * 0.25, cy + m * 0.22);
  path.closePath();
  // Triangle.
  path.moveTo(cx - m * 0.15, cy);
  path.lineTo(cx + m * 0.22, cy - m * 0.22);
  path.lineTo(cx + m * 0.22, cy + m * 0.22);
  path.closePath();
  return path;
}
