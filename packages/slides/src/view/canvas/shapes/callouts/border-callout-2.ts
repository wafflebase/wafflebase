import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `borderCallout2` — ECMA-376 OOXML preset. FULL-FRAME rectangle body
 * plus a thin UNFILLED leader with one bend: interior anchor → bend →
 * target (3 points). OOXML defines the leader as `(x1,y1)`,`(x2,y2)`,
 * `(x3,y3)`; the renderer fills the rect (PATH_BUILDERS) and strokes the
 * outline (OUTLINE_BUILDERS), so the leader is a line and never filled.
 *
 * Wafflebase keeps a reduced 4-adjustment spec: bend (x,y) + target
 * (x,y), fractions of w/h (OOXML thousandths). The interior anchor is
 * fixed at OOXML's default first point.
 */
export const BORDER_CALLOUT_2_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bend x', defaultValue: 18750, min: -50000, max: 150000, axisLabel: 'bendX' },
  { name: 'Bend y', defaultValue: 90000, min: -50000, max: 150000, axisLabel: 'bendY' },
  { name: 'Target x', defaultValue: 18750, min: -50000, max: 150000, axisLabel: 'targetX' },
  { name: 'Target y', defaultValue: 112500, min: -50000, max: 150000, axisLabel: 'targetY' },
];

// OOXML default interior anchor point (x1,y1): adj2=-8333 (x), adj1=18750 (y).
const ANCHOR_X_FRAC = -8333 / 100000;
const ANCHOR_Y_FRAC = 18750 / 100000;

/** Filled body + hit region: the full frame rectangle only. */
export const buildBorderCallout2: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

/**
 * Stroked outline: rectangle border + leader polyline with one bend
 * (interior anchor → bend → target). Stroked, never filled.
 */
export const buildBorderCallout2Outline: PathBuilder = ({ w, h }, adjustments) => {
  const bx = (adj(adjustments, 0, BORDER_CALLOUT_2_ADJUSTMENTS[0].defaultValue) / 100000) * w;
  const by = (adj(adjustments, 1, BORDER_CALLOUT_2_ADJUSTMENTS[1].defaultValue) / 100000) * h;
  const tx = (adj(adjustments, 2, BORDER_CALLOUT_2_ADJUSTMENTS[2].defaultValue) / 100000) * w;
  const ty = (adj(adjustments, 3, BORDER_CALLOUT_2_ADJUSTMENTS[3].defaultValue) / 100000) * h;
  const ax = ANCHOR_X_FRAC * w;
  const ay = ANCHOR_Y_FRAC * h;
  const path = new Path2D();
  // Rectangle border.
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  // Leader polyline: anchor → bend → target.
  path.moveTo(ax, ay);
  path.lineTo(bx, by);
  path.lineTo(tx, ty);
  return path;
};

// Each handle controls an (x, y) coordinate pair. `xIndex` is the
// adjustment index for the x coordinate; the matching y is at
// `xIndex + 1`. The earlier `index: 0|1|2|3` form only updated one
// axis per drag — bend/target handles slid horizontally only.
const indexHandle = (xIndex: 0 | 2): AdjustmentHandle => ({
  position: ({ w, h }, adjustments) => {
    const x =
      adjustments[xIndex] ?? BORDER_CALLOUT_2_ADJUSTMENTS[xIndex].defaultValue;
    const y =
      adjustments[xIndex + 1] ?? BORDER_CALLOUT_2_ADJUSTMENTS[xIndex + 1].defaultValue;
    return {
      x: insetAlongAxis((x / 100000) * w, w),
      y: insetAlongAxis((y / 100000) * h, h),
    };
  },
  apply: ({ w, h }, start, pointer) => {
    const rawX = w > 0 ? Math.round((pointer.x / w) * 100000) : 0;
    const rawY = h > 0 ? Math.round((pointer.y / h) * 100000) : 0;
    const specX = BORDER_CALLOUT_2_ADJUSTMENTS[xIndex];
    const specY = BORDER_CALLOUT_2_ADJUSTMENTS[xIndex + 1];
    const result = [...start];
    result[xIndex] = Math.max(specX.min, Math.min(specX.max, rawX));
    result[xIndex + 1] = Math.max(specY.min, Math.min(specY.max, rawY));
    return result;
  },
});

export const BORDER_CALLOUT_2_HANDLES: readonly AdjustmentHandle[] = [
  // Bend point: paint at (bx, by). xIndex=0 controls (adj0, adj1).
  indexHandle(0),
  // Target point: paint at (tx, ty). xIndex=2 controls (adj2, adj3).
  indexHandle(2),
];
