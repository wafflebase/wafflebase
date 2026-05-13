import type { FrameSize } from '../builder';
import { polylineArc } from '../curves';

/**
 * `actionButtonHelp` glyph — stylised question mark: a curve at
 * the top + a centred dot at the bottom. V0 traces a thick arc as
 * an annular sector + a tail down to where the dot would sit, plus
 * the dot itself.
 */
export function buildHelpGlyph({ w, h }: FrameSize): Path2D {
  const m = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Top curve: thick arc from upper-left through the top to the
  // right side. Approximated as an annular sector.
  const outerR = m * 0.18;
  const innerR = m * 0.1;
  const arcCx = cx;
  const arcCy = cy - m * 0.08;
  const outer = polylineArc(arcCx, arcCy, outerR, outerR, Math.PI, 2 * Math.PI, 16);
  const inner = polylineArc(arcCx, arcCy, innerR, innerR, 2 * Math.PI, Math.PI, 16);
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) path.lineTo(outer[i].x, outer[i].y);
  // Down-tail from outer arc end to where the dot would be.
  const tailX = outer[outer.length - 1].x;
  path.lineTo(tailX, cy + m * 0.08);
  path.lineTo(tailX - (outerR - innerR), cy + m * 0.08);
  path.lineTo(tailX - (outerR - innerR), inner[0].y);
  for (const p of inner.slice(1)) path.lineTo(p.x, p.y);
  path.closePath();
  // Dot below the tail.
  const dotR = m * 0.05;
  const dot = polylineArc(cx, cy + m * 0.2, dotR, dotR, 0, 2 * Math.PI, 12);
  path.moveTo(dot[0].x, dot[0].y);
  for (let i = 1; i < dot.length; i++) path.lineTo(dot[i].x, dot[i].y);
  path.closePath();
  return path;
}
