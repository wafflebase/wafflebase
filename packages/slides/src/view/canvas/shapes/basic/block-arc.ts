import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { blockArcPath } from './sector';
import { angularHandle, insetAlongAxis } from '../handles';

/**
 * `blockArc` — annular sector. Three adjustments:
 *  - `adj1` start angle (OOXML 60000ths)
 *  - `adj2` end angle
 *  - `adj3` thickness as a fraction of the outer radius
 *    (100000 → solid pie; 0 → infinitesimal stroke)
 *
 * Two angular handles paint on the outer ellipse perimeter; a third
 * inline linear-radial handle sits on the inner arc at the sweep
 * midpoint and drags toward/away from the centre to change
 * thickness.
 */
export const BLOCK_ARC_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Start angle',
    defaultValue: 10800000, // 180° (left)
    min: 0,
    max: 21600000,
    axisLabel: 'start',
  },
  {
    name: 'End angle',
    defaultValue: 0, // right
    min: 0,
    max: 21600000,
    axisLabel: 'end',
  },
  {
    name: 'Thickness',
    defaultValue: 25000, // 25% of outer radius
    min: 0,
    max: 50000,
    axisLabel: 'thickness',
  },
];

export const buildBlockArc: PathBuilder = (size, adjustments) => {
  const start = adj(adjustments, 0, BLOCK_ARC_ADJUSTMENTS[0].defaultValue);
  const end = adj(adjustments, 1, BLOCK_ARC_ADJUSTMENTS[1].defaultValue);
  const thick = adj(adjustments, 2, BLOCK_ARC_ADJUSTMENTS[2].defaultValue);
  return blockArcPath(size, start, end, thick);
};

const FULL_TURN_OOXML = 360 * 60000;

function midAngleRad(startOoxml: number, endOoxml: number): number {
  const normalisedEnd =
    endOoxml < startOoxml ? endOoxml + FULL_TURN_OOXML : endOoxml;
  const midOoxml = (startOoxml + normalisedEnd) / 2;
  return (midOoxml / 60000) * (Math.PI / 180);
}

/**
 * Thickness handle: paints on the inner arc at the sweep midpoint.
 * Drag radially (toward / away from the centre) to change thickness.
 * Projects the pointer onto the midradial direction and converts the
 * resulting fraction of the outer ellipse radius into the OOXML
 * 0..50000 thickness encoding.
 */
const thicknessHandle: AdjustmentHandle = {
  position: ({ w, h }, adjustments) => {
    const start = adjustments[0] ?? BLOCK_ARC_ADJUSTMENTS[0].defaultValue;
    const end = adjustments[1] ?? BLOCK_ARC_ADJUSTMENTS[1].defaultValue;
    const thickness =
      adjustments[2] ?? BLOCK_ARC_ADJUSTMENTS[2].defaultValue;
    const cx = w / 2;
    const cy = h / 2;
    const rx = w / 2;
    const ry = h / 2;
    const midRad = midAngleRad(start, end);
    const innerScale = Math.max(0, 1 - thickness / 100000);
    return {
      x: insetAlongAxis(cx + rx * innerScale * Math.cos(midRad), w),
      y: insetAlongAxis(cy + ry * innerScale * Math.sin(midRad), h),
    };
  },
  apply: ({ w, h }, start, pointer) => {
    const cx = w / 2;
    const cy = h / 2;
    const rx = w / 2;
    const ry = h / 2;
    const midRad = midAngleRad(start[0], start[1]);
    const dx = pointer.x - cx;
    const dy = pointer.y - cy;
    const projection = dx * Math.cos(midRad) + dy * Math.sin(midRad);
    // Outer ellipse radius along the midradial.
    const cos = Math.cos(midRad);
    const sin = Math.sin(midRad);
    const denom = Math.sqrt((ry * cos) ** 2 + (rx * sin) ** 2);
    const outerR = denom === 0 ? Math.max(rx, ry) : (rx * ry) / denom;
    const innerFrac = Math.max(0, Math.min(1, projection / outerR));
    const thickness = Math.round((1 - innerFrac) * 100000);
    const spec = BLOCK_ARC_ADJUSTMENTS[2];
    const clamped = Math.max(spec.min, Math.min(spec.max, thickness));
    const result = [...start];
    result[2] = clamped;
    return result;
  },
};

export const BLOCK_ARC_HANDLES: readonly AdjustmentHandle[] = [
  angularHandle({
    center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
    radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
    index: 0,
    spec: BLOCK_ARC_ADJUSTMENTS[0],
  }),
  angularHandle({
    center: ({ w, h }) => ({ x: w / 2, y: h / 2 }),
    radius: ({ w, h }) => ({ rx: w / 2, ry: h / 2 }),
    index: 1,
    spec: BLOCK_ARC_ADJUSTMENTS[1],
  }),
  thicknessHandle,
];
