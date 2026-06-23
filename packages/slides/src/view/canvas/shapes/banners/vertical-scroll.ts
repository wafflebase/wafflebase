import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FaceBuilder,
  FrameSize,
  PathBuilder,
  Point,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { linearTopEdgeHandle } from '../handles';

/**
 * `verticalScroll` — ECMA-376 OOXML scroll banner rotated 90° from
 * `horizontalScroll`: a flat sheet with a roll curled on the TOP edge
 * (right side) and a matching roll on the BOTTOM edge (left side).
 * `adj1` is the curl size `ch = ss * adj / 100000`, `ss = min(w, h)`.
 *
 * OOXML guides at w=h=100, adj=12500: ch=12.5, ch2=6.25, ch4=3.125,
 * x3=18.75, x4=25, x6=87.5, x7=93.75, x5=81.25, y3=87.5, y4=93.75.
 * Angle convention is screen-down y; OOXML cd4=π/2, cd2=π, 3cd4=3π/2.
 */
export const VERTICAL_SCROLL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Roll size', defaultValue: 12500, min: 0, max: 25000 },
];

const HALF = Math.PI / 2; // OOXML cd4
const PI = Math.PI; // OOXML cd2

/** Resolve the OOXML guide values for the given frame + adjustment. */
function guides({ w, h }: FrameSize, adjustments?: number[]) {
  const a1 = Math.max(
    0,
    Math.min(
      25000,
      adj(adjustments, 0, VERTICAL_SCROLL_ADJUSTMENTS[0].defaultValue),
    ),
  );
  const ss = Math.min(w, h);
  const ch = (a1 / 100000) * ss;
  const ch2 = ch / 2;
  const ch4 = ch / 4;
  const r = w;
  const b = h;
  return {
    ch,
    ch2,
    ch4,
    l: 0,
    t: 0,
    r,
    b,
    x3: ch + ch2,
    x4: ch + ch,
    x6: r - ch,
    x7: r - ch2,
    x5: r - ch - ch2,
    y3: b - ch,
    y4: b - ch2,
  };
}

/**
 * Stateful OOXML path turtle. `arcTo` matches DrawingML semantics:
 * center = cur - (wR·cos st, hR·sin st), end = center + (wR·cos(st+sw),
 * hR·sin(st+sw)), polyline-approximated. Angles in radians, y-down.
 */
class Turtle {
  cur: Point = { x: 0, y: 0 };
  constructor(readonly path: Path2D) {}
  moveTo(x: number, y: number): this {
    this.path.moveTo(x, y);
    this.cur = { x, y };
    return this;
  }
  lineTo(x: number, y: number): this {
    this.path.lineTo(x, y);
    this.cur = { x, y };
    return this;
  }
  arcTo(wR: number, hR: number, st: number, sw: number): this {
    const cx = this.cur.x - wR * Math.cos(st);
    const cy = this.cur.y - hR * Math.sin(st);
    const pts = polylineArc(cx, cy, wR, hR, st, st + sw);
    for (let i = 1; i < pts.length; i++) this.path.lineTo(pts[i].x, pts[i].y);
    this.cur = pts[pts.length - 1];
    return this;
  }
  close(): this {
    this.path.closePath();
    return this;
  }
}

/**
 * Main scroll-sheet silhouette (OOXML path 1, outer sub-path): the
 * rectangle body plus the two edge curl bumps. One closed Path2D used
 * for hit-test / icon / export.
 */
export const buildVerticalScroll: PathBuilder = (size, adjustments) => {
  const g = guides(size, adjustments);
  const turtle = new Turtle(new Path2D());
  turtle
    .moveTo(g.ch2, g.b)
    .arcTo(g.ch2, g.ch2, HALF, -HALF) // bottom-left curl
    .lineTo(g.ch2, g.y4)
    .arcTo(g.ch4, g.ch4, HALF, -PI) // bottom inner curl
    .lineTo(g.ch, g.y3)
    .lineTo(g.ch, g.ch2)
    .arcTo(g.ch2, g.ch2, PI, HALF) // top-left curl
    .lineTo(g.x7, g.t)
    .arcTo(g.ch2, g.ch2, 3 * HALF, PI) // top edge curl
    .lineTo(g.x6, g.ch)
    .lineTo(g.x6, g.y4)
    .arcTo(g.ch2, g.ch2, 0, HALF) // right edge curl close
    .close();
  return turtle.path;
};

/**
 * Multi-fill faces: the flat sheet at base fill (shade 0), plus the two
 * rolled-under curl parts as `darkenLess` (-0.18) shadow faces — the
 * top roll and the bottom roll. The inner spiral hole is approximated by
 * these small darker curl faces.
 */
export const buildVerticalScrollFaces: FaceBuilder = (size, adjustments) => {
  const g = guides(size, adjustments);
  const sheet = buildVerticalScroll(size, adjustments);

  // OOXML darkenLess sub-path 1 — top roll (rolled-under).
  const top = new Turtle(new Path2D());
  top
    .moveTo(g.x4, g.ch2)
    .arcTo(g.ch2, g.ch2, 0, HALF)
    .arcTo(g.ch4, g.ch4, HALF, PI)
    .close();

  // OOXML darkenLess sub-path 2 — bottom roll (rolled-under).
  const bottom = new Turtle(new Path2D());
  bottom
    .moveTo(g.ch, g.y4)
    .arcTo(g.ch2, g.ch2, 0, 3 * HALF)
    .arcTo(g.ch4, g.ch4, 3 * HALF, PI)
    .close();

  return [
    { path: sheet, shade: 0 },
    { path: top.path, shade: -0.18 },
    { path: bottom.path, shade: -0.18 },
  ];
};

export const VERTICAL_SCROLL_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: VERTICAL_SCROLL_ADJUSTMENTS[0],
  }),
];

export type { Point };
