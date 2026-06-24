import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FaceBuilder,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { linearTopEdgeHandle } from '../handles';

/**
 * `bevel` — ECMA-376 OOXML raised-button rectangle. Unlike a hollow
 * `frame`, the centre is filled: a flat inner inset rectangle plus four
 * trapezoidal bevel faces (top, bottom, left, right) connect the inner
 * rect corners out to the outer rect corners, giving a 3D raised look.
 *
 * `adj1` is the bevel size, a fraction (thousandths) of `min(w, h)`:
 * inset `x1 = ss * adj / 100000`, with `ss = min(w, h)`,
 * `x2 = r - x1`, `y2 = b - x1`.
 *
 * `buildBevel` (PathBuilder) returns the full outer-rectangle
 * SILHOUETTE — the union outline used for hit-test, icon, snapshot and
 * export. `buildBevelFaces` (FaceBuilder) drives the multi-fill paint:
 * the inner rect at base fill, top/left lit (lighter), bottom/right
 * shadowed (darker), matching OOXML's `lightenLess`/`lighten`/
 * `darkenLess`/`darken` face fills.
 */
export const BEVEL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Bevel size',
    defaultValue: 12500,
    min: 0,
    max: 50000,
  },
];

/** Resolve the inset `x1` from the adjustments array (OOXML pins 0..50000). */
function bevelInset(w: number, h: number, adjustments?: number[]): number {
  const a1 = adj(adjustments, 0, BEVEL_ADJUSTMENTS[0].defaultValue);
  const a = Math.max(0, Math.min(50000, a1));
  return (a / 100000) * Math.min(w, h);
}

export const buildBevel: PathBuilder = ({ w, h }) => {
  // Silhouette = the full outer rectangle (union outline). The bevel is
  // a solid raised button, so the silhouette is just the frame rect,
  // including its filled centre.
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

/**
 * Multi-fill faces for the raised-button look. Painted back-to-front:
 * the inner inset rectangle (base fill), then the four bevel
 * trapezoids. Top/left catch the light (positive shade), bottom/right
 * fall in shadow (negative shade), mirroring OOXML's per-face fills.
 */
export const buildBevelFaces: FaceBuilder = ({ w, h }, adjustments) => {
  const x1 = bevelInset(w, h, adjustments);
  const l = 0;
  const t = 0;
  const r = w;
  const b = h;
  const x2 = r - x1;
  const y2 = b - x1;

  // Inner inset rectangle (flat top face).
  const inner = new Path2D();
  inner.moveTo(x1, x1);
  inner.lineTo(x2, x1);
  inner.lineTo(x2, y2);
  inner.lineTo(x1, y2);
  inner.closePath();

  // Top trapezoid: outer top edge → inner top edge.
  const top = new Path2D();
  top.moveTo(l, t);
  top.lineTo(r, t);
  top.lineTo(x2, x1);
  top.lineTo(x1, x1);
  top.closePath();

  // Left trapezoid: outer left edge → inner left edge.
  const left = new Path2D();
  left.moveTo(l, t);
  left.lineTo(x1, x1);
  left.lineTo(x1, y2);
  left.lineTo(l, b);
  left.closePath();

  // Right trapezoid: outer right edge → inner right edge.
  const right = new Path2D();
  right.moveTo(r, t);
  right.lineTo(r, b);
  right.lineTo(x2, y2);
  right.lineTo(x2, x1);
  right.closePath();

  // Bottom trapezoid: outer bottom edge → inner bottom edge.
  const bottom = new Path2D();
  bottom.moveTo(l, b);
  bottom.lineTo(x1, y2);
  bottom.lineTo(x2, y2);
  bottom.lineTo(r, b);
  bottom.closePath();

  return [
    { path: inner, shade: 0 },
    { path: top, shade: 0.18 },
    { path: left, shade: 0.1 },
    { path: right, shade: -0.1 },
    { path: bottom, shade: -0.18 },
  ];
};

export const BEVEL_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (a, { w, h }) => (a / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: BEVEL_ADJUSTMENTS[0],
  }),
];
