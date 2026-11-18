import type { Frame } from "@wafflebase/slides";

type Point = { x: number; y: number };

/**
 * A world point as a fraction of a frame's own unrotated box: `(0, 0)`
 * is the top-left corner, `(1, 1)` the bottom-right. The point is first
 * un-rotated about the frame centre, so a stamp placed on a rotated
 * sticky stays on the same spot of the sticky as it turns.
 *
 * Flips are ignored: a flipped sticky keeps its stamps where they were
 * dropped on screen-space intent rather than mirroring them.
 */
export function worldToFrameFraction(frame: Frame, p: Point): { u: number; v: number } {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const r = -(frame.rotation || 0);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return {
    u: frame.w > 0 ? 0.5 + lx / frame.w : 0.5,
    v: frame.h > 0 ? 0.5 + ly / frame.h : 0.5,
  };
}

/** The inverse of {@link worldToFrameFraction}. */
export function frameFractionToWorld(frame: Frame, u: number, v: number): Point {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const lx = (u - 0.5) * frame.w;
  const ly = (v - 0.5) * frame.h;
  const r = frame.rotation || 0;
  return {
    x: cx + lx * Math.cos(r) - ly * Math.sin(r),
    y: cy + lx * Math.sin(r) + ly * Math.cos(r),
  };
}

/** Clamp a fraction into the frame so a stamp never floats off its element. */
export function clampFraction(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}
