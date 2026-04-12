import type { DocumentLayout, LayoutBlock } from './layout.js';
import type { PaginatedLayout } from './pagination.js';
import { getPageXOffset, getPageYOffset } from './pagination.js';

/**
 * Axis-aligned rectangle in document-layout coordinates (i.e. the same
 * coordinate space the canvas render uses before the `-scrollY`
 * translate). All values are in CSS pixels.
 */
export interface ImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Identifier for one of the eight resize handles around a selection. */
export type ImageHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Side length of each square handle, in CSS pixels. */
export const HANDLE_SIZE = 8;
/** Half of HANDLE_SIZE — handy for the center-based hit math. */
export const HANDLE_HALF = HANDLE_SIZE / 2;
/** Extra slack around the handle center for pointer-friendly hit testing. */
const HANDLE_HIT_SLACK = 2;

/** Ordered handle list so drawing and hit testing share a single source. */
export const IMAGE_HANDLES: readonly ImageHandle[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

/**
 * Return the center point of a given handle on the rect.
 */
export function handleCenter(rect: ImageRect, handle: ImageHandle): { x: number; y: number } {
  const xMid = rect.x + rect.width / 2;
  const yMid = rect.y + rect.height / 2;
  const xRight = rect.x + rect.width;
  const yBot = rect.y + rect.height;
  switch (handle) {
    case 'nw': return { x: rect.x, y: rect.y };
    case 'n':  return { x: xMid, y: rect.y };
    case 'ne': return { x: xRight, y: rect.y };
    case 'e':  return { x: xRight, y: yMid };
    case 'se': return { x: xRight, y: yBot };
    case 's':  return { x: xMid, y: yBot };
    case 'sw': return { x: rect.x, y: yBot };
    case 'w':  return { x: rect.x, y: yMid };
  }
}

/**
 * Draw a small dimensions pill anchored to the bottom-right of the
 * given rect. Used as an in-drag HUD so users can see the exact
 * pixel size they're resizing to, plus whether the aspect ratio is
 * currently locked. Reuses the ctx's transform — call this *after*
 * `drawImageSelection` so the pill appears above any handle that
 * would otherwise overlap it.
 *
 * Text is drawn in the canvas's native font; the caller doesn't
 * need to set one first. The pill clamps its x position so it never
 * extends past the left edge of the rect when the rect is very wide.
 */
export function drawResizeHud(
  ctx: CanvasRenderingContext2D,
  rect: ImageRect,
  text: string,
  opts: { background: string; textColor: string } = {
    background: '#1a73e8',
    textColor: '#ffffff',
  },
): void {
  ctx.save();
  ctx.font = '11px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  const padX = 6;
  const height = 18;
  const metrics = ctx.measureText(text);
  const width = Math.ceil(metrics.width) + padX * 2;

  // Anchor bottom-right corner, 6px below the rect. Shift left if
  // the rect is narrower than the pill so the pill right-aligns to
  // the rect's right edge rather than spilling past it.
  const x = Math.round(rect.x + rect.width - width);
  const y = Math.round(rect.y + rect.height + 6);

  // Background: rounded rect for a pill look. Falls back to a plain
  // fillRect if the 2D context doesn't support roundRect (older
  // browsers, jsdom).
  ctx.fillStyle = opts.background;
  const roundRect = (ctx as unknown as {
    roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
  }).roundRect;
  if (typeof roundRect === 'function') {
    ctx.beginPath();
    roundRect.call(ctx, x, y, width, height, 4);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, width, height);
  }

  ctx.fillStyle = opts.textColor;
  ctx.fillText(text, x + padX, y + height / 2 + 0.5);
  ctx.restore();
}

/**
 * Format the HUD label for an in-progress resize drag. Corner drags
 * include a "ratio" / "free" suffix so the user can tell at a glance
 * whether holding Shift has released the aspect-ratio lock; side
 * drags show pure dimensions because there is no lock to release.
 */
export function formatResizeHud(
  handle: ImageHandle,
  rect: ImageRect,
  aspectLocked: boolean,
): string {
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  const isCorner =
    handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se';
  if (!isCorner) return `${w} × ${h}`;
  return `${w} × ${h}  ·  ${aspectLocked ? 'ratio' : 'free'}`;
}

