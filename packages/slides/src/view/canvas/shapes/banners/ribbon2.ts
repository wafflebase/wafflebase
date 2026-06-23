import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FaceBuilder,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `ribbon2` — ECMA-376 OOXML upward banner (`<ribbon2>`). The vertical
 * mirror of `ribbon`: a horizontal banner with a raised centre body and
 * two swallowtail tails ending in a V-notch, but the centre band folds
 * *behind* each tail in the upward direction — the `darkenLess`
 * fold-shadow tabs sit at the *bottom* of the centre band, just inside
 * each seam.
 *
 * Adjustments follow the OOXML preset:
 *   `adj1` (index 0) — band height, thousandths of `h` (pinned 0..33333).
 *                      `y2 = b - h * adj1 / 100000` is the band's bottom
 *                      edge; the band runs from `t` down to `y2`.
 *   `adj2` (index 1) — band half-width, thousandths of `w` (pinned
 *                      25000..75000). `dx2 = w * adj2 / 200000`; the band
 *                      spans `hc ± dx2`.
 *
 * `buildRibbon2` (PathBuilder) returns the union SILHOUETTE outline.
 * `buildRibbon2Faces` (FaceBuilder) drives the multi-fill paint: the
 * banner body at base fill, then the two darker fold tabs over it.
 *
 * Geometry names mirror the OOXML `gdLst`. The tiny `wd32`/`hR` corner
 * roundings are modelled as straight joins to the arc endpoints.
 */
export const RIBBON2_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Band height', defaultValue: 16667, min: 0, max: 33333 },
  { name: 'Band width', defaultValue: 50000, min: 25000, max: 75000 },
];

/** Resolve the OOXML guide values for a given frame + adjustments. */
function ribbon2Guides(w: number, h: number, adjustments?: number[]) {
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
  const dy1 = (h * a1) / 200000;
  const y1 = b - dy1;
  const dy2 = (h * a1) / 100000;
  const y2 = b - dy2;
  const y4 = t + dy2;
  const y3 = (y4 + b) / 2;
  const hR = (h * a1) / 400000;
  const y6 = b - hR;
  const y7 = y1 - hR;
  return {
    l, t, r, b, hc, wd8, wd32,
    x2, x3, x4, x5, x6, x7, x8, x9, x10,
    y1, y2, y3, y4, y6, y7, hR,
  };
}

export const buildRibbon2: PathBuilder = ({ w, h }, adjustments) => {
  const g = ribbon2Guides(w, h, adjustments);
  const path = new Path2D();
  // Bottom edge: left fold-tab bottom, across the band bottom, right tab.
  path.moveTo(g.l, g.b);
  path.lineTo(g.x4, g.b);
  path.lineTo(g.x3, g.y1); // round corner → band bottom-left
  path.lineTo(g.x8, g.y2); // across the band's bottom edge
  path.lineTo(g.x7, g.y1); // round corner → right fold-tab bottom
  path.lineTo(g.r, g.b);
  // Right tail: V-notch in, out to the top-right corner.
  path.lineTo(g.x10, g.y3); // inner V point
  path.lineTo(g.r, g.y4);
  // Band right edge up, top edge, band left edge down.
  path.lineTo(g.x9, g.y4);
  path.lineTo(g.x9, g.hR);
  path.lineTo(g.x9, g.t); // round corner → band top
  path.lineTo(g.x3, g.t);
  path.lineTo(g.x2, g.y4); // round corner → band top-left
  // Left tail: out to top-left corner, V-notch in.
  path.lineTo(g.l, g.y4);
  path.lineTo(g.wd8, g.y3); // inner V point
  path.closePath();
  return path;
};

/**
 * Multi-fill faces: the banner body (base fill) plus the two
 * `darkenLess` fold tabs (shade < 0), at the seams where the centre band
 * folds behind each tail. Painted back-to-front.
 */
export const buildRibbon2Faces: FaceBuilder = ({ w, h }, adjustments) => {
  const g = ribbon2Guides(w, h, adjustments);

  const body = buildRibbon2({ w, h }, adjustments);

  // Left fold tab (OOXML darkenLess sub-path 1).
  const leftTab = new Path2D();
  leftTab.moveTo(g.x5, g.y6);
  leftTab.lineTo(g.x3, g.y1);
  leftTab.lineTo(g.x5, g.y2);
  leftTab.closePath();

  // Right fold tab (OOXML darkenLess sub-path 2).
  const rightTab = new Path2D();
  rightTab.moveTo(g.x6, g.y6);
  rightTab.lineTo(g.x8, g.y1);
  rightTab.lineTo(g.x6, g.y2);
  rightTab.closePath();

  return [
    { path: body, shade: 0 },
    { path: leftTab, shade: -0.15 },
    { path: rightTab, shade: -0.15 },
  ];
};

export const RIBBON2_HANDLES: readonly AdjustmentHandle[] = [
  // adj1 — band height. Diamond on the band's bottom edge at the centre.
  {
    position: ({ h }, adjustments) => {
      const y2 = h - (h * Math.max(0, Math.min(33333, adjustments[0] ?? 16667))) / 100000;
      return { x: 0, y: insetAlongAxis(y2, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      // y2 = h - h*a1/100000  ⇒  a1 = (h - y) * 100000 / h
      const raw = h > 0 ? Math.round(((h - y) * 100000) / h) : 0;
      const spec = RIBBON2_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 50000,
      ];
    },
  },
  // adj2 — band half-width. Diamond on the band's left edge at the bottom.
  {
    position: ({ w, h }, adjustments) => {
      const a2 = Math.max(25000, Math.min(75000, adjustments[1] ?? 50000));
      const x2 = w / 2 - (w * a2) / 200000;
      const y2 = h - (h * Math.max(0, Math.min(33333, adjustments[0] ?? 16667))) / 100000;
      return { x: insetAlongAxis(x2, w), y: insetAlongAxis(y2, h) };
    },
    apply: ({ w }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = w > 0 ? Math.round(((w / 2 - x) * 200000) / w) : 0;
      const spec = RIBBON2_ADJUSTMENTS[1];
      return [
        start[0] ?? 16667,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
