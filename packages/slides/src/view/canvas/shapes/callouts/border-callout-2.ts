import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `borderCallout2` — rect body + two-segment tail with one mid-bend.
 * V0: 4 adjustments (bend point + target point).
 */
export const BORDER_CALLOUT_2_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bend x', defaultValue: 18750, min: -50000, max: 150000, axisLabel: 'bendX' },
  { name: 'Bend y', defaultValue: 90000, min: -50000, max: 150000, axisLabel: 'bendY' },
  { name: 'Target x', defaultValue: 18750, min: -50000, max: 150000, axisLabel: 'targetX' },
  { name: 'Target y', defaultValue: 112500, min: -50000, max: 150000, axisLabel: 'targetY' },
];

const BODY_FRAC = 0.75;

export const buildBorderCallout2: PathBuilder = ({ w, h }, adjustments) => {
  const bx = (adj(adjustments, 0, BORDER_CALLOUT_2_ADJUSTMENTS[0].defaultValue) / 100000) * w;
  const by = (adj(adjustments, 1, BORDER_CALLOUT_2_ADJUSTMENTS[1].defaultValue) / 100000) * h;
  const tx = (adj(adjustments, 2, BORDER_CALLOUT_2_ADJUSTMENTS[2].defaultValue) / 100000) * w;
  const ty = (adj(adjustments, 3, BORDER_CALLOUT_2_ADJUSTMENTS[3].defaultValue) / 100000) * h;
  const bodyH = h * BODY_FRAC;
  const tailWidth = w * 0.03;
  const startX = w / 2;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, bodyH);
  path.lineTo(startX + tailWidth, bodyH);
  path.lineTo(bx + tailWidth, by);
  path.lineTo(tx, ty);
  path.lineTo(bx - tailWidth, by);
  path.lineTo(startX - tailWidth, bodyH);
  path.lineTo(0, bodyH);
  path.closePath();
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
