// packages/slides/src/view/canvas/shapes/basic/bracket-pair.ts
import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `bracketPair` — a matched pair of square brackets "[ ]". OOXML
 * renders the fill as a rounded rectangle and strokes only the two
 * corner brackets; we collapse that into a stroke-only open path (two
 * sub-paths) registered in `OPEN_PATH_KINDS`, mirroring the single
 * `leftBracket` / `rightBracket` treatment.
 *
 * adj: corner radius as ‰ of min(w, h) — OOXML `x1 = ss * a / 100000`,
 * `a = pin 0 adj 50000`. Default 16667 → 16.67% of min(w, h). The
 * radius doubles as the horizontal stub length of each bracket.
 */
export const BRACKET_PAIR_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Corner radius', defaultValue: 16667, min: 0, max: 50000 },
];

export const DEF_BRACKET_PAIR_RADIUS = 16667;

export function bracketPairRadius(
  { w, h }: { w: number; h: number },
  adjustments?: number[],
): number {
  const a = Math.max(0, Math.min(50000, adj(adjustments, 0, DEF_BRACKET_PAIR_RADIUS)));
  const ss = Math.min(w, h);
  // Cap so the two opposing brackets never overlap horizontally and
  // the top/bottom corner arcs never cross vertically.
  return Math.min((ss * a) / 100000, w / 2, h / 2);
}

export const buildBracketPair: PathBuilder = (size, adjustments) => {
  const { w, h } = size;
  const r = bracketPairRadius(size, adjustments);
  const path = new Path2D();
  // Left bracket "["
  path.moveTo(r, 0);
  path.quadraticCurveTo(0, 0, 0, r);
  path.lineTo(0, h - r);
  path.quadraticCurveTo(0, h, r, h);
  // Right bracket "]"
  path.moveTo(w - r, 0);
  path.quadraticCurveTo(w, 0, w, r);
  path.lineTo(w, h - r);
  path.quadraticCurveTo(w, h, w - r, h);
  return path;
};

export const BRACKET_PAIR_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: (size, adjustments) => {
      const r = bracketPairRadius(size, adjustments);
      return { x: insetAlongAxis(0, size.w), y: insetAlongAxis(r, size.h) };
    },
    apply: ({ w, h }, _start, pointer) => {
      const ss = Math.min(w, h);
      const y = Math.max(0, Math.min(ss / 2, pointer.y));
      const raw = ss > 0 ? Math.round((y / (ss / 2)) * 50000) : DEF_BRACKET_PAIR_RADIUS;
      return [Math.max(0, Math.min(50000, raw))];
    },
  },
];
