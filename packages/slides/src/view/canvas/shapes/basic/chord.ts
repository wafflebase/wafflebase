import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { chordPath } from './sector';
import { angularHandle } from '../handles';

/**
 * `chord` — circular segment cut off by a straight chord from
 * `adj1` to `adj2`. Same angle storage as `pie`.
 */
export const CHORD_ADJUSTMENTS: readonly AdjustmentSpec[] = [
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

export const buildChord: PathBuilder = (size, adjustments) => {
  const start = adj(adjustments, 0, CHORD_ADJUSTMENTS[0].defaultValue);
  const end = adj(adjustments, 1, CHORD_ADJUSTMENTS[1].defaultValue);
  return chordPath(size, start, end);
};

export const CHORD_HANDLES: readonly AdjustmentHandle[] = [
  angularHandle({
    center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
    radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
    index: 0,
    spec: CHORD_ADJUSTMENTS[0],
  }),
  angularHandle({
    center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
    radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
    index: 1,
    spec: CHORD_ADJUSTMENTS[1],
  }),
];
