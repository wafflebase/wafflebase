import { ADJUSTMENT_SPECS } from '../../canvas/shapes';
import type { ShapeKind } from '../../../model/element';

const SNAP_FRACTION = 0.05;

export type RotatedFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
};

/**
 * Element-local → slide-world coords. Element-local origin is the
 * frame's top-left, axes pre-rotation; slide-world is the un-rotated
 * slide coord system. Used by the overlay to paint adjustment handles
 * on rotated shapes.
 */
export function adjustmentLocalToWorld(
  frame: RotatedFrame,
  local: { x: number; y: number },
): { x: number; y: number } {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const dx = local.x - frame.w / 2;
  const dy = local.y - frame.h / 2;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * Slide-world → element-local coords. Inverse of
 * `adjustmentLocalToWorld`. Used by the drag loop to convert pointer
 * events into the shape's pre-rotation coord space before calling
 * `AdjustmentHandle.apply`.
 */
export function adjustmentWorldToLocal(
  frame: RotatedFrame,
  world: { x: number; y: number },
): { x: number; y: number } {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const dx = world.x - cx;
  const dy = world.y - cy;
  return {
    x: dx * cos + dy * sin + frame.w / 2,
    y: -dx * sin + dy * cos + frame.h / 2,
  };
}

/**
 * Expand the AdjustmentSpec defaults for a shape into a full
 * adjustments array. Returns [] for shapes with no spec.
 */
export function defaultAdjustmentsFor(kind: ShapeKind): number[] {
  const specs = ADJUSTMENT_SPECS.get(kind);
  if (!specs) return [];
  return specs.map((s) => s.defaultValue);
}

/**
 * Snap each adjustment to its default if it is within 5% of
 * (max - min) of that default. Snap is all-or-nothing across
 * multi-index handles: every component must qualify.
 */
export function snapToDefaults(
  kind: ShapeKind,
  adjustments: number[],
): number[] {
  const specs = ADJUSTMENT_SPECS.get(kind);
  if (!specs) return adjustments;
  const allClose = specs.every((spec, i) => {
    const v = adjustments[i] ?? spec.defaultValue;
    const range = spec.max - spec.min;
    return Math.abs(v - spec.defaultValue) <= range * SNAP_FRACTION;
  });
  return allClose ? specs.map((s) => s.defaultValue) : adjustments;
}
