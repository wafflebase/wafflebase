import type { PathBuilder } from '../builder';

/**
 * `flowChartOr` — ellipse inscribed in the frame plus a horizontal
 * and vertical bar through the centre.
 */
export const buildFlowChartOr: PathBuilder = ({ w, h }) => {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const path = new Path2D();
  const segments = 64;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  path.moveTo(0, cy);
  path.lineTo(w, cy);
  path.moveTo(cx, 0);
  path.lineTo(cx, h);
  return path;
};
