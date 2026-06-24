import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `bentArrow` — faithful to the ECMA-376 preset geometry. The arrowhead
 * points RIGHT: a vertical tail rises from the bottom-left, turns at a
 * rounded bend (top-left), and a horizontal arm runs to the arrowhead at
 * the right edge. The bend is an annular sector of constant thickness —
 * two concentric arcs (outer radius `bd`, inner radius `bd2 = bd - th`).
 *
 * Adjustments (OOXML order):
 *   0 adj1 — shaft thickness          (pinned to 0..2·adj2)
 *   1 adj2 — arrowhead half-width      (0..50000)
 *   2 adj3 — arrowhead length          (0..50000)
 *   3 adj4 — bend radius               (pinned to 0..maxAdj4)
 */
export const BENT_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 25000, min: 0, max: 100000 },
  { name: 'Head width', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Head length', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Bend radius', defaultValue: 43750, min: 0, max: 100000 },
];

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** Resolved OOXML guides shared by the builder and the adjustment handles. */
function guides(w: number, h: number, adjustments?: number[]) {
  const ss = Math.min(w, h);
  const r = w;
  const b = h;
  const a2 = clamp(adj(adjustments, 1, 25000), 0, 50000);
  const maxAdj1 = a2 * 2;
  const a1 = clamp(adj(adjustments, 0, 25000), 0, maxAdj1);
  const a3 = clamp(adj(adjustments, 2, 25000), 0, 50000);
  const th = (ss * a1) / 100000;
  const aw2 = (ss * a2) / 100000;
  const th2 = th / 2;
  const dh2 = aw2 - th2;
  const ah = (ss * a3) / 100000;
  const bw = r - ah;
  const bh = b - dh2;
  const bs = Math.min(bw, bh);
  const maxAdj4 = ss > 0 ? (100000 * bs) / ss : 0;
  const a4 = clamp(adj(adjustments, 3, 43750), 0, maxAdj4);
  const bd = (ss * a4) / 100000;
  const bd2 = Math.max(bd - th, 0);
  return {
    ss,
    r,
    b,
    th,
    aw2,
    dh2,
    ah,
    bd,
    bd2,
    maxAdj1,
    maxAdj4,
    x3: th + bd2,
    x4: r - ah,
    y3: dh2 + th,
    y4: dh2 + th + dh2,
    y5: dh2 + bd,
  };
}

export const buildBentArrow: PathBuilder = ({ w, h }, adjustments) => {
  const g = guides(w, h, adjustments);
  const path = new Path2D();
  path.moveTo(0, g.b);
  path.lineTo(0, g.y5);
  // Outer bend (top-left): quarter circle, left edge → top edge.
  if (g.bd > 0) {
    path.arc(g.bd, g.y5, g.bd, Math.PI, 1.5 * Math.PI, false);
  }
  path.lineTo(g.x4, g.dh2);
  path.lineTo(g.x4, 0);
  path.lineTo(g.r, g.aw2); // arrowhead tip → right edge
  path.lineTo(g.x4, g.y4);
  path.lineTo(g.x4, g.y3);
  path.lineTo(g.x3, g.y3);
  // Inner bend: concentric with the outer arc, swept the other way.
  if (g.bd2 > 0) {
    path.arc(g.x3, g.y5, g.bd2, 1.5 * Math.PI, Math.PI, true);
  }
  path.lineTo(g.th, g.b);
  path.closePath();
  return path;
};

export const BENT_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  // adj1 — shaft thickness: horizontal diamond on the bottom edge at x = th.
  {
    position: ({ w, h }, adjustments) => {
      const { th } = guides(w, h, adjustments);
      return { x: th, y: insetAlongAxis(h, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const ss = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = ss > 0 ? Math.round((x / ss) * 100000) : 0;
      const maxAdj1 = clamp(start[1] ?? 25000, 0, 50000) * 2;
      return [
        clamp(raw, 0, maxAdj1),
        start[1] ?? 25000,
        start[2] ?? 25000,
        start[3] ?? 43750,
      ];
    },
  },
  // adj2 — arrowhead half-width: vertical diamond on the right edge at y = y4.
  {
    position: ({ w, h }, adjustments) => {
      const { r, y4 } = guides(w, h, adjustments);
      return { x: insetAlongAxis(r, w), y: y4 };
    },
    apply: ({ w, h }, start, pointer) => {
      // y4 = 2·aw2 = 2·ss·adj2/100000  ⇒  adj2 = y / (2·ss) · 100000.
      const ss = Math.min(w, h);
      const y = Math.max(0, Math.min(h, pointer.y));
      const raw = ss > 0 ? Math.round((y / (2 * ss)) * 100000) : 0;
      return [
        start[0] ?? 25000,
        clamp(raw, 0, 50000),
        start[2] ?? 25000,
        start[3] ?? 43750,
      ];
    },
  },
  // adj3 — arrowhead length: horizontal diamond on the top edge at x = x4.
  {
    position: ({ w, h }, adjustments) => {
      const { x4 } = guides(w, h, adjustments);
      return { x: x4, y: insetAlongAxis(0, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const ss = Math.min(w, h);
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = ss > 0 ? Math.round(((w - x) / ss) * 100000) : 0;
      return [
        start[0] ?? 25000,
        start[1] ?? 25000,
        clamp(raw, 0, 50000),
        start[3] ?? 43750,
      ];
    },
  },
  // adj4 — bend radius: horizontal diamond on the top edge at x = bd.
  {
    position: ({ w, h }, adjustments) => {
      const { bd } = guides(w, h, adjustments);
      return { x: insetAlongAxis(bd, w), y: insetAlongAxis(0, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const { ss, maxAdj4 } = (() => {
        const gg = guides(w, h, start);
        return { ss: gg.ss, maxAdj4: gg.maxAdj4 };
      })();
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = ss > 0 ? Math.round((x / ss) * 100000) : 0;
      return [
        start[0] ?? 25000,
        start[1] ?? 25000,
        start[2] ?? 25000,
        clamp(raw, 0, maxAdj4),
      ];
    },
  },
];
