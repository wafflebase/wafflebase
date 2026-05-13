// packages/slides/src/view/canvas/shapes/arrows/curved.ts
//
// Shared factory for the four directional curved arrows
// (curvedRightArrow, curvedLeftArrow, curvedUpArrow,
// curvedDownArrow). Each variant is a quarter annular sector
// occupying one quadrant of the frame, with a pointy tip extending
// radially outward at the "head" end so the picker icon can
// distinguish all four orientations.
//
// V0 caveat: the tip is a single point — the arrowhead does not
// flare wider than the band's thickness. Adding a flare would push
// the upper/lower shoulders outside the frame at high band radii.
// A proper wide-arrowhead refinement is deferred (see lessons doc).

import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FrameSize,
  PathBuilder,
  Point,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { insetAlongAxis } from '../handles';

export type CurvedDirection = 'right' | 'left' | 'up' | 'down';

export const CURVED_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 20000, min: 0, max: 50000 },
  { name: 'Head length', defaultValue: 20000, min: 0, max: 50000 },
];

interface DirSpec {
  pivot: (size: FrameSize) => Point;
  tailTheta: number;
  headTheta: number;
}

const DIRECTION_SPECS: Record<CurvedDirection, DirSpec> = {
  right: {
    pivot: ({ h }) => ({ x: 0, y: h }),
    tailTheta: -Math.PI / 2,
    headTheta: 0,
  },
  left: {
    pivot: ({ w, h }) => ({ x: w, y: h }),
    tailTheta: -Math.PI / 2,
    headTheta: -Math.PI,
  },
  up: {
    pivot: ({ h }) => ({ x: 0, y: h }),
    tailTheta: 0,
    headTheta: -Math.PI / 2,
  },
  down: {
    pivot: () => ({ x: 0, y: 0 }),
    tailTheta: 0,
    headTheta: Math.PI / 2,
  },
};

export function buildCurvedArrow(
  direction: CurvedDirection,
  size: FrameSize,
  adjustments?: number[],
): Path2D {
  const a1 = adj(adjustments, 0, 20000);
  const a2 = adj(adjustments, 1, 20000);
  const shaft = (a1 / 100000) * Math.min(size.w, size.h);
  const headLen = (a2 / 100000) * Math.min(size.w, size.h);
  const spec = DIRECTION_SPECS[direction];
  const pivot = spec.pivot(size);
  const outerR = Math.min(size.w, size.h) - headLen;
  const innerR = Math.max(0, outerR - shaft);
  const outer = polylineArc(
    pivot.x,
    pivot.y,
    outerR,
    outerR,
    spec.tailTheta,
    spec.headTheta,
    16,
  );
  const inner = polylineArc(
    pivot.x,
    pivot.y,
    innerR,
    innerR,
    spec.headTheta,
    spec.tailTheta,
    16,
  );
  const outerHead = outer[outer.length - 1];
  const innerHead = inner[0];
  // Tip extends radially outward from pivot through outer head end.
  const dx = outerHead.x - pivot.x;
  const dy = outerHead.y - pivot.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const tipX = outerHead.x + (len > 0 ? (dx / len) * headLen : 0);
  const tipY = outerHead.y + (len > 0 ? (dy / len) * headLen : 0);
  const path = new Path2D();
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) {
    path.lineTo(outer[i].x, outer[i].y);
  }
  path.lineTo(tipX, tipY);
  path.lineTo(innerHead.x, innerHead.y);
  for (let i = 1; i < inner.length; i++) {
    path.lineTo(inner[i].x, inner[i].y);
  }
  path.closePath();
  return path;
}

export function curvedArrowHandles(
  direction: CurvedDirection,
): readonly AdjustmentHandle[] {
  const spec = DIRECTION_SPECS[direction];
  return [
    {
      position: (size, adjustments) => {
        const shaft = ((adjustments[0] ?? 20000) / 100000) * Math.min(size.w, size.h);
        const headLen = ((adjustments[1] ?? 20000) / 100000) * Math.min(size.w, size.h);
        const pivot = spec.pivot(size);
        // Diamond at the tail end of the inner arc. Must use the same
        // `outerR = min(w,h) - headLen` the path builder uses
        // (`buildCurvedArrow`); the earlier `outerR = min(w,h)` floated
        // the handle `headLen` pixels off the actual band tail.
        const outerR = Math.max(0, Math.min(size.w, size.h) - headLen);
        const innerR = Math.max(0, outerR - shaft);
        return {
          x: insetAlongAxis(pivot.x + innerR * Math.cos(spec.tailTheta), size.w),
          y: insetAlongAxis(pivot.y + innerR * Math.sin(spec.tailTheta), size.h),
        };
      },
      apply: (size, start, pointer) => {
        const pivot = spec.pivot(size);
        const dx = pointer.x - pivot.x;
        const dy = pointer.y - pivot.y;
        const r = Math.sqrt(dx * dx + dy * dy);
        const headLen = ((start[1] ?? 20000) / 100000) * Math.min(size.w, size.h);
        const outerR = Math.max(0, Math.min(size.w, size.h) - headLen);
        const shaft = Math.max(0, outerR - r);
        const raw =
          outerR > 0 ? Math.round((shaft / outerR) * 100000) : 0;
        const specA = CURVED_ARROW_ADJUSTMENTS[0];
        return [
          Math.max(specA.min, Math.min(specA.max, raw)),
          start[1] ?? 20000,
        ];
      },
    },
    {
      position: (size, adjustments) => {
        const headLen = ((adjustments[1] ?? 20000) / 100000) * Math.min(size.w, size.h);
        const pivot = spec.pivot(size);
        const outerR = Math.min(size.w, size.h) - headLen;
        return {
          x: insetAlongAxis(pivot.x + outerR * Math.cos(spec.headTheta), size.w),
          y: insetAlongAxis(pivot.y + outerR * Math.sin(spec.headTheta), size.h),
        };
      },
      apply: (size, start, pointer) => {
        const pivot = spec.pivot(size);
        const dx = pointer.x - pivot.x;
        const dy = pointer.y - pivot.y;
        const r = Math.sqrt(dx * dx + dy * dy);
        const outerR = Math.min(size.w, size.h);
        const headLen = Math.max(0, outerR - r);
        const raw = Math.round((headLen / outerR) * 100000);
        const specA = CURVED_ARROW_ADJUSTMENTS[1];
        return [
          start[0] ?? 20000,
          Math.max(specA.min, Math.min(specA.max, raw)),
        ];
      },
    },
  ];
}

export function makeCurvedArrowBuilder(direction: CurvedDirection): PathBuilder {
  return (size, adjustments) => buildCurvedArrow(direction, size, adjustments);
}
