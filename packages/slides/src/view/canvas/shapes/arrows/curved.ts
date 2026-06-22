// packages/slides/src/view/canvas/shapes/arrows/curved.ts
//
// The four directional curved arrows (curvedRight/Left/Up/Down),
// ported verbatim from ECMA-376 `presetShapeDefinitions.xml`. Each is
// a quarter annular band with a flared triangular arrowhead at the
// head end (the OOXML `aw` arrow-width guide makes the head wider than
// the band thickness `th` — the detail the old hand-rolled "single
// point tip" approximation was missing).
//
// Each preset has three `<a:path>`s: the band body (norm fill), a
// `fill="darkenLess"` curl that PowerPoint shades for 3-D, and a
// `fill="none"` stroke outline. The body + curl together are the full
// silhouette, so the engine fills both (skipping only the self-
// intersecting `none` outline) — see `buildPresetPath`.

import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { presetBuilder, presetOutlineBuilder } from '../preset/path';
import { presetNumericHandle } from '../preset/handles';
import type { PresetShapeDef } from '../preset/types';

export type CurvedDirection = 'right' | 'left' | 'up' | 'down';

export const CURVED_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Thickness', defaultValue: 25000, min: 0, max: 100000 },
  { name: 'Head width', defaultValue: 50000, min: 0, max: 100000 },
  { name: 'Head length', defaultValue: 25000, min: 0, max: 100000 },
];

