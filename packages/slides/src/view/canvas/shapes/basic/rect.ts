import type { PathBuilder } from '../builder';

/**
 * `rect` — axis-aligned rectangle covering the full element frame.
 * No adjustments. Establishes the per-shape file pattern that the
 * remaining 30+ ShapeKinds follow: a single named `PathBuilder`
 * export, registered once in `shapes/index.ts`.
 */
export const buildRect: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.rect(0, 0, w, h);
  return path;
};
