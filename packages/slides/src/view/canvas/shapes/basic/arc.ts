import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { arcPath } from './sector';
import { angularHandle } from '../handles';

/**
 * `arc` — open elliptical arc from `adj1` to `adj2`. Rendered
 * stroke-only — `insert.ts` defaults `fill` to undefined and only
 * `stroke` is set. Same angle storage as `pie`/`chord`.
 */
export const ARC_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Start angle',
    defaultValue: 16200000,
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

export const buildArc: PathBuilder = (size, adjustments) => {
  const start = adj(adjustments, 0, ARC_ADJUSTMENTS[0].defaultValue);
  const end = adj(adjustments, 1, ARC_ADJUSTMENTS[1].defaultValue);
  return arcPath(size, start, end);
};

export const ARC_HANDLES: readonly AdjustmentHandle[] = [
  angularHandle({
    center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
    radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
    index: 0,
    spec: ARC_ADJUSTMENTS[0],
  }),
  angularHandle({
    center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
    radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
    index: 1,
    spec: ARC_ADJUSTMENTS[1],
  }),
];
