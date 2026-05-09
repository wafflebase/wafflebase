import type { PathBuilder } from '../builder';

/**
 * `flowChartOffpageConnector` — rect with the bottom edge replaced
 * by a downward V meeting at the bottom-centre. Cut depth = 20% of
 * frame height, matching the preset look-alike.
 */
export const buildFlowChartOffpageConnector: PathBuilder = ({ w, h }) => {
  const flatBottom = h * 0.8;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, flatBottom);
  path.lineTo(w / 2, h);
  path.lineTo(0, flatBottom);
  path.closePath();
  return path;
};
