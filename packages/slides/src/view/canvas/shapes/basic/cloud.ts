import type { PathBuilder } from '../builder';

/**
 * `cloud` — faithful port of the OOXML `cloud` preset silhouette so the
 * shape matches PowerPoint / Google Slides exactly (the prior version was
 * a 6-lobe heuristic that read noticeably differently).
 *
 * The preset outline lives in a 43200×43200 design box as a `moveTo`
 * followed by 11 elliptical `arcTo` bumps and a `close`. Each arc is part
 * of an ellipse with radii `(wR, hR)`; the current point sits on that
 * ellipse at `stAng`, the arc sweeps `swAng`, and angles are expressed in
 * 60000ths of a degree. Values are copied verbatim from the ECMA-376
 * `presetShapeDefinitions.xml` `cloud` definition.
 *
 * We render with `Path2D.ellipse`, scaling centre and radii per axis
 * (`sx = w/43200`, `sy = h/43200`) so non-square frames stretch the cloud
 * the same way PowerPoint does. Mapping the design coordinates straight to
 * the frame (rather than re-centring) keeps the small left inset / bottom
 * overhang that the preset itself carries, matching PowerPoint pixel-for-pixel.
 */

/** Design-box edge length for the OOXML `cloud` preset path. */
const DESIGN = 43200;

/** `[wR, hR, stAng, swAng]` per arc, in design units / 60000ths of a degree. */
const ARCS: ReadonlyArray<readonly [number, number, number, number]> = [
  [6753, 9190, -11429249, 7426832],
  [5333, 7267, -8646143, 5396714],
  [4365, 5945, -8748475, 5983381],
  [4857, 6595, -7859164, 7034504],
  [5333, 7273, -4722533, 6541615],
  [6775, 9220, -2776035, 7816140],
  [5785, 7867, 37501, 6842000],
  [6752, 9215, 1347096, 6910353],
  [7720, 10543, 3974558, 4542661],
  [4360, 5918, -16496525, 8804134],
  [4345, 5945, -14809710, 9151131],
];

/** Outline start point, in design units. */
const START_X = 3900;
const START_Y = 14370;

/** 60000ths-of-a-degree → radians. */
const toRad = (a: number): number => (a / 60000) * (Math.PI / 180);

export const buildCloud: PathBuilder = ({ w, h }) => {
  const sx = w / DESIGN;
  const sy = h / DESIGN;
  const path = new Path2D();

  // Track the current point in design coordinates; each arc starts where
  // the previous one ended.
  let curX = START_X;
  let curY = START_Y;
  path.moveTo(curX * sx, curY * sy);

  for (const [wR, hR, stAng, swAng] of ARCS) {
    const start = toRad(stAng);
    const end = toRad(stAng + swAng);
    // The current point lies on the ellipse at `start`, so the centre is
    // the current point minus that radial offset.
    const ecx = curX - wR * Math.cos(start);
    const ecy = curY - hR * Math.sin(start);
    path.ellipse(ecx * sx, ecy * sy, wR * sx, hR * sy, 0, start, end, swAng < 0);
    curX = ecx + wR * Math.cos(end);
    curY = ecy + hR * Math.sin(end);
  }

  path.closePath();
  return path;
};
