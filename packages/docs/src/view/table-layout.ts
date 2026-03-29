import type { TableData, Inline, Block, BlockCellInfo } from '../model/types.js';
import { LIST_INDENT_PX } from '../model/types.js';
import type { LayoutLine } from './layout.js';
import { cachedMeasureText, applyAlignment } from './layout.js';
import { buildFont, ptToPx, Theme } from './theme.js';

export interface LayoutTableCell {
  lines: LayoutLine[];
  blockBoundaries: number[];
  width: number;
  height: number;
  merged: boolean;
}

export interface LayoutTable {
  cells: LayoutTableCell[][]; // [row][col]
  columnXOffsets: number[];
  columnPixelWidths: number[];
  rowYOffsets: number[];
  rowHeights: number[];
  totalWidth: number;
  totalHeight: number;
  blockParentMap: Map<string, BlockCellInfo>;
}

const DEFAULT_CELL_PADDING = 4;
const MIN_ROW_HEIGHT = 20;

/**
 * Layout inlines within a table cell into wrapped lines.
 */
function layoutCellInlines(
  inlines: Inline[],
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): LayoutLine[] {
  if (inlines.length === 0) {
    const defaultHeight = ptToPx(Theme.defaultFontSize) * 1.5;
    return [{ runs: [], y: 0, height: defaultHeight, width: 0 }];
  }

  // Check if all inlines are empty text
  const totalText = inlines.reduce((s, i) => s + i.text, '');
  if (totalText.length === 0) {
    const fontSize = inlines[0]?.style.fontSize ?? Theme.defaultFontSize;
    const defaultHeight = ptToPx(fontSize) * 1.5;
    return [{ runs: [], y: 0, height: defaultHeight, width: 0 }];
  }

  const lines: LayoutLine[] = [];
  let currentRuns: LayoutLine['runs'] = [];
  let lineWidth = 0;
  let lineMaxFontSize = 0;

  for (let i = 0; i < inlines.length; i++) {
    const inline = inlines[i];
    const fontSize = inline.style.fontSize ?? Theme.defaultFontSize;
    const fontSizePx = ptToPx(fontSize);
    const font = buildFont(
      inline.style.fontSize,
      inline.style.fontFamily,
      inline.style.bold,
      inline.style.italic,
    );

    // Split text into words (keep trailing spaces with preceding word)
    const words = splitWords(inline.text);
    let charPos = 0;

    for (const word of words) {
      const wordWidth = cachedMeasureText(ctx, word, font);

      // Wrap if adding this word exceeds maxWidth and line is not empty
      if (lineWidth + wordWidth > maxWidth && currentRuns.length > 0) {
        const lineHeight = (lineMaxFontSize || fontSizePx) * 1.5;
        lines.push({
          runs: currentRuns,
          y: 0,
          height: lineHeight,
          width: lineWidth,
        });
        currentRuns = [];
        lineWidth = 0;
        lineMaxFontSize = 0;
      }

      currentRuns.push({
        inline,
        text: word,
        x: lineWidth,
        width: wordWidth,
        inlineIndex: i,
        charStart: charPos,
        charEnd: charPos + word.length,
      });
      lineWidth += wordWidth;
      if (fontSizePx > lineMaxFontSize) lineMaxFontSize = fontSizePx;
      charPos += word.length;
    }
  }

  // Flush remaining runs
  if (currentRuns.length > 0) {
    const defaultFontSizePx = ptToPx(Theme.defaultFontSize);
    const lineHeight = (lineMaxFontSize || defaultFontSizePx) * 1.5;
    lines.push({
      runs: currentRuns,
      y: 0,
      height: lineHeight,
      width: lineWidth,
    });
  }

  // Set cumulative y offsets
  let y = 0;
  for (const line of lines) {
    line.y = y;
    y += line.height;
  }

  return lines;
}

/**
 * Split text into words, keeping trailing spaces with the word.
 */
function splitWords(text: string): string[] {
  if (text.length === 0) return [];
  const words: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    current += text[i];
    if (text[i] === ' ' && i + 1 < text.length && text[i + 1] !== ' ') {
      words.push(current);
      current = '';
    }
  }
  if (current.length > 0) words.push(current);
  return words;
}

/**
 * Layout blocks within a table cell into wrapped lines.
 * Returns lines and blockBoundaries (line index where each block starts).
 */
