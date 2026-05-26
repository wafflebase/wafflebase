// packages/slides/src/view/canvas/shapes/curves.ts
//
// Shared polyline approximation for every curved shape (pie, arc, chord,
// blockArc, circularArrow, uturnArrow, curved*Arrow, banner scrolls,
// action button "return" glyph, …). Callers receive ordered point lists
// and stitch them into a Path2D with `moveTo` + `lineTo`.
//
// Polyline (not quadraticCurveTo) is the canonical render path: the
// JSDOM canvas shim used by Vitest has incomplete `quadraticCurveTo`
// support, and P3-A.2 lessons §8 settled on "one code path for tests
// and production" as the rule. Browser anti-alias makes the 32-segment
// approximation visually indistinguishable from a Bézier at slide-scale
// frame sizes (~960 × 540).

import type { Point } from './builder';

/**
 * Segment count used by every P3-B curved shape unless it explicitly
 * overrides. At 24 px picker preview that yields < 1 px chord error;
 * on a 960 × 540 slide canvas the worst case (full-circle 360° arc
 * fitting the slide) gives ~5° per segment, sub-visible after
 * anti-alias.
 */
export const DEFAULT_ARC_SEGMENTS = 32;

/**
 * Return `segments + 1` points along an elliptical arc from `theta0`
 * to `theta1` (radians, inclusive on both ends). Angle convention is
 * standard `Math.cos`/`Math.sin` in screen-down y coordinates:
 *
 * - `0` → +x axis (right)
 * - `+π/2` → +y axis (down)
 * - `+π` → −x axis (left)
 * - `−π/2` or `+3π/2` → −y axis (up)
 *
 * Sweep direction is determined by the sign of `theta1 − theta0`. For
 * a clockwise arc from 0 to 90° pass `theta0 = 0`, `theta1 = π/2`. For
 * a full circle pass `theta1 = theta0 + 2 * Math.PI`.
 *
 * @throws RangeError if `segments` is not a positive integer.
 */
export function polylineArc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  theta0: number,
  theta1: number,
  segments: number = DEFAULT_ARC_SEGMENTS,
): Point[] {
  if (!Number.isInteger(segments) || segments < 1) {
    throw new RangeError(
      `polylineArc: \`segments\` must be a positive integer, got ${segments}`,
    );
  }
  const pts: Point[] = [];
  const step = (theta1 - theta0) / segments;
  for (let i = 0; i <= segments; i++) {
    const t = theta0 + i * step;
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return pts;
}
