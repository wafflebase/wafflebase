import type { AdjustmentHandle, AdjustmentSpec, PathBuilder } from '../builder';
import { presetBuilder } from '../preset/path';
import { presetNumericHandle } from '../preset/handles';
import type { PresetShapeDef } from '../preset/types';

/**
 * `swooshArrow` — a thin curve that rises from the SW corner to a
 * flared arrowhead at the upper-right, ported verbatim from the
 * ECMA-376 `presetShapeDefinitions.xml` (`<swooshArrow>`). Two
 * adjustments: `adj1` controls the curve height / head rise, `adj2`
 * the head's horizontal offset from the right edge.
 */
const SWOOSH_ARROW_DEF: PresetShapeDef = {
  adj: { adj1: 25000, adj2: 16667 },
  guides: [
    { name: 'a1', fmla: 'pin 1 adj1 75000' },
    { name: 'maxAdj2', fmla: '*/ 70000 w ss' },
    { name: 'a2', fmla: 'pin 0 adj2 maxAdj2' },
    { name: 'ad1', fmla: '*/ h a1 100000' },
    { name: 'ad2', fmla: '*/ ss a2 100000' },
    { name: 'xB', fmla: '+- r 0 ad2' },
    { name: 'yB', fmla: '+- t ssd8 0' },
    { name: 'alfa', fmla: '*/ cd4 1 14' },
    { name: 'dx0', fmla: 'tan ssd8 alfa' },
    { name: 'xC', fmla: '+- xB 0 dx0' },
    { name: 'dx1', fmla: 'tan ad1 alfa' },
    { name: 'yF', fmla: '+- yB ad1 0' },
    { name: 'xF', fmla: '+- xB dx1 0' },
    { name: 'xE', fmla: '+- xF dx0 0' },
    { name: 'yE', fmla: '+- yF ssd8 0' },
    { name: 'dy2', fmla: '+- yE 0 t' },
    { name: 'dy22', fmla: '*/ dy2 1 2' },
    { name: 'dy3', fmla: '*/ h 1 20' },
    { name: 'yD', fmla: '+- t dy22 dy3' },
    { name: 'dy4', fmla: '*/ hd6 1 1' },
    { name: 'yP1', fmla: '+- hd6 dy4 0' },
    { name: 'xP1', fmla: 'val wd6' },
    { name: 'dy5', fmla: '*/ hd6 1 2' },
    { name: 'yP2', fmla: '+- yF dy5 0' },
    { name: 'xP2', fmla: 'val wd4' },
  ],
  paths: [
    {
      cmds: [
        { t: 'move', pt: { x: 'l', y: 'b' } },
        { t: 'quad', c: { x: 'xP1', y: 'yP1' }, pt: { x: 'xB', y: 'yB' } },
        { t: 'line', pt: { x: 'xC', y: 't' } },
        { t: 'line', pt: { x: 'r', y: 'yD' } },
        { t: 'line', pt: { x: 'xE', y: 'yE' } },
        { t: 'line', pt: { x: 'xF', y: 'yF' } },
        { t: 'quad', c: { x: 'xP2', y: 'yP2' }, pt: { x: 'l', y: 'b' } },
        { t: 'close' },
      ],
    },
  ],
};

export const SWOOSH_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Thickness', defaultValue: 25000, min: 1, max: 75000 },
  { name: 'Head size', defaultValue: 16667, min: 0, max: 70000 },
];

export const buildSwooshArrow: PathBuilder = presetBuilder(SWOOSH_ARROW_DEF);

export const SWOOSH_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  presetNumericHandle({
    def: SWOOSH_ARROW_DEF,
    index: 0,
    posX: 'xF',
    posY: 'yF',
    spec: SWOOSH_ARROW_ADJUSTMENTS[0],
  }),
  presetNumericHandle({
    def: SWOOSH_ARROW_DEF,
    index: 1,
    posX: 'xB',
    posY: 'yB',
    spec: SWOOSH_ARROW_ADJUSTMENTS[1],
  }),
];
