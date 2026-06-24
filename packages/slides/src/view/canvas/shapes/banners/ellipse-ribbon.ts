// packages/slides/src/view/canvas/shapes/banners/ellipse-ribbon.ts
import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FaceBuilder,
  Point,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';

/**
 * Curved ("elliptical") ribbon banners, faithful to the ECMA-376 OOXML
 * `ellipseRibbon` / `ellipseRibbon2` presets.
 *
 * The banner body is a constant-thickness band whose top and bottom
 * edges follow the same parabola `y = f1 * (x - x²/w)` (with
 * `f1 = 4·dy1/w`). The band is a downward-opening parabola so that:
 *
 * `ellipseRibbon`  — the two ENDS are raised (held at the top, `y = t`)
 *                    and the central body curves DOWN (concave-up dip).
 * `ellipseRibbon2` — the vertical mirror: the central body curves UP
 *                    and the two ends drop to the bottom (`y = b`).
 *
 * Behind the central body sit two folded "tab" faces (OOXML
 * `fill="darkenLess"`) that read as the underside of the fold; the main
 * body is painted over them.
 *
 * adj1 (`Body height`)  — band thickness as ‰ of h (OOXML default 25000)
 * adj2 (`Center width`) — central-body width as ‰ of w (OOXML default
 *                         50000, the distance between the two fold lines)
 * adj3 (`Arch amount`)  — parabola depth as ‰ of h (OOXML default 12500)
 *
 * Curves use a polyline approximation of the quadratic Béziers so a
 * single code path serves both the JSDOM test shim and the browser.
 */
export const ELLIPSE_RIBBON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Body height', defaultValue: 25000, min: 0, max: 100000 },
  { name: 'Center width', defaultValue: 50000, min: 25000, max: 75000 },
  { name: 'Arch amount', defaultValue: 12500, min: 0, max: 100000 },
];

const DEF_BODY = 25000;
const DEF_WIDTH = 50000;
const DEF_ARCH = 12500;
const QUAD_SEGMENTS = 16;

type Geom = {
  l: number;
  r: number;
  hc: number;
  wd8: number;
  /** End anchor (raised end for ribbon, dropped end for ribbon2). */
  endY: number;
  /** Fold base line on the opposite edge from `endY`. */
  rh: number;
  x2: number;
  x3: number;
  x4: number;
  x5: number;
  x6: number;
  y1: number;
  cx1: number;
  cy1: number;
  cx2: number;
  y3: number;
  cy3: number;
  y2: number;
  y5: number;
  y6: number;
  cx4: number;
  cy4: number;
  cx5: number;
  cy6: number;
  y7: number;
  cy7: number;
};

/**
 * Resolve all OOXML guide values for the given frame and adjustments.
 * `dir = 1` is `ellipseRibbon` (math in y-down screen space, body dips
 * down). `dir = -1` mirrors every y about the bottom edge for
 * `ellipseRibbon2`.
 */
