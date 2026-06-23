import type { PathBuilder } from '../builder';

/**
 * `flowChartDelay` — rectangle on the left joined to a right-side
 * semi-ellipse forming a "D". Per ECMA-376 the cap is centred at
 * `hc = w/2` with horizontal radius `wd2 = w/2` and vertical radius
 * `hd2 = h/2`, so the curved right half is exactly a semi-ellipse
 * (the flat top/bottom run from the left edge to mid-width).
 */
export const buildFlowChartDelay: PathBuilder = ({ w, h }) => {
  const rx = w / 2;
  const ry = h / 2;
  const flatX = w - rx;
  const cy = h / 2;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(flatX, 0);
  const segments = 32;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const angle = -Math.PI / 2 + t * Math.PI;
    const x = flatX + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    path.lineTo(x, y);
  }
  path.lineTo(0, h);
  path.closePath();
  return path;
};