const CURVED_RIGHT_DEF: PresetShapeDef = {
  adj: { adj1: 25000, adj2: 50000, adj3: 25000 },
  guides: [
    { name: 'maxAdj2', fmla: '*/ 50000 h ss' },
    { name: 'a2', fmla: 'pin 0 adj2 maxAdj2' },
    { name: 'a1', fmla: 'pin 0 adj1 a2' },
    { name: 'th', fmla: '*/ ss a1 100000' },
    { name: 'aw', fmla: '*/ ss a2 100000' },
    { name: 'q1', fmla: '+/ th aw 4' },
    { name: 'hR', fmla: '+- hd2 0 q1' },
    { name: 'q7', fmla: '*/ hR 2 1' },
    { name: 'q8', fmla: '*/ q7 q7 1' },
    { name: 'q9', fmla: '*/ th th 1' },
    { name: 'q10', fmla: '+- q8 0 q9' },
    { name: 'q11', fmla: 'sqrt q10' },
    { name: 'idx', fmla: '*/ q11 w q7' },
    { name: 'maxAdj3', fmla: '*/ 100000 idx ss' },
    { name: 'a3', fmla: 'pin 0 adj3 maxAdj3' },
    { name: 'ah', fmla: '*/ ss a3 100000' },
    { name: 'y3', fmla: '+- hR th 0' },
    { name: 'q2', fmla: '*/ w w 1' },
    { name: 'q3', fmla: '*/ ah ah 1' },
    { name: 'q4', fmla: '+- q2 0 q3' },
    { name: 'q5', fmla: 'sqrt q4' },
    { name: 'dy', fmla: '*/ q5 hR w' },
    { name: 'y5', fmla: '+- hR dy 0' },
    { name: 'y7', fmla: '+- y3 dy 0' },
    { name: 'q6', fmla: '+- aw 0 th' },
    { name: 'dh', fmla: '*/ q6 1 2' },
    { name: 'y4', fmla: '+- y5 0 dh' },
    { name: 'y8', fmla: '+- y7 dh 0' },
    { name: 'aw2', fmla: '*/ aw 1 2' },
    { name: 'y6', fmla: '+- b 0 aw2' },
    { name: 'x1', fmla: '+- r 0 ah' },
    { name: 'swAng', fmla: 'at2 ah dy' },
    { name: 'stAng', fmla: '+- cd2 0 swAng' },
    { name: 'mswAng', fmla: '+- 0 0 swAng' },
    { name: 'q12', fmla: '*/ th 1 2' },
    { name: 'dang2', fmla: 'at2 idx q12' },
    { name: 'swAng2', fmla: '+- dang2 0 cd4' },
    { name: 'swAng3', fmla: '+- cd4 dang2 0' },
    { name: 'stAng3', fmla: '+- cd2 0 dang2' },
  ],
  // Union of the two filled OOXML paths: the band body + the
  // `darkenLess` curl (the upper portion PowerPoint shades for 3-D).
  // Together they are the full silhouette; we fill both in the shape
  // colour, connected at every aspect ratio.
  paths: [
    {
      cmds: [
        { t: 'move', pt: { x: 'l', y: 'hR' } },
        { t: 'arc', wR: 'w', hR: 'hR', stAng: 'cd2', swAng: 'mswAng' },
        { t: 'line', pt: { x: 'x1', y: 'y4' } },
        { t: 'line', pt: { x: 'r', y: 'y6' } },
        { t: 'line', pt: { x: 'x1', y: 'y8' } },
        { t: 'line', pt: { x: 'x1', y: 'y7' } },
        { t: 'arc', wR: 'w', hR: 'hR', stAng: 'stAng', swAng: 'swAng' },
        { t: 'close' },
      ],
    },
    {
      fill: 'darkenLess',
      cmds: [
        { t: 'move', pt: { x: 'r', y: 'th' } },
        { t: 'arc', wR: 'w', hR: 'hR', stAng: '3cd4', swAng: 'swAng2' },
        { t: 'arc', wR: 'w', hR: 'hR', stAng: 'stAng3', swAng: 'swAng3' },
        { t: 'close' },
      ],
    },
  ],
  // `fill="none"` perimeter — stroked instead of the filled union so
  // the body/curl seam is not drawn across the shape.
  outline: [
    { t: 'move', pt: { x: 'l', y: 'hR' } },
    { t: 'arc', wR: 'w', hR: 'hR', stAng: 'cd2', swAng: 'mswAng' },
    { t: 'line', pt: { x: 'x1', y: 'y4' } },
    { t: 'line', pt: { x: 'r', y: 'y6' } },
    { t: 'line', pt: { x: 'x1', y: 'y8' } },
    { t: 'line', pt: { x: 'x1', y: 'y7' } },
    { t: 'arc', wR: 'w', hR: 'hR', stAng: 'stAng', swAng: 'swAng' },
    { t: 'line', pt: { x: 'l', y: 'hR' } },
    { t: 'arc', wR: 'w', hR: 'hR', stAng: 'cd2', swAng: 'cd4' },
    { t: 'line', pt: { x: 'r', y: 'th' } },
    { t: 'arc', wR: 'w', hR: 'hR', stAng: '3cd4', swAng: 'swAng2' },
  ],
};

