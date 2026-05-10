import type { Frame } from '../../model/element';

const SNAP_THRESHOLD = 8;

export interface SlideDimensions { w: number; h: number; }

export type SnapGuide =
  | { axis: 'x'; position: number; kind: 'slide-center' | 'edge' }
  | { axis: 'y'; position: number; kind: 'slide-center' | 'edge' };

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

  const xCandidates: Array<{ from: number; to: number }> = [
    // Slide centre vs dragged centre
    { from: dragged.centerXPx, to: slide.w / 2 },
  ];
  const yCandidates: Array<{ from: number; to: number }> = [
    { from: dragged.centerYPx, to: slide.h / 2 },
  ];
  for (const o of others) {
    const oLeft = o.x;
    const oRight = o.x + o.w;
    const oTop = o.y;
    const oBot = o.y + o.h;
    xCandidates.push(
      { from: dragged.leftPx,  to: oLeft },
      { from: dragged.leftPx,  to: oRight },
      { from: dragged.rightPx, to: oLeft },
      { from: dragged.rightPx, to: oRight },
    );
    yCandidates.push(
      { from: dragged.topPx,    to: oTop },
      { from: dragged.topPx,    to: oBot },
      { from: dragged.bottomPx, to: oTop },
      { from: dragged.bottomPx, to: oBot },
    );
  }

  const xResult = bestSnapAdjust(xCandidates);
  const yResult = bestSnapAdjust(yCandidates);

  const guides: SnapGuide[] = [];
  if (xResult.winnerIndex !== null) {
    guides.push(
      xResult.winnerIndex === 0
        ? { axis: 'x', position: slide.w / 2, kind: 'slide-center' }
        : { axis: 'x', position: xCandidates[xResult.winnerIndex].to, kind: 'edge' },
    );
  }
  if (yResult.winnerIndex !== null) {
    guides.push(
      yResult.winnerIndex === 0
        ? { axis: 'y', position: slide.h / 2, kind: 'slide-center' }
        : { axis: 'y', position: yCandidates[yResult.winnerIndex].to, kind: 'edge' },
    );
  }

  return {
    dx: dx + xResult.adjust,
    dy: dy + yResult.adjust,
    guides,
  };
}

function bestSnapAdjust(
  cands: Array<{ from: number; to: number }>,
): { adjust: number; winnerIndex: number | null } {
  let best = 0;
  let bestAbs = SNAP_THRESHOLD + 1;
  let winnerIndex: number | null = null;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const diff = c.to - c.from;
    const abs = Math.abs(diff);
    if (abs <= SNAP_THRESHOLD && abs < bestAbs) {
      best = diff;
      bestAbs = abs;
      winnerIndex = i;
    }
  }
  return { adjust: best, winnerIndex };
}
