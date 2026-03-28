/**
 * Padding (px) on each side of the page when zoom-to-fit is active.
 */
export const MOBILE_PADDING = 16;

/**
 * Compute the scale factor to fit a page within the container width.
 *
 * Returns a value in (0, 1] — 1 means no scaling needed.
 * When the container is wide enough for the page + padding, returns 1.
 */
export function computeScaleFactor(
  containerWidth: number,
  pageWidth: number,
): number {
  if (pageWidth <= 0) return 1;
  const available = containerWidth - MOBILE_PADDING * 2;
  if (available <= 0)
    return Math.max(
      Number.EPSILON,
      containerWidth / (pageWidth + MOBILE_PADDING * 2),
    );
  return Math.min(1, available / pageWidth);
}