const CURVED_LEFT_DEF: PresetShapeDef = {
  adj: { adj1: 25000, adj2: 50000, adj3: 25000 },
  guides: [
    { name: 'maxAdj2', fmla: '*/ 50000 h ss' },
    { name: 'a2', fmla: 'pin 0 adj2 maxAdj2' },
    { name: 'a1', fmla: 'pin 0 adj1 a2' },
    { name: 'th', fmla: '*/ ss a1 100000' },
    { name: 'aw', fmla: '*/ ss a2 100000' },
    { name: 'q1', fmla: '+/ th aw 4' },
    { name: 'hR', fmla: '+- hd2 0 q1' },
    { name: 'q7', fmla: '*/ hR 2 1' },
    { name: 'q8', fmla: '*/ q7 q7 1' },
    { name: 'q9', fmla: '*/ th th 1' },
    { name: 'q10', fmla: '+- q8 0 q9' },
    { name: 'q11', fmla: 'sqrt q10' },
    { name: 'idx', fmla: '*/ q11 w q7' },
    { name: 'maxAdj3', fmla: '*/ 100000 idx ss' },
    { name: 'a3', fmla: 'pin 0 adj3 maxAdj3' },
    { name: 'ah', fmla: '*/ ss a3 100000' },
    { name: 'y3', fmla: '+- hR th 0' },
    { name: 'q2', fmla: '*/ w w 1' },
    { name: 'q3', fmla: '*/ ah ah 1' },
    { name: 'q4', fmla: '+- q2 0 q3' },
    { name: 'q5', fmla: 'sqrt q4' },
    { name: 'dy', fmla: '*/ q5 hR w' },
    { name: 'y5', fmla: '+- hR dy 0' },
    { name: 'y7', fmla: '+- y3 dy 0' },
    { name: 'q6', fmla: '+- aw 0 th' },
    { name: 'dh', fmla: '*/ q6 1 2' },
    { name: 'y4', fmla: '+- y5 0 dh' },
    { name: 'y8', fmla: '+- y7 dh 0' },
    { name: 'aw2', fmla: '*/ aw 1 2' },
    { name: 'y6', fmla: '+- b 0 aw2' },
    { name: 'x1', fmla: '+- l ah 0' },
    { name: 'swAng', fmla: 'at2 ah dy' },
    { name: 'mswAng', fmla: '+- 0 0 swAng' },
    { name: 'q12', fmla: '*/ th 1 2' },
    { name: 'dang2', fmla: 'at2 idx q12' },
    { name: 'swAng2', fmla: '+- dang2 0 swAng' },
    { name: 'swAng3', fmla: '+- swAng dang2 0' },
    { name: 'stAng3', fmla: '+- 0 0 dang2' },
  ],
  // Union of band body + `darkenLess` curl — full silhouette.
  paths: [
    {
      cmds: [
        { t: 'move', pt: { x: 'l', y: 'y6' } },
        { t: 'line', pt: { x: 'x1', y: 'y4' } },
        { t: 'line', pt: { x: 'x1', y: 'y5' } },
        { t: 'arc', wR: 'w', hR: 'hR', stAng: 'swAng', swAng: 'swAng2' },
        { t: 'arc', wR: 'w', hR: 'hR', stAng: 'stAng3', swAng: 'swAng3' },
        { t: 'line', pt: { x: 'x1', y: 'y8' } },
        { t: 'close' },
      ],
    },
    {
      fill: 'darkenLess',
      cmds: [
        { t: 'move', pt: { x: 'r', y: 'y3' } },
        { t: 'arc', wR: 'w', hR: 'hR', stAng: '0', swAng: '-5400000' },
        { t: 'line', pt: { x: 'l', y: 't' } },
        { t: 'arc', wR: 'w', hR: 'hR', stAng: '3cd4', swAng: 'cd4' },
        { t: 'close' },
      ],
    },
  ],
  // `fill="none"` perimeter — stroked instead of the filled union.
  outline: [
    { t: 'move', pt: { x: 'r', y: 'y3' } },
    { t: 'arc', wR: 'w', hR: 'hR', stAng: '0', swAng: '-5400000' },
    { t: 'line', pt: { x: 'l', y: 't' } },
    { t: 'arc', wR: 'w', hR: 'hR', stAng: '3cd4', swAng: 'cd4' },
    { t: 'line', pt: { x: 'r', y: 'y3' } },
    { t: 'arc', wR: 'w', hR: 'hR', stAng: '0', swAng: 'swAng' },
    { t: 'line', pt: { x: 'x1', y: 'y8' } },
    { t: 'line', pt: { x: 'l', y: 'y6' } },
    { t: 'line', pt: { x: 'x1', y: 'y4' } },
    { t: 'line', pt: { x: 'x1', y: 'y5' } },
    { t: 'arc', wR: 'w', hR: 'hR', stAng: 'swAng', swAng: 'swAng2' },
  ],
};

