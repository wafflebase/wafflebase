import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { pointTailHandle } from './handles';
import { wedgeTailGuides } from './wedge-common';

/**
 * `wedgeRectCallout` — speech-bubble rectangle with a triangular tail.
 * Faithful port of the ECMA-376 `wedgeRectCallout` preset.
 *
 * Adjustments (`WEDGE_RECT_CALLOUT_ADJUSTMENTS`):
 *   [0] adj1 — tail tip x, OOXML thousandths of `w` from the frame
 *              centre. Default -20833.
 *   [1] adj2 — tail tip y, OOXML thousandths of `h` from the frame
 *              centre. Default 62500 (tip just below the bubble).
 *
 * The tail is a fixed third-of-side wide wedge anchored in the quadrant
 * the tip points toward (`x1..x2`/`y1..y2` = 7..10 or 2..5 twelfths),
 * exiting whichever edge the diagonal-slope test selects. See
 * `wedge-common.ts` for the shared guide derivation.
 */
export const WEDGE_RECT_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
];

export const buildWedgeRectCallout: PathBuilder = ({ w, h }, adjustments) => {
  const g = wedgeTailGuides(
    w,
    h,
    adj(adjustments, 0, -20833),
    adj(adjustments, 1, 62500),
  );
  const path = new Path2D();
  // OOXML pathLst: rectangle walked clockwise from the top-left, with a
  // conditional tail vertex inserted into each edge's wedge-base notch.
  path.moveTo(0, 0);
  path.lineTo(g.x1, 0);
  path.lineTo(g.xt, g.yt);
  path.lineTo(g.x2, 0);
  path.lineTo(w, 0);
  path.lineTo(w, g.y1);
  path.lineTo(g.xr, g.yr);
  path.lineTo(w, g.y2);
  path.lineTo(w, h);
  path.lineTo(g.x2, h);
  path.lineTo(g.xb, g.yb);
  path.lineTo(g.x1, h);
  path.lineTo(0, h);
  path.lineTo(0, g.y2);
  path.lineTo(g.xl, g.yl);
  path.lineTo(0, g.y1);
  path.closePath();
  return path;
};

export const WEDGE_RECT_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  pointTailHandle(
    WEDGE_RECT_CALLOUT_ADJUSTMENTS[0],
    WEDGE_RECT_CALLOUT_ADJUSTMENTS[1],
  ),
];
