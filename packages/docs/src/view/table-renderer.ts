import type { LayoutTable } from './table-layout.js';
import type { TableData, BorderStyle } from '../model/types.js';
import { DEFAULT_BORDER_STYLE } from '../model/types.js';
import { Theme, buildFont, ptToPx } from './theme.js';

/**
 * Render a table on the Canvas using pre-computed layout data.
 *
 * Rendering order: cell backgrounds, cell text, borders.
 */
export function renderTable(
  ctx: CanvasRenderingContext2D,
  tableData: TableData,
  tableLayout: LayoutTable,
  tableX: number,
  tableY: number,
): void {
  const { rows } = tableData;
  const { cells, columnXOffsets, columnPixelWidths, rowYOffsets, rowHeights } = tableLayout;

  const numRows = cells.length;
  const numCols = columnPixelWidths.length;

  // 1. Cell backgrounds
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const layoutCell = cells[r][c];
      if (layoutCell.merged) continue;

      const cell = rows[r]?.cells[c];
      if (!cell?.style?.backgroundColor) continue;

      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;

      let cellWidth = 0;
      for (let s = 0; s < colSpan && c + s < numCols; s++) {
        cellWidth += columnPixelWidths[c + s];
      }

      let cellHeight = 0;
      for (let s = 0; s < rowSpan && r + s < numRows; s++) {
        cellHeight += rowHeights[r + s];
      }

      ctx.fillStyle = cell.style.backgroundColor;
      ctx.fillRect(
        tableX + columnXOffsets[c],
        tableY + rowYOffsets[r],
        cellWidth,
        cellHeight,
      );
    }
  }

  // 2. Cell text
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const layoutCell = cells[r][c];
      if (layoutCell.merged) continue;

      const cell = rows[r]?.cells[c];
      if (!cell) continue;

      const padding = cell.style?.padding ?? 4;
      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;

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
    }
  }

  // 3. Borders
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const layoutCell = cells[r][c];
      if (layoutCell.merged) continue;

      const cell = rows[r]?.cells[c];
      if (!cell) continue;

      const colSpan = cell.colSpan ?? 1;
      const rowSpan = cell.rowSpan ?? 1;

      let cellWidth = 0;
      for (let s = 0; s < colSpan && c + s < numCols; s++) {
        cellWidth += columnPixelWidths[c + s];
      }

      let cellHeight = 0;
      for (let s = 0; s < rowSpan && r + s < numRows; s++) {
        cellHeight += rowHeights[r + s];
      }

      const x = tableX + columnXOffsets[c];
      const y = tableY + rowYOffsets[r];

      // Use theme-aware default border color so borders adapt to dark mode
      const themeBorder: BorderStyle = { ...DEFAULT_BORDER_STYLE, color: Theme.defaultColor };
      drawBorder(ctx, cell.style?.borderTop ?? themeBorder, x, y, x + cellWidth, y);
      drawBorder(ctx, cell.style?.borderBottom ?? themeBorder, x, y + cellHeight, x + cellWidth, y + cellHeight);
      drawBorder(ctx, cell.style?.borderLeft ?? themeBorder, x, y, x, y + cellHeight);
      drawBorder(ctx, cell.style?.borderRight ?? themeBorder, x + cellWidth, y, x + cellWidth, y + cellHeight);
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