function geom(
  { w, h }: { w: number; h: number },
  adjustments: number[] | undefined,
  dir: 1 | -1,
): Geom {
  const l = 0;
  const t = 0;
  const r = w;
  const b = h;
  const hc = w / 2;
  const wd8 = w / 8;

  const adj1 = adj(adjustments, 0, DEF_BODY);
  const adj2 = adj(adjustments, 1, DEF_WIDTH);
  const adj3 = adj(adjustments, 2, DEF_ARCH);

  const a1 = Math.max(0, Math.min(100000, adj1));
  const a2 = Math.max(25000, Math.min(75000, adj2));
  const q11 = (100000 - a1) / 2;
  const minAdj3 = Math.max(0, a1 - q11);
  const a3 = Math.max(minAdj3, Math.min(a1, adj3));

  const dx2 = (w * a2) / 200000;
  const x2 = hc - dx2;
  const x3 = x2 + wd8;
  const x4 = r - x3;
  const x5 = r - x2;
  const x6 = r - wd8;

  const dy1 = (h * a3) / 100000;
  const f1 = (4 * dy1) / w;

  // Top-edge parabola sample at x3.
  const y1d = f1 * (x3 - (x3 * x3) / w);
  const cx1 = x3 / 2;
  const cy1d = f1 * cx1;
  const cx2 = r - cx1;

  const q1 = (h * a1) / 100000;
  const dy3 = q1 - dy1;

  const q5 = f1 * (x2 - (x2 * x2) / w);
  const y3d = q5 + dy3;
  const q6 = dy1 + dy3 - y3d;
  const cy3d = q6 + dy1 + dy3;

  const rh = b - q1;
  const q8 = (dy1 * 14) / 16;
  const y2d = (q8 + rh) / 2;

  const y5d = q5 + rh;
  const y6d = y3d + rh;
  const cx4 = x2 / 2;
  const cy4d = f1 * cx4 + rh;
  const cx5 = r - cx4;
  const cy6d = cy3d + rh;
  const y7d = y1d + dy3;
  const cy7d = q1 + q1 - y7d;

  // For ellipseRibbon (dir +1) the values above are y-down as decoded.
  // For ellipseRibbon2 (dir -1) every y mirrors about the bottom edge.
  const my = (yDown: number) => (dir === 1 ? yDown : b - yDown);
  return {
    l,
    r,
    hc,
    wd8,
    endY: my(t),
    rh: my(rh),
    x2,
    x3,
    x4,
    x5,
    x6,
    y1: my(y1d),
    cx1,
    cy1: my(cy1d),
    cx2,
    y3: my(y3d),
    cy3: my(cy3d),
    y2: my(y2d),
    y5: my(y5d),
    y6: my(y6d),
    cx4,
    cy4: my(cy4d),
    cx5,
    cy6: my(cy6d),
    y7: my(y7d),
    cy7: my(cy7d),
  };
}

/** Append a quadratic Bézier as a polyline (JSDOM-safe). */
function quadTo(path: Path2D, p0: Point, c: Point, p1: Point): void {
  for (let i = 1; i <= QUAD_SEGMENTS; i++) {
    const u = i / QUAD_SEGMENTS;
    const mu = 1 - u;
    const x = mu * mu * p0.x + 2 * mu * u * c.x + u * u * p1.x;
    const y = mu * mu * p0.y + 2 * mu * u * c.y + u * u * p1.y;
    path.lineTo(x, y);
  }
}

/**
 * Trace the OOXML silhouette into `path`. `endY` is the raised/dropped
 * end anchor (`t` for ellipseRibbon, `b` for ellipseRibbon2). `rh` is
 * the opposite-side fold base line.
 */
function tracePath(path: Path2D, g: Geom): void {
  const { l, r, hc, wd8, x2, x3, x4, x5, x6, cx1, cy1, cx2, cx4, cy4, cx5 } = g;
  const { endY, y1, y2, y3, y5, y6, cy3, cy6, rh } = g;

  let cur: Point = { x: l, y: endY };
  path.moveTo(cur.x, cur.y);
  // Left half of top edge: parabola up-end → x3.
  quadTo(path, cur, { x: cx1, y: cy1 }, { x: x3, y: y1 });
  cur = { x: x3, y: y1 };
  path.lineTo(x2, y3);
  cur = { x: x2, y: y3 };
  // Central top edge: dip through cy3 across to x5.
  quadTo(path, cur, { x: hc, y: cy3 }, { x: x5, y: y3 });
  cur = { x: x5, y: y3 };
  path.lineTo(x4, y1);
  cur = { x: x4, y: y1 };
  // Right half of top edge: x4 → up-end at r.
  quadTo(path, cur, { x: cx2, y: cy1 }, { x: r, y: endY });
  cur = { x: r, y: endY };
  // Right fold tab notch, then down to fold base.
  path.lineTo(x6, y2);
  path.lineTo(r, rh);
  cur = { x: r, y: rh };
  // Right-bottom curve down to x5.
  quadTo(path, cur, { x: cx5, y: cy4 }, { x: x5, y: y5 });
  cur = { x: x5, y: y5 };
  path.lineTo(x5, y6);
  cur = { x: x5, y: y6 };
  // Bottom edge: through cy6 across to x2.
  quadTo(path, cur, { x: hc, y: cy6 }, { x: x2, y: y6 });
  cur = { x: x2, y: y6 };
  path.lineTo(x2, y5);
  cur = { x: x2, y: y5 };
  // Left-bottom curve up to fold base.
  quadTo(path, cur, { x: cx4, y: cy4 }, { x: l, y: rh });
  // Left fold tab notch.
  path.lineTo(wd8, y2);
  path.closePath();
}

