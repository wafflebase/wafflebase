// Paint table chrome (cell backgrounds + borders) onto a `PDFPage`.
//
// Mirrors the canvas-side `renderTableBackgrounds` + border pass in
// `view/table-renderer.ts` so both renderers place rectangles and lines
// at byte-identical coordinates. Cell *content* (recursive paint of the
// blocks inside each cell) is delegated back to the caller via the
// `paintCellContent` callback so this module stays focused on chrome
// and doesn't depend on the body painter's `paintLine` machinery.
//
// Range walking (start row, end row, merged-cell skip) is shared with the
// canvas renderer through `view/table-geometry.ts`, so any change to the
// row-range semantics applies to both backends.

import {
  PDFPage, rgb,
  pushGraphicsState, popGraphicsState,
  rectangle, clip, endPath,
} from 'pdf-lib';
import type { LayoutPage, PageLine } from '../view/pagination.js';
import type { LayoutBlock } from '../view/layout.js';
import type { LayoutTable, LayoutTableCell } from '../view/table-layout.js';
import type { TableCell, BorderStyle } from '../model/types.js';
import { DEFAULT_BORDER_STYLE } from '../model/types.js';
import {
  computeTableRangeForPageLine,
  cellOriginPx,
  isCellCovered,
} from '../view/table-geometry.js';
import { styleColor } from './pdf-style-map.js';

const PX_PER_PT = 96 / 72;
const px2pt = (px: number) => px / PX_PER_PT;

/**
 * Rectangle of a cell on a page, in *page-local* pixel coordinates
 * (table origin already added). Passed to `paintCellContent` so the
 * caller can recursively paint blocks at the right position without
 * having to redo the table-logical → page-local translation.
 */
export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Caller-supplied paint hook for a single cell's content. Receives the
 * cell's data (`TableCell`), its already-computed layout
 * (`LayoutTableCell`), the parent `LayoutTable` (for `rowYOffsets` /
 * `rowHeights` lookups when distributing merged-cell lines), the
 * row/col indices, and the cell's page-local rect.
 */
export type PaintCellContent = (
  cell: TableCell,
  layoutCell: LayoutTableCell,
  layoutTable: LayoutTable,
  row: number,
  col: number,
  rect: CellRect,
) => void;

/**
 * Paint the chrome (backgrounds, then borders) for a contiguous span of
 * `PageLine`s that all belong to the same table block on this page. The
 * caller is responsible for spotting the *first* PageLine of the table
 * fragment on the page and skipping ahead by `range.endRowIndex -
 * range.pageStartRow` so this function isn't called once per row.
 */
