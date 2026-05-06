import type { Frame } from '../../../model/element';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const MIN_SIZE = 1;

/**
 * Apply a resize drag to a frame. Returns a new frame; does not mutate
 * the input. v1 ignores `frame.rotation` — handles act on the
 * axis-aligned bbox per the T2 simplification.
 *
 * Each handle has an anchor (the opposite corner or edge midpoint)
 * that stays fixed. Dragging changes the dimensions on the active
 * side(s).
 *
 * `shift` preserves aspect: the larger of |dx|/w and |dy|/h is taken
 * as the scale factor, then applied to the other axis.
 */
export function resizeFrame(
  start: Frame,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  shift: boolean,
): Frame {
  const right  = start.x + start.w;
  const bottom = start.y + start.h;

  // Track edges; let the handle pick which ones move.
  let left = start.x;
  let top = start.y;
  let r = right;
  let b = bottom;

  if (shift) {
    ({ dx, dy } = preserveAspect(start.w, start.h, handle, dx, dy));
  }

  switch (handle) {
    case 'e':  r = right + dx;                   break;
    case 'w':  left = start.x + dx;              break;
    case 's':  b = bottom + dy;                  break;
    case 'n':  top = start.y + dy;               break;
    case 'ne': r = right + dx; top = start.y + dy; break;
    case 'nw': left = start.x + dx; top = start.y + dy; break;
    case 'se': r = right + dx; b = bottom + dy;  break;
    case 'sw': left = start.x + dx; b = bottom + dy; break;
  }

  // Enforce minimum size by clamping the moving edge against its anchor.
  // For w/h-clamped edges, snap the moving edge back so size === MIN_SIZE.
  if (r - left < MIN_SIZE) {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') {
      left = right - MIN_SIZE;
    } else {
      r = left + MIN_SIZE;
    }
  }
  if (b - top < MIN_SIZE) {
    if (handle === 'n' || handle === 'nw' || handle === 'ne') {
      top = bottom - MIN_SIZE;
    } else {
      b = top + MIN_SIZE;
    }
  }

  return {
    x: left, y: top,
    w: r - left, h: b - top,
    rotation: start.rotation,
  };
}

function preserveAspect(
  w: number, h: number,
  handle: ResizeHandle,
  dx: number, dy: number,
): { dx: number; dy: number } {
  // Edges only get one degree of freedom — shift is a no-op.
  if (handle === 'e' || handle === 'w' || handle === 'n' || handle === 's') {
    return { dx, dy };
  }
  // Sign of dy depends on whether the handle pulls top or bottom.
  const dyForGrowth = (handle === 'nw' || handle === 'ne') ? -dy : dy;
  const dxForGrowth = (handle === 'nw' || handle === 'sw') ? -dx : dx;
  const xScale = dxForGrowth / w;
  const yScale = dyForGrowth / h;
  const scale = Math.abs(xScale) > Math.abs(yScale) ? xScale : yScale;
  const targetDx = scale * w * ((handle === 'nw' || handle === 'sw') ? -1 : 1);
  const targetDy = scale * h * ((handle === 'nw' || handle === 'ne') ? -1 : 1);
  return { dx: targetDx, dy: targetDy };
}
