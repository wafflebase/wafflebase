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
 * `borderCallout1` — full-frame text box plus a single-segment leader
 * line to a target point. Faithful port of the ECMA-376 preset:
 *
 *   path 1 (filled): rectangle l,t → r,t → r,b → l,b → close
 *   path 2 (fill=none): (x1,y1) → (x2,y2)
 *
 * Adjustments are the OOXML `(y, x)` pairs (thousandths of frame h/w):
 *   [0] adj1 y1  Default 18750     [1] adj2 x1  Default -8333
 *   [2] adj3 y2  Default 112500    [3] adj4 x2  Default -38333
 */
export const BORDER_CALLOUT_1_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Point 1 y', defaultValue: 18750, ...Y_BOUND, axisLabel: 'y' },
  { name: 'Point 1 x', defaultValue: -8333, ...X_BOUND, axisLabel: 'x' },
  { name: 'Target y', defaultValue: 112500, ...Y_BOUND, axisLabel: 'y' },
  { name: 'Target x', defaultValue: -38333, ...X_BOUND, axisLabel: 'x' },
];

const DEFAULTS = BORDER_CALLOUT_1_ADJUSTMENTS.map((a) => a.defaultValue);

export const buildBorderCallout1: PathBuilder = buildBorderCalloutBox;

export const buildBorderCallout1Leader: PathBuilder = ({ w, h }, adjustments) =>
  buildBorderLeader(w, h, adjustments, DEFAULTS);

export const BORDER_CALLOUT_1_HANDLES: readonly AdjustmentHandle[] = [
  leaderPointHandle(
    0,
    1,
    BORDER_CALLOUT_1_ADJUSTMENTS[0],
    BORDER_CALLOUT_1_ADJUSTMENTS[1],
  ),
  leaderPointHandle(
    2,
    3,
    BORDER_CALLOUT_1_ADJUSTMENTS[2],
    BORDER_CALLOUT_1_ADJUSTMENTS[3],
  ),
];
