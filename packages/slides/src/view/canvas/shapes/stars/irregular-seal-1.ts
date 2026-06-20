// packages/slides/src/view/canvas/shapes/stars/irregular-seal-1.ts
import type { PathBuilder } from '../builder';

/**
 * `irregularSeal1` — "Explosion 1" starburst. OOXML defines it as a
 * fixed 24-vertex polygon in a 21600 × 21600 path box with no
 * adjustments (`<a:avLst/>` empty). We scale each vertex to the
 * element frame. Vertices are transcribed verbatim from the ECMA-376
 * preset geometry so PPTX round-trips pixel-for-pixel.
 */
const SEAL_UNIT = 21600;
const SEAL_1_POINTS: ReadonlyArray<readonly [number, number]> = [
  [10800, 5800],
  [14522, 0],
  [14155, 5325],
  [18380, 4457],
  [16702, 7315],
  [21097, 8137],
  [17607, 10475],
  [21600, 13290],
  [16837, 12942],
  [18145, 18095],
  [14020, 14457],
  [13247, 19737],
  [10532, 14935],
  [8485, 21600],
  [7715, 15627],
  [4762, 17617],
  [5667, 13937],
  [135, 14587],
  [3722, 11775],
  [0, 8615],
  [4627, 7617],
  [370, 2295],
  [7312, 6320],
  [8352, 2295],
];

export const buildIrregularSeal1: PathBuilder = ({ w, h }) => {
  const sx = w / SEAL_UNIT;
  const sy = h / SEAL_UNIT;
  const path = new Path2D();
  SEAL_1_POINTS.forEach(([x, y], i) => {
    const px = x * sx;
    const py = y * sy;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  });
  path.closePath();
  return path;
};