/** Build the central fold-shadow tab (OOXML `darkenLess` sub-path). */
function buildFoldTab(g: Geom): Path2D {
  const { hc, x2, x3, x4, x5, y1, y3, y7, cy3, cy7 } = g;
  const path = new Path2D();
  path.moveTo(x3, y7);
  path.lineTo(x3, y1);
  path.lineTo(x2, y3);
  quadTo(path, { x: x2, y: y3 }, { x: hc, y: cy3 }, { x: x5, y: y3 });
  path.lineTo(x4, y1);
  path.lineTo(x4, y7);
  quadTo(path, { x: x4, y: y7 }, { x: hc, y: cy7 }, { x: x3, y: y7 });
  path.closePath();
  return path;
}

function buildBand(
  size: { w: number; h: number },
  adjustments: number[] | undefined,
  dir: 1 | -1,
): Path2D {
  const g = geom(size, adjustments, dir);
  const path = new Path2D();
  tracePath(path, g);
  return path;
}

function buildFaces(
  size: { w: number; h: number },
  adjustments: number[] | undefined,
  dir: 1 | -1,
): { path: Path2D; shade?: number }[] {
  const g = geom(size, adjustments, dir);
  const body = new Path2D();
  tracePath(body, g);
  const tab = buildFoldTab(g);
  // Body first (base fill), then the darker fold tab on top — paintFaces
  // fills in array order, so the dark tab must come last to be visible
  // (matches the other banner faces).
  return [
    { path: body, shade: 0 },
    { path: tab, shade: -0.15 },
  ];
}

export const buildEllipseRibbon: PathBuilder = (size, adjustments) =>
  buildBand(size, adjustments, 1);

export const buildEllipseRibbon2: PathBuilder = (size, adjustments) =>
  buildBand(size, adjustments, -1);

export const buildEllipseRibbonFaces: FaceBuilder = (size, adjustments) =>
  buildFaces(size, adjustments, 1);

export const buildEllipseRibbon2Faces: FaceBuilder = (size, adjustments) =>
  buildFaces(size, adjustments, -1);

/** Vertical drag at the band end controls band thickness (adj1). */
function bodyHeightHandle(dir: 1 | -1): AdjustmentHandle {
  return {
    position: ({ w, h }, adjustments) => {
      const q1 = ((adjustments[0] ?? DEF_BODY) / 100000) * h;
      return { x: w / 2, y: dir === 1 ? q1 : h - q1 };
    },
    apply: ({ h }, start, pointer) => {
      const frac = dir === 1 ? pointer.y / h : (h - pointer.y) / h;
      const raw = h > 0 ? Math.round(frac * 100000) : DEF_BODY;
      return [
        Math.max(0, Math.min(100000, raw)),
        start[1] ?? DEF_WIDTH,
        start[2] ?? DEF_ARCH,
      ];
    },
  };
}

export const ELLIPSE_RIBBON_HANDLES: readonly AdjustmentHandle[] = [
  bodyHeightHandle(1),
];

export const ELLIPSE_RIBBON2_HANDLES: readonly AdjustmentHandle[] = [
  bodyHeightHandle(-1),
];
