import type { Frame } from '../../model/element';
import type { Guide } from '../../model/presentation';

const SNAP_THRESHOLD = 8;

export interface SlideDimensions { w: number; h: number; }

export type SnapGuideKind = 'slide-center' | 'guide' | 'edge';

export type SnapGuide =
  | { axis: 'x'; position: number; kind: SnapGuideKind; guideId?: string }
  | { axis: 'y'; position: number; kind: SnapGuideKind; guideId?: string };

type Candidate = {
  from: number;
  to: number;
  kind: SnapGuideKind;
  /** Set when `kind === 'guide'`; matches the source `Guide.id`. */
  guideId?: string;
};

/**
 * Priority among snap candidates within the same threshold band. Lower
 * number wins. Slide-center > user-placed guide > other-element edge.
 *
 * Rationale: slide-center is the strongest visual anchor and most
 * commonly intended; explicit guides reflect direct user intent and
 * should win over implicit element-edge alignment.
 */
const PRIORITY: Record<SnapGuideKind, number> = {
  'slide-center': 0,
  'guide': 1,
  'edge': 2,
};

/**
 * Adjust a (dx, dy) drag delta so the dragged group's bounding-box
 * edges or centre snap to the slide centre, a presentation-wide
 * alignment guide, or a non-selected element's edge — whichever wins
 * inside the 8 px threshold.
 *
 * Both axes are computed independently. Among candidates that fall
 * inside the threshold, `PRIORITY` resolves ties; within the same
 * kind, the smallest correction wins.
 *
 * Also returns a `guides` array describing which alignment line(s)
 * won the snap so an overlay layer can render visible feedback during
 * the drag. Empty when no axis snapped.
 */
export function snapDelta(
  bbox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  others: readonly Frame[],
  slide: SlideDimensions,
  guides: readonly Guide[] = [],
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

  // Presentation-wide guides. Three candidate offsets per guide so the
  // dragged frame can snap by either edge or by its centre.
  for (const g of guides) {
    if (g.axis === 'x') {
      xCandidates.push(
        { from: dragged.leftPx,    to: g.position, kind: 'guide', guideId: g.id },
        { from: dragged.rightPx,   to: g.position, kind: 'guide', guideId: g.id },
        { from: dragged.centerXPx, to: g.position, kind: 'guide', guideId: g.id },
      );
    } else {
      yCandidates.push(
        { from: dragged.topPx,     to: g.position, kind: 'guide', guideId: g.id },
        { from: dragged.bottomPx,  to: g.position, kind: 'guide', guideId: g.id },
        { from: dragged.centerYPx, to: g.position, kind: 'guide', guideId: g.id },
      );
    }
  }

  const xResult = bestSnapAdjust(xCandidates);
  const yResult = bestSnapAdjust(yCandidates);

  const snapGuides: SnapGuide[] = [];
  const xGuide = toGuide('x', xResult.winner);
  if (xGuide) snapGuides.push(xGuide);
  const yGuide = toGuide('y', yResult.winner);
  if (yGuide) snapGuides.push(yGuide);

  return {
    dx: dx + xResult.adjust,
    dy: dy + yResult.adjust,
    guides: snapGuides,
  };
}

function toGuide(
  axis: 'x' | 'y',
  winner: Candidate | null,
): SnapGuide | null {
  if (!winner) return null;
  return {
    axis,
    position: winner.to,
    kind: winner.kind,
    guideId: winner.guideId,
  };
}

function bestSnapAdjust(
  cands: Candidate[],
): { adjust: number; winner: Candidate | null } {
  let winner: Candidate | null = null;
  let bestAbs = SNAP_THRESHOLD + 1;
  for (const c of cands) {
    const diff = c.to - c.from;
    const abs = Math.abs(diff);
    if (abs > SNAP_THRESHOLD) continue;
    if (winner === null) {
      winner = c;
      bestAbs = abs;
      continue;
    }
    const pNew = PRIORITY[c.kind];
    const pCur = PRIORITY[winner.kind];
    if (pNew < pCur) {
      // Higher priority kind wins regardless of distance — guides
      // outrank element edges even when an edge happens to be closer.
      winner = c;
      bestAbs = abs;
    } else if (pNew === pCur && abs < bestAbs) {
      winner = c;
      bestAbs = abs;
    }
  }
  if (!winner) return { adjust: 0, winner: null };
  return { adjust: winner.to - winner.from, winner };
}