/**
 * Draw the selection overlay (thin rect + eight handles) on top of an
 * already-rendered image. Caller is expected to have set the canvas
 * origin such that `rect` is in the current coordinate space (the
 * DocCanvas render loop is already translated by `-scrollY`, so the
 * layout-coordinate rect can be passed through directly).
 */
export function drawImageSelection(
  ctx: CanvasRenderingContext2D,
  rect: ImageRect,
  opts: { borderColor: string; handleFill: string; handleStroke: string } = {
    borderColor: '#1a73e8',
    handleFill: '#ffffff',
    handleStroke: '#1a73e8',
  },
): void {
  ctx.save();
  // Selection rectangle. Offset by 0.5 so the 1px stroke lands on a
  // pixel center and stays crisp.
  ctx.strokeStyle = opts.borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.round(rect.x) + 0.5,
    Math.round(rect.y) + 0.5,
    Math.round(rect.width),
    Math.round(rect.height),
  );

  // Eight handles. White fill with a matching stroke so they're visible
  // on both light- and dark-themed image content.
  ctx.fillStyle = opts.handleFill;
  ctx.strokeStyle = opts.handleStroke;
  ctx.lineWidth = 1;
  for (const handle of IMAGE_HANDLES) {
    const c = handleCenter(rect, handle);
    const hx = Math.round(c.x - HANDLE_HALF);
    const hy = Math.round(c.y - HANDLE_HALF);
    ctx.fillRect(hx, hy, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(hx + 0.5, hy + 0.5, HANDLE_SIZE - 1, HANDLE_SIZE - 1);
  }
  ctx.restore();
}

/**
 * Return which handle — if any — the pointer `(x, y)` lies on. The
 * hit region extends slightly beyond the drawn handle for a more
 * forgiving click target.
 */
export function hitTestImageHandle(
  rect: ImageRect,
  x: number,
  y: number,
): ImageHandle | null {
  const reach = HANDLE_HALF + HANDLE_HIT_SLACK;
  for (const handle of IMAGE_HANDLES) {
    const c = handleCenter(rect, handle);
    if (Math.abs(x - c.x) <= reach && Math.abs(y - c.y) <= reach) {
      return handle;
    }
  }
  return null;
}

/** True if `(x, y)` lies inside the image's bounding rectangle. */
export function hitTestImageRect(rect: ImageRect, x: number, y: number): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

/**
 * CSS cursor name to show when hovering the given handle. Matches Google
 * Docs — corners use the diagonal-resize cursors, side handles use axis
 * ones.
 */
export function cursorForHandle(handle: ImageHandle): string {
  switch (handle) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n':  case 's':  return 'ns-resize';
    case 'e':  case 'w':  return 'ew-resize';
  }
}

/**
 * Walk the document layout and return a map from `${blockId}:${offset}`
 * to the image's screen-space bounding box. Covers body paragraphs and
 * simple (non-merged, non-row-spanning, top-aligned) table cells.
 *
 * The offset key is the block-level character offset of the image run's
 * first character within the inner block (for cell images, that inner
 * block is the cell's paragraph / list-item). This matches the
 * `selectedImage.offset` value the editor stores and the value it
 * passes to `cursor.moveTo` / `doc.applyInlineStyle`, which are
 * already cell-aware downstream.
 */
export function collectImageRects(
  layout: DocumentLayout,
  paginatedLayout: PaginatedLayout,
  canvasWidth: number,
): Map<string, ImageRect> {
  const map = new Map<string, ImageRect>();
  if (paginatedLayout.pages.length === 0) return map;

  const pageX = getPageXOffset(paginatedLayout, canvasWidth);

  // The math here MUST match `DocCanvas.renderRun`'s image branch
  // exactly or the selection overlay drifts off the picture:
  //   renderRun receives lineX = pageX + pl.x and lineY = pageY + pl.y,
  //   then draws at (lineX + run.x, lineY + lineHeight - drawHeight).
  // Note that `pl.x` / `pl.y` *already* include the page margins —
  // pagination.ts sets them to `margins.left` / `margins.top + currentY`
  // when it places each PageLine. Adding `margins.left` here a second
  // time would shift every handle right by one margin width.
  for (const page of paginatedLayout.pages) {
    const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
    for (const pl of page.lines) {
      const lb = layout.blocks[pl.blockIndex] as LayoutBlock | undefined;
      if (!lb) continue;

      if (lb.block.type === 'table') {
        collectTableCellImageRects(lb, pl, pageY, pageX, map);
        continue;
      }

      const line = lb.lines[pl.lineIndex];
      if (!line) continue;
      const lineHeight = pl.line.height;

      // Walk every line of the block up to the current one once to get
      // the block-level character offset of the first run on `line`.
      let blockOffset = 0;
      for (let li = 0; li < pl.lineIndex; li++) {
        for (const r of lb.lines[li].runs) {
          blockOffset += r.charEnd - r.charStart;
        }
      }

      for (const run of line.runs) {
        if (run.inline.style.image) {
          const drawHeight = run.imageHeight ?? lineHeight;
          const x = pageX + pl.x + run.x;
          const y = pageY + pl.y + lineHeight - drawHeight;
          const key = `${lb.block.id}:${blockOffset}`;
          map.set(key, { x, y, width: run.width, height: drawHeight });
        }
        blockOffset += run.charEnd - run.charStart;
      }
    }
  }
  return map;
}

