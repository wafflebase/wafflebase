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
 * `horizontalScroll` — ECMA-376 OOXML scroll banner: a flat sheet with
 * a roll curled up on the LEFT edge (rolled forward at the top) and a
 * matching roll on the RIGHT edge (curled at the bottom). `adj1` is the
 * curl size `ch = ss * adj / 100000` where `ss = min(w, h)`.
 *
 * OOXML guides at w=h=100, adj=12500: ch=12.5, ch2=6.25, ch4=3.125,
 * y3=18.75, y4=25, y6=87.5, y7=93.75, y5=81.25, x3=87.5, x4=93.75.
 * Angle convention is screen-down y; OOXML cd4=π/2, cd2=π, 3cd4=3π/2,
 * negative swing = counter-clockwise.
 */
export const HORIZONTAL_SCROLL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
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
      adj(adjustments, 0, HORIZONTAL_SCROLL_ADJUSTMENTS[0].defaultValue),
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
    y3: ch + ch2,
    y4: ch + ch,
    y6: b - ch,
    y7: b - ch2,
    y5: b - ch - ch2,
    x3: r - ch,
    x4: r - ch2,
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
export const buildHorizontalScroll: PathBuilder = (size, adjustments) => {
  const g = guides(size, adjustments);
  const turtle = new Turtle(new Path2D());
  turtle
    .moveTo(g.r, g.ch2)
    .arcTo(g.ch2, g.ch2, 0, HALF) // right curl top edge
    .lineTo(g.x4, g.ch2)
    .arcTo(g.ch4, g.ch4, 0, PI) // right inner curl
    .lineTo(g.x3, g.ch)
    .lineTo(g.ch2, g.ch)
    .arcTo(g.ch2, g.ch2, 3 * HALF, -HALF) // left-top curl
    .lineTo(g.l, g.y7)
    .arcTo(g.ch2, g.ch2, PI, -PI) // left edge curl down
    .lineTo(g.ch, g.y6)
    .lineTo(g.x4, g.y6)
    .arcTo(g.ch2, g.ch2, HALF, -HALF) // bottom-right curl close
    .close();
  return turtle.path;
};

/**
 * Multi-fill faces: the flat sheet at base fill (shade 0), plus the two
 * rolled-under curl parts as `darkenLess` (-0.18) shadow faces — the
 * left inner roll and the right top roll. The inner spiral hole is
 * approximated by these small darker curl faces.
 */
export const buildHorizontalScrollFaces: FaceBuilder = (size, adjustments) => {
  const g = guides(size, adjustments);
  const sheet = buildHorizontalScroll(size, adjustments);

  // OOXML darkenLess sub-path 1 — left inner roll (rolled-under).
  const left = new Turtle(new Path2D());
  left
    .moveTo(g.ch2, g.y4)
    .arcTo(g.ch2, g.ch2, HALF, -HALF)
    .arcTo(g.ch4, g.ch4, 0, -PI)
    .close();

  // OOXML darkenLess sub-path 2 — right top roll (rolled-under).
  const right = new Turtle(new Path2D());
  right
    .moveTo(g.x4, g.ch)
    .arcTo(g.ch2, g.ch2, HALF, -3 * HALF)
    .arcTo(g.ch4, g.ch4, PI, -PI)
    .close();

  return [
    { path: sheet, shade: 0 },
    { path: left.path, shade: -0.18 },
    { path: right.path, shade: -0.18 },
  ];
};

export const HORIZONTAL_SCROLL_HANDLES: readonly AdjustmentHandle[] = [
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: HORIZONTAL_SCROLL_ADJUSTMENTS[0],
  }),
];

export type { Point };
