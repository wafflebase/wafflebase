import type { FrameSize } from '../builder';

/**
 * `actionButtonReturn` glyph — bent return arrow: descends, turns
 * left, ends with a leftward arrowhead.
 */
export function buildReturnGlyph({ w, h }: FrameSize): Path2D {
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const thick = m * 0.07;
  const path = new Path2D();
  // Vertical stem on the right + horizontal leg + arrowhead on the left.
  path.moveTo(cx + m * 0.18 - thick, cy - m * 0.25);
  path.lineTo(cx + m * 0.18 + thick, cy - m * 0.25);
  path.lineTo(cx + m * 0.18 + thick, cy + m * 0.1 + thick);
  path.lineTo(cx - m * 0.05, cy + m * 0.1 + thick);
  path.lineTo(cx - m * 0.05, cy + m * 0.22);
  path.lineTo(cx - m * 0.25, cy + m * 0.1);
  path.lineTo(cx - m * 0.05, cy - m * 0.02);
  path.lineTo(cx - m * 0.05, cy + m * 0.1 - thick);
  path.lineTo(cx + m * 0.18 - thick, cy + m * 0.1 - thick);
  path.closePath();
  return path;
}
