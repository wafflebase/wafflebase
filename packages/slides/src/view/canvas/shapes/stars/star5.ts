// packages/slides/src/view/canvas/shapes/stars/star5.ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj, regularPolygonPath } from '../builder';
import { radialStarHandle } from './handles';

export const STAR_5_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Inner radius',
    defaultValue: 19098,
    min: 0,
    max: 50000,
    format: (v) => `${(v / 1000).toFixed(1)}%`,
  },
];

/**
 * `star5` — 5-pointed regular star inscribed in the element frame,
 * apex up. Inner ring radius is `(adj[0] / 100000) × outer`.
 */
export const buildStar5: PathBuilder = ({ w, h }, adjustments) => {
  const ratio = adj(adjustments, 0, 19098) / 100000;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const points = 5;
  const baseRotation = -Math.PI / 2;
  const innerRotation = baseRotation + Math.PI / points;
  const outer = regularPolygonPath(cx, cy, rx, ry, points, baseRotation);
  const inner = regularPolygonPath(
    cx,
    cy,
    rx * ratio,
    ry * ratio,
    points,
    innerRotation,
  );
  const path = new Path2D();
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 0; i < points; i++) {
    path.lineTo(inner[i].x, inner[i].y);
    const next = (i + 1) % points;
    path.lineTo(outer[next].x, outer[next].y);
  }
  path.closePath();
  return path;
};

export const STAR_5_HANDLES = [radialStarHandle(5)] as const;
