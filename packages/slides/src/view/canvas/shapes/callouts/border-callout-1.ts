import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `borderCallout1` — rectangle body + single-segment wedge tail
 * pointing to a callout target. The rect takes the top 75% of the
 * frame; the tail extends from the rect's bottom-mid to the target
 * point. V0: 2 adjustments — target x (fraction of w) and target
 * y (fraction of h). OOXML's full 4-adjustment definition (start
 * + target) is reduced to "target only" for now; the start point
 * is fixed at the rect's bottom midpoint.
 */
export const BORDER_CALLOUT_1_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Target x', defaultValue: 18750, min: -50000, max: 150000, axisLabel: 'x' },
  { name: 'Target y', defaultValue: 112500, min: -50000, max: 150000, axisLabel: 'y' },
];

const BODY_FRAC = 0.75; // rect occupies the top 75% of the frame

export const buildBorderCallout1: PathBuilder = ({ w, h }, adjustments) => {
  const tx = (adj(adjustments, 0, BORDER_CALLOUT_1_ADJUSTMENTS[0].defaultValue) / 100000) * w;
  const ty = (adj(adjustments, 1, BORDER_CALLOUT_1_ADJUSTMENTS[1].defaultValue) / 100000) * h;
  const bodyH = h * BODY_FRAC;
  const tailWidth = w * 0.04;
  const startX = w / 2;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, bodyH);
  path.lineTo(startX + tailWidth, bodyH);
  path.lineTo(tx, ty);
  path.lineTo(startX - tailWidth, bodyH);
  path.lineTo(0, bodyH);
  path.closePath();
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
