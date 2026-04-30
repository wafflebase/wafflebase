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

import { PDFPage, rgb } from 'pdf-lib';
import type { LayoutPage, PageLine } from '../view/pagination.js';
import type { LayoutBlock } from '../view/layout.js';
import type { TableCell, BorderStyle } from '../model/types.js';
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
 * Caller-supplied paint hook for a single cell's content. Task 4.2
 * leaves this empty (background + borders only); Task 4.3 will fill it
 * in by recursively painting the cell's `block.blocks`.
 */
export type PaintCellContent = (cell: TableCell, rect: CellRect) => void;

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
  const tableX = pl.x;
  const tableY = pl.y - layoutTable.rowYOffsets[pl.lineIndex];

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
      const { x, y, w, h } = cellOriginPx(layoutTable, tableData, r, c);
      paintCellContent(cells[c], {
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
  drawEdge(page, cellStyle?.borderTop, x, y, x + w, y, pageHeightPt);
  drawEdge(page, cellStyle?.borderBottom, x, y + h, x + w, y + h, pageHeightPt);
  drawEdge(page, cellStyle?.borderLeft, x, y, x, y + h, pageHeightPt);
  drawEdge(page, cellStyle?.borderRight, x + w, y, x + w, y + h, pageHeightPt);
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
