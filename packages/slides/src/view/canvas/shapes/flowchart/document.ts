import type { PathBuilder } from '../builder';
import { appendSineWave } from './wave';

/**
 * Append a single document silhouette as a closed subpath. Used by
 * `buildFlowChartDocument` and re-used by `flowChartMultidocument`
 * for stacked silhouettes.
 *
 * Wave centreline is at `y + h - amp`, amplitude
 * `amp = min(h/8, w/16)` to stay visually proportionate at extreme
 * aspect ratios.
 */
export function appendDocumentSubpath(
  path: Path2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const amp = Math.min(h / 8, w / 16);
  const baseY = y + h - amp;
  path.moveTo(x, y);
  path.lineTo(x + w, y);
  path.lineTo(x + w, baseY);
  appendSineWave(path, x + w, x, baseY, amp);
  path.lineTo(x, y);
  path.closePath();
}

/**
 * `flowChartDocument` — rectangle whose bottom edge is replaced by a
 * one-period sine wave.
 */
export const buildFlowChartDocument: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  appendDocumentSubpath(path, 0, 0, w, h);
  return path;
};
