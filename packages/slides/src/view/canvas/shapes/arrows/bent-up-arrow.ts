import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `bentUpArrow` — L-shape (horizontal bottom arm + vertical right
 * arm) with the arrowhead pointing UP at the top of the vertical
 * arm. Per ECMA-376 it has three independent adjustments, all
 * scaled by `ss = min(w, h)`:
 *   [0] adj1 — shaft thickness; bottom-arm thickness `dy2 = ss*a1/100000`,
 *       vertical-arm half-width `dx2 = ss*a1/200000`.
 *   [1] adj2 — head width; head half-base `dx1 = ss*a2/50000` and tip
 *       inset `dx3 = ss*a2/100000` (independent of the shaft).
 *   [2] adj3 — head length; vertical extent `y1 = ss*a3/100000`.
 */
export const BENT_UP_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Head width', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Head length', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildBentUpArrow: PathBuilder = ({ w, h }, adjustments) => {
  const a1 = adj(adjustments, 0, BENT_UP_ARROW_ADJUSTMENTS[0].defaultValue);
  const a2 = adj(adjustments, 1, BENT_UP_ARROW_ADJUSTMENTS[1].defaultValue);
  const a3 = adj(adjustments, 2, BENT_UP_ARROW_ADJUSTMENTS[2].defaultValue);
  const ss = Math.min(w, h);
  const y1 = (ss * a3) / 100000; // head vertical extent from top
  const dx1 = (ss * a2) / 50000; // head half-base
  const x1 = w - dx1; // left base of arrowhead
  const dx3 = (ss * a2) / 100000; // tip inset from right
  const x3 = w - dx3; // tip x
  const dx2 = (ss * a1) / 200000; // vertical-arm half-width
  const x2 = x3 - dx2; // vertical-arm left edge
  const x4 = x3 + dx2; // vertical-arm right edge
  const dy2 = (ss * a1) / 100000; // bottom-arm thickness
  const y2 = h - dy2; // top of the bottom arm
  const path = new Path2D();
  path.moveTo(0, y2); // (l, y2)
  path.lineTo(x2, y2); // (x2, y2)
  path.lineTo(x2, y1); // (x2, y1)
  path.lineTo(x1, y1); // (x1, y1)
  path.lineTo(x3, 0); // (x3, t) — arrowhead tip (UP)
  path.lineTo(w, y1); // (r, y1)
  path.lineTo(x4, y1); // (x4, y1)
  path.lineTo(x4, h); // (x4, b)
  path.lineTo(0, h); // (l, b)
  path.closePath();
  return path;
};

export const BENT_UP_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  // adj1 (shaft thickness): left-edge handle at y = y2 = h - dy2.
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const a1 = adjustments[0] ?? BENT_UP_ARROW_ADJUSTMENTS[0].defaultValue;
      const dy2 = (ss * a1) / 100000;
      return { x: 0, y: insetAlongAxis(h - dy2, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const dy2 = Math.max(0, h - y);
      const ss = Math.min(w, h);
      const raw = ss > 0 ? Math.round((dy2 / ss) * 100000) : 0;
      const spec = BENT_UP_ARROW_ADJUSTMENTS[0];
      return [
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[1] ?? BENT_UP_ARROW_ADJUSTMENTS[1].defaultValue,
        start[2] ?? BENT_UP_ARROW_ADJUSTMENTS[2].defaultValue,
      ];
    },
  },
  // adj2 (head width): top-edge handle at x = x1 = w - dx1.
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const a2 = adjustments[1] ?? BENT_UP_ARROW_ADJUSTMENTS[1].defaultValue;
      const a3 = adjustments[2] ?? BENT_UP_ARROW_ADJUSTMENTS[2].defaultValue;
      const dx1 = (ss * a2) / 50000;
      const y1 = (ss * a3) / 100000;
      return { x: insetAlongAxis(w - dx1, w), y: insetAlongAxis(y1, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const x = Math.max(0, Math.min(w, pointer.x));
      const dx1 = Math.max(0, w - x);
      const ss = Math.min(w, h);
      // dx1 = ss * a2 / 50000  ->  a2 = dx1 * 50000 / ss
      const raw = ss > 0 ? Math.round((dx1 * 50000) / ss) : 0;
      const spec = BENT_UP_ARROW_ADJUSTMENTS[1];
      return [
        start[0] ?? BENT_UP_ARROW_ADJUSTMENTS[0].defaultValue,
        Math.max(spec.min, Math.min(spec.max, raw)),
        start[2] ?? BENT_UP_ARROW_ADJUSTMENTS[2].defaultValue,
      ];
    },
  },
  // adj3 (head length): handle at the tip column, y = y1.
  {
    position: ({ w, h }, adjustments) => {
      const ss = Math.min(w, h);
      const a2 = adjustments[1] ?? BENT_UP_ARROW_ADJUSTMENTS[1].defaultValue;
      const a3 = adjustments[2] ?? BENT_UP_ARROW_ADJUSTMENTS[2].defaultValue;
      const dx3 = (ss * a2) / 100000;
      const y1 = (ss * a3) / 100000;
      return { x: insetAlongAxis(w - dx3, w), y: insetAlongAxis(y1, h) };
    },
    apply: ({ w, h }, start, pointer) => {
      const y = Math.max(0, Math.min(h, pointer.y));
      const ss = Math.min(w, h);
      const raw = ss > 0 ? Math.round((y / ss) * 100000) : 0;
      const spec = BENT_UP_ARROW_ADJUSTMENTS[2];
      return [
        start[0] ?? BENT_UP_ARROW_ADJUSTMENTS[0].defaultValue,
        start[1] ?? BENT_UP_ARROW_ADJUSTMENTS[1].defaultValue,
        Math.max(spec.min, Math.min(spec.max, raw)),
      ];
    },
  },
];
