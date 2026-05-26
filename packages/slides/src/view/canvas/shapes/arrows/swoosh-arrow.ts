import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { polylineArc } from '../curves';
import { insetAlongAxis } from '../handles';

/**
 * `swooshArrow` — curved tail rising from SW to NE with an
 * arrowhead at the upper-right tip. V0 traces the curve as a
 * single elliptical arc on each side of the band. Two adjustments:
 * shaft thickness + head length.
 */
export const SWOOSH_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 12500, min: 0, max: 25000 },
  { name: 'Head length', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildSwooshArrow: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, 12500);
  const a2 = adj(adjustments, 1, 25000);
  const shaft = (a1 / 100000) * Math.min(w, h);
  const headLen = (a2 / 100000) * w;
  const headHalf = shaft * 1.25;
  // Outer ellipse centred at NE corner; inner ellipse shrunk by
  // `shaft`. Trace inner edge from SW corner up to head start,
  // then arrowhead, then outer edge back.
  const cx = w;
  const cy = h;
  const outerRx = w;
  const outerRy = h;
  const innerRx = Math.max(0, outerRx - shaft);
  const innerRy = Math.max(0, outerRy - shaft);
  const path = new Path2D();
  // Inner curve: from (0, h - shaft) at θ = π up through θ = 3π/2
  // (top) to the head start. We stop short of θ = 3π/2 to leave
  // room for the head.
  const tipFrac = 1 - headLen / w; // how much of the arc to draw
  const tipAngle = Math.PI + tipFrac * (Math.PI / 2);
  const inner = polylineArc(cx, cy, innerRx, innerRy, Math.PI, tipAngle, 16);
  path.moveTo(inner[0].x, inner[0].y);
  for (let i = 1; i < inner.length; i++) path.lineTo(inner[i].x, inner[i].y);
  // Arrowhead from end of inner curve to outer arc start.
  const headEndOuter = polylineArc(cx, cy, outerRx, outerRy, Math.PI, tipAngle, 16);
  const tipOuter = headEndOuter[headEndOuter.length - 1];
  // Compute outward perpendicular at tip for arrowhead spread.
  const tx = Math.cos(tipAngle);
  const ty = Math.sin(tipAngle);
  // Perpendicular pointing outward from the centre (away).
  const perpX = tx;
  const perpY = ty;
  const tipX = tipOuter.x + perpX * headHalf;
  const tipY = tipOuter.y + perpY * headHalf;
  path.lineTo(tipOuter.x + perpX * headHalf, tipOuter.y + perpY * headHalf);
  void tipX; void tipY;
  path.lineTo(tipOuter.x, tipOuter.y);
  // Outer curve back from tip to SW corner (reverse direction).
  for (let i = headEndOuter.length - 2; i >= 0; i--) {
    path.lineTo(headEndOuter[i].x, headEndOuter[i].y);
  }
  path.closePath();
  return path;
};

export const SWOOSH_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const shaft = ((adjustments[0] ?? 12500) / 100000) * Math.min(w, h);
      return { x: 0, y: insetAlongAxis(h - shaft, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const shaft = Math.max(0, h - y);
      const raw = Math.round((shaft / Math.min(w, h)) * 100000);
      const spec = SWOOSH_ARROW_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? 25000,
      ];
    },
  },
  {
    position: ({ w }, adjustments) => {
      const headLen = ((adjustments[1] ?? 25000) / 100000) * w;
      return { x: insetAlongAxis(w - headLen, w), y: 0 };
    },
    apply: ({ w }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const headLen = Math.max(0, w - x);
      const raw = w > 0 ? Math.round((headLen / w) * 100000) : 0;
      const spec = SWOOSH_ARROW_ADJUSTMENTS[1];
      return [
        start[0] ?? 12500,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
