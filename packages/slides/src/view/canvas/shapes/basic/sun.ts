import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj, regularPolygonPath } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `sun` — outer star polygon with 16 alternating points (8 sun
 * rays + 8 inner vertices) inscribed in the frame ellipse. `adj1`
 * controls the inner radius as a fraction of the outer radius —
 * 12500 → rays barely emerge; 50000 → rays nearly meet at the
 * centre. Default ~25000 produces a recognisable sun silhouette.
 */
const POINTS = 8;

export const SUN_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Ray length',
    defaultValue: 25000,
    min: 0,
    max: 50000,
  },
];

export const buildSun: PathBuilder = ({ w, h }, adjustments) => {
  const a = adj(adjustments, 0, SUN_ADJUSTMENTS[0].defaultValue);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const innerScale = 1 - a / 100000;
  const irx = rx * innerScale;
  const iry = ry * innerScale;
  const outer = regularPolygonPath(cx, cy, rx, ry, POINTS, -Math.PI / 2);
  // Inner vertices are also a regular polygon, rotated by half a
  // step so each inner point sits between two outer rays.
  const inner = regularPolygonPath(
    cx,
    cy,
    irx,
    iry,
    POINTS,
    -Math.PI / 2 + Math.PI / POINTS,
  );
  const path = new Path2D();
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 0; i < POINTS; i++) {
    path.lineTo(outer[i].x, outer[i].y);
    path.lineTo(inner[i].x, inner[i].y);
  }
  path.closePath();
  return path;
};

export const SUN_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const a = adjustments[0] ?? SUN_ADJUSTMENTS[0].defaultValue;
      const irx = (w / 2) * (1 - a / 100000);
      return {
        x: insetAlongAxis(w / 2 + irx, w),
        y: insetAlongAxis(h / 2, h),
      };
    },
    apply: ({ w }, start, pointer) => {
      // pointer is at distance r from centre on the +x axis →
      // inner radius = r; a = 100000 * (1 − r / outerRx).
      const rx = w / 2;
      if (rx <= 0) return [...start];
      const r = Math.max(0, pointer.x - w / 2);
      const raw = Math.round(100000 * (1 - r / rx));
      const spec = SUN_ADJUSTMENTS[0];
      const clamped = Math.max(spec.min, Math.min(spec.max, raw));
      const result = [...start];
      result[0] = clamped;
      return result;
    },
  },
];