export function paintTablePageRange(
  page: PDFPage,
  layoutPage: LayoutPage,
  pl: PageLine,
  plIndex: number,
  layoutBlock: LayoutBlock,
  pageHeightPt: number,
  paintCellContent: PaintCellContent,
): void {
  const tableData = layoutBlock.block.tableData;
  const layoutTable = layoutBlock.layoutTable;
  if (!tableData || !layoutTable) return;

  const range = computeTableRangeForPageLine(
    layoutPage, layoutBlock, pl, plIndex,
  );

  // Table origin in page-local pixel coordinates: `pl.x` is the left
  // page margin (the table's x), `pl.y` is the table-row's page-local
  // y for the first PageLine, but the table-logical y is `tl.rowYOffsets[
  // pl.lineIndex]`. Subtracting gives the page-local y of the table's
  // top edge — which is what `cellOriginPx` returns relative to.
  //
  // For split-row fragments, `pl.y` refers to the top of the fragment on
  // this page; the row's content actually starts `rowSplitOffset` pixels
  // above that. Subtract it so that table-logical Y of `rowSplitOffset`
  // maps to `pl.y` on the page. A clip rectangle below hides the parts of
  // the row that fall outside this fragment.
  const splitOffset = pl.rowSplitOffset ?? 0;
  const splitHeight = pl.rowSplitHeight;
  const tableX = pl.x;
  const tableY = pl.y - layoutTable.rowYOffsets[pl.lineIndex] - splitOffset;

  // For split fragments, install a PDF clip path covering only the
  // fragment's vertical band on the page. Backgrounds, content, and
  // borders that extend past the band (the parts of the row that belong
  // on adjacent pages) get clipped away — matching the Canvas
  // `ctx.clip()` pass in `renderTableBackgrounds` / `renderTableContent`.
  const isSplit = pl.rowSplitOffset !== undefined && splitHeight !== undefined;
  if (isSplit) {
    const clipXpt = px2pt(pl.x);
    const clipYpt = pageHeightPt - px2pt(pl.y + splitHeight);
    const clipWpt = px2pt(layoutTable.totalWidth);
    const clipHpt = px2pt(splitHeight);
    page.pushOperators(
      pushGraphicsState(),
      rectangle(clipXpt, clipYpt, clipWpt, clipHpt),
      clip(),
      endPath(),
    );
  }

  // 1. Backgrounds first so cell text and borders draw over them.
  for (let r = range.renderStartRow; r < range.endRowIndex; r++) {
    const cells = tableData.rows[r]?.cells ?? [];
    for (let c = 0; c < cells.length; c++) {
      if (isCellCovered(layoutTable, r, c)) continue;
      const cell = cells[c];
      if (!cell.style?.backgroundColor) continue;

      const { x, y, w, h } = cellOriginPx(layoutTable, tableData, r, c);
      const px = tableX + x;
      const py = tableY + y;
      const bg = styleColor(cell.style.backgroundColor);
      page.drawRectangle({
        x: px2pt(px),
        y: pageHeightPt - px2pt(py + h),
        width: px2pt(w),
        height: px2pt(h),
        color: rgb(bg.r, bg.g, bg.b),
      });
    }
  }

  // 2. Cell content (delegated). Painting content before borders means a
  // border drawn on the cell edge sits on top of any text that grazes
  // it — matching the canvas renderer's order in `renderTable`.
  for (let r = range.renderStartRow; r < range.endRowIndex; r++) {
    const cells = tableData.rows[r]?.cells ?? [];
    for (let c = 0; c < cells.length; c++) {
      if (isCellCovered(layoutTable, r, c)) continue;
      const layoutCell = layoutTable.cells[r]?.[c];
      if (!layoutCell) continue;
      const { x, y, w, h } = cellOriginPx(layoutTable, tableData, r, c);
      paintCellContent(cells[c], layoutCell, layoutTable, r, c, {
        x: tableX + x,
        y: tableY + y,
        w,
        h,
      });
    }
  }

  // 3. Borders last so they sit on top of fills and content.
  for (let r = range.renderStartRow; r < range.endRowIndex; r++) {
    const cells = tableData.rows[r]?.cells ?? [];
    for (let c = 0; c < cells.length; c++) {
      if (isCellCovered(layoutTable, r, c)) continue;
      const cell = cells[c];
      const { x, y, w, h } = cellOriginPx(layoutTable, tableData, r, c);
      drawCellBorders(
        page,
        cell.style,
        tableX + x,
        tableY + y,
        w,
        h,
        pageHeightPt,
      );
    }
  }

  if (isSplit) {
    page.pushOperators(popGraphicsState());
  }
}

/**
 * Draw the four border edges for a cell. Each edge is a separate line
 * so per-edge `BorderStyle` overrides (e.g. only-bottom, dashed-top
 * later) compose without re-drawing the rectangle. Edges with
 * `style: 'none'` are skipped — matching `drawBorder` in
 * `table-renderer.ts`.
 */
function drawCellBorders(
  page: PDFPage,
  cellStyle: TableCell['style'] | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  pageHeightPt: number,
): void {
  // Fall back to the theme default (1px black solid) when a cell omits
  // an explicit border, matching `view/table-renderer.ts:481-485`. Without
  // this fallback, tables built without per-cell border configuration —
  // i.e., the default insertion case — render as invisible grids in PDF.
  const fb = DEFAULT_BORDER_STYLE;
  drawEdge(page, cellStyle?.borderTop ?? fb,    x,     y,     x + w, y,     pageHeightPt);
  drawEdge(page, cellStyle?.borderBottom ?? fb, x,     y + h, x + w, y + h, pageHeightPt);
  drawEdge(page, cellStyle?.borderLeft ?? fb,   x,     y,     x,     y + h, pageHeightPt);
  drawEdge(page, cellStyle?.borderRight ?? fb,  x + w, y,     x + w, y + h, pageHeightPt);
}

function drawEdge(
  page: PDFPage,
  border: BorderStyle | undefined,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pageHeightPt: number,
): void {
  if (!border || border.style === 'none') return;
  const c = styleColor(border.color);
  // Border widths in the model are in CSS pixels; convert to points and
  // floor at a hairline so a `width: 1` doesn't visually disappear.
  const thicknessPt = Math.max(0.25, border.width / PX_PER_PT);
  page.drawLine({
    start: { x: px2pt(x1), y: pageHeightPt - px2pt(y1) },
    end: { x: px2pt(x2), y: pageHeightPt - px2pt(y2) },
    thickness: thicknessPt,
    color: rgb(c.r, c.g, c.b),
  });
}
