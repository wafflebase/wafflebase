import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `borderCallout3` — rect body + three-segment tail with two
 * mid-bends. V0: 6 adjustments (2 bend points + target).
 */
export const BORDER_CALLOUT_3_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bend1 x', defaultValue: 38000, min: -50000, max: 150000, axisLabel: 'b1x' },
  { name: 'Bend1 y', defaultValue: 88000, min: -50000, max: 150000, axisLabel: 'b1y' },
  { name: 'Bend2 x', defaultValue: 25000, min: -50000, max: 150000, axisLabel: 'b2x' },
  { name: 'Bend2 y', defaultValue: 100000, min: -50000, max: 150000, axisLabel: 'b2y' },
  { name: 'Target x', defaultValue: 18750, min: -50000, max: 150000, axisLabel: 'tx' },
  { name: 'Target y', defaultValue: 115000, min: -50000, max: 150000, axisLabel: 'ty' },
];

const BODY_FRAC = 0.7;

export const buildBorderCallout3: PathBuilder = ({ w, h }, adjustments) => {
  const b1x = (adj(adjustments, 0, BORDER_CALLOUT_3_ADJUSTMENTS[0].defaultValue) / 100000) * w;
  const b1y = (adj(adjustments, 1, BORDER_CALLOUT_3_ADJUSTMENTS[1].defaultValue) / 100000) * h;
  const b2x = (adj(adjustments, 2, BORDER_CALLOUT_3_ADJUSTMENTS[2].defaultValue) / 100000) * w;
  const b2y = (adj(adjustments, 3, BORDER_CALLOUT_3_ADJUSTMENTS[3].defaultValue) / 100000) * h;
  const tx = (adj(adjustments, 4, BORDER_CALLOUT_3_ADJUSTMENTS[4].defaultValue) / 100000) * w;
  const ty = (adj(adjustments, 5, BORDER_CALLOUT_3_ADJUSTMENTS[5].defaultValue) / 100000) * h;
  const bodyH = h * BODY_FRAC;
  const tailWidth = w * 0.025;
  const startX = w / 2;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, bodyH);
  path.lineTo(startX + tailWidth, bodyH);
  path.lineTo(b1x + tailWidth, b1y);
  path.lineTo(b2x + tailWidth, b2y);
  path.lineTo(tx, ty);
  path.lineTo(b2x - tailWidth, b2y);
  path.lineTo(b1x - tailWidth, b1y);
  path.lineTo(startX - tailWidth, bodyH);
  path.lineTo(0, bodyH);
  path.closePath();
  return path;
};

const indexHandle = (index: 0 | 2 | 4): AdjustmentHandle => ({
  position: ({ w, h }, adjustments) => {
    const x = adjustments[index] ?? BORDER_CALLOUT_3_ADJUSTMENTS[index].defaultValue;
    const y = adjustments[index + 1] ?? BORDER_CALLOUT_3_ADJUSTMENTS[index + 1].defaultValue;
    return {
      x: insetAlongAxis((x / 100000) * w, w),
      y: insetAlongAxis((y / 100000) * h, h),
    };
  },
  apply: ({ w, h }, start, pointer) => {
    const rawX = Math.round((pointer.x / w) * 100000);
    const rawY = Math.round((pointer.y / h) * 100000);
    const specX = BORDER_CALLOUT_3_ADJUSTMENTS[index];
    const specY = BORDER_CALLOUT_3_ADJUSTMENTS[index + 1];
    const result = [...start];
    result[index] = Math.max(specX.min, Math.min(specX.max, rawX));
    result[index + 1] = Math.max(specY.min, Math.min(specY.max, rawY));
    return result;
  },
});

export const BORDER_CALLOUT_3_HANDLES: readonly AdjustmentHandle[] = [
  indexHandle(0),
  indexHandle(2),
  indexHandle(4),
];
