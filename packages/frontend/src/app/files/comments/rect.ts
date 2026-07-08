import type { PdfRect } from '@/types/comments.ts';

export type PixelRect = { left: number; top: number; width: number; height: number };

const clampPx = (n: number, max: number): number => Math.min(max, Math.max(0, n));

/**
 * Convert a pointer drag (page-local pixels) into a page-relative [0,1]
 * rectangle. Orientation-normalized so any drag direction yields a positive
 * width/height, and clamped so an overshoot outside the page stays in range.
 *
 * Clamping happens in pixel space and width/height are derived from the
 * clamped pixel extents (not by subtracting two independently-divided [0,1]
 * values) so exact drags don't pick up binary floating-point rounding noise
 * (e.g. 0.3 - 0.1 !== 0.2 in IEEE 754).
 */
export function normalizeDragRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  pageW: number,
  pageH: number,
): PdfRect {
  const minX = clampPx(Math.min(start.x, end.x), pageW);
  const maxX = clampPx(Math.max(start.x, end.x), pageW);
  const minY = clampPx(Math.min(start.y, end.y), pageH);
  const maxY = clampPx(Math.max(start.y, end.y), pageH);
  return {
    x: minX / pageW,
    y: minY / pageH,
    w: (maxX - minX) / pageW,
    h: (maxY - minY) / pageH,
  };
}

/** CSS percentage box for absolutely positioning a pin over a page. */
export function rectToStyle(rect: PdfRect): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}
