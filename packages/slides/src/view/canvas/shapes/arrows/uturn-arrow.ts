import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { insetAlongAxis } from '../handles';

/**
 * `uturnArrow` — U-shape: vertical arm going up on the left,
 * 180° arc over the top, vertical arm coming down on the right
 * with an arrowhead at the bottom. V0 uses two polyline arcs
 * (outer + inner) for the 180° turn.
 */
export const UTURN_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 20000, min: 0, max: 40000 },
  { name: 'Head length', defaultValue: 20000, min: 0, max: 50000 },
];

export const buildUturnArrow: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 20000);
  const a2 = adj(adjustments, 1, 20000);
  const shaft = (a1 / 100000) * Math.min(w, h);
  const headLen = (a2 / 100000) * h;
  const headHalf = shaft * 0.75;
  // Arrowhead on the right arm, tip pointing down at the bottom.
  const rightCx = w - headHalf;
  const leftCx = headHalf;
  // Top of the U-turn — semicircle whose centre is between leftCx
  // and rightCx, sitting at the same y as both arm tops.
  const turnCx = (leftCx + rightCx) / 2;
  // Radii chosen so the semicircle endpoints land flush with the arm
  // walls: outer at `(leftCx - shaft/2)` / `(rightCx + shaft/2)`, inner
  // at `(leftCx + shaft/2)` / `(rightCx - shaft/2)`. The earlier
  // `outerR = turnCx` produced visible notches because the arc extended
  // past the arm walls by `shaft/2`.
  const outerR = (rightCx - leftCx) / 2 + shaft / 2;
  const innerR = Math.max(0, (rightCx - leftCx) / 2 - shaft / 2);
  const turnCy = outerR;
  const path = new Path2D();
  // CW from bottom-left of left arm.
  path.moveTo(leftCx - shaft / 2, h);
  path.lineTo(leftCx - shaft / 2, turnCy);
  // Outer semicircle CW from (leftCx - shaft/2, turnCy) at θ = π
  // around the top to (rightCx + shaft/2, turnCy) at θ = 0. In
  // screen-y-down: going through θ = -π/2 (top) requires the arc
  // direction be π → 0 with a step through negative y...
  // polylineArc(turnCx, turnCy, outerR, outerR, π, 0) traces
  // BELOW (positive y), but we want above. Use θ from π through
  // 3π/2 (negative y → top in screen) back to 2π.
  const outer = polylineArc(
    turnCx,
    turnCy,
    outerR,
    outerR,
    Math.PI,
    2 * Math.PI,
    16,
  );
  for (const p of outer) path.lineTo(p.x, p.y);
  // Down the right arm to head start.
  path.lineTo(rightCx + shaft / 2, h - headLen);
  // Arrowhead.
  path.lineTo(w, h - headLen);
  path.lineTo(rightCx, h);
  path.lineTo(rightCx - headHalf, h - headLen);
  path.lineTo(rightCx - shaft / 2, h - headLen);
  path.lineTo(rightCx - shaft / 2, turnCy);
  // Inner semicircle back (reverse of outer).
  if (innerR > 0) {
    const inner = polylineArc(
      turnCx,
      turnCy,
      innerR,
      innerR,
      2 * Math.PI,
      Math.PI,
      16,
    );
    for (const p of inner) path.lineTo(p.x, p.y);
  } else {
    path.lineTo(turnCx, turnCy);
  }
  path.lineTo(leftCx + shaft / 2, h);
  path.closePath();
  return path;
};

export const UTURN_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const shaft = ((adjustments[0] ?? 20000) / 100000) * Math.min(w, h);
      return { x: insetAlongAxis(shaft, w), y: h };
    },
    apply: ({ w, h }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const raw = Math.round((x / Math.min(w, h)) * 100000);
      const spec = UTURN_ARROW_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 20000,
      ];
    },
  },
  {
    position: ({ w, h }, adjustments) => {
      const headLen = ((adjustments[1] ?? 20000) / 100000) * h;
      return { x: insetAlongAxis(w, w), y: insetAlongAxis(h - headLen, h) };
    },
    apply: ({ h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const headLen = Math.max(0, h - y);
      const raw = h > 0 ? Math.round((headLen / h) * 100000) : 0;
      const spec = UTURN_ARROW_ADJUSTMENTS[1];
      return [
        start[0] ?? 20000,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
