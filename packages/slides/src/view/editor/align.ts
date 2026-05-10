import type { Frame } from '../../model/element';

export type AlignDirection =
  | 'left' | 'center-h' | 'right'
  | 'top'  | 'center-v' | 'bottom';

export type DistributeAxis = 'horizontal' | 'vertical';

export interface AlignReference {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Compute new frames for align. Returns id→new-frame ONLY for frames
 * that need to move (skip no-ops to keep store batches tight).
 *
 * Reference is the rectangle the alignment is performed against:
 *   - multi-select: combined bounding box of the selection
 *   - single-select: the slide canvas (1920×1080)
 * Caller picks the reference; this function does not.
 */
export function alignFrames(
  frames: ReadonlyMap<string, Frame>,
  direction: AlignDirection,
  reference: AlignReference,
): Map<string, Frame> {
  const result = new Map<string, Frame>();
  for (const [id, frame] of frames) {
    const moved = applyAlign(frame, direction, reference);
    if (moved) result.set(id, moved);
  }
  return result;
}

/**
 * Compute new frames so inner elements have equal gaps between
 * consecutive frames on the given axis. Endpoints (leftmost/rightmost
 * for horizontal, topmost/bottommost for vertical) stay fixed.
 *
 * Returns id→new-frame ONLY for frames that moved. Returns an EMPTY map
 * (no-op) when there are fewer than 3 frames — distribution is undefined
 * for 0/1/2 elements. Does not throw.
 */
export function distributeFrames(
  frames: ReadonlyMap<string, Frame>,
  axis: DistributeAxis,
): Map<string, Frame> {
  const result = new Map<string, Frame>();
  if (frames.size < 3) return result;

  const sorted = [...frames.entries()].sort((a, b) =>
    axis === 'horizontal' ? a[1].x - b[1].x : a[1].y - b[1].y,
  );

  const n = sorted.length;
  const first = sorted[0][1];
  const last = sorted[n - 1][1];

  // gap = (last leading edge - first leading edge - sum of widths
  //        excluding the last frame) / (n - 1)
  // For horizontal: leading edge = x, width = w. Mirror for vertical.
  let sumExceptLast = 0;
  for (let i = 0; i < n - 1; i++) {
    sumExceptLast += axis === 'horizontal' ? sorted[i][1].w : sorted[i][1].h;
  }

  const firstLead = axis === 'horizontal' ? first.x : first.y;
  const lastLead = axis === 'horizontal' ? last.x : last.y;
  const gap = (lastLead - firstLead - sumExceptLast) / (n - 1);

  // Walk frame 1..n-2 and place each at firstLead + sum(prev widths) + i*gap.
  let runningSum = axis === 'horizontal' ? sorted[0][1].w : sorted[0][1].h;
  for (let i = 1; i < n - 1; i++) {
    const [id, frame] = sorted[i];
    const newLead = firstLead + runningSum + i * gap;
    if (axis === 'horizontal') {
      if (newLead !== frame.x) {
        result.set(id, { ...frame, x: newLead });
      }
      runningSum += frame.w;
    } else {
      if (newLead !== frame.y) {
        result.set(id, { ...frame, y: newLead });
      }
      runningSum += frame.h;
    }
  }

  return result;
}

function applyAlign(
  frame: Frame,
  direction: AlignDirection,
  ref: AlignReference,
): Frame | null {
  switch (direction) {
    case 'left': {
      const x = ref.x;
      return x === frame.x ? null : { ...frame, x };
    }
    case 'center-h': {
      const x = ref.x + ref.w / 2 - frame.w / 2;
      return x === frame.x ? null : { ...frame, x };
    }
    case 'right': {
      const x = ref.x + ref.w - frame.w;
      return x === frame.x ? null : { ...frame, x };
    }
    case 'top': {
      const y = ref.y;
      return y === frame.y ? null : { ...frame, y };
    }
    case 'center-v': {
      const y = ref.y + ref.h / 2 - frame.h / 2;
      return y === frame.y ? null : { ...frame, y };
    }
    case 'bottom': {
      const y = ref.y + ref.h - frame.h;
      return y === frame.y ? null : { ...frame, y };
    }
  }
}