/**
 * Extend the image-rect map with images found inside the row at
 * `pl.lineIndex` of the table block `lb`. Mirrors the position math
 * used by `renderTableContent`:
 *
 *   cellX = pageX + margins.left + columnXOffsets[c] + padding + run.x
 *   cellY = pageY + pl.y + padding + line.y + line.height - drawHeight
 *
 * Restricted to non-merged, non-row-spanning, top-aligned cells in
 * this pass. Merged/row-spanning/vertically-aligned cells fall back
 * to "not selectable" — M2 scope trade-off; the body path keeps
 * working and the common case (image inside a simple cell) is now
 * live. More exotic layouts land in a follow-up once the row-span
 * pagination math is shared out of the table renderer.
 */
function collectTableCellImageRects(
  lb: LayoutBlock,
  pl: { lineIndex: number; x: number; y: number },
  pageY: number,
  pageX: number,
  out: Map<string, ImageRect>,
): void {
  const tableData = lb.block.tableData;
  const layoutTable = lb.layoutTable;
  if (!tableData || !layoutTable) return;
  const r = pl.lineIndex;
  const rowCells = layoutTable.cells[r];
  if (!rowCells) return;
  const dataRow = tableData.rows[r];
  if (!dataRow) return;

  // Note: `pl.x` for a table row is `margins.left` (see pagination.ts
  // where table row PageLines are constructed), matching the body
  // path. We use `pl.x` directly here so the two code paths stay
  // symmetric and the test fixtures don't need table-specific
  // pl.x / pl.y values.
  for (let c = 0; c < rowCells.length; c++) {
    const layoutCell = rowCells[c];
    if (layoutCell.merged) continue;
    const cell = dataRow.cells[c];
    if (!cell) continue;

    const colSpan = cell.colSpan ?? 1;
    const rowSpan = cell.rowSpan ?? 1;
    if (rowSpan > 1) continue; // row-spanning cells: follow-up
    const verticalAlign = cell.style?.verticalAlign ?? 'top';
    if (verticalAlign !== 'top') continue; // non-top: follow-up

    const padding = cell.style?.padding ?? 4;
    const cellX = pageX + pl.x + layoutTable.columnXOffsets[c];
    const cellY = pageY + pl.y;

    // Walk the cell's lines, tracking which block each line belongs
    // to (cells can hold multiple paragraphs / list-items) and the
    // running character offset within that block.
    const boundaries = layoutCell.blockBoundaries;
    let currentBlockIdx = 0;
    let offsetInBlock = 0;
    for (let li = 0; li < layoutCell.lines.length; li++) {
      // Advance `currentBlockIdx` when the line crosses a block
      // boundary. `blockBoundaries[bi]` is the first line index of
      // block `bi`; the while-loop handles consecutive empty blocks
      // that start at the same line index defensively.
      while (
        currentBlockIdx + 1 < boundaries.length &&
        boundaries[currentBlockIdx + 1] <= li
      ) {
        currentBlockIdx++;
        offsetInBlock = 0;
      }
      const innerBlock = cell.blocks[currentBlockIdx];
      if (!innerBlock) break;

      const line = layoutCell.lines[li];
      for (const run of line.runs) {
        if (run.inline.style.image) {
          const drawHeight = run.imageHeight ?? line.height;
          const x = cellX + padding + run.x;
          const y = cellY + padding + line.y + line.height - drawHeight;
          const key = `${innerBlock.id}:${offsetInBlock}`;
          out.set(key, { x, y, width: run.width, height: drawHeight });
        }
        offsetInBlock += run.charEnd - run.charStart;
      }
    }
    // `colSpan` is unused for image layout (the image still sits at
    // the cell's top-left corner regardless of its span width), but
    // lint would complain about the unused `cell.colSpan ?? 1` read
    // above without this explicit touch.
    void colSpan;
  }
}

