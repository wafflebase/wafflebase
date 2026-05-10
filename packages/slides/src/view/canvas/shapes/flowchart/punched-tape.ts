import type { PathBuilder } from '../builder';
import { appendSineWave } from './wave';

/**
 * `flowChartPunchedTape` — rectangle with both top and bottom
 * edges replaced by one-period sine waves. Top wave centred at
 * `y = amp`, bottom at `y = h - amp`, amplitude `min(h/8, w/16)`.
 * Top travels left-to-right with `+amp`; bottom travels
 * right-to-left with `-amp` so the visible curl matches GS.
 */
export const buildFlowChartPunchedTape: PathBuilder = ({ w, h }) => {
  const amp = Math.min(h / 8, w / 16);
  const topY = amp;
  const botY = h - amp;
  const path = new Path2D();
  path.moveTo(0, topY);
  appendSineWave(path, 0, w, topY, amp);
  path.lineTo(w, botY);
  appendSineWave(path, w, 0, botY, -amp);
  path.closePath();
  return path;
};
