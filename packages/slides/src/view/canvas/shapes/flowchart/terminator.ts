import type { PathBuilder } from '../builder';

/**
 * `flowChartTerminator` — pill shape (rounded rectangle with corner
 * radius = `min(w, h) / 2`, i.e. fully rounded ends). Identical to
 * `roundRect` at maximum corner radius; kept as a distinct kind so
 * the OOXML preset round-trips.
 */
export const buildFlowChartTerminator: PathBuilder = ({ w, h }) => {
  const r = Math.min(w, h) / 2;
  const path = new Path2D();
  path.moveTo(r, 0);
  path.lineTo(w - r, 0);
  path.quadraticCurveTo(w, 0, w, r);
  path.lineTo(w, h - r);
  path.quadraticCurveTo(w, h, w - r, h);
  path.lineTo(r, h);
  path.quadraticCurveTo(0, h, 0, h - r);
  path.lineTo(0, r);
  path.quadraticCurveTo(0, 0, r, 0);
  path.closePath();
  return path;
};
