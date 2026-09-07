import type { Frame } from '@wafflebase/slides';
import { resizeFrameToSize } from '@wafflebase/slides';

/**
 * Widen a frame patch that changes `w` / `h` so it also carries the
 * compensated `x` / `y`.
 *
 * `frame.x/y` is the top-left of the UNROTATED box while rotation pivots
 * on the centre, so a size-only patch moves the centre and a rotated
 * element jumps across the slide instead of resizing in place (#1039).
 * `resizeFrameToSize` anchors the unrotated top-left corner in world
 * space — the same anchor a south-east drag-resize uses — and is the
 * identity on `x` / `y` at `rotation === 0`, so unrotated behaviour is
 * unchanged.
 *
 * Patches that don't touch size (rotation, position) pass through
 * untouched.
 */
export function anchoredFramePatch(
  frame: Frame,
  patch: Partial<Frame>,
): Partial<Frame> {
  if (patch.w === undefined && patch.h === undefined) return patch;
  const next = resizeFrameToSize(frame, patch.w ?? frame.w, patch.h ?? frame.h);
  return { ...patch, x: next.x, y: next.y };
}
