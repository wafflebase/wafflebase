// packages/slides/src/view/canvas/shapes/arrows/curved.ts
//
// Shared factory for the four directional curved arrows
// (curvedRightArrow, curvedLeftArrow, curvedUpArrow,
// curvedDownArrow). Each variant is a quarter annular sector
// occupying one quadrant of the frame, with a pointy tip extending
// radially outward at the "head" end so the picker icon can
// distinguish all four orientations.
//
// The shaft is a quarter annular band; at the head it terminates in a
// triangular arrowhead that flares wider than the band (shoulders at
// `outerR + flare` / `innerR - flare`) and points tangentially. The
// band's `outerR = min(w,h) - headLen`, so the outer shoulder
// (`outerR + flare`, with `flare = headLen`) lands exactly on the
// frame edge and never clips.

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
  const centerR = (outerR + innerR) / 2;
  // Arrowhead flares symmetrically about the band centreline: the
  // shoulders sit `shaft` beyond each band edge (head width = 3×shaft),
  // clamped into the frame. Symmetric flare avoids the inner shoulder
  // collapsing onto the pivot for thin bands.
  const headHalf = shaft;
  const shoulderOuterR = Math.min(Math.min(size.w, size.h), centerR + shaft + headHalf);
  const shoulderInnerR = Math.max(0, centerR - shaft - headHalf);
  // Arrowhead occupies an angular slice `headSpan` of the quarter,
  // capped at half the sweep so the shaft never vanishes.
  const sweep = spec.headTheta - spec.tailTheta; // signed, |.| = π/2
  const s = Math.sign(sweep) || 1;
  const headSpan = Math.min(
    Math.abs(sweep) * 0.5,
    centerR > 0 ? headLen / centerR : 0,
  );
  const thetaBase = spec.headTheta - s * headSpan;

  const outer = polylineArc(
    pivot.x,
    pivot.y,
    outerR,
    outerR,
    spec.tailTheta,
    thetaBase,
    16,
  );
  const inner = polylineArc(
    pivot.x,
    pivot.y,
    innerR,
    innerR,
    thetaBase,
    spec.tailTheta,
    16,
  );
  const at = (r: number, theta: number): Point => ({
    x: pivot.x + r * Math.cos(theta),
    y: pivot.y + r * Math.sin(theta),
  });
  const shoulderOuter = at(shoulderOuterR, thetaBase);
  const shoulderInner = at(shoulderInnerR, thetaBase);
  const tip = at(centerR, spec.headTheta);

  const path = new Path2D();
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) path.lineTo(outer[i].x, outer[i].y);
  path.lineTo(shoulderOuter.x, shoulderOuter.y);
  path.lineTo(tip.x, tip.y);
  path.lineTo(shoulderInner.x, shoulderInner.y);
  for (const p of inner) path.lineTo(p.x, p.y);
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
        const minDim = Math.min(size.w, size.h);
        const pivot = spec.pivot(size);
        const dx = pointer.x - pivot.x;
        const dy = pointer.y - pivot.y;
        const r = Math.sqrt(dx * dx + dy * dy);
        const headLen = ((start[1] ?? 20000) / 100000) * minDim;
        const outerR = Math.max(0, minDim - headLen);
        const shaft = Math.max(0, outerR - r);
        // Builder uses `min(w, h)` as the shaft-thickness basis
        // (see `buildCurvedArrow`); the apply formula must match,
        // not the inner-band-relative `outerR`.
        const raw =
          minDim > 0 ? Math.round((shaft / minDim) * 100000) : 0;
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
