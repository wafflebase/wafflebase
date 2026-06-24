import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import {
  buildBorderCalloutBox,
  buildBorderLeader,
  leaderPointHandle,
  X_BOUND,
  Y_BOUND,
} from './border-common';

/**
 * `borderCallout3` — full-frame text box plus a three-segment leader
 * (two mid-bends). Faithful port of the ECMA-376 preset:
 *
 *   path 1 (filled): rectangle l,t → r,t → r,b → l,b → close
 *   path 2 (fill=none): (x1,y1) → (x2,y2) → (x3,y3) → (x4,y4)
 *
 * Adjustments are the OOXML `(y, x)` pairs (thousandths of frame h/w):
 *   [0] y1 18750   [1] x1 -8333
 *   [2] y2 18750   [3] x2 -16667
 *   [4] y3 100000  [5] x3 -16667
 *   [6] y4 112963  [7] x4 -8333
 */
export const BORDER_CALLOUT_3_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Point 1 y', defaultValue: 18750, ...Y_BOUND, axisLabel: 'y' },
  { name: 'Point 1 x', defaultValue: -8333, ...X_BOUND, axisLabel: 'x' },
  { name: 'Bend 1 y', defaultValue: 18750, ...Y_BOUND, axisLabel: 'y' },
  { name: 'Bend 1 x', defaultValue: -16667, ...X_BOUND, axisLabel: 'x' },
  { name: 'Bend 2 y', defaultValue: 100000, ...Y_BOUND, axisLabel: 'y' },
  { name: 'Bend 2 x', defaultValue: -16667, ...X_BOUND, axisLabel: 'x' },
  { name: 'Target y', defaultValue: 112963, ...Y_BOUND, axisLabel: 'y' },
  { name: 'Target x', defaultValue: -8333, ...X_BOUND, axisLabel: 'x' },
];

const DEFAULTS = BORDER_CALLOUT_3_ADJUSTMENTS.map((a) => a.defaultValue);

export const buildBorderCallout3: PathBuilder = buildBorderCalloutBox;

export const buildBorderCallout3Leader: PathBuilder = ({ w, h }, adjustments) =>
  buildBorderLeader(w, h, adjustments, DEFAULTS);

export const BORDER_CALLOUT_3_HANDLES: readonly AdjustmentHandle[] = [
  leaderPointHandle(0, 1, BORDER_CALLOUT_3_ADJUSTMENTS[0], BORDER_CALLOUT_3_ADJUSTMENTS[1]),
  leaderPointHandle(2, 3, BORDER_CALLOUT_3_ADJUSTMENTS[2], BORDER_CALLOUT_3_ADJUSTMENTS[3]),
  leaderPointHandle(4, 5, BORDER_CALLOUT_3_ADJUSTMENTS[4], BORDER_CALLOUT_3_ADJUSTMENTS[5]),
  leaderPointHandle(6, 7, BORDER_CALLOUT_3_ADJUSTMENTS[6], BORDER_CALLOUT_3_ADJUSTMENTS[7]),
];
