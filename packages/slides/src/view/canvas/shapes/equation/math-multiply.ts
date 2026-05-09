import type { PathBuilder } from '../builder';
import { adj } from '../builder';

/**
 * `mathMultiply` — `×` glyph: a single 12-vertex polygon outlining
 * the X (the union of two thin perpendicular bars rotated 45°).
 *
 * Adjustments — re-uses `MATH_PLUS_ADJUSTMENTS`:
 *   [0] armThickness — OOXML thousandths of `min(w,h)`. Default 23520.
 *
 * Why a single polygon: the previous implementation drew two
 * separate diagonal rectangles. When stroked, both rectangles'
 * boundaries — including the four inner edges that sit inside the
 * cross overlap — were painted, leaving a small visible square
 * outline at the centre where the arms intersect. Tracing the X
 * union as one polygon emits the outer outline only.
 *
 * Construction: build the cross unrotated (a `+` with arms of
 * length `2 * halfDiag`, where halfDiag = hypot(w, h) / 2), walk
 * the 12-vertex outline clockwise, then rotate every vertex by 45°
 * about the centre.
 */
export const buildMathMultiply: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 23520) / 100000) * Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const halfDiag = Math.hypot(w, h) / 2;
  const half = t / 2;
  // 12-vertex `+` outline in a centre-origin frame, walked clockwise
  // starting from the top-left corner of the top arm tip.
  const localVerts: Array<[number, number]> = [
    [-half, -halfDiag], // 1. top-arm tip, top-left corner
    [half, -halfDiag],  // 2. top-arm tip, top-right corner
    [half, -half],      // 3. top-right inner notch
    [halfDiag, -half],  // 4. right-arm tip, top-right corner
    [halfDiag, half],   // 5. right-arm tip, bottom-right corner
    [half, half],       // 6. bottom-right inner notch
    [half, halfDiag],   // 7. bottom-arm tip, bottom-right corner
    [-half, halfDiag],  // 8. bottom-arm tip, bottom-left corner
    [-half, half],      // 9. bottom-left inner notch
    [-halfDiag, half],  // 10. left-arm tip, bottom-left corner
    [-halfDiag, -half], // 11. left-arm tip, top-left corner
    [-half, -half],     // 12. top-left inner notch
  ];
  const cosR = Math.SQRT1_2; // cos 45°
  const sinR = Math.SQRT1_2; // sin 45°
  const path = new Path2D();
  localVerts.forEach(([x, y], i) => {
    const xr = x * cosR - y * sinR + cx;
    const yr = x * sinR + y * cosR + cy;
    if (i === 0) path.moveTo(xr, yr);
    else path.lineTo(xr, yr);
  });
  path.closePath();
  return path;
};
