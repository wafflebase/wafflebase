import type { PathBuilder } from '../builder';

/**
 * `ellipse` — full ellipse inscribed in the element frame. No
 * adjustments. Centre is (w/2, h/2), radii are (w/2, h/2).
 */
export const buildEllipse: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  return path;
};
