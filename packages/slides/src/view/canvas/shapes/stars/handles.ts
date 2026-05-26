// packages/slides/src/view/canvas/shapes/stars/handles.ts
import type { AdjustmentHandle, AdjustmentSpec } from '../builder';

/**
 * Radial drag handle for an N-pointed star. Position = first inner-
 * ring vertex (immediately clockwise of the apex outer vertex). Drag
 * vector along the same ray controls the inner ratio. All math in
 * unit-ellipse space so non-square frames behave consistently with
 * the path builder's ellipse inscription.
 *
 * `spec` supplies the OOXML clamp range; callers pass the star's own
 * `AdjustmentSpec` so adding a future star with a different `max`
 * cannot silently desync from the factory.
 */
export function radialStarHandle(
  points: number,
  spec: AdjustmentSpec,
): AdjustmentHandle {
  const theta = -Math.PI / 2 + Math.PI / points;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const { min, max } = spec;

  return {
    position: ({ w, h }, adjustments) => {
      const ratio = (adjustments[0] ?? 0) / 100000;
      const cx = w / 2;
      const cy = h / 2;
      const rx = w / 2;
      const ry = h / 2;
      return { x: cx + ratio * rx * cos, y: cy + ratio * ry * sin };
    },
    apply: ({ w, h }, _start, pointer) => {
      const cx = w / 2;
      const cy = h / 2;
      const rx = w / 2;
      const ry = h / 2;
      // Normalize into unit-ellipse space then project onto the
      // handle's ray.
      const u = rx > 0 ? (pointer.x - cx) / rx : 0;
      const v = ry > 0 ? (pointer.y - cy) / ry : 0;
      const radial = Math.max(0, u * cos + v * sin);
      const ratio = Math.min(1, radial);
      const value = Math.round(ratio * 100000);
      return [Math.max(min, Math.min(max, value))];
    },
  };
}
