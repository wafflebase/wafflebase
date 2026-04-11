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
): void {
  const { rows } = tableData;
  const { cells, columnXOffsets, columnPixelWidths, rowYOffsets, rowHeights } = tableLayout;

  const numRows = cells.length;
  const numCols = columnPixelWidths.length;
  const rowEnd = endRow ?? numRows;

  for (let r = startRow; r < rowEnd; r++) {
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
}

/**
 * Second pass of the table render pipeline: draw cell text (including
 * inline run backgrounds), list markers, and borders. Assumes
 * `renderTableBackgrounds` has already run for the same row range, and
 * that any selection highlight the editor wants under the text has
 * been drawn in between.
 */
export function renderTableContent(
  ctx: CanvasRenderingContext2D,
  tableData: TableData,
  tableLayout: LayoutTable,
  tableX: number,
  tableY: number,
  startRow = 0,
  endRow?: number,
): void {
  const { rows } = tableData;
  const { cells, columnXOffsets, columnPixelWidths, rowYOffsets, rowHeights } = tableLayout;

  const numRows = cells.length;
  const numCols = columnPixelWidths.length;
  const rowEnd = endRow ?? numRows;

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

  // 3. Borders
  for (let r = startRow; r < rowEnd; r++) {
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