function layoutCellBlocks(
  blocks: Block[],
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): { lines: LayoutLine[]; blockBoundaries: number[] } {
  if (blocks.length === 0) {
    const defaultHeight = ptToPx(Theme.defaultFontSize) * 1.5;
    return {
      lines: [{ runs: [], y: 0, height: defaultHeight, width: 0 }],
      blockBoundaries: [0],
    };
  }

  const allLines: LayoutLine[] = [];
  const blockBoundaries: number[] = [];

  for (const block of blocks) {
    blockBoundaries.push(allLines.length);
    // Reserve space for list marker indent
    const listIndent = block.type === 'list-item'
      ? LIST_INDENT_PX * ((block.listLevel ?? 0) + 1)
      : 0;
    const effectiveWidth = maxWidth - listIndent;
    const blockLines = layoutCellInlines(block.inlines, ctx, effectiveWidth);
    // Apply horizontal alignment
    const alignment = block.style?.alignment ?? 'left';
    for (let li = 0; li < blockLines.length; li++) {
      applyAlignment(blockLines[li], effectiveWidth, alignment, li === blockLines.length - 1);
    }
    // Shift runs right by the list indent
    if (listIndent > 0) {
      for (const line of blockLines) {
        for (const run of line.runs) {
          run.x += listIndent;
        }
        line.width += listIndent;
      }
    }
    allLines.push(...blockLines);
  }

  // Recalculate cumulative y offsets
  let y = 0;
  for (const line of allLines) {
    line.y = y;
    y += line.height;
  }

  return { lines: allLines, blockBoundaries };
}

/**
 * Compute the spatial layout of a table.
 */
export function computeTableLayout(
  tableData: TableData,
  tableBlockId: string,
  ctx: CanvasRenderingContext2D,
  contentWidth: number,
): LayoutTable {
  const { rows, columnWidths } = tableData;
  const numCols = columnWidths.length;
  const numRows = rows.length;

  // 1. Convert column width ratios to pixel widths
  const columnPixelWidths = columnWidths.map((ratio) => ratio * contentWidth);

  // 2. Compute column X offsets (cumulative sum)
  const columnXOffsets: number[] = [];
  let xOffset = 0;
  for (let c = 0; c < numCols; c++) {
    columnXOffsets.push(xOffset);
    xOffset += columnPixelWidths[c];
  }

  // 3. Layout each cell
  const cells: LayoutTableCell[][] = [];
  for (let r = 0; r < numRows; r++) {
    const row = rows[r];
    const cellRow: LayoutTableCell[] = [];
    for (let c = 0; c < numCols; c++) {
      const cell = row.cells[c];
      const colSpan = cell?.colSpan ?? 1;

      if (colSpan === 0) {
        // Merged cell placeholder
        cellRow.push({ lines: [], blockBoundaries: [], width: 0, height: 0, merged: true });
        continue;
      }

      // Compute cell width as sum of spanned columns
      let cellWidth = 0;
      for (let s = 0; s < colSpan && c + s < numCols; s++) {
        cellWidth += columnPixelWidths[c + s];
      }

      const padding = cell?.style?.padding ?? DEFAULT_CELL_PADDING;
      const innerWidth = Math.max(cellWidth - padding * 2, 0);

      const { lines, blockBoundaries } = layoutCellBlocks(cell?.blocks ?? [], ctx, innerWidth);
      const cellHeight = lines.reduce((sum, l) => sum + l.height, 0) + padding * 2;

      cellRow.push({ lines, blockBoundaries, width: cellWidth, height: cellHeight, merged: false });
    }
    cells.push(cellRow);
  }

  // 4. Compute row heights: max cell height per row
  const rowHeights: number[] = new Array(numRows).fill(0);

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cell = cells[r][c];
      if (cell.merged) continue;

      const rowSpan = rows[r].cells[c]?.rowSpan ?? 1;
      if (rowSpan === 1) {
        rowHeights[r] = Math.max(rowHeights[r], cell.height);
      }
    }
  }

  // Handle rowSpan > 1: distribute extra height to the last spanned row
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cell = cells[r][c];
      if (cell.merged) continue;

      const rowSpan = rows[r].cells[c]?.rowSpan ?? 1;
      if (rowSpan > 1) {
        const lastRow = Math.min(r + rowSpan - 1, numRows - 1);
        let spannedHeight = 0;
        for (let sr = r; sr <= lastRow; sr++) {
          spannedHeight += rowHeights[sr];
        }
        if (cell.height > spannedHeight) {
          rowHeights[lastRow] += cell.height - spannedHeight;
        }
      }
    }
  }

  // 5. Ensure MIN_ROW_HEIGHT for each row
  for (let r = 0; r < numRows; r++) {
    if (rowHeights[r] < MIN_ROW_HEIGHT) {
      rowHeights[r] = MIN_ROW_HEIGHT;
    }
  }

  // 6. Compute row Y offsets (cumulative sum)
  const rowYOffsets: number[] = [];
  let yOffset = 0;
  for (let r = 0; r < numRows; r++) {
    rowYOffsets.push(yOffset);
    yOffset += rowHeights[r];
  }

  // 7. Build BlockParentMap
  const blockParentMap = new Map<string, BlockCellInfo>();
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cell = rows[r]?.cells[c];
      if (!cell || (cell.colSpan === 0)) continue;
      for (const block of cell.blocks) {
        blockParentMap.set(block.id, { tableBlockId, rowIndex: r, colIndex: c });
      }
    }
  }

  // 8. Return LayoutTable
  const totalWidth = columnPixelWidths.reduce((sum, w) => sum + w, 0);
  const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0);

  return {
    cells,
    columnXOffsets,
    columnPixelWidths,
    rowYOffsets,
    rowHeights,
    totalWidth,
    totalHeight,
    blockParentMap,
  };
}
