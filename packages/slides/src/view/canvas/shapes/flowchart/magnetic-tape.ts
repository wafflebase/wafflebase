import type { PathBuilder } from '../builder';

/**
 * `flowChartMagneticTape` — a circle with a small tail (foot) at the
 * bottom-right, the classic "sequential access storage" symbol. The
 * full OOXML preset trims a small wedge of the circle and squares it
 * off into the corner; we approximate with a full disk plus a small
 * triangular foot reaching the bottom-right corner, which reads the
 * same at slide scale.
 */
export const buildFlowChartMagneticTape: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  // Foot: from the bottom of the disk out to the bottom-right corner.
  path.moveTo(w / 2, h);
  path.lineTo(w, h);
  path.lineTo(w, h * 0.8);
  path.closePath();
  return path;
};
