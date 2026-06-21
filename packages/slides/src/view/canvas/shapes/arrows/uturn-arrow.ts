import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { presetBuilder } from '../preset/path';
import { presetNumericHandle } from '../preset/handles';
import type { PresetShapeDef } from '../preset/types';

/**
 * `uturnArrow` — a flat-top U with rounded corners and a flared
 * arrowhead at the end of the right arm, ported verbatim from
 * ECMA-376 `presetShapeDefinitions.xml` (`<uturnArrow>`). Five
 * adjustments: shaft thickness, arrowhead width, arrowhead length,
 * outer bend radius, and overall arm height.
 */
const UTURN_ARROW_DEF: PresetShapeDef = {
  adj: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 43750, adj5: 75000 },
  guides: [
    { name: 'a2', fmla: 'pin 0 adj2 25000' },
    { name: 'maxAdj1', fmla: '*/ a2 2 1' },
    { name: 'a1', fmla: 'pin 0 adj1 maxAdj1' },
    { name: 'q2', fmla: '*/ a1 ss h' },
    { name: 'q3', fmla: '+- 100000 0 q2' },
    { name: 'maxAdj3', fmla: '*/ q3 h ss' },
    { name: 'a3', fmla: 'pin 0 adj3 maxAdj3' },
    { name: 'q1', fmla: '+- a3 a1 0' },
    { name: 'minAdj5', fmla: '*/ q1 ss h' },
    { name: 'a5', fmla: 'pin minAdj5 adj5 100000' },
    { name: 'th', fmla: '*/ ss a1 100000' },
    { name: 'aw2', fmla: '*/ ss a2 100000' },
    { name: 'th2', fmla: '*/ th 1 2' },
    { name: 'dh2', fmla: '+- aw2 0 th2' },
    { name: 'y5', fmla: '*/ h a5 100000' },
    { name: 'ah', fmla: '*/ ss a3 100000' },
    { name: 'y4', fmla: '+- y5 0 ah' },
    { name: 'x9', fmla: '+- r 0 dh2' },
    { name: 'bw', fmla: '*/ x9 1 2' },
    { name: 'bs', fmla: 'min bw y4' },
    { name: 'maxAdj4', fmla: '*/ bs 100000 ss' },
    { name: 'a4', fmla: 'pin 0 adj4 maxAdj4' },
    { name: 'bd', fmla: '*/ ss a4 100000' },
    { name: 'bd3', fmla: '+- bd 0 th' },
    { name: 'bd2', fmla: 'max bd3 0' },
    { name: 'x3', fmla: '+- th bd2 0' },
    { name: 'x8', fmla: '+- r 0 aw2' },
    { name: 'x6', fmla: '+- x8 0 aw2' },
    { name: 'x7', fmla: '+- x6 dh2 0' },
    { name: 'x4', fmla: '+- x9 0 bd' },
    { name: 'x5', fmla: '+- x7 0 bd2' },
    { name: 'cx', fmla: '+/ th x7 2' },
  ],
  paths: [
    {
      cmds: [
        { t: 'move', pt: { x: 'l', y: 'b' } },
        { t: 'line', pt: { x: 'l', y: 'bd' } },
        { t: 'arc', wR: 'bd', hR: 'bd', stAng: 'cd2', swAng: 'cd4' },
        { t: 'line', pt: { x: 'x4', y: 't' } },
        { t: 'arc', wR: 'bd', hR: 'bd', stAng: '3cd4', swAng: 'cd4' },
        { t: 'line', pt: { x: 'x9', y: 'y4' } },
        { t: 'line', pt: { x: 'r', y: 'y4' } },
        { t: 'line', pt: { x: 'x8', y: 'y5' } },
        { t: 'line', pt: { x: 'x6', y: 'y4' } },
        { t: 'line', pt: { x: 'x7', y: 'y4' } },
        { t: 'line', pt: { x: 'x7', y: 'x3' } },
        { t: 'arc', wR: 'bd2', hR: 'bd2', stAng: '0', swAng: '-5400000' },
        { t: 'line', pt: { x: 'x3', y: 'th' } },
        { t: 'arc', wR: 'bd2', hR: 'bd2', stAng: '3cd4', swAng: '-5400000' },
        { t: 'line', pt: { x: 'th', y: 'b' } },
        { t: 'close' },
      ],
    },
  ],
};

export const UTURN_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Arrowhead width', defaultValue: 25000, min: 0, max: 25000 },
  { name: 'Arrowhead length', defaultValue: 25000, min: 0, max: 100000 },
  { name: 'Bend radius', defaultValue: 43750, min: 0, max: 100000 },
  { name: 'Height', defaultValue: 75000, min: 0, max: 100000 },
];

export const buildUturnArrow: PathBuilder = presetBuilder(UTURN_ARROW_DEF);

export const UTURN_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  presetNumericHandle({
    def: UTURN_ARROW_DEF,
    index: 0,
    posX: 'th',
    posY: 'b',
    spec: UTURN_ARROW_ADJUSTMENTS[0],
  }),
  presetNumericHandle({
    def: UTURN_ARROW_DEF,
    index: 1,
    posX: 'x6',
    posY: 'b',
    spec: UTURN_ARROW_ADJUSTMENTS[1],
  }),
  presetNumericHandle({
    def: UTURN_ARROW_DEF,
    index: 2,
    posX: 'x6',
    posY: 'y4',
    spec: UTURN_ARROW_ADJUSTMENTS[2],
  }),
  presetNumericHandle({
    def: UTURN_ARROW_DEF,
    index: 3,
    posX: 'bd',
    posY: 't',
    spec: UTURN_ARROW_ADJUSTMENTS[3],
  }),
  presetNumericHandle({
    def: UTURN_ARROW_DEF,
    index: 4,
    posX: 'r',
    posY: 'y5',
    spec: UTURN_ARROW_ADJUSTMENTS[4],
  }),
];
