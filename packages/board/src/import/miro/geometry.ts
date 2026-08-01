import type { Frame } from '@wafflebase/slides';

/** Miro position (item CENTER) and geometry (rotation in DEGREES). */
export interface MiroPositionLike { x?: number; y?: number }
export interface MiroGeometryLike { width?: number; height?: number; rotation?: number }

const DEFAULT_SIZE = { w: 100, h: 100 };

/**
 * Convert Miro's center-origin position + degree rotation into the board's
 * top-left-origin `Frame` in radians. Coordinates map 1:1 — the board plane is
 * unbounded, so no scaling is needed.
 */
export function miroFrame(
  position: MiroPositionLike | undefined,
  geometry: MiroGeometryLike | undefined,
  fallbackSize: { w: number; h: number } = DEFAULT_SIZE,
): Frame {
  const w = geometry?.width ?? fallbackSize.w;
  const h = geometry?.height ?? fallbackSize.h;
  const cx = position?.x ?? 0;
  const cy = position?.y ?? 0;
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    rotation: ((geometry?.rotation ?? 0) * Math.PI) / 180,
  };
}
