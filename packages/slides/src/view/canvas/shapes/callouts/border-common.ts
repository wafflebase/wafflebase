// packages/slides/src/view/canvas/shapes/callouts/border-common.ts
//
// Shared geometry for the OOXML border callouts (`borderCallout1/2/3`).
// Each is a full-frame rectangle (filled body) PLUS a separate
// `fill="none"` leader polyline that runs through N target points. The
// adjustments are stored in OOXML order — alternating `(y, x)` pairs
// (`adj1=y1, adj2=x1, adj3=y2, adj4=x2, …`), each a thousandth of the
// frame height/width.

import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { adj } from '../builder';

/** Full-frame rectangle body, shared by all three border callouts. */
export const buildBorderCalloutBox: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};

/**
 * Build the open leader polyline from a `[y1, x1, y2, x2, …]` adjustment
 * layout. `defaults` carries the per-index OOXML default so a missing or
 * short adjustments array still renders the preset leader.
 */
export function buildBorderLeader(
  w: number,
  h: number,
  adjustments: number[] | undefined,
  defaults: readonly number[],
): Path2D {
  const path = new Path2D();
  const pointCount = defaults.length / 2;
  for (let i = 0; i < pointCount; i++) {
    const y = (h * adj(adjustments, 2 * i, defaults[2 * i])) / 100000;
    const x = (w * adj(adjustments, 2 * i + 1, defaults[2 * i + 1])) / 100000;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  return path;
}

/**
 * One draggable leader vertex controlling its `(y, x)` adjustment pair
 * (`yIndex = 2i`, `xIndex = 2i+1`). Pointer → thousandths of frame
 * dimensions; other indices pass through unchanged.
 */
export function leaderPointHandle(
  yIndex: number,
  xIndex: number,
  ySpec: AdjustmentSpec,
  xSpec: AdjustmentSpec,
): AdjustmentHandle {
  return {
    // No `insetAlongAxis` here: a leader vertex legitimately sits OUTSIDE
    // the frame (the target points down-left of the box by default), so the
    // handle must land on the real line endpoint, not clamped to the box
    // edge — matching where PowerPoint / Google Slides draw it.
    position: ({ w, h }, adjustments) => ({
      x: ((adjustments[xIndex] ?? xSpec.defaultValue) / 100000) * w,
      y: ((adjustments[yIndex] ?? ySpec.defaultValue) / 100000) * h,
    }),
    apply: ({ w, h }, start, pointer) => {
      const result = [...start];
      // Guard zero-size frames so a drag can't write NaN (parity with the
      // arrow callout handles).
      const rawX = w > 0 ? Math.round((pointer.x / w) * 100000) : xSpec.defaultValue;
      const rawY = h > 0 ? Math.round((pointer.y / h) * 100000) : ySpec.defaultValue;
      result[xIndex] = Math.max(xSpec.min, Math.min(xSpec.max, rawX));
      result[yIndex] = Math.max(ySpec.min, Math.min(ySpec.max, rawY));
      return result;
    },
  };
}

/** Generous shared bounds — leader targets routinely sit outside the box. */
export const Y_BOUND = { min: -150000, max: 200000 } as const;
export const X_BOUND = { min: -200000, max: 200000 } as const;
