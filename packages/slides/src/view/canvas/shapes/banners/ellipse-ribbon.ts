// packages/slides/src/view/canvas/shapes/banners/ellipse-ribbon.ts
import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { adj } from '../builder';
import { DEFAULT_ARC_SEGMENTS } from '../curves';

/**
 * Curved ("elliptical") ribbon banners. Like the V0 straight `ribbon`,
 * these ship as a simplified-but-recognizable approximation of the
 * OOXML parabolic preset: a constant-thickness band whose centreline
 * follows a parabola, with a small folded tab dropping below each end.
 *
 * `ellipseRibbon`  — the band arches **up** in the middle (ends droop).
 * `ellipseRibbon2` — the band arches **down** in the middle (ends rise).
 *
 * adj[0] body height — band thickness as ‰ of h (OOXML `adj1`, default 25000).
 * adj[1] arch amount — curve depth as ‰ of h (OOXML `adj3`, default 12500).
 * Curves use polyline approximation (shim-safe, like every curved shape).
 */
export const ELLIPSE_RIBBON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Body height', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Arch amount', defaultValue: 12500, min: 0, max: 50000 },
];

const DEF_BODY = 25000;
const DEF_ARCH = 12500;
const TAIL_FRAC = 0.12; // folded-tab width as a fraction of w
const TAIL_DROP = 0.18; // folded-tab depth as a fraction of h

/**
 * Build a curved ribbon. `dir = +1` arches up in the middle
 * (`ellipseRibbon`), `dir = -1` arches down (`ellipseRibbon2`).
 */
export function buildEllipseRibbonBand(
  { w, h }: { w: number; h: number },
  adjustments: number[] | undefined,
  dir: 1 | -1,
): Path2D {
  const t = Math.max(0, Math.min(50000, adj(adjustments, 0, DEF_BODY))) / 100000 * h;
  const arch = Math.max(0, Math.min(50000, adj(adjustments, 1, DEF_ARCH))) / 100000 * h;
  const tail = w * TAIL_FRAC;
  const drop = h * TAIL_DROP;
  const seg = DEFAULT_ARC_SEGMENTS;
  // Centreline parabola. u in [-1, 1]; parab = u² (0 centre, 1 ends).
  // dir +1 → centre sits high (small y), ends drop by `arch`.
  // dir -1 → centre sits low, ends rise.
  const mid = h / 2;
  const centre = (x: number) => {
    const u = (2 * x) / w - 1;
    return mid - dir * arch * (0.5 - u * u);
  };
  const top = (x: number) => centre(x) - t / 2;
  const bottom = (x: number) => centre(x) + t / 2;

  const path = new Path2D();
  // Top edge, left → right.
  path.moveTo(0, top(0));
  for (let i = 1; i <= seg; i++) {
    const x = (w * i) / seg;
    path.lineTo(x, top(x));
  }
  // Right folded tab: drop down, notch back up.
  path.lineTo(w, bottom(w) + drop);
  path.lineTo(w - tail, bottom(w) + drop - Math.min(drop, t));
  // Bottom edge, right → left.
  for (let i = seg; i >= 0; i--) {
    const x = (w * i) / seg;
    path.lineTo(x, bottom(x));
  }
  // Left folded tab.
  path.lineTo(tail, bottom(0) + drop - Math.min(drop, t));
  path.lineTo(0, bottom(0) + drop);
  path.closePath();
  return path;
}

export const buildEllipseRibbon: PathBuilder = (size, adjustments) =>
  buildEllipseRibbonBand(size, adjustments, 1);

export const buildEllipseRibbon2: PathBuilder = (size, adjustments) =>
  buildEllipseRibbonBand(size, adjustments, -1);

/** Vertical drag near the left end controls band thickness (adj[0]). */
function bodyHeightHandle(): AdjustmentHandle {
  return {
    position: ({ w, h }, adjustments) => {
      const t = ((adjustments[0] ?? DEF_BODY) / 100000) * h;
      return { x: w / 2, y: Math.max(0, h / 2 - t / 2) };
    },
    apply: ({ h }, start, pointer) => {
      const half = Math.abs(pointer.y - h / 2);
      const raw = h > 0 ? Math.round(((half * 2) / h) * 100000) : DEF_BODY;
      return [Math.max(0, Math.min(50000, raw)), start[1] ?? DEF_ARCH];
    },
  };
}

export const ELLIPSE_RIBBON_HANDLES: readonly AdjustmentHandle[] = [
  bodyHeightHandle(),
];
