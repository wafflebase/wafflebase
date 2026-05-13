import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { angularHandle, insetAlongAxis } from '../handles';

/**
 * `circularArrow` — near-complete circular band with a pointy tip
 * at one end. V0: sweep is fixed at 300° (60° gap). Three
 * adjustments: shaft thickness + head length + start angle of the
 * gap. The start angle uses `angularHandle` so the user can rotate
 * the gap around the frame.
 */
export const CIRCULAR_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 12500, min: 0, max: 25000 },
  { name: 'Head length', defaultValue: 12500, min: 0, max: 30000 },
  {
    name: 'Start angle',
    defaultValue: -3600000, // −60° → gap opens to the upper-right.
    min: -21600000,
    max: 21600000,
    axisLabel: 'start',
  },
];

const SWEEP_DEGREES = 300;
const SWEEP_RAD = (SWEEP_DEGREES * Math.PI) / 180;

export const buildCircularArrow: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 12500);
  const a2 = adj(adjustments, 1, 12500);
  const startOoxml = adj(adjustments, 2, -3600000);
  const shaft = (a1 / 100000) * Math.min(w, h);
  const headLen = (a2 / 100000) * Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const outerR = Math.min(w, h) / 2 - headLen;
  const innerR = Math.max(0, outerR - shaft);
  const t0 = (startOoxml / 60000) * (Math.PI / 180);
  const t1 = t0 + SWEEP_RAD;
  const outer = polylineArc(cx, cy, outerR, outerR, t0, t1, 32);
  const inner = polylineArc(cx, cy, innerR, innerR, t1, t0, 32);
  const outerHead = outer[outer.length - 1];
  const innerHead = inner[0];
  // Pointy tip extends radially outward from centre.
  const dx = outerHead.x - cx;
  const dy = outerHead.y - cy;
  const len = Math.sqrt(dx * dx + dy * dy);
  const tipX = outerHead.x + (len > 0 ? (dx / len) * headLen : 0);
  const tipY = outerHead.y + (len > 0 ? (dy / len) * headLen : 0);
  const path = new Path2D();
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) {
    path.lineTo(outer[i].x, outer[i].y);
  }
  path.lineTo(tipX, tipY);
  path.lineTo(innerHead.x, innerHead.y);
  for (let i = 1; i < inner.length; i++) {
    path.lineTo(inner[i].x, inner[i].y);
  }
  path.closePath();
  return path;
};

export const CIRCULAR_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  // Shaft thickness — diamond on the inner arc at the start angle.
  {
    position: ({ w, h }, adjustments) => {
      const shaft = ((adjustments[0] ?? 12500) / 100000) * Math.min(w, h);
      const headLen = ((adjustments[1] ?? 12500) / 100000) * Math.min(w, h);
      const startOoxml = adjustments[2] ?? -3600000;
      const t0 = (startOoxml / 60000) * (Math.PI / 180);
      const cx = w / 2;
      const cy = h / 2;
      const outerR = Math.min(w, h) / 2 - headLen;
      const innerR = Math.max(0, outerR - shaft);
      return {
        x: insetAlongAxis(cx + innerR * Math.cos(t0), w),
        y: insetAlongAxis(cy + innerR * Math.sin(t0), h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const cx = w / 2;
      const cy = h / 2;
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const outerR = Math.min(w, h) / 2;
      const shaft = Math.max(0, outerR - r);
      const raw = Math.round((shaft / outerR) * 100000);
      const spec = CIRCULAR_ARROW_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 12500,
        start[2] ?? -3600000,
      ];
    },
  },
  // Head length — diamond on the outer perimeter at the head end.
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[1] ?? 12500) / 100000) * Math.min(w, h);
      const startOoxml = adjustments[2] ?? -3600000;
      const t1 = (startOoxml / 60000) * (Math.PI / 180) + SWEEP_RAD;
      const cx = w / 2;
      const cy = h / 2;
      const outerR = Math.min(w, h) / 2 - headLen;
      return {
        x: insetAlongAxis(cx + outerR * Math.cos(t1), w),
        y: insetAlongAxis(cy + outerR * Math.sin(t1), h),
      };
    },
    apply: ({ w, h }, start, pointer) => {
      const cx = w / 2;
      const cy = h / 2;
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const outerR = Math.min(w, h) / 2;
      const headLen = Math.max(0, outerR - r);
      const raw = Math.round((headLen / outerR) * 100000);
      const spec = CIRCULAR_ARROW_ADJUSTMENTS[1];
      return [
        start[0] ?? 12500,
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[2] ?? -3600000,
      ];
    },
  },
  // Start angle — angular handle on the outer perimeter at t0.
  angularHandle({
    center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
    radius: ({ w, h }) => {
      const halfMin = Math.min(w, h) / 2;
      return { rx: halfMin - 4, ry: halfMin - 4 };
    },
    index: 2,
    spec: CIRCULAR_ARROW_ADJUSTMENTS[2],
  }),
];
