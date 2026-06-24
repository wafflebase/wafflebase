import type { PathBuilder } from '../builder';

/**
 * Append a single document silhouette as a closed subpath. Used by
 * `buildFlowChartDocument` and re-used by `flowChartMultidocument`
 * for stacked silhouettes.
 *
 * The bottom edge follows the ECMA-376 `flowChartDocument` preset: a
 * single asymmetric cubic Bézier (not a symmetric sine). It starts at
 * the right edge at `17322/21600·h`, dips below the baseline (deep
 * control point `23922/21600·h` is the *second* control point, nearer
 * the left end) and lands at the left edge at `20172/21600·h`, so the
 * deepest dip sits left of centre.
 */
export function appendDocumentSubpath(
  path: Path2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // OOXML guide values, scaled from the 21600 design space.
  const y1 = (17322 / 21600) * h; // right-edge start of the bottom curve
  const y2 = (20172 / 21600) * h; // left-edge end of the bottom curve
  const yc = (23922 / 21600) * h; // lower control-point depth (below h)
  const xc = (10800 / 21600) * w; // horizontal control-point (mid-width)
  path.moveTo(x, y);
  path.lineTo(x + w, y);
  path.lineTo(x + w, y + y1);
  // Asymmetric S-curve: cp1 at (mid, y1), cp2 at (mid, yc), end at (left, y2).
  path.bezierCurveTo(
    x + xc,
    y + y1,
    x + xc,
    y + yc,
    x,
    y + y2,
  );
  path.closePath();
}

/**
 * `flowChartDocument` — rectangle whose bottom edge is replaced by the
 * OOXML asymmetric document curve.
 */
export const buildFlowChartDocument: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  appendDocumentSubpath(path, 0, 0, w, h);
  return path;
};
