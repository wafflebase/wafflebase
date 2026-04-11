import type { LayoutTable } from './table-layout.js';
import type { TableData, BorderStyle } from '../model/types.js';
import { DEFAULT_BORDER_STYLE, LIST_INDENT_PX, UNORDERED_MARKERS } from '../model/types.js';
import { Theme, buildFont, ptToPx } from './theme.js';

/**
 * Render a table on the Canvas using pre-computed layout data.
 *
 * Rendering order: cell backgrounds, cell text, borders. This is a
 * convenience facade for tests and single-pass callers — the real
 * editor pipeline uses `renderTableBackgrounds` and
 * `renderTableContent` separately so that the local selection
 * highlight can land between the two passes (otherwise opaque cell
 * backgrounds would cover the translucent selection overlay).
 */
export function renderTable(
  ctx: CanvasRenderingContext2D,
  tableData: TableData,
  tableLayout: LayoutTable,
  tableX: number,
  tableY: number,
  startRow = 0,
  endRow?: number,
): void {
  renderTableBackgrounds(ctx, tableData, tableLayout, tableX, tableY, startRow, endRow);
  renderTableContent(ctx, tableData, tableLayout, tableX, tableY, startRow, endRow);
}

/**
 * First pass of the table render pipeline: fill each cell's background
 * color (if any). Called before the editor draws its selection
 * highlight so the highlight overlays the background instead of being
 * hidden underneath it.
 */
export function renderTableBackgrounds(
  ctx: CanvasRenderingContext2D,
  tableData: TableData,
  tableLayout: LayoutTable,
  tableX: number,
  tableY: number,
  startRow = 0,
  endRow?: number,
  pageStartRow?: number,
): void {
  const { rows } = tableData;
  const { cells, columnXOffsets, columnPixelWidths, rowYOffsets, rowHeights } = tableLayout;

  const numRows = cells.length;
  const numCols = columnPixelWidths.length;
  const rowEnd = endRow ?? numRows;
  const pageStart = pageStartRow ?? startRow;

  for (let r = startRow; r < rowEnd; r++) {
    for (let c = 0; c < numCols; c++) {
      const layoutCell = cells[r][c];
      if (layoutCell.merged) continue;

      const cell = rows[r]?.cells[c];
      if (!cell?.style?.backgroundColor) continue;

      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;

      // Clip the cell to the rows physically rendered on this page so a
      // merged cell split across pages shows its background on each page
      // as if it were a standalone cell.
      const visibleStart = Math.max(r, pageStart);
      const visibleEnd = Math.min(r + rowSpan, rowEnd, numRows);
      if (visibleStart >= visibleEnd) continue;

      let cellWidth = 0;
      for (let s = 0; s < colSpan && c + s < numCols; s++) {
        cellWidth += columnPixelWidths[c + s];
      }

      let visibleHeight = 0;
      for (let rr = visibleStart; rr < visibleEnd; rr++) {
        visibleHeight += rowHeights[rr];
      }

      ctx.fillStyle = cell.style.backgroundColor;
      ctx.fillRect(
        tableX + columnXOffsets[c],
        tableY + rowYOffsets[visibleStart],
        cellWidth,
        visibleHeight,
      );
    }
  }
}

/**
 * Second pass of the table render pipeline: draw cell text (including
 * inline run backgrounds), list markers, and borders. Assumes
 * `renderTableBackgrounds` has already run for the same row range, and
 * that any selection highlight the editor wants under the text has
 * been drawn in between.
 *
 * `pageStartRow` is the first row physically laid out on the current
 * page (normally equal to `startRow`). It differs only for merged cells
 * that span a page break: the caller sweeps `startRow` back to the
 * merge's top-left so the cell gets visited here, but only the lines
 * whose vertical position lies within `[pageStartRow, endRow)` should
 * actually be drawn. Without that filter, merged-cell text is rendered
 * twice (once on each page) and lines near the break appear on both.
 */
