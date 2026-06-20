import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `leftRightUpArrow` — three-way arrow (left + right + up), faithful to
 * the OOXML `leftRightUpArrow` preset. The left/right arrows share a
 * horizontal bar near the bottom; the up arrow rises from that bar to
 * the very top of the frame. All arm thicknesses/heads derive from
 * `ss = min(w, h)` so the three arms stay proportional at any aspect.
 *
 * Adjustments (OOXML units, thousandths):
 *   [0] shaft thickness — `2·dx3 = ss·a1/100000` (clamped to `2·a2`)
 *   [1] head width      — `dy2 = ss·a2/50000` (L/R heads); `2·dx2` (up head)
 *   [2] head length     — `x1 = ss·a3/100000` (all three heads)
 */
export const LEFT_RIGHT_UP_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Head width', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Head length', defaultValue: 25000, min: 0, max: 50000 },
];

const LRU_DEFAULT_SHAFT = LEFT_RIGHT_UP_ARROW_ADJUSTMENTS[0].defaultValue;
const LRU_DEFAULT_HEAD_WIDTH = LEFT_RIGHT_UP_ARROW_ADJUSTMENTS[1].defaultValue;
const LRU_DEFAULT_HEAD_LENGTH = LEFT_RIGHT_UP_ARROW_ADJUSTMENTS[2].defaultValue;

/**
 * Resolve the OOXML guide values for a frame + adjustments. Shared by
 * the path builder and the handles so they never drift.
 */
function lruGuides(
  { w, h }: { w: number; h: number },
  adjustments?: number[],
) {
  const ss = Math.min(w, h);
  const a2 = Math.max(0, Math.min(50000, adj(adjustments, 1, LRU_DEFAULT_HEAD_WIDTH)));
  const a1 = Math.max(0, Math.min(2 * a2, adj(adjustments, 0, LRU_DEFAULT_SHAFT)));
  const maxAdj3 = (100000 - 2 * a2) / 2;
  const a3 = Math.max(0, Math.min(Math.max(0, maxAdj3), adj(adjustments, 2, LRU_DEFAULT_HEAD_LENGTH)));
  const x1 = (ss * a3) / 100000; // head length (also the up-head base y)
  const dx2 = (ss * a2) / 100000; // up-head half-width / L-R head inset
  const dx3 = (ss * a1) / 200000; // shaft half-thickness
  const dy2 = (ss * a2) / 50000; // L/R head full width
  const hc = w / 2;
  return {
    x1,
    dx2,
    dx3,
    x2: hc - dx2, // up head left-outer
    x3: hc - dx3, // shaft left
    x4: hc + dx3, // shaft right
    x5: hc + dx2, // up head right-outer
    x6: w - x1, // right head inner
    y2: h - dy2, // L/R head outer corner
    y3: h - dx2 - dx3, // shaft top edge (y4 - dx3)
    y4: h - dx2, // L/R arrow centerline
    y5: h - dx2 + dx3, // shaft bottom edge (y4 + dx3)
    hc,
  };
}

export const buildLeftRightUpArrow: PathBuilder = (size, adjustments) => {
  const { w, h } = size;
  const g = lruGuides(size, adjustments);
  const path = new Path2D();
  path.moveTo(0, g.y4); // left tip
  path.lineTo(g.x1, g.y2); // left head top-outer
  path.lineTo(g.x1, g.y3); // left head top-inner (shaft top)
  path.lineTo(g.x3, g.y3); // along shaft to up-shaft left
  path.lineTo(g.x3, g.x1); // up shaft left edge → up-head base
  path.lineTo(g.x2, g.x1); // up head left-outer
  path.lineTo(g.hc, 0); // up tip (top)
  path.lineTo(g.x5, g.x1); // up head right-outer
  path.lineTo(g.x4, g.x1); // up head right-inner
  path.lineTo(g.x4, g.y3); // down up-shaft right → shaft top
  path.lineTo(g.x6, g.y3); // along shaft to right head inner
  path.lineTo(g.x6, g.y2); // right head top-outer
  path.lineTo(w, g.y4); // right tip
  path.lineTo(g.x6, h); // right head bottom-outer
  path.lineTo(g.x6, g.y5); // right head bottom-inner (shaft bottom)
  path.lineTo(g.x1, g.y5); // along shaft bottom to left head bottom-inner
  path.lineTo(g.x1, h); // left head bottom-outer
  path.closePath();
  return path;
};

export const LEFT_RIGHT_UP_ARROW_HANDLES: readonly AdjustmentHandle[] = [
  // Shaft thickness — diamond on the shaft top edge at the up-shaft left.
  {
    position: (size, adjustments) => {
      const g = lruGuides(size, adjustments);
      return { x: g.x3, y: insetAlongAxis(g.y3, size.h) };
    },
    apply: (size, start, pointer) => {
      const { h } = size;
      const ss = Math.min(size.w, h);
      const y4 = h - (ss * (start[1] ?? LRU_DEFAULT_HEAD_WIDTH)) / 100000;
      // Distance above the L/R centerline = shaft half-thickness.
      const half = Math.max(0, y4 - Math.max(0, Math.min(h, pointer.y)));
      const raw = ss > 0 ? Math.round((half / ss) * 200000) : 0;
      const a2 = start[1] ?? LRU_DEFAULT_HEAD_WIDTH;
      return [
        Math.max(0, Math.min(2 * a2, raw)),
        a2,
        start[2] ?? LRU_DEFAULT_HEAD_LENGTH,
      ];
    },
  },
  // Head width — diamond at the outer corner of the left head.
  {
    position: (size, adjustments) => {
      const g = lruGuides(size, adjustments);
      return { x: insetAlongAxis(g.x1, size.w), y: insetAlongAxis(g.y2, size.h) };
    },
    apply: (size, start, pointer) => {
      const { h } = size;
      const ss = Math.min(size.w, h);
      // y2 = h − dy2, dy2 = ss·a2/50000 ⇒ a2 = (h − y2)·50000/ss.
      const dy2 = Math.max(0, Math.min(h, h - Math.max(0, Math.min(h, pointer.y))));
      const raw = ss > 0 ? Math.round((dy2 / ss) * 50000) : 0;
      return [
        start[0] ?? LRU_DEFAULT_SHAFT,
        Math.max(0, Math.min(50000, raw)),
        start[2] ?? LRU_DEFAULT_HEAD_LENGTH,
      ];
    },
  },
  // Head length — diamond at the up arrowhead's left-outer corner.
  {
    position: (size, adjustments) => {
      const g = lruGuides(size, adjustments);
      return { x: g.x2, y: insetAlongAxis(g.x1, size.h) };
    },
    apply: (size, start, pointer) => {
      const ss = Math.min(size.w, size.h);
      const x1 = Math.max(0, Math.min(size.h, pointer.y));
      const raw = ss > 0 ? Math.round((x1 / ss) * 100000) : 0;
      const a2 = start[1] ?? LRU_DEFAULT_HEAD_WIDTH;
      const maxAdj3 = Math.max(0, (100000 - 2 * a2) / 2);
      return [
        start[0] ?? LRU_DEFAULT_SHAFT,
        a2,
        Math.max(0, Math.min(maxAdj3, raw)),
      ];
    },
  },
];
