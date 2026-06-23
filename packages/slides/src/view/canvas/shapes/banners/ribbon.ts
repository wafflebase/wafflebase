import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FaceBuilder,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `ribbon` — ECMA-376 OOXML downward banner (`<ribbon>`). A horizontal
 * banner with a raised centre body, two swallowtail tails ending in a
 * V-notch, and — where the centre band folds *behind* each tail — two
 * `darkenLess` fold-shadow tabs. The fold is downward: the small folded
 * tabs sit at the *top* of the centre band, just inside each seam.
 *
 * Adjustments follow the OOXML preset:
 *   `adj1` (index 0) — band height, thousandths of `h` (pinned 0..33333).
 *                      `y2 = h * adj1 / 100000` is the band's top edge;
 *                      the band runs from `y2` down to `b`.
 *   `adj2` (index 1) — band half-width, thousandths of `w` (pinned
 *                      25000..75000). `dx2 = w * adj2 / 200000`; the band
 *                      spans `hc ± dx2`.
 *
 * `buildRibbon` (PathBuilder) returns the union SILHOUETTE outline (band
 * + both notched tails) for hit-test / icon / export. `buildRibbonFaces`
 * (FaceBuilder) drives the multi-fill paint: the banner body at base
 * fill, then the two darker fold tabs over it.
 *
 * Coordinate names mirror the OOXML `gdLst` (`x2..x10`, `y1..y6`, `hR`).
 * The tiny `wd32`/`hR` corner roundings of the spec are modelled as
 * straight joins to the arc endpoints — sub-pixel at typical sizes and
 * exact for the polygon hit-test.
 */
export const RIBBON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Band height', defaultValue: 16667, min: 0, max: 33333 },
  { name: 'Band width', defaultValue: 50000, min: 25000, max: 75000 },
];

/** Resolve the OOXML guide values for a given frame + adjustments. */
function ribbonGuides(w: number, h: number, adjustments?: number[]) {
  const a1 = Math.max(0, Math.min(33333, adj(adjustments, 0, 16667)));
  const a2 = Math.max(25000, Math.min(75000, adj(adjustments, 1, 50000)));
  const l = 0;
  const t = 0;
  const r = w;
  const b = h;
  const hc = w / 2;
  const wd8 = w / 8;
  const wd32 = w / 32;
  const x10 = r - wd8;
  const dx2 = (w * a2) / 200000;
  const x2 = hc - dx2;
  const x9 = hc + dx2;
  const x3 = x2 + wd32;
  const x8 = x9 - wd32;
  const x5 = x2 + wd8;
  const x6 = x9 - wd8;
  const x4 = x5 - wd32;
  const x7 = x6 + wd32;
  const y1 = (h * a1) / 200000;
  const y2 = (h * a1) / 100000;
  const y4 = b - y2;
  const y3 = y4 / 2;
  const hR = (h * a1) / 400000;
  const y5 = b - hR;
  const y6 = y2 - hR;
  return {
    l, t, r, b, hc, wd8, wd32,
    x2, x3, x4, x5, x6, x7, x8, x9, x10,
    y1, y2, y3, y4, y5, y6, hR,
  };
}

export const buildRibbon: PathBuilder = ({ w, h }, adjustments) => {
  const g = ribbonGuides(w, h, adjustments);
  const path = new Path2D();
  // Top edge: left fold-tab top, across the band top, right fold-tab top.
  path.moveTo(g.l, g.t);
  path.lineTo(g.x4, g.t);
  path.lineTo(g.x3, g.y1); // round corner → band top-left
  path.lineTo(g.x8, g.y2); // across the band's top edge
  path.lineTo(g.x7, g.y1); // round corner → right fold-tab top
  path.lineTo(g.r, g.t);
  // Right tail: V-notch in, out to the bottom-right corner.
  path.lineTo(g.x10, g.y3); // inner V point
  path.lineTo(g.r, g.y4);
  // Band right edge down, bottom edge, band left edge up.
  path.lineTo(g.x9, g.y4);
  path.lineTo(g.x9, g.y5);
  path.lineTo(g.x9, g.b); // round corner → band bottom
  path.lineTo(g.x2, g.b);
  path.lineTo(g.x2, g.y4); // round corner → band bottom-left
  // Left tail: out to bottom-left corner, V-notch in.
  path.lineTo(g.l, g.y4);
  path.lineTo(g.wd8, g.y3); // inner V point
  path.closePath();
  return path;
};

/**
 * Multi-fill faces: the banner body (base fill) plus the two
 * `darkenLess` fold tabs (shade < 0) painted over it, at the seams where
 * the centre band folds behind each tail. Painted back-to-front.
 */
export const buildRibbonFaces: FaceBuilder = ({ w, h }, adjustments) => {
  const g = ribbonGuides(w, h, adjustments);

  // Body = the full silhouette at base fill.
  const body = buildRibbon({ w, h }, adjustments);

  // Left fold tab (OOXML darkenLess sub-path 1).
  const leftTab = new Path2D();
  leftTab.moveTo(g.x5, g.hR);
  leftTab.lineTo(g.x3, g.y1);
  leftTab.lineTo(g.x5, g.y2);
  leftTab.closePath();

  // Right fold tab (OOXML darkenLess sub-path 2).
  const rightTab = new Path2D();
  rightTab.moveTo(g.x6, g.hR);
  rightTab.lineTo(g.x8, g.y1);
  rightTab.lineTo(g.x6, g.y2);
  rightTab.closePath();

  return [
    { path: body, shade: 0 },
    { path: leftTab, shade: -0.15 },
    { path: rightTab, shade: -0.15 },
  ];
};

export const RIBBON_HANDLES: readonly AdjustmentHandle[] = [
  // adj1 — band height. Diamond on the band's top edge at the centre.
  {
    position: ({ h }, adjustments) => {
      const y2 = (h * Math.max(0, Math.min(33333, adjustments[0] ?? 16667))) / 100000;
      return { x: 0, y: insetAlongAxis(y2, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const raw = h > 0 ? Math.round((y / h) * 100000) : 0;
      const spec = RIBBON_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 50000,
      ];
    },
  },
  // adj2 — band half-width. Diamond on the band's left edge at the top.
  {
    position: ({ w, h }, adjustments) => {
      const a2 = Math.max(25000, Math.min(75000, adjustments[1] ?? 50000));
      const x2 = w / 2 - (w * a2) / 200000;
      const y2 = (h * Math.max(0, Math.min(33333, adjustments[0] ?? 16667))) / 100000;
      return { x: insetAlongAxis(x2, w), y: insetAlongAxis(y2, h) };
    },
    apply: ({ w }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      // x2 = w/2 - w*a2/200000  ⇒  a2 = (w/2 - x) * 200000 / w
      const raw = w > 0 ? Math.round(((w / 2 - x) * 200000) / w) : 0;
      const spec = RIBBON_ADJUSTMENTS[1];
      return [
        start[0] ?? 16667,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
