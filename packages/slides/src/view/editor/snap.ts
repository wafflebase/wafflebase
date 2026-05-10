import type { Frame } from '../../model/element';

const SNAP_THRESHOLD = 8;

export interface SlideDimensions { w: number; h: number; }

export type SnapGuide =
  | { axis: 'x'; position: number; kind: 'slide-center' | 'edge' }
  | { axis: 'y'; position: number; kind: 'slide-center' | 'edge' };

type Candidate = {
  from: number;
  to: number;
  kind: 'slide-center' | 'edge';
};

/**
 * Adjust a (dx, dy) drag delta so the dragged group's bounding-box
 * edges or centre snap to the slide centre or to a non-selected
 * element's edge, whichever is closest within an 8 px threshold.
 *
 * Both axes are computed independently. If no candidate is within
 * threshold on an axis, the original delta is returned unchanged on
 * that axis. The smallest correction wins per axis.
 *
 * Also returns a `guides` array describing which alignment line(s)
 * won the snap, so an overlay layer can render visible guide lines
 * during drag. Empty when no axis snapped.
 */
export function snapDelta(
  bbox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  others: readonly Frame[],
  slide: SlideDimensions,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const dragged = {
    leftPx: bbox.x + dx,
    rightPx: bbox.x + dx + bbox.w,
    centerXPx: bbox.x + dx + bbox.w / 2,
    topPx: bbox.y + dy,
    bottomPx: bbox.y + dy + bbox.h,
    centerYPx: bbox.y + dy + bbox.h / 2,
  };

  const xCandidates: Candidate[] = [
    // Slide centre vs dragged centre
    { from: dragged.centerXPx, to: slide.w / 2, kind: 'slide-center' },
  ];
  const yCandidates: Candidate[] = [
    { from: dragged.centerYPx, to: slide.h / 2, kind: 'slide-center' },
  ];
  for (const o of others) {
    const oLeft = o.x;
    const oRight = o.x + o.w;
    const oTop = o.y;
    const oBot = o.y + o.h;
    xCandidates.push(
      { from: dragged.leftPx,  to: oLeft,  kind: 'edge' },
      { from: dragged.leftPx,  to: oRight, kind: 'edge' },
      { from: dragged.rightPx, to: oLeft,  kind: 'edge' },
      { from: dragged.rightPx, to: oRight, kind: 'edge' },
    );
    yCandidates.push(
      { from: dragged.topPx,    to: oTop, kind: 'edge' },
      { from: dragged.topPx,    to: oBot, kind: 'edge' },
      { from: dragged.bottomPx, to: oTop, kind: 'edge' },
      { from: dragged.bottomPx, to: oBot, kind: 'edge' },
    );
  }

  const xResult = bestSnapAdjust(xCandidates);
  const yResult = bestSnapAdjust(yCandidates);

  const guides: SnapGuide[] = [];
  const xGuide = toGuide('x', xResult.winner);
  if (xGuide) guides.push(xGuide);
  const yGuide = toGuide('y', yResult.winner);
  if (yGuide) guides.push(yGuide);

  return {
    dx: dx + xResult.adjust,
    dy: dy + yResult.adjust,
    guides,
  };
}

function toGuide(
  axis: 'x' | 'y',
  winner: Candidate | null,
): SnapGuide | null {
  if (!winner) return null;
  return { axis, position: winner.to, kind: winner.kind };
}

function bestSnapAdjust(
  cands: Candidate[],
): { adjust: number; winner: Candidate | null } {
  let best = 0;
  let bestAbs = SNAP_THRESHOLD + 1;
  let winner: Candidate | null = null;
  for (const c of cands) {
    const diff = c.to - c.from;
    const abs = Math.abs(diff);
    if (abs <= SNAP_THRESHOLD && abs < bestAbs) {
      best = diff;
      bestAbs = abs;
      winner = c;
    }
  }
  return { adjust: best, winner };
}
