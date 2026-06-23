import type { PathBuilder } from '../builder';

/**
 * `flowChartTerminator` — stadium with half-ELLIPSE caps, not a pill.
 * Per ECMA-376 the cap horizontal radius is `wR = 3475/21600 * w`
 * (≈ 0.1609 w) and the vertical radius is `hR = h/2`. On a square
 * box this reads as a rounded rect, but on a wide box the curved
 * ends only reach ~0.16 w in from each side (they are squashed
 * ellipses, never semicircles).
 */
const CAP_RATIO = 3475 / 21600;

export const buildFlowChartTerminator: PathBuilder = ({ w, h }) => {
  const rx = w * CAP_RATIO;
  const ry = h / 2;
  const cy = h / 2;
  const leftCx = rx;
  const rightCx = w - rx;
  const segments = 32;
  const path = new Path2D();

  // Top straight edge, left cap centre to right cap centre.
  path.moveTo(leftCx, 0);
  path.lineTo(rightCx, 0);

  // Right cap: top (-90°) sweeping clockwise to bottom (+90°).
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const angle = -Math.PI / 2 + t * Math.PI;
    path.lineTo(rightCx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
  }

  // Bottom straight edge.
  path.lineTo(leftCx, h);

  // Left cap: bottom (+90°) sweeping clockwise to top (+270°).
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const angle = Math.PI / 2 + t * Math.PI;
    path.lineTo(leftCx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
  }

  path.closePath();
  return path;
};
