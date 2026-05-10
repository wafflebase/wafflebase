import type { PathBuilder } from '../builder';

/**
 * `flowChartDisplay` — flat top and bottom edges with a small
 * leftward-pointing wedge on the left and a right-side rounded
 * cap. Approximates the OOXML `flowChartDisplay` preset; the
 * Phase 4 formula evaluator is expected to override this builder.
 */
export const buildFlowChartDisplay: PathBuilder = ({ w, h }) => {
  const leftX = w / 6;
  const rightX = (5 * w) / 6;
  const capRx = w - rightX;
  const capRy = h / 2;
  const cy = h / 2;
  const path = new Path2D();
  path.moveTo(0, cy);
  path.lineTo(leftX, 0);
  path.lineTo(rightX, 0);
  const segments = 32;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const angle = -Math.PI / 2 + t * Math.PI;
    const x = rightX + capRx * Math.cos(angle);
    const y = cy + capRy * Math.sin(angle);
    path.lineTo(x, y);
  }
  path.lineTo(leftX, h);
  path.closePath();
  return path;
};
