// packages/slides/src/view/canvas/shapes/stars/irregular-seal-2.ts
import type { PathBuilder } from '../builder';

/**
 * `irregularSeal2` — "Explosion 2" starburst. OOXML defines it as a
 * fixed 28-vertex polygon in a 21600 × 21600 path box with no
 * adjustments. Vertices transcribed verbatim from the ECMA-376 preset
 * geometry, scaled to the element frame.
 */
const SEAL_UNIT = 21600;
const SEAL_2_POINTS: ReadonlyArray<readonly [number, number]> = [
  [11462, 4342],
  [14790, 0],
  [14525, 5777],
  [18007, 3172],
  [16380, 6532],
  [21600, 6645],
  [16985, 9402],
  [18270, 11290],
  [16380, 12310],
  [18877, 15632],
  [14640, 14350],
  [14942, 17370],
  [12180, 15935],
  [11612, 18842],
  [9872, 17370],
  [8700, 19712],
  [7527, 18125],
  [4917, 21600],
  [4805, 18240],
  [1285, 17825],
  [3330, 15370],
  [0, 12877],
  [3935, 11592],
  [1172, 8270],
  [5372, 7817],
  [4502, 3625],
  [8550, 6382],
  [9722, 1887],
];

export const buildIrregularSeal2: PathBuilder = ({ w, h }) => {
  const sx = w / SEAL_UNIT;
  const sy = h / SEAL_UNIT;
  const path = new Path2D();
  SEAL_2_POINTS.forEach(([x, y], i) => {
    const px = x * sx;
    const py = y * sy;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  });
  path.closePath();
  return path;
};
