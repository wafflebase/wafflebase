import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { pieSectorPath } from './sector';
import { angularHandle } from '../handles';

/**
 * `pie` — closed pie slice from `adj1` to `adj2`, swept clockwise
 * with wrap. Storage in OOXML 60000ths of a degree.
 * Default: 270° → 0° (a NE-quadrant 1/4 slice).
 */
export const PIE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Start angle',
    defaultValue: 16200000, // 270°
    min: 0,
    max: 21600000,
    axisLabel: 'start',
  },
  {
    name: 'End angle',
    defaultValue: 0,
    min: 0,
    max: 21600000,
    axisLabel: 'end',
  },
];

export const buildPie: PathBuilder = (size, adjustments) => {
  const start = adj(adjustments, 0, PIE_ADJUSTMENTS[0].defaultValue);
  const end = adj(adjustments, 1, PIE_ADJUSTMENTS[1].defaultValue);
  return pieSectorPath(size, start, end);
};

export const PIE_HANDLES: readonly AdjustmentHandle[] = [
  angularHandle({
    center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
    radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
    index: 0,
    spec: PIE_ADJUSTMENTS[0],
  }),
  angularHandle({
    center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
    radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
    index: 1,
    spec: PIE_ADJUSTMENTS[1],
  }),
];
