import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `borderCallout1` — ECMA-376 OOXML preset. The body is a FULL-FRAME
 * rectangle `(0,0,w,h)`; a thin, UNFILLED leader line runs from an
 * interior anchor point to the callout target. OOXML defines two leader
 * points: `(x1,y1)` (interior anchor) and `(x2,y2)` (target). The
 * renderer fills `PATH_BUILDERS[kind]` (the rect) and, when an
 * `OUTLINE_BUILDERS[kind]` exists, strokes THAT instead — so the leader
 * shows as a line and is never filled.
 *
 * Wafflebase keeps a reduced 2-adjustment spec: target x / target y
 * (fraction of w/h, OOXML thousandths). The interior anchor is fixed at
 * OOXML's default first point.
 */
export const BORDER_CALLOUT_1_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Target x', defaultValue: 18750, min: -50000, max: 150000, axisLabel: 'x' },
  { name: 'Target y', defaultValue: 112500, min: -50000, max: 150000, axisLabel: 'y' },
];

// OOXML default interior anchor point (x1,y1): adj2=-8333 (x), adj1=18750 (y).
const ANCHOR_X_FRAC = -8333 / 100000;
const ANCHOR_Y_FRAC = 18750 / 100000;

/**
 * Filled body + hit region: the full frame rectangle only. The leader
 * line lives in the outline builder so it is stroked, not filled.
 */
export const buildBorderCallout1: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

/**
 * Stroked outline: the rectangle border plus the straight (2-point)
 * leader from the interior anchor to the target. This is what the
 * renderer strokes (via OUTLINE_BUILDERS), so the leader is a line and
 * is never filled.
 */
export const buildBorderCallout1Outline: PathBuilder = ({ w, h }, adjustments) => {
  const tx = (adj(adjustments, 0, BORDER_CALLOUT_1_ADJUSTMENTS[0].defaultValue) / 100000) * w;
  const ty = (adj(adjustments, 1, BORDER_CALLOUT_1_ADJUSTMENTS[1].defaultValue) / 100000) * h;
  const ax = ANCHOR_X_FRAC * w;
  const ay = ANCHOR_Y_FRAC * h;
  const path = new Path2D();
  // Rectangle border.
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  // Leader polyline: interior anchor → target (straight).
  path.moveTo(ax, ay);
  path.lineTo(tx, ty);
  return path;
};

export const BORDER_CALLOUT_1_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const tx = (adjustments[0] ?? BORDER_CALLOUT_1_ADJUSTMENTS[0].defaultValue) / 100000;
      const ty = (adjustments[1] ?? BORDER_CALLOUT_1_ADJUSTMENTS[1].defaultValue) / 100000;
      return {
        x: insetAlongAxis(tx * w, w),
        y: insetAlongAxis(ty * h, h),
      };
    },
    apply: ({ w, h }, _start, pointer) => {
      const rawX = Math.round((pointer.x / w) * 100000);
      const rawY = Math.round((pointer.y / h) * 100000);
      return [
        Math.max(BORDER_CALLOUT_1_ADJUSTMENTS[0].min, Math.min(BORDER_CALLOUT_1_ADJUSTMENTS[0].max, rawX)),
        Math.max(BORDER_CALLOUT_1_ADJUSTMENTS[1].min, Math.min(BORDER_CALLOUT_1_ADJUSTMENTS[1].max, rawY)),
      ];
    },
  },
];
