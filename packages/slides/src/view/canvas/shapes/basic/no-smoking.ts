import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { linearTopEdgeHandle } from '../handles';

/**
 * `noSmoking` — annular ring with a diagonal NW→SE slash cutting
 * through the central hole. `adj1` is the ring/slash thickness as an
 * OOXML thousandths fraction of `min(w, h)`; the slash band shares the
 * ring's thickness, matching the OOXML preset's single `adj1`.
 *
 * Geometry: one outer ellipse loop + two C-shaped inner-hole loops
 * (NE and SW of the slash). The slash is clipped to the outer ellipse,
 * and the inner ellipse is broken in two by the slash band edges —
 * each hole's boundary is an inner-ellipse arc joined to a straight
 * slash-edge segment. Rendered with the even-odd fill rule (see
 * `shape-renderer.EVENODD_KINDS`) so the two inner sub-paths punch
 * holes through the outer silhouette without depending on winding
 * direction.
 *
 * The previous V0 implementation drew three separate closed sub-paths
 * (outer ring + inner ring + thick slash rectangle): `ctx.fill` merged
 * them correctly under non-zero winding, but `ctx.stroke(path)` traced
 * every sub-path independently, leaving a visible band rectangle
 * outline where the slash overlapped the ring and a small overshoot
 * past the outer perimeter. Same fix shape as `mathNotEqual` /
 * `mathMultiply`: trace the union outline so fill and stroke agree.
 */
export const NO_SMOKING_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Band thickness',
    defaultValue: 18750,
    min: 0,
    max: 50000,
  },
];

const TWO_PI = Math.PI * 2;
// Per inner-hole arc. 16 segments at slide scale (~0.3 × frame) keeps
// chord error well under 1px; the polyline endpoints are pinned to the
// exact line-ellipse intersections so the arc still closes flush with
// the band edge.
const INNER_ARC_SEGMENTS = 16;

/**
 * Solve the two parametric `s` values where line `(p0 + s*d)` meets an
 * axis-aligned ellipse with semi-axes `(eX, eY)` centred at the origin.
 * Returns ascending roots, or `null` when the line misses the ellipse
 * (band wider than the inner ellipse along `n`) or the semi-axes are
 * degenerate.
 */
function lineEllipseRoots(
  p0x: number,
  p0y: number,
  dx: number,
  dy: number,
  eX: number,
  eY: number,
): [number, number] | null {
  if (eX <= 0 || eY <= 0) return null;
  const A = (dx * dx) / (eX * eX) + (dy * dy) / (eY * eY);
  if (A === 0) return null;
  const B = 2 * ((p0x * dx) / (eX * eX) + (p0y * dy) / (eY * eY));
  const C = (p0x * p0x) / (eX * eX) + (p0y * p0y) / (eY * eY) - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const r1 = (-B - sq) / (2 * A);
  const r2 = (-B + sq) / (2 * A);
  return [Math.min(r1, r2), Math.max(r1, r2)];
}

/**
 * Pick the sweep endpoint (`thStart + forwardDelta` vs
 * `thStart - (2π − forwardDelta)`) so the arc midpoint's signed
 * perpendicular along `n` matches `desiredSign`. Used to choose the
 * "NE-side" vs "SW-side" arc when both connect the same two
 * intersection points.
 */
function pickArcEnd(
  thStart: number,
  thEnd: number,
  irx: number,
  iry: number,
  nx: number,
  ny: number,
  desiredSign: 1 | -1,
): number {
  const forwardDelta = ((thEnd - thStart) % TWO_PI + TWO_PI) % TWO_PI;
  const midForward = thStart + forwardDelta / 2;
  const sp =
    irx * Math.cos(midForward) * nx + iry * Math.sin(midForward) * ny;
  const matches = desiredSign > 0 ? sp > 0 : sp < 0;
  return matches
    ? thStart + forwardDelta
    : thStart - (TWO_PI - forwardDelta);
}

