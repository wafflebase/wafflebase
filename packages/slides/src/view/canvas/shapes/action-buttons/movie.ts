import type { FrameSize } from '../builder';

/**
 * `actionButtonMovie` glyph — filmstrip outline with sprocket
 * marks on the left and right edges.
 */
export function buildMovieGlyph({ w, h }: FrameSize): Path2D {
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Filmstrip body (rounded ends approximated by simple rectangle
  // with notched short ends).
  const left = cx - m * 0.3;
  const right = cx + m * 0.3;
  const top = cy - m * 0.18;
  const bottom = cy + m * 0.18;
  path.moveTo(left, top);
  path.lineTo(right, top);
  path.lineTo(right, bottom);
  path.lineTo(left, bottom);
  path.closePath();
  // Sprocket holes — 3 on top, 3 on bottom, painted as a CCW
  // sub-path so they show as cutouts under non-zero winding.
  const holeR = m * 0.04;
  const holeYTop = top + m * 0.04;
  const holeYBot = bottom - m * 0.04;
  const stride = (right - left) / 4;
  for (let i = 0; i < 3; i++) {
    const x = left + stride * (i + 1);
    // Top hole.
    path.moveTo(x - holeR, holeYTop);
    path.lineTo(x - holeR, holeYTop + holeR);
    path.lineTo(x + holeR, holeYTop + holeR);
    path.lineTo(x + holeR, holeYTop);
    path.closePath();
    // Bottom hole.
    path.moveTo(x - holeR, holeYBot - holeR);
    path.lineTo(x - holeR, holeYBot);
    path.lineTo(x + holeR, holeYBot);
    path.lineTo(x + holeR, holeYBot - holeR);
    path.closePath();
  }
  return path;
}
