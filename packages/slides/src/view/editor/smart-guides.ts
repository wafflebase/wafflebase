import type { Frame } from '../../model/element';

/**
 * One side of an arrow span used by the smart-guide overlay. `from` /
 * `to` are world coords on the matched axis; `perpendicular` is the
 * fixed coordinate on the other axis (the row/column the arrow is
 * drawn at).
 */
export type Span = { from: number; to: number; perpendicular: number };

/**
 * Result of detecting an equal-spacing trio, an equal-distance pair,
 * or an equal-size match. Rendered by `overlay.ts` alongside the
 * existing edge / center / user-guide `SnapGuide` set.
 *
 *  - equal-spacing  → two same-axis arrows at the middle element's
 *                     centre, one for each gap.
 *  - equal-distance → two same-axis arrows — the existing pair's gap
 *                     and the new (drag, neighbour) gap.
 *  - equal-size     → a dashed outline around every matched frame.
 */
export type SmartGuide =
  | { kind: 'equal-spacing';  axis: 'x' | 'y'; spans: [Span, Span] }
  | { kind: 'equal-distance'; axis: 'x' | 'y'; spans: [Span, Span] }
  | { kind: 'equal-size';     axis: 'x' | 'y'; matchedFrames: Frame[] };

/**
 * Refine the snap-corrected (`dx`, `dy`) further when the dragged
 * bbox would form an equal-spacing trio or equal-distance pair with
 * `others`. Called AFTER `snapDelta`: any edge/centre/guide snap has
 * already won. Threshold is the same 8 px band the rest of the editor
 * uses.
 *
 * Axes are independent — `x` may match equal-spacing while `y` is
 * untouched.
 */

const THRESHOLD = 8;

type Drag = {
  leftPx: number; rightPx: number; centerXPx: number;
  topPx: number;  bottomPx: number; centerYPx: number;
};

function makeDrag(
  bbox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
): Drag {
  return {
    leftPx:   bbox.x + dx,
    rightPx:  bbox.x + dx + bbox.w,
    centerXPx: bbox.x + dx + bbox.w / 2,
    topPx:    bbox.y + dy,
    bottomPx: bbox.y + dy + bbox.h,
    centerYPx: bbox.y + dy + bbox.h / 2,
  };
}

function overlapsRow(d: Drag, o: Frame): boolean {
  return d.bottomPx > o.y && d.topPx < o.y + o.h;
}

function overlapsCol(d: Drag, o: Frame): boolean {
  return d.rightPx > o.x && d.leftPx < o.x + o.w;
}

