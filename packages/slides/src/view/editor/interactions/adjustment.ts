import { ADJUSTMENT_SPECS } from '../../canvas/shapes';
import type { ShapeKind } from '../../../model/element';

const SNAP_FRACTION = 0.05;

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
