import type { PathBuilder } from '../builder';

/**
 * `flowChartSummingJunction` — ellipse inscribed in the frame plus
 * a diagonal X spanning the inscribed-square diagonal endpoints.
 * Uses a 64-segment parametric polyline for the ellipse to avoid
 * the test-canvas shim's `Path2D.ellipse` (per P1 lessons).
 */
export const buildFlowChartSummingJunction: PathBuilder = ({ w, h }) => {
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
  const dx = rx * Math.SQRT1_2;
  const dy = ry * Math.SQRT1_2;
  path.moveTo(cx - dx, cy - dy);
  path.lineTo(cx + dx, cy + dy);
  path.moveTo(cx - dx, cy + dy);
  path.lineTo(cx + dx, cy - dy);
  return path;
};
