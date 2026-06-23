import type { PathBuilder } from '../builder';

/**
 * `lightningBolt` — non-parametric jagged Z-shape. The OOXML preset is
 * an 11-vertex polygon traced in a 21600×21600 coordinate space, with a
 * single pointed apex at the top and a single point at the bottom-right.
 * Vertices are expressed as fractions of that space and scaled by w/h.
 */
const OOXML_W = 21600;
const OOXML_H = 21600;

// OOXML lightningBolt pathLst vertices (moveTo + 10 lnTo, then close).
const VERTS: ReadonlyArray<readonly [number, number]> = [
  [8472, 0], // pointed apex at top
  [12860, 6080],
  [11050, 6797],
  [16577, 12007],
  [14767, 12877],
  [21600, 21600], // point at bottom-right
  [10012, 14915],
  [12222, 13987],
  [5022, 9705],
  [7602, 8382],
  [0, 3890],
];

export const buildLightningBolt: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  const sx = w / OOXML_W;
  const sy = h / OOXML_H;
  path.moveTo(VERTS[0][0] * sx, VERTS[0][1] * sy);
  for (let i = 1; i < VERTS.length; i++) {
    path.lineTo(VERTS[i][0] * sx, VERTS[i][1] * sy);
  }
  path.closePath();
  return path;
};