const CURVED_UP_DEF: PresetShapeDef = {
  adj: { adj1: 25000, adj2: 50000, adj3: 25000 },
  guides: [
    { name: 'maxAdj2', fmla: '*/ 50000 w ss' },
    { name: 'a2', fmla: 'pin 0 adj2 maxAdj2' },
    { name: 'a1', fmla: 'pin 0 adj1 100000' },
    { name: 'th', fmla: '*/ ss a1 100000' },
    { name: 'aw', fmla: '*/ ss a2 100000' },
    { name: 'q1', fmla: '+/ th aw 4' },
    { name: 'wR', fmla: '+- wd2 0 q1' },
    { name: 'q7', fmla: '*/ wR 2 1' },
    { name: 'q8', fmla: '*/ q7 q7 1' },
    { name: 'q9', fmla: '*/ th th 1' },
    { name: 'q10', fmla: '+- q8 0 q9' },
    { name: 'q11', fmla: 'sqrt q10' },
    { name: 'idy', fmla: '*/ q11 h q7' },
    { name: 'maxAdj3', fmla: '*/ 100000 idy ss' },
    { name: 'a3', fmla: 'pin 0 adj3 maxAdj3' },
    { name: 'ah', fmla: '*/ ss a3 100000' },
    { name: 'x3', fmla: '+- wR th 0' },
    { name: 'q2', fmla: '*/ h h 1' },
    { name: 'q3', fmla: '*/ ah ah 1' },
    { name: 'q4', fmla: '+- q2 0 q3' },
    { name: 'q5', fmla: 'sqrt q4' },
    { name: 'dx', fmla: '*/ q5 wR h' },
    { name: 'x5', fmla: '+- wR dx 0' },
    { name: 'x7', fmla: '+- x3 dx 0' },
    { name: 'q6', fmla: '+- aw 0 th' },
    { name: 'dh', fmla: '*/ q6 1 2' },
    { name: 'x4', fmla: '+- x5 0 dh' },
    { name: 'x8', fmla: '+- x7 dh 0' },
    { name: 'aw2', fmla: '*/ aw 1 2' },
    { name: 'x6', fmla: '+- r 0 aw2' },
    { name: 'y1', fmla: '+- t ah 0' },
    { name: 'swAng', fmla: 'at2 ah dx' },
    { name: 'mswAng', fmla: '+- 0 0 swAng' },
    { name: 'iy', fmla: '+- t idy 0' },
    { name: 'ix', fmla: '+/ wR x3 2' },
    { name: 'q12', fmla: '*/ th 1 2' },
    { name: 'dang2', fmla: 'at2 idy q12' },
    { name: 'swAng2', fmla: '+- dang2 0 swAng' },
    { name: 'mswAng2', fmla: '+- 0 0 swAng2' },
    { name: 'stAng3', fmla: '+- cd4 0 swAng' },
    { name: 'swAng3', fmla: '+- swAng dang2 0' },
    { name: 'stAng2', fmla: '+- cd4 0 dang2' },
  ],
  // Union of band body + `darkenLess` curl — full silhouette.
  paths: [
    {
      cmds: [
        { t: 'move', pt: { x: 'x6', y: 't' } },
        { t: 'line', pt: { x: 'x8', y: 'y1' } },
        { t: 'line', pt: { x: 'x7', y: 'y1' } },
        { t: 'arc', wR: 'wR', hR: 'h', stAng: 'stAng3', swAng: 'swAng3' },
        { t: 'arc', wR: 'wR', hR: 'h', stAng: 'stAng2', swAng: 'swAng2' },
        { t: 'line', pt: { x: 'x4', y: 'y1' } },
        { t: 'close' },
      ],
    },
    {
      fill: 'darkenLess',
      cmds: [
        { t: 'move', pt: { x: 'wR', y: 'b' } },
        { t: 'arc', wR: 'wR', hR: 'h', stAng: 'cd4', swAng: 'cd4' },
        { t: 'line', pt: { x: 'th', y: 't' } },
        { t: 'arc', wR: 'wR', hR: 'h', stAng: 'cd2', swAng: '-5400000' },
        { t: 'close' },
      ],
    },
  ],
  // `fill="none"` perimeter — stroked instead of the filled union.
  outline: [
    { t: 'move', pt: { x: 'ix', y: 'iy' } },
    { t: 'arc', wR: 'wR', hR: 'h', stAng: 'stAng2', swAng: 'swAng2' },
    { t: 'line', pt: { x: 'x4', y: 'y1' } },
    { t: 'line', pt: { x: 'x6', y: 't' } },
    { t: 'line', pt: { x: 'x8', y: 'y1' } },
    { t: 'line', pt: { x: 'x7', y: 'y1' } },
    { t: 'arc', wR: 'wR', hR: 'h', stAng: 'stAng3', swAng: 'swAng' },
    { t: 'line', pt: { x: 'wR', y: 'b' } },
    { t: 'arc', wR: 'wR', hR: 'h', stAng: 'cd4', swAng: 'cd4' },
    { t: 'line', pt: { x: 'th', y: 't' } },
    { t: 'arc', wR: 'wR', hR: 'h', stAng: 'cd2', swAng: '-5400000' },
  ],
};

