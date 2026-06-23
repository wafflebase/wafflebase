import type { PathBuilder } from '../builder';

/**
 * `flowChartMagneticTape` — a circle with a squared-off foot in the
 * bottom-right quadrant, the classic "sequential access storage"
 * symbol.
 *
 * Per the ECMA-376 `flowChartMagneticTape` preset, the outline starts
 * at the bottom of the circle (`hc, b`), sweeps the ellipse for 360° −
 * `ang1` (three 90° arcs plus a final arc, `ang1 = atan2(h, w)` — 45°
 * for a square frame) up to the foot point on the circle (`ir, ib`),
 * then squares off the remaining bottom-right wedge with line segments
 * to `(r, ib)` and `(r, b)` before closing back to the bottom. The
 * omitted `ang1`→90° wedge is replaced by the right-angle foot reaching
 * the bottom-right corner.
 *
 * The elliptical arc is emitted as a polyline so the sweep is honoured
 * for non-square frames (and in environments whose `Path2D.ellipse`
 * ignores the start/end angles).
 */
export const buildFlowChartMagneticTape: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  // OOXML `ang1 = atan2(h, w)`: the angle (from +x axis, y-down) of the
  // foot point on the ellipse. For a square frame this is 45°.
  const ang1 = Math.atan2(h, w);
  // ib = vc + (h/2)·sin(ang1): the y of the foot point and the squared edge.
  const ib = cy + ry * Math.sin(ang1);

  // Sweep from the bottom (90°) through 180°, 270°, 360° to the foot
  // angle (360° + ang1), omitting the ang1→90° bottom-right wedge.
  const start = Math.PI / 2;
  const end = 2 * Math.PI + ang1;
  const segments = 96;
  path.moveTo(cx + rx * Math.cos(start), cy + ry * Math.sin(start));
  for (let i = 1; i <= segments; i++) {
    const a = start + ((end - start) * i) / segments;
    path.lineTo(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  // Square off the foot: out to the right edge at the foot height, down
  // to the bottom-right corner, then close back to the bottom point.
  path.lineTo(w, ib);
  path.lineTo(w, h);
  path.closePath();
  return path;
};
