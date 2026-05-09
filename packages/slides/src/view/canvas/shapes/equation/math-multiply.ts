import type { PathBuilder } from '../builder';
import { adj } from '../builder';

/**
 * `mathMultiply` — `×` glyph: two thin rectangles rotated ±45° about
 * the frame centre.
 *
 * Adjustments — re-uses `MATH_PLUS_ADJUSTMENTS`:
 *   [0] armThickness — OOXML thousandths of `min(w,h)`. Default 23520.
 *
 * Each diagonal arm is expressed as an explicit polygon (via
 * moveTo/lineTo/closePath) rather than a transform-rotated rect, so
 * the test environment's Path2D shim — which has no save/restore
 * sub-path transform support — can hit-test it.
 */
export const buildMathMultiply: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 23520) / 100000) * Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  const halfDiag = Math.hypot(w, h) / 2;
  function diagonal(rotateRadians: number): void {
    const cosR = Math.cos(rotateRadians);
    const sinR = Math.sin(rotateRadians);
    const corners: Array<[number, number]> = [
      [-halfDiag, -t / 2],
      [halfDiag, -t / 2],
      [halfDiag, t / 2],
      [-halfDiag, t / 2],
    ];
    corners.forEach(([x, y], i) => {
      const xr = x * cosR - y * sinR + cx;
      const yr = x * sinR + y * cosR + cy;
      if (i === 0) path.moveTo(xr, yr);
      else path.lineTo(xr, yr);
    });
    path.closePath();
  }
  diagonal(Math.PI / 4); // top-left → bottom-right arm
  diagonal(-Math.PI / 4); // bottom-left → top-right arm
  return path;
};
