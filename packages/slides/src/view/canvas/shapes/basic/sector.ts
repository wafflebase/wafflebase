// packages/slides/src/view/canvas/shapes/basic/sector.ts
//
// Shared path geometry for the four arc-based basic shapes: `pie`,
// `chord`, `arc`, `blockArc`. Each one is "the perimeter of an ellipse
// inscribed in the frame, swept clockwise from a start angle to an end
// angle, closed differently". Centralising the sweep + polyline
// approximation here keeps the per-shape builders short (~6 lines)
// and stops the four shapes from drifting apart on edge cases.
//
// Angle convention: OOXML 60000ths of a degree (`60000 ⇒ 1°`,
// `21600000 ⇒ 360°`). Angles increase clockwise from the +x axis
// (right), matching screen-down y. A pointer at the bottom midpoint
// of the frame sits at 90°.
//
// Sweep direction: OOXML pie/chord/arc/blockArc always sweep
// **clockwise** from `start` to `end`. When `end < start` we wrap by
// adding 360° to `end`, so a default pie (start = 270°, end = 0°)
// renders a 1/4 slice in the NE quadrant rather than a 3/4 slice
// the other way around.

import { polylineArc } from '../curves';
import type { FrameSize } from '../builder';

const FULL_TURN_OOXML = 360 * 60000;

function ooxmlToRadians(ooxml: number): number {
  return (ooxml / 60000) * (Math.PI / 180);
}

/**
 * Normalise OOXML start/end angle pair to a radian range guaranteed
 * to sweep clockwise (`t1 >= t0`). Wraps `end` by 360° when it falls
 * before `start` numerically.
 */
function normalizeSweep(
  startOoxml: number,
  endOoxml: number,
): { t0: number; t1: number } {
  const t0 = ooxmlToRadians(startOoxml);
  let endOoxmlNorm = endOoxml;
  if (endOoxmlNorm < startOoxml) endOoxmlNorm += FULL_TURN_OOXML;
  const t1 = ooxmlToRadians(endOoxmlNorm);
  return { t0, t1 };
}

/**
 * `pie` — closed wedge from the centre out to the start angle, along
 * the arc to the end angle, back to the centre. Filled.
 */
export function pieSectorPath(
  { w, h }: FrameSize,
  startOoxml: number,
  endOoxml: number,
): Path2D {
  const cx = w / 2;
  const cy = h / 2;
  const { t0, t1 } = normalizeSweep(startOoxml, endOoxml);
  const arc = polylineArc(cx, cy, w / 2, h / 2, t0, t1);
  const path = new Path2D();
  path.moveTo(cx, cy);
  for (const p of arc) path.lineTo(p.x, p.y);
  path.closePath();
  return path;
}

/**
 * `chord` — closed segment from the start of the arc, along the arc
 * to the end, then straight back across. Filled.
 */
export function chordPath(
  { w, h }: FrameSize,
  startOoxml: number,
  endOoxml: number,
): Path2D {
  const cx = w / 2;
  const cy = h / 2;
  const { t0, t1 } = normalizeSweep(startOoxml, endOoxml);
  const arc = polylineArc(cx, cy, w / 2, h / 2, t0, t1);
  const path = new Path2D();
  path.moveTo(arc[0].x, arc[0].y);
  for (let i = 1; i < arc.length; i++) path.lineTo(arc[i].x, arc[i].y);
  path.closePath();
  return path;
}

/**
 * `arc` — open path along the elliptical arc. No close, no fill —
 * the dispatcher renders this via stroke only (see
 * `STYLE_BY_KIND['arc']` in the editor `insert.ts`).
 */
export function arcPath(
  { w, h }: FrameSize,
  startOoxml: number,
  endOoxml: number,
): Path2D {
  const cx = w / 2;
  const cy = h / 2;
  const { t0, t1 } = normalizeSweep(startOoxml, endOoxml);
  const arc = polylineArc(cx, cy, w / 2, h / 2, t0, t1);
  const path = new Path2D();
  path.moveTo(arc[0].x, arc[0].y);
  for (let i = 1; i < arc.length; i++) path.lineTo(arc[i].x, arc[i].y);
  return path;
}

/**
 * `blockArc` — annular sector. Outer arc from `t0 → t1`, radial step
 * inward, inner arc back from `t1 → t0`, close back to outer start.
 * `thicknessFrac` is `adj3 / 100000` — 0 means an open band (zero
 * thickness, visually a stroke), 0.5 means inner radius is half of
 * outer (a thick band), values above 0.5 visually fall through to
 * pie-like wedges and are clamped at the spec layer.
 *
 * Inner radii are derived multiplicatively from the outer radii so
 * the band hugs the same ellipse on both sides (no rounding from
 * `min(rx, ry)`).
 */
export function blockArcPath(
  { w, h }: FrameSize,
  startOoxml: number,
  endOoxml: number,
  thicknessOoxml: number,
): Path2D {
  const cx = w / 2;
  const cy = h / 2;
  const { t0, t1 } = normalizeSweep(startOoxml, endOoxml);
  const rx = w / 2;
  const ry = h / 2;
  const innerScale = Math.max(0, 1 - thicknessOoxml / 100000);
  const irx = rx * innerScale;
  const iry = ry * innerScale;

  const outer = polylineArc(cx, cy, rx, ry, t0, t1);
  const inner = polylineArc(cx, cy, irx, iry, t1, t0);

  const path = new Path2D();
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) {
    path.lineTo(outer[i].x, outer[i].y);
  }
  for (const p of inner) path.lineTo(p.x, p.y);
  path.closePath();
  return path;
}
