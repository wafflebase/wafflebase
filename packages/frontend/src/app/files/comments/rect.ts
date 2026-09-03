import type { PdfAnchor, PdfRect } from '@/types/comments.ts';

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

/**
 * The boxes an anchor highlights: one for a drawn region, one per selected
 * line for a text selection.
 */
export function anchorRects(anchor: PdfAnchor): ReadonlyArray<PdfRect> {
  return anchor.kind === 'pdf-region' ? [anchor.rect] : anchor.rects;
}

/**
 * The single box enclosing everything an anchor covers — where the pin goes,
 * and what the composer positions itself against. A text anchor with no rects
 * cannot occur through the normal path (`readPdfTextSelection` rejects it),
 * but a hand-edited CRDT could carry one, so it degrades to an empty box at
 * the page origin rather than returning `Infinity` from `Math.min`.
 */
export function anchorBounds(anchor: PdfAnchor): PdfRect {
  const rects = anchorRects(anchor);
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  // A single box is its own bounds. Returning it verbatim also keeps a
  // region's pin exactly on its rect, where `(x + w) - x` would drift by a
  // float ulp.
  if (rects.length === 1) return rects[0]!;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Bring a comment's anchor into view inside the PDF viewer.
 *
 * Every page is in the DOM from the moment the document loads (an
 * aspect-ratio placeholder stands in until it rasterizes), so a thread on a
 * page that has never been scrolled to still resolves. Anchors are page
 * fractions, so the target is derived from the page's measured box rather
 * than from any stored pixel value.
 *
 * The anchor is parked a third of the way down the viewport rather than at
 * its very top, so the lines around it — the context the comment is about —
 * stay on screen. Does nothing when the page is not mounted, which is the
 * right outcome for a thread pointing past the end of the file.
 */
export function scrollToAnchor(anchor: PdfAnchor): void {
  const page = document.querySelector<HTMLElement>(
    `[data-pdf-page="${anchor.pageIndex}"]`,
  );
  const viewport = page?.closest<HTMLElement>('[data-pdf-viewport]');
  if (!page || !viewport) return;

  const pageBox = page.getBoundingClientRect();
  const viewportBox = viewport.getBoundingClientRect();
  if (pageBox.height <= 0) return;

  const anchorTop =
    viewport.scrollTop +
    (pageBox.top - viewportBox.top) +
    anchorBounds(anchor).y * pageBox.height;

  viewport.scrollTo({
    top: Math.max(0, anchorTop - viewportBox.height / 3),
    behavior: 'smooth',
  });
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
