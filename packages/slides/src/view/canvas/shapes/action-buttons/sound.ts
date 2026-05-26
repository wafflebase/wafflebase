import type { FrameSize } from '../builder';

/**
 * `actionButtonSound` glyph — speaker silhouette (square base +
 * triangular flare). Sound waves are skipped in V0 to keep the
 * glyph readable at picker size.
 */
export function buildSoundGlyph({ w, h }: FrameSize): Path2D {
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Square base.
  path.moveTo(cx - m * 0.22, cy - m * 0.1);
  path.lineTo(cx - m * 0.05, cy - m * 0.1);
  // Flared cone to the right.
  path.lineTo(cx + m * 0.22, cy - m * 0.25);
  path.lineTo(cx + m * 0.22, cy + m * 0.25);
  path.lineTo(cx - m * 0.05, cy + m * 0.1);
  path.lineTo(cx - m * 0.22, cy + m * 0.1);
  path.closePath();
  return path;
}
