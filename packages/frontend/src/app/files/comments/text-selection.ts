import type { PdfRect, PdfTextAnchor } from '@/types/comments.ts';

/** The subset of `DOMRect` this module needs, so callers can pass plain data. */
export type ClientRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Rects smaller than this (in page fractions) are layout noise, not text. */
const MIN_RECT_SIZE = 0.0005;
/** Two rects within this fraction of each other are the same line box. */
const SAME_RECT_EPSILON = 0.001;
/**
 * Two rects sit on the same line when their vertical extents overlap by more
 * than this share of the shorter one. A subscript hangs below its base but
 * still overlaps it heavily; the next line down does not overlap at all.
 */
const SAME_LINE_OVERLAP = 0.35;
/**
 * Horizontal gap (in page fractions) up to which two rects on one line are
 * joined. Wide enough to close the seams between separately-positioned runs —
 * which is what mathematical notation is made of — and far narrower than the
 * gutter between two columns, which must stay two highlights.
 */
const MAX_JOIN_GAP = 0.012;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Convert a selection's client rectangles into page-relative [0,1] boxes.
 *
 * `Range.getClientRects()` returns one rectangle per line box, which is what
 * makes a multi-line highlight follow the text rather than covering the whole
 * block between the first and last character. It also returns degenerate and
 * duplicated rectangles — collapsed ranges at line ends, and one rect per
 * text node where a line is split across several — so they are filtered and
 * deduplicated here.
 *
 * Kept free of DOM lookups so the geometry is testable without layout, which
 * jsdom does not provide.
 */
export function normalizeClientRects(
  rects: ReadonlyArray<ClientRect>,
  page: ClientRect,
): PdfRect[] {
  if (page.width <= 0 || page.height <= 0) return [];

  const out: PdfRect[] = [];
  for (const r of rects) {
    // Clamp in pixel space, then derive w/h from the clamped extents, so a
    // selection running past the page edge stays in range without the
    // rounding noise of subtracting two independently-divided fractions.
    const left = Math.min(Math.max(r.left - page.left, 0), page.width);
    const top = Math.min(Math.max(r.top - page.top, 0), page.height);
    const right = Math.min(Math.max(r.left + r.width - page.left, 0), page.width);
    const bottom = Math.min(
      Math.max(r.top + r.height - page.top, 0),
      page.height,
    );

    const rect: PdfRect = {
      x: clamp01(left / page.width),
      y: clamp01(top / page.height),
      w: clamp01((right - left) / page.width),
      h: clamp01((bottom - top) / page.height),
    };
    if (rect.w < MIN_RECT_SIZE || rect.h < MIN_RECT_SIZE) continue;
    if (out.some((seen) => sameRect(seen, rect))) continue;
    out.push(rect);
  }
  return mergeRunsIntoLines(out);
}

/**
 * Join rects that belong to the same run of text into one box per line.
 *
 * A PDF has no notion of a text line: pdf.js positions a separate span for
 * every run the content stream draws, and `getClientRects()` hands back one
 * rect per span. Ordinary prose usually yields a single rect per line, but
 * anything typeset — mathematical notation above all — is a chain of small
 * runs on shifted baselines, so `n₁n₅ → o₂` arrives as a dozen fragments and
 * highlighting them literally paints a row of disconnected chips around the
 * subscripts instead of a band across the expression.
 *
 * Rects are grouped by vertical overlap and joined left to right while the
 * gap stays small, so a subscript merges into the expression it belongs to
 * while two columns of a two-column page stay two separate highlights.
 */
function mergeRunsIntoLines(rects: ReadonlyArray<PdfRect>): PdfRect[] {
  if (rects.length < 2) return [...rects];

  // Group by line first: read order within a line is what the join walks.
  const lines: PdfRect[][] = [];
  for (const rect of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((l) => l.some((r) => onSameLine(r, rect)));
    if (line) line.push(rect);
    else lines.push([rect]);
  }

  const merged: PdfRect[] = [];
  for (const line of lines) {
    let current: PdfRect | null = null;
    for (const rect of line.sort((a, b) => a.x - b.x)) {
      if (current && rect.x - (current.x + current.w) <= MAX_JOIN_GAP) {
        current = union(current, rect);
        continue;
      }
      if (current) merged.push(current);
      current = rect;
    }
    if (current) merged.push(current);
  }
  return merged.sort((a, b) => a.y - b.y || a.x - b.x);
}

function onSameLine(a: PdfRect, b: PdfRect): boolean {
  const overlap =
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlap <= 0) return false;
  return overlap >= SAME_LINE_OVERLAP * Math.min(a.h, b.h);
}

function union(a: PdfRect, b: PdfRect): PdfRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function sameRect(a: PdfRect, b: PdfRect): boolean {
  return (
    Math.abs(a.x - b.x) < SAME_RECT_EPSILON &&
    Math.abs(a.y - b.y) < SAME_RECT_EPSILON &&
    Math.abs(a.w - b.w) < SAME_RECT_EPSILON &&
    Math.abs(a.h - b.h) < SAME_RECT_EPSILON
  );
}

/**
 * The page element a range sits in, or null when the selection is outside the
 * viewer (the comments panel, the header) or straddles two pages.
 *
 * A selection crossing a page boundary is refused rather than truncated: an
 * anchor names one `pageIndex`, and silently dropping the rest of what the
 * user highlighted would be worse than asking them to select again.
 */
export function pageElementOf(range: Range): HTMLElement | null {
  const start = closestPage(range.startContainer);
  if (!start) return null;
  const end = closestPage(range.endContainer);
  return end === start ? start : null;
}

function closestPage(node: Node | null): HTMLElement | null {
  const el =
    node?.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>('[data-pdf-page]') ?? null;
}

/**
 * Read the document's current selection as a PDF text anchor, or null when
 * there is nothing commentable selected.
 *
 * The anchor's page-relative rects are all a caller needs to place an
 * affordance next to the text: rendered inside the page overlay they scroll,
 * zoom and reflow with the page, where screen coordinates would need
 * recomputing on every one of those.
 */
export function readPdfTextSelection(
  selection: Selection | null,
): PdfTextAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const quote = selection.toString().trim();
  if (quote.length === 0) return null;

  const pageEl = pageElementOf(range);
  if (!pageEl) return null;
  const pageIndex = Number(pageEl.dataset.pdfPage);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;

  const rects = normalizeClientRects(
    Array.from(range.getClientRects()),
    pageEl.getBoundingClientRect(),
  );
  if (rects.length === 0) return null;

  return { kind: 'pdf-text', pageIndex, rects, quote };
}