export function renderTableContent(
  ctx: CanvasRenderingContext2D,
  tableData: TableData,
  tableLayout: LayoutTable,
  tableX: number,
  tableY: number,
  startRow = 0,
  endRow?: number,
  pageStartRow?: number,
): void {
  const { rows } = tableData;
  const { cells, columnXOffsets, columnPixelWidths, rowYOffsets, rowHeights } = tableLayout;

  const numRows = cells.length;
  const numCols = columnPixelWidths.length;
  const rowEnd = endRow ?? numRows;
  const pageStart = pageStartRow ?? startRow;

  // Map a line to the row it visually belongs to. Used to filter lines
  // of merged cells that cross a page break so each line is drawn on
  // exactly one page.
  const findOwnerRow = (
    r: number,
    rowSpan: number,
    textYOffset: number,
    lineYInCell: number,
    lineHeight: number,
  ): number => {
    const lineCenterInTable =
      rowYOffsets[r] + textYOffset + lineYInCell + lineHeight / 2;
    for (let rr = r; rr < r + rowSpan && rr < numRows; rr++) {
      const top = rowYOffsets[rr];
      const bottom = top + rowHeights[rr];
      if (lineCenterInTable >= top && lineCenterInTable < bottom) {
        return rr;
      }
    }
    // Line center falls past the spanned rows (overflow from a merged
    // cell whose content is taller than its row budget). Attribute it
    // to the last row of the span so it renders on the last page the
    // cell touches.
    return Math.min(r + rowSpan - 1, numRows - 1);
  };

  // 2. Cell text
  for (let r = startRow; r < rowEnd; r++) {
    for (let c = 0; c < numCols; c++) {
      const layoutCell = cells[r][c];
      if (layoutCell.merged) continue;

      const cell = rows[r]?.cells[c];
      if (!cell) continue;

      const padding = cell.style?.padding ?? 4;
      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;

      // A non-merged cell on a swept-back row (r < pageStart) belongs to
      // an earlier page — it was already rendered there, skip it here so
      // the canvas state isn't wasted on clipped draws.
      if (rowSpan === 1 && r < pageStart) continue;

      let cellWidth = 0;
      for (let s = 0; s < colSpan && c + s < numCols; s++) {
        cellWidth += columnPixelWidths[c + s];
      }

      let cellHeight = 0;
      for (let s = 0; s < rowSpan && r + s < numRows; s++) {
        cellHeight += rowHeights[r + s];
      }

      const cellX = tableX + columnXOffsets[c];
      const cellY = tableY + rowYOffsets[r];

      // Compute total text content height for vertical alignment
      const totalTextHeight = layoutCell.lines.reduce((sum, l) => sum + l.height, 0);
      const verticalAlign = cell.style?.verticalAlign ?? 'top';

      let textYOffset: number;
      if (verticalAlign === 'middle') {
        textYOffset = padding + (cellHeight - padding * 2 - totalTextHeight) / 2;
      } else if (verticalAlign === 'bottom') {
        textYOffset = cellHeight - padding - totalTextHeight;
      } else {
        // top
        textYOffset = padding;
      }

      // Render each line's runs
      for (const line of layoutCell.lines) {
        if (rowSpan > 1) {
          const ownerRow = findOwnerRow(r, rowSpan, textYOffset, line.y, line.height);
          if (ownerRow < pageStart || ownerRow >= rowEnd) continue;
        }
        for (const run of line.runs) {
          const style = run.inline.style;
          const fontSize = style.fontSize ?? Theme.defaultFontSize;
          const fontSizePx = ptToPx(fontSize);

          ctx.font = buildFont(
            style.fontSize,
            style.fontFamily,
            style.bold,
            style.italic,
          );
          ctx.fillStyle = style.color ?? Theme.defaultColor;
          ctx.textBaseline = 'alphabetic';

          const runX = cellX + padding + run.x;
          const runLineY = cellY + textYOffset + line.y;
          const baselineY = runLineY + line.height * 0.75;

          // Text background highlight
          if (style.backgroundColor) {
            ctx.save();
            ctx.fillStyle = style.backgroundColor;
            ctx.fillRect(runX, runLineY, run.width, line.height);
            ctx.restore();
            ctx.fillStyle = style.color ?? Theme.defaultColor;
          }

          ctx.fillText(run.text, runX, baselineY);

          // Underline
          if (style.underline) {
            const underlineY = baselineY + 2;
            ctx.beginPath();
            ctx.strokeStyle = style.color ?? Theme.defaultColor;
            ctx.lineWidth = 1;
            ctx.moveTo(runX, underlineY);
            ctx.lineTo(runX + run.width, underlineY);
            ctx.stroke();
          }

          // Strikethrough
          if (style.strikethrough) {
            const strikeY = baselineY - fontSizePx * 0.25;
            ctx.beginPath();
            ctx.strokeStyle = style.color ?? Theme.defaultColor;
            ctx.lineWidth = 1;
            ctx.moveTo(runX, strikeY);
            ctx.lineTo(runX + run.width, strikeY);
            ctx.stroke();
          }
        }
      }

      // Render list markers for list-item blocks in this cell
      const { blockBoundaries } = layoutCell;
      if (cell.blocks && blockBoundaries.length > 0) {
        // Track ordered list counter per level within this cell
        const listCounters = new Map<number, number>();
        for (let bi = 0; bi < cell.blocks.length; bi++) {
          const cellBlock = cell.blocks[bi];
          if (cellBlock.type !== 'list-item') {
            listCounters.clear();
            continue;
          }
          const level = cellBlock.listLevel ?? 0;
          // Reset counters for deeper levels and when kind changes
          for (const [k] of listCounters) {
            if (k > level) listCounters.delete(k);
          }
          if (cellBlock.listKind === 'unordered') {
            listCounters.delete(level);
          }
          const count = cellBlock.listKind === 'ordered'
            ? (listCounters.get(level) ?? 0) + 1
            : 0;
          if (cellBlock.listKind === 'ordered') {
            listCounters.set(level, count);
          }

          const firstLineIdx = blockBoundaries[bi];
          if (firstLineIdx === undefined || firstLineIdx >= layoutCell.lines.length) continue;
          const firstLine = layoutCell.lines[firstLineIdx];

          // Keep the marker on whichever page actually renders the
          // first line of this list-item block.
          if (rowSpan > 1) {
            const ownerRow = findOwnerRow(r, rowSpan, textYOffset, firstLine.y, firstLine.height);
            if (ownerRow < pageStart || ownerRow >= rowEnd) continue;
          }

          const markerIndent = LIST_INDENT_PX * level + LIST_INDENT_PX / 2 - 4;
          const markerX = cellX + padding + markerIndent;
          const markerLineY = cellY + textYOffset + firstLine.y;

          const marker = cellBlock.listKind === 'unordered'
            ? UNORDERED_MARKERS[level % UNORDERED_MARKERS.length]
            : `${count}.`;

          const fontSize = cellBlock.inlines[0]?.style.fontSize ?? Theme.defaultFontSize;
          const fontSizePx = ptToPx(fontSize);
          const baselineY = Math.round(markerLineY + (firstLine.height + fontSizePx * 0.8) / 2);
          ctx.font = buildFont(fontSize, cellBlock.inlines[0]?.style.fontFamily, false, false);
          ctx.fillStyle = cellBlock.inlines[0]?.style.color ?? Theme.defaultColor;
          ctx.fillText(marker, markerX, baselineY);
        }
      }
    }
  }

  // 3. Borders. Clip each cell to the rows physically rendered on this
  // page so a merged cell split by a page break draws a full 4-sided
  // rectangle on each page instead of one half-open shape per page.
  for (let r = startRow; r < rowEnd; r++) {
    for (let c = 0; c < numCols; c++) {
      const layoutCell = cells[r][c];
      if (layoutCell.merged) continue;

      const cell = rows[r]?.cells[c];
      if (!cell) continue;

      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;

      const visibleStart = Math.max(r, pageStart);
      const visibleEnd = Math.min(r + rowSpan, rowEnd, numRows);
      if (visibleStart >= visibleEnd) continue;

      let cellWidth = 0;
      for (let s = 0; s < colSpan && c + s < numCols; s++) {
        cellWidth += columnPixelWidths[c + s];
      }

      let visibleHeight = 0;
      for (let rr = visibleStart; rr < visibleEnd; rr++) {
        visibleHeight += rowHeights[rr];
      }

      const x = tableX + columnXOffsets[c];
      const y = tableY + rowYOffsets[visibleStart];

      // Use theme-aware default border color so borders adapt to dark mode
      const themeBorder: BorderStyle = { ...DEFAULT_BORDER_STYLE, color: Theme.defaultColor };
      drawBorder(ctx, cell.style?.borderTop ?? themeBorder, x, y, x + cellWidth, y);
      drawBorder(ctx, cell.style?.borderBottom ?? themeBorder, x, y + visibleHeight, x + cellWidth, y + visibleHeight);
      drawBorder(ctx, cell.style?.borderLeft ?? themeBorder, x, y, x, y + visibleHeight);
      drawBorder(ctx, cell.style?.borderRight ?? themeBorder, x + cellWidth, y, x + cellWidth, y + visibleHeight);
    }
  }
}

/**
 * Draw a single border line if its style is not 'none'.
 */
function drawBorder(
  ctx: CanvasRenderingContext2D,
  border: BorderStyle,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (border.style === 'none') return;

  ctx.beginPath();
  ctx.strokeStyle = border.color;
  ctx.lineWidth = border.width;
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
