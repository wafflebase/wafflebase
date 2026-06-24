import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { linearLeftEdgeHandle, linearTopEdgeHandle } from '../handles';

/**
 * `round2DiagRect` — rectangle with two diagonally-opposite corners
 * rounded per ECMA-376 OOXML preset geometry.
 *
 * Per the OOXML `round2DiagRect` spec, `adj1` controls the radius of
 * the TOP-LEFT (NW) and BOTTOM-RIGHT (SE) corners, and `adj2` controls
 * the TOP-RIGHT (NE) and BOTTOM-LEFT (SW) corners. The default
 * adjustments (`adj1 = 16667`, `adj2 = 0`) therefore round the NW + SE
 * diagonal pair and leave the NE + SW pair square.
 *
 * Radius is `adj/100000 * min(w, h)` (the OOXML `ss` shortest-side
 * scale), clamped so the spec range `[0, 50000]` keeps each radius
 * within half the shortest side.
 */
export const ROUND2_DIAG_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'NW/SE corner radius',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    axisLabel: 'nw',
  },
  {
    name: 'NE/SW corner radius',
    defaultValue: 0,
    min: 0,
    max: 50000,
    axisLabel: 'ne',
  },
];

export const buildRound2DiagRect: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, ROUND2_DIAG_RECT_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, ROUND2_DIAG_RECT_ADJUSTMENTS[1].defaultValue);
  const ss = Math.min(w, h);
  // adj1 → NW + SE, adj2 → NE + SW (per OOXML `round2DiagRect`).
  const rNwSe = (a1 / 100000) * ss;
  const rNeSw = (a2 / 100000) * ss;

  const path = new Path2D();
  // Clockwise (y DOWN), starting at the end of the NW corner's top edge.
  // Top edge: NW round-out → NE corner.
  path.moveTo(rNwSe, 0);
  path.lineTo(w - rNeSw, 0);
  if (rNeSw > 0) {
    // NE corner: from top edge (up) round to right edge.
    const ne = polylineArc(w - rNeSw, rNeSw, rNeSw, rNeSw, -Math.PI / 2, 0);
    for (const p of ne) path.lineTo(p.x, p.y);
  } else {
    path.lineTo(w, 0);
  }
  // Right edge → SE corner.
  path.lineTo(w, h - rNwSe);
  if (rNwSe > 0) {
    // SE corner: from right edge round to bottom edge.
    const se = polylineArc(w - rNwSe, h - rNwSe, rNwSe, rNwSe, 0, Math.PI / 2);
    for (const p of se) path.lineTo(p.x, p.y);
  } else {
    path.lineTo(w, h);
  }
  // Bottom edge → SW corner.
  path.lineTo(rNeSw, h);
  if (rNeSw > 0) {
    // SW corner: from bottom edge round to left edge.
    const sw = polylineArc(
      rNeSw,
      h - rNeSw,
      rNeSw,
      rNeSw,
      Math.PI / 2,
      Math.PI,
    );
    for (const p of sw) path.lineTo(p.x, p.y);
  } else {
    path.lineTo(0, h);
  }
  // Left edge → NW corner.
  path.lineTo(0, rNwSe);
  if (rNwSe > 0) {
    // NW corner: from left edge round to top edge.
    const nw = polylineArc(
      rNwSe,
      rNwSe,
      rNwSe,
      rNwSe,
      Math.PI,
      (3 * Math.PI) / 2,
    );
    for (const p of nw) path.lineTo(p.x, p.y);
  } else {
    path.lineTo(0, 0);
  }
  path.closePath();
  return path;
};

export const ROUND2_DIAG_RECT_HANDLES: readonly AdjustmentHandle[] = [
  // adj1 (NW/SE) — diamond slides along the top edge from the left
  // corner; x measures the NW horizontal round-out distance.
  linearTopEdgeHandle({
    forward: (val, { w, h }) => (val / 100000) * Math.min(w, h),
    inverse: (x, { w, h }) => (x / Math.min(w, h)) * 100000,
    spec: ROUND2_DIAG_RECT_ADJUSTMENTS[0],
    index: 0,
  }),
  // adj2 (NE/SW) — diamond slides along the left edge from the bottom
  // corner; y measures the SW vertical round-out distance.
  linearLeftEdgeHandle({
    forward: (val, { w, h }) => h - (val / 100000) * Math.min(w, h),
    inverse: (y, { w, h }) => ((h - y) / Math.min(w, h)) * 100000,
    spec: ROUND2_DIAG_RECT_ADJUSTMENTS[1],
    index: 1,
  }),
];
