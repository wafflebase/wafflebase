import type { PathBuilder } from '../builder';

/**
 * `flowChartDelay` — rectangle on the left joined to a right-side
 * semi-ellipse forming a "D". Semi-ellipse radius
 * `rx = min(h/2, w)`, vertical radius `h/2`. When the frame is
 * narrower than its height, the curve consumes the full width
 * gracefully.
 */
export const buildFlowChartDelay: PathBuilder = ({ w, h }) => {
  const rx = Math.min(h / 2, w);
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
