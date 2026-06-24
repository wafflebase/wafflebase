import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `foldedCorner` — rectangle with the bottom-right (SE) corner visibly
 * folded inward, exposing a triangular flap. `adj1` is the fold size as
 * a fraction of `min(w, h)` (`ss` in OOXML). Matches the ECMA-376
 * `foldedCorner` preset geometry: the main body is the rectangle minus
 * the bottom-right notch, and a folded-over triangular flap sits at the
 * bottom-right.
 *
 * OOXML guides (l=0, t=0, r=w, b=h, y DOWN):
 *   a   = pin(0, adj, 50000)
 *   dy2 = ss · a / 100000      (fold depth)
 *   dy1 = dy2 / 5              (flap "lift")
 *   x1  = r − dy2
 *   x2  = x1 + dy1
 *   y2  = b − dy2
 *   y1  = y2 + dy1
 */
export const FOLDED_CORNER_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Fold size',
    defaultValue: 16667,
    min: 0,
    max: 50000,
  },
];

export const buildFoldedCorner: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, FOLDED_CORNER_ADJUSTMENTS[0].defaultValue);
  const ss = Math.min(w, h);
  const dy2 = (a1 / 100000) * ss;
  const dy1 = dy2 / 5;
  const x1 = w - dy2;
  const x2 = x1 + dy1;
  const y2 = h - dy2;
  const y1 = y2 + dy1;

  const path = new Path2D();
  // Main body: rectangle with the bottom-right corner notched away.
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, y2);
  path.lineTo(x1, h);
  path.lineTo(0, h);
  path.closePath();
  // Folded-over flap triangle at the bottom-right — painted as a
  // separate subpath, visually distinct via the dispatcher's edge
  // stroke. (OOXML's `darkenLess` shaded face.)
  path.moveTo(x1, h);
  path.lineTo(x2, y1);
  path.lineTo(w, y2);
  path.closePath();
  return path;
};

export const FOLDED_CORNER_HANDLES: readonly AdjustmentHandle[] = [
  // Diamond sits on the bottom edge at (x1, h) — drag left to grow the
  // fold (OOXML ahXY: pos x="x1" y="b"). Forward maps adj → x1 = w − f;
  // inverse: f = w − x → adj = ((w − x) / min(w,h)) * 100000.
  {
    position: ({ w, h }, adjs) => {
      const a1 = adjs[0] ?? FOLDED_CORNER_ADJUSTMENTS[0].defaultValue;
      const x1 = w - (a1 / 100000) * Math.min(w, h);
      return { x: insetAlongAxis(x1, w), y: insetAlongAxis(h, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const raw = Math.round(((w - pointer.x) / Math.min(w, h)) * 100000);
      const spec = FOLDED_CORNER_ADJUSTMENTS[0];
      const clamped = Math.max(spec.min, Math.min(spec.max, raw));
      const result = [...start];
      result[0] = clamped;
      return result;
    },
  },
];
