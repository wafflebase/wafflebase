import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FaceBuilder,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `leftRightRibbon` — ECMA-376 OOXML preset banner. A horizontal ribbon
 * with an arrowhead at BOTH the left and right ends and a raised center
 * with a vertical FOLD: the body steps between two heights across the
 * center line (the left half sits higher, the right half lower), joined
 * by an S-curved fold, with a small `darkenLess` shadow flap behind the
 * fold. The center fold is what distinguishes this shape from a plain
 * left-right (double-headed) arrow.
 *
 * Coordinates follow the OOXML guide list decoded at the default
 * w=h=100, adj1=50000, adj2=50000, adj3=16667 (y increases downward):
 *
 *   x1 = ss*a2/100000               (inner edge of left arrowhead)
 *   x4 = r - x1                     (inner edge of right arrowhead)
 *   x2 = hc - w/32, x3 = hc + w/32  (fold flap edges, half-band wd32)
 *   dy1 = h*a1/200000               (half the head spread)
 *   dy2 = -h*a3/200000              (fold rise, negative)
 *   ly1 = vc + dy2 - dy1            (left body TOP edge)
 *   ly2 = ly1 + dy1                 (left arrowhead top tip level)
 *   ly4 = ly2 * 2                   (left body BOTTOM edge)
 *   ly3 = ly4 - ly1                 (left body fold-flap bottom)
 *   ry1 = b - ly4, ry2 = b - ly3    (right arrowhead / right body top)
 *   ry3 = b - ly2, ry4 = b - ly1    (right tip level / right body bottom)
 *   hR  = a3*ss/400000              (fold arc half-height)
 *
 * Adjustments (OOXML thousandths):
 *   [0] adj1 — head spread (arrowhead vertical extent), default 50000.
 *   [1] adj2 — arrowhead horizontal length, default 50000
 *       (clamped to maxAdj2 = (wd2 - wd32)/ss).
 *   [2] adj3 — fold/step height, default 16667 (clamped to 33333).
 */
export const LEFT_RIGHT_RIBBON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Head spread', defaultValue: 50000, min: 0, max: 100000, axisLabel: 'head' },
  { name: 'Tail length', defaultValue: 50000, min: 0, max: 100000, axisLabel: 'tail' },
  { name: 'Fold height', defaultValue: 16667, min: 0, max: 33333, axisLabel: 'fold' },
];

/**
 * Decode the OOXML guide list for a given frame and adjustments.
 * Returned values are in element-local pixels (top-left origin).
 */
function geometry({ w, h }: { w: number; h: number }, adjustments?: number[]) {
  const ss = Math.min(w, h);
  const r = w;
  const b = h;
  const hc = w / 2;
  const vc = h / 2;
  const wd2 = w / 2;
  const wd32 = w / 32;

  const a3 = Math.max(0, Math.min(adj(adjustments, 2, 16667), 33333));
  const maxAdj1 = 100000 - a3;
  const a1 = Math.max(0, Math.min(adj(adjustments, 0, 50000), maxAdj1));
  const w1 = wd2 - wd32;
  const maxAdj2 = ss > 0 ? (100000 * w1) / ss : 0;
  const a2 = Math.max(0, Math.min(adj(adjustments, 1, 50000), maxAdj2));

  const x1 = (ss * a2) / 100000;
  const x4 = r - x1;
  const x2 = hc - wd32;
  const x3 = hc + wd32;

  const dy1 = (h * a1) / 200000;
  const dy2 = (h * a3) / -200000;
  const ly1 = vc + dy2 - dy1;
  const ry4 = vc + dy1 - dy2;
  const ly2 = ly1 + dy1;
  const ry3 = b - ly2;
  const ly4 = ly2 * 2;
  const ry1 = b - ly4;
  const ly3 = ly4 - ly1;
  const ry2 = b - ly3;
  const hR = (a3 * ss) / 400000;
  const y1 = ly1 + hR;

  return {
    l: 0, t: 0, r, b, hc, wd32,
    x1, x2, x3, x4,
    ly1, ly2, ly3, ly4,
    ry1, ry2, ry3, ry4,
    hR, y1,
  };
}

/**
 * Trace the main ribbon silhouette onto `path` as ONE closed polygon.
 * The center fold's two small OOXML `arcTo` segments (wR = wd32, hR)
 * are approximated with straight steps so the body remains a single
 * closed sub-path: the top edge steps DOWN from the higher left half
 * (ly1) to the lower right half (ry2) across the fold band [x2, x3],
 * and the bottom edge steps UP from the right half (ry4) to the left
 * half (ly3). That vertical step is the fold that distinguishes this
 * shape from a plain double-headed arrow.
 */
