// packages/slides/src/view/canvas/shapes/preset/handles.ts
//
// Generic adjustment handle for preset-defined shapes. Rather than
// hand-deriving a closed-form inverse for each shape's adjustment →
// landmark relationship, the handle:
//
//   - reads its diamond position straight from a preset guide point
//     (the `<a:ahXY>/<a:ahPolar>` `pos` landmark), and
//   - on drag, numerically searches the single adjustment it controls
//     for the value that brings that landmark closest to the pointer.
//
// The per-handle objective (distance from landmark to pointer as the
// one adjustment varies over its `[min, max]`) is unimodal for the
// arrow adjustments we wire (thickness, head length/size, sweep/start
// angles), so a golden-section search converges reliably without any
// shape-specific math.

import type { AdjustmentHandle, AdjustmentSpec, FrameSize, Point } from '../builder';
import { insetAlongAxis } from '../handles';
import { presetPoint } from './path';
import type { PresetShapeDef } from './types';

/** Number of adjustment slots a preset declares (adj1, adj2, …). */
function adjCount(def: PresetShapeDef): number {
  return Object.keys(def.adj).length;
}

/**
 * Build a full adjustment array from a (possibly short) start array,
 * filling unset slots with the preset's avLst defaults so guide
 * evaluation stays self-consistent while a single slot is varied.
 */
function fullAdjustments(
  def: PresetShapeDef,
  start: number[],
  override?: { index: number; value: number },
): number[] {
  const n = adjCount(def);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = start[i] ?? def.adj[`adj${i + 1}`] ?? 0;
    out.push(v);
  }
  if (override && override.index < n) out[override.index] = override.value;
  return out;
}

const GOLDEN = (Math.sqrt(5) - 1) / 2; // 0.618…
const SEARCH_ITERS = 60;

/**
 * A preset adjustment handle. `index` is the 0-based adjustment slot
 * (slot 0 ⇒ `adj1`); `posX`/`posY` are the guide tokens for the
 * landmark diamond; `spec` supplies the drag clamp.
 */
export function presetNumericHandle(opts: {
  def: PresetShapeDef;
  index: number;
  posX: string;
  posY: string;
  spec: AdjustmentSpec;
}): AdjustmentHandle {
  const { def, index, posX, posY, spec } = opts;
  return {
    position: (frame: FrameSize, adjustments: number[]): Point => {
      const full = fullAdjustments(def, adjustments);
      const p = presetPoint(def, frame, full, posX, posY);
      return {
        x: insetAlongAxis(p.x, frame.w),
        y: insetAlongAxis(p.y, frame.h),
      };
    },
    apply: (frame: FrameSize, start: number[], pointer: Point): number[] => {
      const dist2 = (value: number): number => {
        const full = fullAdjustments(def, start, { index, value });
        let p: Point;
        try {
          p = presetPoint(def, frame, full, posX, posY);
        } catch {
          return Number.POSITIVE_INFINITY;
        }
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        return dx * dx + dy * dy;
      };
      // Golden-section minimisation over [min, max].
      let a = spec.min;
      let b = spec.max;
      let c = b - GOLDEN * (b - a);
      let d = a + GOLDEN * (b - a);
      let fc = dist2(c);
      let fd = dist2(d);
      for (let i = 0; i < SEARCH_ITERS; i++) {
        if (fc < fd) {
          b = d;
          d = c;
          fd = fc;
          c = b - GOLDEN * (b - a);
          fc = dist2(c);
        } else {
          a = c;
          c = d;
          fc = fd;
          d = a + GOLDEN * (b - a);
          fd = dist2(d);
        }
      }
      const best = (a + b) / 2;
      const clamped = Math.max(spec.min, Math.min(spec.max, Math.round(best)));
      const result = fullAdjustments(def, start);
      result[index] = clamped;
      return result;
    },
  };
}

/**
 * Angular preset handle for an adjustment that stores an *absolute*
 * angle in DrawingML 60000ths of a degree about the frame centre
 * (e.g. circularArrow's start/end angle, `adj4`/`adj3`). The diamond
 * is drawn at a preset landmark; on drag the angle is read directly
 * from `atan2(pointer − centre)`, normalised to `[0, 21600000)`.
 */
export function presetAngularHandle(opts: {
  def: PresetShapeDef;
  index: number;
  posX: string;
  posY: string;
  spec: AdjustmentSpec;
}): AdjustmentHandle {
  const { def, index, posX, posY, spec } = opts;
  return {
    position: (frame: FrameSize, adjustments: number[]): Point => {
      const full = fullAdjustments(def, adjustments);
      const p = presetPoint(def, frame, full, posX, posY);
      return {
        x: insetAlongAxis(p.x, frame.w),
        y: insetAlongAxis(p.y, frame.h),
      };
    },
    apply: (frame: FrameSize, start: number[], pointer: Point): number[] => {
      const cx = frame.w / 2;
      const cy = frame.h / 2;
      let deg = (Math.atan2(pointer.y - cy, pointer.x - cx) * 180) / Math.PI;
      // Unwrap toward the start angle so dragging across the 0°/360°
      // seam doesn't snap to the opposite side (mirrors `angularHandle`).
      const startRaw = (start[index] ?? spec.defaultValue) / 60000;
      const startDeg = Number.isFinite(startRaw) ? startRaw : 0;
      const MAX_UNWRAP = 4;
      let steps = 0;
      while (deg - startDeg > 180 && steps++ < MAX_UNWRAP) deg -= 360;
      steps = 0;
      while (deg - startDeg < -180 && steps++ < MAX_UNWRAP) deg += 360;
      const ooxml = Math.round(deg * 60000);
      const clamped = Math.max(spec.min, Math.min(spec.max, ooxml));
      const result = fullAdjustments(def, start);
      result[index] = clamped;
      return result;
    },
  };
}
