import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

/**
 * `hexagon` — horizontal hexagon (long axis = w) with triangular
 * notches on the left and right edges.
 *
 * Adjustments:
 *   [0] notchDepth — OOXML thousandths of `min(w,h)`; default 25000.
 */
export const HEXAGON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Notch depth', defaultValue: 25000, min: 0, max: 100000 },
];

export const buildHexagon: PathBuilder = ({ w, h }, adjustments) => {
  const notch = (adj(adjustments, 0, 25000) / 100000) * Math.min(w, h);
  const path = new Path2D();
  // Horizontal hexagon (long axis = w). Notches cut the left/right edges.
  path.moveTo(notch, 0);
  path.lineTo(w - notch, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - notch, h);
  path.lineTo(notch, h);
  path.lineTo(0, h / 2);
  path.closePath();
  return path;
};
