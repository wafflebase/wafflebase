// packages/slides/src/view/canvas/shapes/callouts/wedge-common.ts
//
// Shared tail geometry for `wedgeRectCallout` and `wedgeRoundRectCallout`.
// Both presets use an identical `gdLst` to decide which edge the tail
// pokes out of and where its base anchors sit; only the corner treatment
// differs. Ported verbatim from ECMA-376 `presetShapeDefinitions.xml`.

import { ifPos } from './ooxml-math';

/**
 * The OOXML wedge tail guides for a `(w, h)` frame and the two position
 * adjustments (`adj1`/`adj2`, thousandths of `w`/`h` from the centre).
 *
 * The wedge base is a fixed third-of-side wide notch (`x1..x2` = `7..10`
 * or `2..5` twelfths) sitting in the quadrant the tip points toward; the
 * tail exits whichever pair of opposite edges the diagonal-slope test
 * (`dz = |dy| − |dq|`, `dq = dxPos·h/w`) selects. Each edge gets a
 * conditional vertex that either reaches the tip `(xPos, yPos)` or
 * collapses onto the edge, so exactly one tail protrudes.
 */
export type WedgeTailGuides = {
  /** Tail tip. */
  xPos: number;
  yPos: number;
  /** Wedge-base anchor fractions along the top/bottom and left/right. */
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  /** Per-edge tail vertex (top, right, bottom, left). */
  xt: number;
  yt: number;
  xr: number;
  yr: number;
  xb: number;
  yb: number;
  xl: number;
  yl: number;
};

export function wedgeTailGuides(
  w: number,
  h: number,
  adj1: number,
  adj2: number,
): WedgeTailGuides {
  const l = 0;
  const t = 0;
  const r = w;
  const b = h;
  const hc = w / 2;
  const vc = h / 2;

  const dxPos = (w * adj1) / 100000;
  const dyPos = (h * adj2) / 100000;
  const xPos = hc + dxPos;
  const yPos = vc + dyPos;
  const dq = (dxPos * h) / w;
  const dz = Math.abs(dyPos) - Math.abs(dq);

  const x1 = (w * ifPos(dxPos, 7, 2)) / 12;
  const x2 = (w * ifPos(dxPos, 10, 5)) / 12;
  const y1 = (h * ifPos(dyPos, 7, 2)) / 12;
  const y2 = (h * ifPos(dyPos, 10, 5)) / 12;

  return {
    xPos,
    yPos,
    x1,
    x2,
    y1,
    y2,
    xt: ifPos(dz, ifPos(dyPos, x1, xPos), x1),
    yt: ifPos(dz, ifPos(dyPos, t, yPos), t),
    xr: ifPos(dz, r, ifPos(dxPos, xPos, r)),
    yr: ifPos(dz, y1, ifPos(dxPos, yPos, y1)),
    xb: ifPos(dz, ifPos(dyPos, xPos, x1), x1),
    yb: ifPos(dz, ifPos(dyPos, yPos, b), b),
    xl: ifPos(dz, l, ifPos(dxPos, l, xPos)),
    yl: ifPos(dz, y1, ifPos(dxPos, y1, yPos)),
  };
}
