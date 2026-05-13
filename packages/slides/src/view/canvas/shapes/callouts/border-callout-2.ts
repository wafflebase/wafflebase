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

const indexHandle = (index: 0 | 1 | 2 | 3): AdjustmentHandle => ({
  position: ({ w, h }, adjustments) => {
    const val = adjustments[index] ?? BORDER_CALLOUT_2_ADJUSTMENTS[index].defaultValue;
    const frac = val / 100000;
    const isX = index % 2 === 0;
    if (isX) {
      const partner = adjustments[index + 1] ?? BORDER_CALLOUT_2_ADJUSTMENTS[index + 1].defaultValue;
      return {
        x: insetAlongAxis(frac * w, w),
        y: insetAlongAxis((partner / 100000) * h, h),
      };
    }
    return { x: 0, y: insetAlongAxis(frac * h, h) };
  },
  apply: ({ w, h }, start, pointer) => {
    const isX = index % 2 === 0;
    const raw = isX
      ? Math.round((pointer.x / w) * 100000)
      : Math.round((pointer.y / h) * 100000);
    const spec = BORDER_CALLOUT_2_ADJUSTMENTS[index];
    const result = [...start];
    result[index] = Math.max(spec.min, Math.min(spec.max, raw));
    return result;
  },
});

export const BORDER_CALLOUT_2_HANDLES: readonly AdjustmentHandle[] = [
  // Bend point: paint at (bx, by).
  indexHandle(0),
  // Target point: paint at (tx, ty).
  indexHandle(2),
];