function traceSilhouette(path: Path2D, g: ReturnType<typeof geometry>): void {
  const { l, t, r, b, hc, x1, x2, x3, x4 } = g;
  const { ly1, ly2, ly3, ly4, ry1, ry2, ry3, ry4 } = g;

  path.moveTo(l, ly2); // left arrowhead tip (vertical center of left head)
  path.lineTo(x1, t); // top corner of left arrowhead
  path.lineTo(x1, ly1); // top edge of left body
  path.lineTo(hc, ly1); // into the fold (top, higher left half)
  // Top fold step DOWN to the lower right half across [x2..x3].
  path.lineTo(x3, ly1);
  path.lineTo(x3, ry2);
  path.lineTo(x4, ry2); // top edge of right body
  path.lineTo(x4, ry1); // top corner of right arrowhead
  path.lineTo(r, ry3); // right arrowhead tip (vertical center of right head)
  path.lineTo(x4, b); // bottom corner of right arrowhead
  path.lineTo(x4, ry4); // bottom edge of right body
  path.lineTo(hc, ry4); // into the fold (bottom, lower right half)
  // Bottom fold step UP back to the higher left half across [x2..x3].
  path.lineTo(x2, ry4);
  path.lineTo(x2, ly3);
  path.lineTo(x1, ly3); // bottom edge of left body
  path.lineTo(x1, ly4); // bottom corner of left arrowhead
  path.closePath(); // back to left tip (l, ly2)
}

export const buildLeftRightRibbon: PathBuilder = (size, adjustments) => {
  const g = geometry(size, adjustments);
  const path = new Path2D();
  traceSilhouette(path, g);
  return path;
};

/**
 * Multi-fill faces: the full ribbon body at the base fill (shade 0)
 * plus the center fold flap as a darker face (shade -0.15), matching
 * OOXML's `darkenLess` shadow behind the vertical fold.
 */
export const buildLeftRightRibbonFaces: FaceBuilder = (size, adjustments) => {
  const g = geometry(size, adjustments);
  const body = new Path2D();
  traceSilhouette(body, g);

  // Fold-shadow flap: the small band behind the fold, between x2 and
  // x3, from the fold top (y1) down to the right-half top (ry2). This
  // is OOXML's `darkenLess` sub-path that reads as the shadow cast by
  // the raised left half over the lower right half.
  const flap = new Path2D();
  flap.moveTo(g.x3, g.y1);
  flap.lineTo(g.x3, g.ry2);
  flap.lineTo(g.x2, g.ry2);
  flap.lineTo(g.x2, g.y1);
  flap.closePath();

  return [
    { path: body, shade: 0 },
    { path: flap, shade: -0.15 },
  ];
};

export const LEFT_RIGHT_RIBBON_HANDLES: readonly AdjustmentHandle[] = [
  // Head spread — diamond on the left body TOP edge at the inner
  // arrowhead corner (x1, ly1). ly1 = vc + dy2 - dy1 moves with a1
  // (unlike ly2 = vc + dy2, where the dy1 term cancels), so the handle
  // tracks a1 and the position↔apply round-trip is stable.
  {
    position: (size, adjustments) => {
      const g = geometry(size, adjustments);
      return { x: insetAlongAxis(g.x1, size.w), y: insetAlongAxis(g.ly1, size.h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      // ly1 = vc + dy2 - dy1  ⇒  dy1 = (h/2 + dy2px) - ly1.
      // Recover a1 from the body-top edge: dragging it up (smaller y)
      // widens the head spread.
      const a3 = Math.max(0, Math.min(start[2] ?? 16667, 33333));
      const dy2px = (h * a3) / -200000;
      const ly1 = y;
      const dy1px = h / 2 + dy2px - ly1;
      const raw = h > 0 ? Math.round((dy1px / h) * 200000) : 0;
      const spec = LEFT_RIGHT_RIBBON_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 50000,
        start[2] ?? 16667,
      ];
    },
  },
  // Tail length — diamond on the top edge at the inner left arrowhead
  // corner (x1, ly1). Drag right → longer arrowhead.
  {
    position: (size, adjustments) => {
      const g = geometry(size, adjustments);
      return { x: insetAlongAxis(g.x1, size.w), y: insetAlongAxis(g.ly1, size.h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const ss = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = ss > 0 ? Math.round((x / ss) * 100000) : 0;
      const spec = LEFT_RIGHT_RIBBON_ADJUSTMENTS[1];
      return [
        start[0] ?? 50000,
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[2] ?? 16667,
      ];
    },
  },
  // Fold height — diamond on the center fold top at (x3, ry2).
  {
    position: (size, adjustments) => {
      const g = geometry(size, adjustments);
      return { x: insetAlongAxis(g.x3, size.w), y: insetAlongAxis(g.ry2, size.h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      // ry2 = b - ly3 = b - (ly4 - ly1). Larger fold → ry2 closer to vc.
      // Recover a3 from how far ry2 sits below the body top.
      const foldPx = Math.abs(h / 2 - y);
      const raw = h > 0 ? Math.round((foldPx / h) * 200000) : 0;
      const spec = LEFT_RIGHT_RIBBON_ADJUSTMENTS[2];
      return [
        start[0] ?? 50000,
        start[1] ?? 50000,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
