import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { insetAlongAxis } from '../handles';

/**
 * `moon` — crescent silhouette. Outer left-facing half-ellipse plus
 * inner right-facing half-ellipse (offset rightward by `adj1`) form
 * the C-shape. `adj1` controls the crescent thickness — 0 produces a
 * thin sliver, 87500 nearly fills the frame.
 */
export const MOON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Crescent thickness',
    defaultValue: 50000,
    min: 0,
    max: 87500,
  },
];

export const buildMoon: PathBuilder = ({ w, h }, adjustments) => {
  const a = adj(adjustments, 0, MOON_ADJUSTMENTS[0].defaultValue);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  // Outer crescent: left half of the frame ellipse.
  const outer = polylineArc(cx, cy, rx, ry, Math.PI / 2, (3 * Math.PI) / 2, 16);
  // Inner cutout: a smaller ellipse offset rightward. Its left edge
  // matches the inner curve of the crescent.
  const innerRx = rx * (1 - a / 100000);
  const offsetCx = cx + (rx - innerRx);
  const inner = polylineArc(
    offsetCx,
    cy,
    innerRx,
    ry,
    (3 * Math.PI) / 2,
    Math.PI / 2,
    16,
  );
  const path = new Path2D();
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) {
    path.lineTo(outer[i].x, outer[i].y);
  }
  for (const p of inner) {
    path.lineTo(p.x, p.y);
  }
  path.closePath();
  return path;
};

export const MOON_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const a = adjustments[0] ?? MOON_ADJUSTMENTS[0].defaultValue;
      // Inner-curve rightmost point sits at x = cx − rx + 2 * (rx −
      // innerRx) = cx + rx − 2*innerRx.
      const cx = w / 2;
      const rx = w / 2;
      const innerRx = rx * (1 - a / 100000);
      return {
        x: insetAlongAxis(cx + rx - 2 * innerRx, w),
        y: insetAlongAxis(h / 2, h),
      };
    },
    apply: ({ w }, start, pointer) => {
      // x = cx + rx − 2 * innerRx  ⇒  innerRx = (cx + rx − x) / 2
      // a = 100000 (1 − innerRx / rx)
      const cx = w / 2;
      const rx = w / 2;
      const innerRx = Math.max(0, (cx + rx - pointer.x) / 2);
      const raw = Math.round(100000 * (1 - innerRx / rx));
      const spec = MOON_ADJUSTMENTS[0];
      const clamped = Math.max(spec.min, Math.min(spec.max, raw));
      const result = [...start];
      result[0] = clamped;
      return result;
    },
  },
];