export const buildNoSmoking: PathBuilder = ({ w, h }, adjustments) => {
  const a = adj(adjustments, 0, NO_SMOKING_ADJUSTMENTS[0].defaultValue);
  const m = Math.min(w, h);
  const t = (a / 100000) * m;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const innerScale = Math.max(0, 1 - (2 * t) / m);
  const irx = rx * innerScale;
  const iry = ry * innerScale;

  // Slash direction: NW corner → SE corner of the bounding box.
  // `n` is the 90°-CCW perpendicular in math convention; canvas y is
  // down, so visually `+n` points toward the SW corner and `−n` toward
  // the NE corner. The band's two edges sit at `±n · t/2`.
  const diagLen = Math.hypot(w, h);
  const dx = diagLen > 0 ? w / diagLen : 1;
  const dy = diagLen > 0 ? h / diagLen : 0;
  const nx = -dy;
  const ny = dx;
  const ht = t / 2;

  const path = new Path2D();

  // Outer ellipse — single closed loop. polylineArc(0, 2π) sweeps θ
  // E→S→W→N (visually CW in canvas y-down). The two inner-hole
  // sub-paths below punch through it via the even-odd fill rule
  // (EVENODD_KINDS); their CCW winding is incidental — it just keeps
  // the geometry self-consistent if anything ever calls fill('nonzero').
  const outer = polylineArc(cx, cy, rx, ry, 0, TWO_PI);
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) {
    path.lineTo(outer[i].x, outer[i].y);
  }
  path.closePath();

  // Inner ellipse collapsed (`adj1 ≥ 50000`) or zero-thickness band —
  // no holes to carve, just the filled outer silhouette.
  if (irx <= 0 || iry <= 0 || t <= 0) return path;

  /**
   * Carve one C-shaped hole bounded by a slash-band edge and the inner
   * ellipse arc on the requested side.
   *
   *  - `perpX/perpY` is the perpendicular offset of the band edge from
   *    the inner ellipse centre (so the edge line is `(perp + s · d)`).
   *  - `desiredSign` selects which inner arc to follow: −1 keeps the
   *    arc on the side where `signed_perp = (p − c) · n` is negative
   *    (NE of the slash), +1 stays positive (SW of the slash).
   */
  function addHole(perpX: number, perpY: number, desiredSign: 1 | -1) {
    const roots = lineEllipseRoots(perpX, perpY, dx, dy, irx, iry);
    if (!roots) return;
    const [sNW, sSE] = roots;
    const pNW = {
      x: cx + perpX + sNW * dx,
      y: cy + perpY + sNW * dy,
    };
    const pSE = {
      x: cx + perpX + sSE * dx,
      y: cy + perpY + sSE * dy,
    };
    const thNW = Math.atan2((pNW.y - cy) / iry, (pNW.x - cx) / irx);
    const thSE = Math.atan2((pSE.y - cy) / iry, (pSE.x - cx) / irx);
    const thArcEnd = pickArcEnd(thNW, thSE, irx, iry, nx, ny, desiredSign);
    // Traverse the chosen inner arc in reverse (pSE → pNW) so the hole
    // subpath winds CCW relative to the CW outer perimeter.
    const arc = polylineArc(
      cx,
      cy,
      irx,
      iry,
      thArcEnd,
      thNW,
      INNER_ARC_SEGMENTS,
    );
    // Pin the polyline endpoints to the exact line-ellipse roots so
    // the straight-back segment closes flush with the band edge — the
    // sampled polyline endpoints would otherwise sit a few µpx off.
    arc[0] = pSE;
    arc[arc.length - 1] = pNW;
    path.moveTo(pSE.x, pSE.y);
    for (let i = 1; i < arc.length; i++) {
      path.lineTo(arc[i].x, arc[i].y);
    }
    // Straight band-edge segment from pNW back to pSE closes the loop.
    path.lineTo(pSE.x, pSE.y);
    path.closePath();
  }

  // NE hole: above-right of the slash. The NE band edge passes through
  // `−n · ht`; the hole sits where `signed_perp < −ht`, i.e. `< 0`.
  addHole(-nx * ht, -ny * ht, -1);
  // SW hole: below-left of the slash. The SW band edge passes through
  // `+n · ht`; the hole sits where `signed_perp > +ht`, i.e. `> 0`.
  addHole(+nx * ht, +ny * ht, +1);

  return path;
};

export const NO_SMOKING_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: NO_SMOKING_ADJUSTMENTS[0],
  }),
];
