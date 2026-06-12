import type { Frame } from '../../../model/element';
import type { Endpoint } from '../../../model/connector';

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

/**
 * Apply a resize drag to a (possibly rotated) frame using a world-space
 * pointer delta. For unrotated frames this is identical to
 * `resizeFrame`. For rotated frames the world delta is projected onto
 * the frame's local axes, the resize is computed in local coords, and
 * the result is positioned so the anchor handle (the corner / edge
 * midpoint OPPOSITE to the dragged handle) stays fixed in world
 * coordinates — the intuitive Google-Slides behaviour.
 */
export function resizeFrameWorld(
  start: Frame,
  handle: ResizeHandle,
  worldDx: number,
  worldDy: number,
  shift: boolean,
): Frame {
  if (start.rotation === 0) {
    return resizeFrame(start, handle, worldDx, worldDy, shift);
  }

  // Project world delta into the frame's local axes by rotating by -θ.
  const cosInv = Math.cos(-start.rotation);
  const sinInv = Math.sin(-start.rotation);
  const localDx = worldDx * cosInv - worldDy * sinInv;
  const localDy = worldDx * sinInv + worldDy * cosInv;

  // Compute the new dimensions on a fictional unrotated frame at origin.
  const localStart: Frame = { x: 0, y: 0, w: start.w, h: start.h, rotation: 0 };
  const local = resizeFrame(localStart, handle, localDx, localDy, shift);

  // Anchor = opposite corner / edge midpoint. It must stay in the same
  // WORLD position before and after the resize. anchorBefore is its
  // position in start's local coords; anchorAfter is its position in
  // the new (resized) local coords.
  const anchorBefore = anchorLocal(handle, start.w, start.h);
  const anchorAfter  = anchorLocal(handle, local.w,  local.h);

  // World position of anchorBefore = startCentre + R(rot) * (anchorBefore - startLocalCentre).
  const startCx = start.x + start.w / 2;
  const startCy = start.y + start.h / 2;
  const cosF = Math.cos(start.rotation);
  const sinF = Math.sin(start.rotation);
  const dxL = anchorBefore.x - start.w / 2;
  const dyL = anchorBefore.y - start.h / 2;
  const anchorWorldX = startCx + cosF * dxL - sinF * dyL;
  const anchorWorldY = startCy + sinF * dxL + cosF * dyL;

  // Solve for the new frame's centre so anchorAfter (in NEW local
  // coords) lands on the same anchor world position.
  // anchorWorld = newCentre + R(rot) * (anchorAfter - newLocalCentre)
  const dxA = anchorAfter.x - local.w / 2;
  const dyA = anchorAfter.y - local.h / 2;
  const newCx = anchorWorldX - (cosF * dxA - sinF * dyA);
  const newCy = anchorWorldY - (sinF * dxA + cosF * dyA);

  return {
    x: newCx - local.w / 2,
    y: newCy - local.h / 2,
    w: local.w,
    h: local.h,
    rotation: start.rotation,
  };
}

function anchorLocal(handle: ResizeHandle, w: number, h: number): { x: number; y: number } {
  switch (handle) {
    case 'nw': return { x: w,     y: h };
    case 'n':  return { x: w / 2, y: h };
    case 'ne': return { x: 0,     y: h };
    case 'e':  return { x: 0,     y: h / 2 };
    case 'se': return { x: 0,     y: 0 };
    case 's':  return { x: w / 2, y: 0 };
    case 'sw': return { x: w,     y: 0 };
    case 'w':  return { x: w,     y: h / 2 };
  }
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

export type ElementSnapshot =
  | { kind: 'frame'; id: string; worldFrame: Frame }
  | {
      kind: 'connector';
      id: string;
      worldFrame: Frame;
      start: Endpoint;
      end: Endpoint;
    };

export interface MultiResizeStart {
  scope: readonly string[];
  startBbox: Frame; // rotation === 0
  snapshots: readonly ElementSnapshot[];
}

export interface MultiResizeResult {
  newBbox: Frame;
  frames: Map<string, Frame>;
  connectorEndpoints: Map<string, { start: Endpoint; end: Endpoint }>;
}

/**
 * Pure multi-resize math. Reuses `resizeFrame` for the bbox (it is
 * always axis-aligned) and redistributes the new dimensions over
 * per-child frames via a single affine map: a child's centre and
 * size scale by (sx, sy) relative to the bbox anchor. Rotation is
 * preserved per child (Google Slides / PowerPoint behaviour). Each
 * child's `w` / `h` is clamped to `MIN_SIZE`.
 */
export function resizeMultiFrames(
  start: MultiResizeStart,
  handle: ResizeHandle,
  worldDx: number,
  worldDy: number,
  shift: boolean,
): MultiResizeResult {
  const newBbox = resizeFrame(start.startBbox, handle, worldDx, worldDy, shift);
  const sx = start.startBbox.w > 0 ? newBbox.w / start.startBbox.w : 1;
  const sy = start.startBbox.h > 0 ? newBbox.h / start.startBbox.h : 1;

  const mapPoint = (px: number, py: number): { x: number; y: number } => ({
    x: newBbox.x + (px - start.startBbox.x) * sx,
    y: newBbox.y + (py - start.startBbox.y) * sy,
  });

  const frames = new Map<string, Frame>();
  const connectorEndpoints = new Map<string, { start: Endpoint; end: Endpoint }>();

  for (const snap of start.snapshots) {
    const cx = snap.worldFrame.x + snap.worldFrame.w / 2;
    const cy = snap.worldFrame.y + snap.worldFrame.h / 2;
    const c2 = mapPoint(cx, cy);
    const w2 = Math.max(snap.worldFrame.w * sx, MIN_SIZE);
    const h2 = Math.max(snap.worldFrame.h * sy, MIN_SIZE);
    const nextFrame: Frame = {
      x: c2.x - w2 / 2,
      y: c2.y - h2 / 2,
      w: w2,
      h: h2,
      rotation: snap.worldFrame.rotation,
      flipH: snap.worldFrame.flipH,
      flipV: snap.worldFrame.flipV,
    };
    frames.set(snap.id, nextFrame);

    if (snap.kind === 'connector') {
      const mapEp = (ep: Endpoint): Endpoint => {
        if (ep.kind === 'attached') return ep;
        const p = mapPoint(ep.x, ep.y);
        return { kind: 'free', x: p.x, y: p.y };
      };
      const writeStart = snap.start.kind === 'free' ? mapEp(snap.start) : snap.start;
      const writeEnd   = snap.end.kind   === 'free' ? mapEp(snap.end)   : snap.end;
      if (snap.start.kind === 'free' || snap.end.kind === 'free') {
        connectorEndpoints.set(snap.id, { start: writeStart, end: writeEnd });
      }
    }
  }

  return { newBbox, frames, connectorEndpoints };
}
