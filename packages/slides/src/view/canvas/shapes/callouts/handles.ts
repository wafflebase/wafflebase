// packages/slides/src/view/canvas/shapes/callouts/handles.ts
//
// Shared factory for callout "tail point" adjustment handles. All
// four wedge/cloud callouts in P1/P2 encode their tail tip the same
// way — adjustments [0]/[1] are signed thousandths of (w, h) measured
// from the frame centre — so the position/apply math collapses into
// a single factory parameterised on the two AdjustmentSpec entries.
import type {
  AdjustmentHandle,
  AdjustmentSpec,
} from '../builder';

const HANDLE_INSET = 8;

/**
 * Point-axis (2D) drag handle for callout tails. Both adjustments are
 * driven by one drag: `adjustments[0]` is signed thousandths of `w`
 * around the frame x centre, `adjustments[1]` is signed thousandths
 * of `h` around the y centre.
 *
 * Paint position equals the tail tip exactly, EXCEPT when the tail
 * lands inside the frame and within `HANDLE_INSET` of a corner — in
 * that case the diamond is pushed `HANDLE_INSET` away from the corner
 * so it doesn't visually disappear under a corner resize handle. The
 * stored adjustment data still reaches the boundary value; only the
 * paint position is clipped. Tails outside the frame (the common
 * "callout points away from the bubble" case) keep their raw
 * attached-to-tip position.
 */
export function pointTailHandle(
  specX: AdjustmentSpec,
  specY: AdjustmentSpec,
): AdjustmentHandle {
  return {
    position: ({ w, h }, adjustments) => {
      const tx = w / 2 + ((adjustments[0] ?? specX.defaultValue) / 100000) * w;
      const ty = h / 2 + ((adjustments[1] ?? specY.defaultValue) / 100000) * h;
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
    apply: ({ w, h }, start, pointer) => {
      const tx = w > 0 ? Math.round(((pointer.x - w / 2) / w) * 100000) : 0;
      const ty = h > 0 ? Math.round(((pointer.y - h / 2) / h) * 100000) : 0;
      const clampX = Math.max(specX.min, Math.min(specX.max, tx));
      const clampY = Math.max(specY.min, Math.min(specY.max, ty));
      const result = [...start];
      result[0] = clampX;
      result[1] = clampY;
      return result;
    },
  };
}
