import type { PathBuilder } from '../builder';

/**
 * `cloud` — five overlapping circles approximating a cloud
 * silhouette. No adjustments. Each lobe is a full-circle `arc()`; the
 * union of overlapping circles covers a cloud-shaped region.
 */
export const buildCloud: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  const cx = w / 2;
  const cy = h / 2;
  const lobe = Math.min(w, h) * 0.28;
  const lobes: Array<[number, number, number]> = [
    [cx - w * 0.30, cy - h * 0.10, lobe],
    [cx,            cy - h * 0.30, lobe * 1.1],
    [cx + w * 0.30, cy - h * 0.10, lobe],
    [cx + w * 0.20, cy + h * 0.25, lobe * 0.95],
    [cx - w * 0.20, cy + h * 0.25, lobe * 0.95],
  ];
  lobes.forEach(([x, y, r], i) => {
    if (i === 0) path.moveTo(x + r, y);
    path.arc(x, y, r, 0, Math.PI * 2);
  });
  path.closePath();
  return path;
};