export function smartGuides(
  bbox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  others: readonly Frame[],
): { dx: number; dy: number; guides: SmartGuide[] } {
  const d = makeDrag(bbox, dx, dy);

  type Cand = {
    adjust: number;
    guide: SmartGuide;
  };

  let bestX: Cand | null = null;
  let bestY: Cand | null = null;
  const tryX = (c: Cand) => {
    if (Math.abs(c.adjust) > THRESHOLD) return;
    if (!bestX || Math.abs(c.adjust) < Math.abs(bestX.adjust)) bestX = c;
  };
  const tryY = (c: Cand) => {
    if (Math.abs(c.adjust) > THRESHOLD) return;
    if (!bestY || Math.abs(c.adjust) < Math.abs(bestY.adjust)) bestY = c;
  };

  // Equal-spacing — dragged in the middle, A on the left, B on the right.
  // X-axis: A.right ≤ drag.left, B.left ≥ drag.right, same row.
  for (let i = 0; i < others.length; i++) {
    const a = others[i];
    if (!overlapsRow(d, a)) continue;
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const b = others[j];
      if (!overlapsRow(d, b)) continue;
      if (a.x + a.w > d.leftPx) continue;     // A must be fully left
      if (b.x < d.rightPx) continue;          // B must be fully right
      const gapL = d.leftPx - (a.x + a.w);
      const gapR = b.x - d.rightPx;
      const adjust = (gapR - gapL) / 2;
      tryX({
        adjust,
        guide: {
          kind: 'equal-spacing',
          axis: 'x',
          spans: [
            { from: a.x + a.w, to: d.leftPx + adjust, perpendicular: d.centerYPx },
            { from: d.rightPx + adjust, to: b.x,      perpendicular: d.centerYPx },
          ],
        },
      });
    }
  }
  // Y-axis mirror.
  for (let i = 0; i < others.length; i++) {
    const a = others[i];
    if (!overlapsCol(d, a)) continue;
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const b = others[j];
      if (!overlapsCol(d, b)) continue;
      if (a.y + a.h > d.topPx) continue;
      if (b.y < d.bottomPx) continue;
      const gapT = d.topPx - (a.y + a.h);
      const gapB = b.y - d.bottomPx;
      const adjust = (gapB - gapT) / 2;
      tryY({
        adjust,
        guide: {
          kind: 'equal-spacing',
          axis: 'y',
          spans: [
            { from: a.y + a.h, to: d.topPx + adjust, perpendicular: d.centerXPx },
            { from: d.bottomPx + adjust, to: b.y,    perpendicular: d.centerXPx },
          ],
        },
      });
    }
  }

  // Equal-spacing — dragged at an END. Pair (A, B) with A.right < B.left
  // already same-row. Two cases:
  //   1) dragged.left ≥ B.right → make gap(B, dragged) == gap(A, B)
  //   2) dragged.right ≤ A.left → make gap(dragged, A) == gap(A, B)
  for (let i = 0; i < others.length; i++) {
    const a = others[i];
    if (!overlapsRow(d, a)) continue;
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const b = others[j];
      if (!overlapsRow(d, b)) continue;
      if (a.x + a.w >= b.x) continue;  // need A strictly left of B
      const innerGap = b.x - (a.x + a.w);
      // Case 1: dragged on the right of B.
      if (d.leftPx >= b.x + b.w) {
        const outerGap = d.leftPx - (b.x + b.w);
        const adjust = innerGap - outerGap;
        tryX({
          adjust,
          guide: {
            kind: 'equal-spacing',
            axis: 'x',
            spans: [
              { from: a.x + a.w, to: b.x,             perpendicular: d.centerYPx },
              { from: b.x + b.w, to: d.leftPx + adjust, perpendicular: d.centerYPx },
            ],
          },
        });
      }
      // Case 2: dragged on the left of A.
      if (d.rightPx <= a.x) {
        const outerGap = a.x - d.rightPx;
        const adjust = -(innerGap - outerGap);
        tryX({
          adjust,
          guide: {
            kind: 'equal-spacing',
            axis: 'x',
            spans: [
              { from: d.rightPx + adjust, to: a.x, perpendicular: d.centerYPx },
              { from: a.x + a.w, to: b.x,          perpendicular: d.centerYPx },
            ],
          },
        });
      }
    }
  }

  // Equal-spacing — dragged at an END (Y axis). Pair (A, B) with A.bottom < B.top.
  for (let i = 0; i < others.length; i++) {
    const a = others[i];
    if (!overlapsCol(d, a)) continue;
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const b = others[j];
      if (!overlapsCol(d, b)) continue;
      if (a.y + a.h >= b.y) continue;
      const innerGap = b.y - (a.y + a.h);
      if (d.topPx >= b.y + b.h) {
        const outerGap = d.topPx - (b.y + b.h);
        const adjust = innerGap - outerGap;
        tryY({
          adjust,
          guide: {
            kind: 'equal-spacing',
            axis: 'y',
            spans: [
              { from: a.y + a.h, to: b.y,              perpendicular: d.centerXPx },
              { from: b.y + b.h, to: d.topPx + adjust,  perpendicular: d.centerXPx },
            ],
          },
        });
      }
      if (d.bottomPx <= a.y) {
        const outerGap = a.y - d.bottomPx;
        const adjust = -(innerGap - outerGap);
        tryY({
          adjust,
          guide: {
            kind: 'equal-spacing',
            axis: 'y',
            spans: [
              { from: d.bottomPx + adjust, to: a.y, perpendicular: d.centerXPx },
              { from: a.y + a.h, to: b.y,           perpendicular: d.centerXPx },
            ],
          },
        });
      }
    }
  }

  const guides: SmartGuide[] = [];
  if (bestX) guides.push((bestX as Cand).guide);
  if (bestY) guides.push((bestY as Cand).guide);
  return {
    dx: dx + (bestX ? (bestX as Cand).adjust : 0),
    dy: dy + (bestY ? (bestY as Cand).adjust : 0),
    guides,
  };
}
