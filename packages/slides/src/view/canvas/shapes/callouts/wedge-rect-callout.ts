import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';

/**
 * `wedgeRectCallout` — speech-bubble rectangle with a triangular tail.
 *
 * Adjustments (`WEDGE_RECT_CALLOUT_ADJUSTMENTS`):
 *   [0] tailX — OOXML thousandths of `w`, measured from the frame
 *               centre. Default -20833 (tail x ≈ 0.292 · w).
 *   [1] tailY — OOXML thousandths of `h`, measured from the frame
 *               centre. Default 62500 (tail y ≈ 1.125 · h, i.e. just
 *               below the bubble).
 *
 * The tail attaches to whichever of the four rectangle edges is
 * closest to (tailX, tailY); negative adjustment values point
 * left/up, positive values point right/down.
 */
export const WEDGE_RECT_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
];

export const buildWedgeRectCallout: PathBuilder = ({ w, h }, adjustments) => {
  const tx = w / 2 + (adj(adjustments, 0, -20833) / 100000) * w;
  const ty = h / 2 + (adj(adjustments, 1, 62500) / 100000) * h;
  // Tail attaches to the closer of the four edges. Determine which.
  const distances = [
    { side: 'top',    d: Math.abs(ty - 0) },
    { side: 'right',  d: Math.abs(tx - w) },
    { side: 'bottom', d: Math.abs(ty - h) },
    { side: 'left',   d: Math.abs(tx - 0) },
  ];
  const closest = distances.reduce((a, b) => (a.d < b.d ? a : b));
  const baseHalf = Math.min(w, h) * 0.05;
  const path = new Path2D();
  path.moveTo(0, 0);
  // Top edge with optional tail.
  if (closest.side === 'top') {
    path.lineTo(Math.max(0, tx - baseHalf), 0);
    path.lineTo(tx, ty);
    path.lineTo(Math.min(w, tx + baseHalf), 0);
  }
  path.lineTo(w, 0);
  if (closest.side === 'right') {
    path.lineTo(w, Math.max(0, ty - baseHalf));
    path.lineTo(tx, ty);
    path.lineTo(w, Math.min(h, ty + baseHalf));
  }
  path.lineTo(w, h);
  if (closest.side === 'bottom') {
    path.lineTo(Math.min(w, tx + baseHalf), h);
    path.lineTo(tx, ty);
    path.lineTo(Math.max(0, tx - baseHalf), h);
  }
  path.lineTo(0, h);
  if (closest.side === 'left') {
    path.lineTo(0, Math.min(h, ty + baseHalf));
    path.lineTo(tx, ty);
    path.lineTo(0, Math.max(0, ty - baseHalf));
  }
  path.closePath();
  return path;
};

const CALLOUT_MIN = WEDGE_RECT_CALLOUT_ADJUSTMENTS[0].min;
const CALLOUT_MAX = WEDGE_RECT_CALLOUT_ADJUSTMENTS[0].max;
const HANDLE_INSET = 8;

export const WEDGE_RECT_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const tx = w / 2 + ((adjustments[0] ?? -20833) / 100000) * w;
      const ty = h / 2 + ((adjustments[1] ?? 62500) / 100000) * h;
      // Inset only when the tail is *inside* the frame AND within
      // INSET of a corner — that is the only case the diamond would
      // visually overlap a corner resize handle. Tails outside the
      // frame (default callout points outward) keep their raw
      // position so the diamond stays attached to the tail tip.
      const insideX = tx >= 0 && tx <= w;
      const insideY = ty >= 0 && ty <= h;
      if (insideX && insideY) {
        const nearLeft = tx < HANDLE_INSET;
        const nearRight = tx > w - HANDLE_INSET;
        const nearTop = ty < HANDLE_INSET;
        const nearBottom = ty > h - HANDLE_INSET;
        if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
          return {
            x: nearLeft ? HANDLE_INSET : w - HANDLE_INSET,
            y: nearTop ? HANDLE_INSET : h - HANDLE_INSET,
          };
        }
      }
      return { x: tx, y: ty };
    },
    apply: ({ w, h }, _start, pointer) => {
      const tx = w > 0 ? Math.round(((pointer.x - w / 2) / w) * 100000) : 0;
      const ty = h > 0 ? Math.round(((pointer.y - h / 2) / h) * 100000) : 0;
      const clamp = (v: number) => Math.max(CALLOUT_MIN, Math.min(CALLOUT_MAX, v));
      return [clamp(tx), clamp(ty)];
    },
  },
];
