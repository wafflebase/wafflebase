import type { FrameSize } from '../builder';
import { polylineArc } from '../curves';

/**
 * `actionButtonInformation` glyph — lowercase `i` (small dot above
 * a vertical stem).
 */
export function buildInformationGlyph({ w, h }: FrameSize): Path2D {
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Stem.
  path.moveTo(cx - m * 0.05, cy - m * 0.1);
  path.lineTo(cx + m * 0.05, cy - m * 0.1);
  path.lineTo(cx + m * 0.05, cy + m * 0.3);
  path.lineTo(cx - m * 0.05, cy + m * 0.3);
  path.closePath();
  // Dot.
  const dotR = m * 0.07;
  const dot = polylineArc(cx, cy - m * 0.22, dotR, dotR, 0, 2 * Math.PI, 12);
  path.moveTo(dot[0].x, dot[0].y);
  for (let i = 1; i < dot.length; i++) path.lineTo(dot[i].x, dot[i].y);
  path.closePath();
  return path;
}