const CURVED_DOWN_DEF: PresetShapeDef = {
  adj: { adj1: 25000, adj2: 50000, adj3: 25000 },
  guides: [
    { name: 'maxAdj2', fmla: '*/ 50000 w ss' },
    { name: 'a2', fmla: 'pin 0 adj2 maxAdj2' },
    { name: 'a1', fmla: 'pin 0 adj1 100000' },
    { name: 'th', fmla: '*/ ss a1 100000' },
    { name: 'aw', fmla: '*/ ss a2 100000' },
    { name: 'q1', fmla: '+/ th aw 4' },
    { name: 'wR', fmla: '+- wd2 0 q1' },
    { name: 'q7', fmla: '*/ wR 2 1' },
    { name: 'q8', fmla: '*/ q7 q7 1' },
    { name: 'q9', fmla: '*/ th th 1' },
    { name: 'q10', fmla: '+- q8 0 q9' },
    { name: 'q11', fmla: 'sqrt q10' },
    { name: 'idy', fmla: '*/ q11 h q7' },
    { name: 'maxAdj3', fmla: '*/ 100000 idy ss' },
    { name: 'a3', fmla: 'pin 0 adj3 maxAdj3' },
    { name: 'ah', fmla: '*/ ss a3 100000' },
    { name: 'x3', fmla: '+- wR th 0' },
    { name: 'q2', fmla: '*/ h h 1' },
    { name: 'q3', fmla: '*/ ah ah 1' },
    { name: 'q4', fmla: '+- q2 0 q3' },
    { name: 'q5', fmla: 'sqrt q4' },
    { name: 'dx', fmla: '*/ q5 wR h' },
    { name: 'x5', fmla: '+- wR dx 0' },
    { name: 'x7', fmla: '+- x3 dx 0' },
    { name: 'q6', fmla: '+- aw 0 th' },
    { name: 'dh', fmla: '*/ q6 1 2' },
    { name: 'x4', fmla: '+- x5 0 dh' },
    { name: 'x8', fmla: '+- x7 dh 0' },
    { name: 'aw2', fmla: '*/ aw 1 2' },
    { name: 'x6', fmla: '+- r 0 aw2' },
    { name: 'y1', fmla: '+- b 0 ah' },
    { name: 'swAng', fmla: 'at2 ah dx' },
    { name: 'mswAng', fmla: '+- 0 0 swAng' },
    { name: 'iy', fmla: '+- b 0 idy' },
    { name: 'ix', fmla: '+/ wR x3 2' },
    { name: 'q12', fmla: '*/ th 1 2' },
    { name: 'dang2', fmla: 'at2 idy q12' },
    { name: 'stAng', fmla: '+- 3cd4 swAng 0' },
    { name: 'stAng2', fmla: '+- 3cd4 0 dang2' },
    { name: 'swAng2', fmla: '+- dang2 0 cd4' },
    { name: 'swAng3', fmla: '+- cd4 dang2 0' },
  ],
  // Union of band body + `darkenLess` curl — full silhouette.
  paths: [
    {
      cmds: [
        { t: 'move', pt: { x: 'x6', y: 'b' } },
        { t: 'line', pt: { x: 'x4', y: 'y1' } },
        { t: 'line', pt: { x: 'x5', y: 'y1' } },
        { t: 'arc', wR: 'wR', hR: 'h', stAng: 'stAng', swAng: 'mswAng' },
        { t: 'line', pt: { x: 'x3', y: 't' } },
        { t: 'arc', wR: 'wR', hR: 'h', stAng: '3cd4', swAng: 'swAng' },
        { t: 'line', pt: { x: 'x8', y: 'y1' } },
        { t: 'close' },
      ],
    },
    {
      fill: 'darkenLess',
      cmds: [
        { t: 'move', pt: { x: 'ix', y: 'iy' } },
        { t: 'arc', wR: 'wR', hR: 'h', stAng: 'stAng2', swAng: 'swAng2' },
        { t: 'line', pt: { x: 'l', y: 'b' } },
        { t: 'arc', wR: 'wR', hR: 'h', stAng: 'cd2', swAng: 'swAng3' },
        { t: 'close' },
      ],
    },
  ],
  // `fill="none"` perimeter — stroked instead of the filled union.
  outline: [
    { t: 'move', pt: { x: 'ix', y: 'iy' } },
    { t: 'arc', wR: 'wR', hR: 'h', stAng: 'stAng2', swAng: 'swAng2' },
    { t: 'line', pt: { x: 'l', y: 'b' } },
    { t: 'arc', wR: 'wR', hR: 'h', stAng: 'cd2', swAng: 'cd4' },
    { t: 'line', pt: { x: 'x3', y: 't' } },
    { t: 'arc', wR: 'wR', hR: 'h', stAng: '3cd4', swAng: 'swAng' },
    { t: 'line', pt: { x: 'x8', y: 'y1' } },
    { t: 'line', pt: { x: 'x6', y: 'b' } },
    { t: 'line', pt: { x: 'x4', y: 'y1' } },
    { t: 'line', pt: { x: 'x5', y: 'y1' } },
    { t: 'arc', wR: 'wR', hR: 'h', stAng: 'stAng', swAng: 'mswAng' },
  ],
};