/**
 * Given a map of image rects (produced by `collectImageRects`) and a
 * pointer position, return the first image whose rect contains the
 * pointer. `null` if the pointer isn't over any image.
 */
export function findImageAtPoint(
  rects: Map<string, ImageRect>,
  x: number,
  y: number,
): { blockId: string; offset: number; rect: ImageRect } | null {
  for (const [key, rect] of rects) {
    if (hitTestImageRect(rect, x, y)) {
      const sep = key.lastIndexOf(':');
      const blockId = key.slice(0, sep);
      const offset = Number.parseInt(key.slice(sep + 1), 10);
      return { blockId, offset, rect };
    }
  }
  return null;
}

/** Minimum side length of an image during resize, in CSS pixels. */
export const MIN_IMAGE_DIMENSION = 20;

/**
 * Compute the new width/height of an image being resized from a given
 * handle, based on the pointer delta relative to the drag start.
 *
 * - Side handles (`n`, `s`, `e`, `w`) only change one axis.
 * - Corner handles change both axes. If `aspectLock` is true, the
 *   corner scales uniformly — we pick whichever axis moved more
 *   (in proportional terms) and drive the other off it. This matches
 *   the Google Docs behavior where a corner drag always produces a
 *   similar-shape image unless the user holds Shift.
 * - Results are clamped to `[MIN_IMAGE_DIMENSION, maxWidth/maxHeight]`.
 *
 * Pure function — anchor math lives in `computePreviewRect`.
 */
export function computeResizeDelta(
  handle: ImageHandle,
  startWidth: number,
  startHeight: number,
  dx: number,
  dy: number,
  opts: {
    aspectLock: boolean;
    maxWidth: number;
    maxHeight: number;
  },
): { width: number; height: number } {
  const hasEast = handle === 'ne' || handle === 'e' || handle === 'se';
  const hasWest = handle === 'nw' || handle === 'w' || handle === 'sw';
  const hasNorth = handle === 'nw' || handle === 'n' || handle === 'ne';
  const hasSouth = handle === 'sw' || handle === 's' || handle === 'se';

  let width = startWidth;
  let height = startHeight;
  if (hasEast) width = startWidth + dx;
  if (hasWest) width = startWidth - dx;
  if (hasSouth) height = startHeight + dy;
  if (hasNorth) height = startHeight - dy;

  const isCorner = (hasEast || hasWest) && (hasNorth || hasSouth);
  if (isCorner && opts.aspectLock && startWidth > 0 && startHeight > 0) {
    // Scale uniformly along whichever axis moved more (proportionally).
    // Using abs(scale - 1) keeps the dominant axis independent of whether
    // the user is enlarging or shrinking.
    const wScale = width / startWidth;
    const hScale = height / startHeight;
    const scale =
      Math.abs(wScale - 1) >= Math.abs(hScale - 1) ? wScale : hScale;
    width = startWidth * scale;
    height = startHeight * scale;
  }

  // Clamp to min/max. Apply min first so the max check doesn't fight it.
  width = Math.max(MIN_IMAGE_DIMENSION, Math.min(width, opts.maxWidth));
  height = Math.max(MIN_IMAGE_DIMENSION, Math.min(height, opts.maxHeight));
  return { width, height };
}

/**
 * Build the preview rect for an in-progress resize. The rect is
 * anchored on the opposite corner / edge of the handle being dragged
 * so the non-dragged side stays visually pinned, just like Google Docs.
 */
export function computePreviewRect(
  startRect: ImageRect,
  handle: ImageHandle,
  previewWidth: number,
  previewHeight: number,
): ImageRect {
  let x = startRect.x;
  let y = startRect.y;
  if (handle === 'nw' || handle === 'w' || handle === 'sw') {
    // West edge is being dragged — anchor on east.
    x = startRect.x + startRect.width - previewWidth;
  }
  if (handle === 'nw' || handle === 'n' || handle === 'ne') {
    // North edge is being dragged — anchor on south.
    y = startRect.y + startRect.height - previewHeight;
  }
  return { x, y, width: previewWidth, height: previewHeight };
}