const DEFS: Record<CurvedDirection, PresetShapeDef> = {
  right: CURVED_RIGHT_DEF,
  left: CURVED_LEFT_DEF,
  up: CURVED_UP_DEF,
  down: CURVED_DOWN_DEF,
};

/** Per-direction `<a:ahLst>` landmark tokens, in adjustment order. */
const HANDLE_POS: Record<
  CurvedDirection,
  ReadonlyArray<{ x: string; y: string }>
> = {
  right: [
    { x: 'x1', y: 'y5' },
    { x: 'r', y: 'y4' },
    { x: 'x1', y: 'b' },
  ],
  left: [
    { x: 'x1', y: 'y5' },
    { x: 'r', y: 'y4' },
    { x: 'x1', y: 'b' },
  ],
  up: [
    { x: 'x7', y: 'y1' },
    { x: 'x4', y: 't' },
    { x: 'r', y: 'y1' },
  ],
  down: [
    { x: 'x7', y: 'y1' },
    { x: 'x4', y: 'b' },
    { x: 'r', y: 'y1' },
  ],
};

export function makeCurvedArrowBuilder(direction: CurvedDirection): PathBuilder {
  return presetBuilder(DEFS[direction]);
}

/** Stroke-outline builder (perimeter only) for a curved arrow. */
export function makeCurvedArrowOutlineBuilder(
  direction: CurvedDirection,
): PathBuilder {
  const outline = presetOutlineBuilder(DEFS[direction]);
  if (!outline) throw new Error(`curved arrow "${direction}" has no outline`);
  return outline;
}

export function curvedArrowHandles(
  direction: CurvedDirection,
): readonly AdjustmentHandle[] {
  const def = DEFS[direction];
  const pos = HANDLE_POS[direction];
  return pos.map((p, index) =>
    presetNumericHandle({
      def,
      index,
      posX: p.x,
      posY: p.y,
      spec: CURVED_ARROW_ADJUSTMENTS[index],
    }),
  );
}
