import type { TableData, Inline, Block, BlockCellInfo } from '../model/types.js';
import { LIST_INDENT_PX } from '../model/types.js';
import type { LayoutLine } from './layout.js';
import { cachedMeasureText, applyAlignment, computeCharOffsets } from './layout.js';
import { buildFont, ptToPx, Theme } from './theme.js';
import { computeMergedCellLineLayouts } from './table-renderer.js';

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
  // Tallest image on the current line, in pixels. Tracked separately from
  // lineMaxFontSize so it is not multiplied by the 1.5 text line-height
  // factor — the final line height is max(textHeight, imageHeight).
  let lineMaxImageHeight = 0;

  const flushCurrentLine = (fallbackFontSizePx: number) => {
    const textLineHeight = (lineMaxFontSize || fallbackFontSizePx) * 1.5;
    const lineHeight = Math.max(textLineHeight, lineMaxImageHeight);
    lines.push({
      runs: currentRuns,
      y: 0,
      height: lineHeight,
      width: lineWidth,
    });
    currentRuns = [];
    lineWidth = 0;
    lineMaxFontSize = 0;
    lineMaxImageHeight = 0;
  };

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

    // Image inlines are a single unbreakable run. Scale down to fit the
    // cell width if necessary, and force line height to accommodate the
    // image. Mirrors the image path in layoutBlock / measureSegments.
    if (inline.style.image) {
      const image = inline.style.image;
      let displayWidth = image.width;
      let displayHeight = image.height;
      if (maxWidth > 0 && displayWidth > maxWidth) {
        const scale = maxWidth / displayWidth;
        displayWidth = maxWidth;
        displayHeight = image.height * scale;
      }
      // Wrap to next line if the scaled image won't fit next to existing runs.
      if (lineWidth + displayWidth > maxWidth && currentRuns.length > 0) {
        flushCurrentLine(fontSizePx);
      }
      currentRuns.push({
        inline,
        text: inline.text,
        x: lineWidth,
        width: displayWidth,
        inlineIndex: i,
        charStart: 0,
        charEnd: inline.text.length,
        // Single-character placeholder: charOffsets has one entry equal to width.
        charOffsets: inline.text.length > 0 ? [displayWidth] : [],
        imageHeight: displayHeight,
      });
      lineWidth += displayWidth;
      if (displayHeight > lineMaxImageHeight) lineMaxImageHeight = displayHeight;
      continue;
    }

    // Split text into words (keep trailing spaces with preceding word)
    const words = splitWords(inline.text);
    let charPos = 0;

    for (const word of words) {
      const wordWidth = cachedMeasureText(ctx, word, font);

      // Wrap if adding this word exceeds maxWidth and line is not empty
      if (lineWidth + wordWidth > maxWidth && currentRuns.length > 0) {
        flushCurrentLine(fontSizePx);
      }

      // Character-level break: if a single word is wider than maxWidth,
      // split it into chunks that fit. This prevents text from
      // overflowing cell boundaries (matches Google Docs behavior).
      if (wordWidth > maxWidth && maxWidth > 0) {
        let remaining = word;
        let remainCharPos = charPos;
        while (remaining.length > 0) {
          // Find how many characters fit in the remaining line width
          const availWidth = maxWidth - lineWidth;
          let fitLen = 0;
          let fitWidth = 0;
          for (let ci = 1; ci <= remaining.length; ci++) {
            const w = cachedMeasureText(ctx, remaining.slice(0, ci), font);
            if (w > availWidth && fitLen > 0) break;
            fitLen = ci;
            fitWidth = w;
          }
          // At least one character per chunk to avoid infinite loop
          if (fitLen === 0) {
            fitLen = 1;
            fitWidth = cachedMeasureText(ctx, remaining.slice(0, 1), font);
          }
          const chunk = remaining.slice(0, fitLen);
          currentRuns.push({
            inline,
            text: chunk,
            x: lineWidth,
            width: fitWidth,
            inlineIndex: i,
            charStart: remainCharPos,
            charEnd: remainCharPos + chunk.length,
            charOffsets: computeCharOffsets(ctx, chunk, font),
          });
          lineWidth += fitWidth;
          if (fontSizePx > lineMaxFontSize) lineMaxFontSize = fontSizePx;
          remainCharPos += chunk.length;
          remaining = remaining.slice(fitLen);
          if (remaining.length > 0) {
            flushCurrentLine(fontSizePx);
          }
        }
        charPos = remainCharPos;
        continue;
      }

      currentRuns.push({
        inline,
        text: word,
        x: lineWidth,
        width: wordWidth,
        inlineIndex: i,
        charStart: charPos,
        charEnd: charPos + word.length,
        charOffsets: computeCharOffsets(ctx, word, font),
      });
      lineWidth += wordWidth;
      if (fontSizePx > lineMaxFontSize) lineMaxFontSize = fontSizePx;
      charPos += word.length;
    }
  }

  // Flush remaining runs
  if (currentRuns.length > 0) {
    flushCurrentLine(ptToPx(Theme.defaultFontSize));
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
  blockParentMap?: Map<string, BlockCellInfo>,
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

    // Handle nested table blocks
    if (block.type === 'table' && block.tableData) {
      const nestedLayout = computeTableLayout(
        block.tableData, block.id, ctx, maxWidth,
      );
      // Merge inner blockParentMap into outer
      if (blockParentMap) {
        for (const [k, v] of nestedLayout.blockParentMap) {
          blockParentMap.set(k, v);
        }
      }
      const tableLine: LayoutLine = {
        runs: [],
        y: 0,
        height: nestedLayout.totalHeight,
        width: nestedLayout.totalWidth,
        nestedTable: nestedLayout,
      };
      allLines.push(tableLine);
      continue;
    }

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
  const blockParentMap = new Map<string, BlockCellInfo>();
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

      const { lines, blockBoundaries } = layoutCellBlocks(cell?.blocks ?? [], ctx, innerWidth, blockParentMap);
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

  // 5b. Apply user-specified row heights as minimums
  if (tableData.rowHeights) {
    for (let r = 0; r < numRows; r++) {
      const userHeight = tableData.rowHeights[r];
      if (userHeight !== undefined && userHeight > rowHeights[r]) {
        rowHeights[r] = userHeight;
      }
    }
  }

  // 5c. Grow rows that overflow due to merged-cell content redistribution.
  // computeMergedCellLineLayouts (used at render time) pushes lines from
  // shorter rows into later rows. When staggered merges make an
  // intermediate row short, all content may pile into the last spanned
  // row whose height was calculated without that extra load. Simulate
  // the redistribution here and grow the receiving row as needed.
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cell = cells[r][c];
      if (cell.merged) continue;
      const rowSpan = rows[r].cells[c]?.rowSpan ?? 1;
      if (rowSpan <= 1) continue;

      const padding = rows[r].cells[c]?.style?.padding ?? DEFAULT_CELL_PADDING;
      const spanEnd = Math.min(r + rowSpan, numRows);

      // Simulate the line redistribution (mirrors computeMergedCellLineLayouts)
      let curRow = r;
      let yInRow = padding;

      for (const line of cell.lines) {
        if (
          curRow + 1 < spanEnd &&
          yInRow + line.height > rowHeights[curRow] - padding
        ) {
          curRow++;
          yInRow = padding;
        }
        yInRow += line.height;
      }

      // Ensure the last receiving row has enough height
      const needed = yInRow + padding;
      if (needed > rowHeights[curRow]) {
        rowHeights[curRow] = needed;
      }
    }
  }

  // 6. Compute row Y offsets (cumulative sum)
  const rowYOffsets: number[] = [];
  let yOffset = 0;
  for (let r = 0; r < numRows; r++) {
    rowYOffsets.push(yOffset);
    yOffset += rowHeights[r];
  }

  // 7. Register direct-child blocks in BlockParentMap
  // (nested table blocks are already merged by layoutCellBlocks)
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

/**
 * Result of resolving a nested table's layout context.
 */
export interface ResolvedNestedTable {
  /** The top-level LayoutBlock containing this table. */
  lb: { block: Block; layoutTable: LayoutTable; blockIndex: number };
  /** The LayoutTable for the target table (may be the top-level or inner). */
  layoutTable: LayoutTable;
  /** The data Block for the target table. */
  dataBlock: Block;
  /** Accumulated X offset from the top-level table origin. */
  xOffset: number;
  /** Accumulated Y offset from the top-level table origin (table-logical). */
  yOffset: number;
  /** The row index of the outermost nesting level (for paginated Y lookup). */
  outerRowIndex: number;
}

/**
 * Resolve a (possibly nested) table block ID to its LayoutTable and
 * accumulated coordinate offsets from the top-level layout block.
 *
 * For a top-level table, xOffset and yOffset are 0.
 * For nested tables, they accumulate cell padding and line offsets at each level.
 */
export function resolveNestedTableLayout(
  tableBlockId: string,
  layout: { blocks: Array<{ block: Block; layoutTable?: LayoutTable }>; blockParentMap: Map<string, BlockCellInfo> },
): ResolvedNestedTable | undefined {
  // Walk up to find the top-level table
  let topTableId = tableBlockId;
  while (true) {
    const parentInfo = layout.blockParentMap.get(topTableId);
    if (!parentInfo) break;
    topTableId = parentInfo.tableBlockId;
  }

  const lbIdx = layout.blocks.findIndex((b) => b.block.id === topTableId);
  const lb = layout.blocks[lbIdx];
  if (!lb?.layoutTable) return undefined;

  // If the target is the top-level table itself, return directly
  if (topTableId === tableBlockId) {
    return {
      lb: { block: lb.block, layoutTable: lb.layoutTable, blockIndex: lbIdx },
      layoutTable: lb.layoutTable,
      dataBlock: lb.block,
      xOffset: 0,
      yOffset: 0,
      outerRowIndex: -1, // not applicable for top-level
    };
  }

  // Build the nesting path from outermost to target table
  const path: BlockCellInfo[] = [];
  let cur = tableBlockId;
  while (cur !== topTableId) {
    const info = layout.blockParentMap.get(cur);
    if (!info) return undefined;
    path.unshift(info);
    cur = info.tableBlockId;
  }

  let tl = lb.layoutTable;
  let dataBlock = lb.block;
  let xOffset = 0;
  let yOffset = 0;

  for (const seg of path) {
    const { rowIndex, colIndex } = seg;
    const cell = tl.cells[rowIndex]?.[colIndex];
    if (!cell || cell.merged) return undefined;

    const cellData = dataBlock.tableData?.rows[rowIndex]?.cells[colIndex];
    const cellPadding = cellData?.style.padding ?? 4;

    // Find the nested table line for this segment's target
    const targetId = seg === path[path.length - 1]
      ? tableBlockId
      : path[path.indexOf(seg) + 1].tableBlockId;

    let nestedLine: LayoutLine | undefined;
    let nestedLineIdx = -1;
    for (let li = 0; li < cell.lines.length; li++) {
      if (cell.lines[li].nestedTable) {
        let bi = 0;
        for (let b = cell.blockBoundaries.length - 1; b >= 0; b--) {
          if (li >= cell.blockBoundaries[b]) { bi = b; break; }
        }
        if (cellData?.blocks[bi]?.id === targetId) {
          nestedLine = cell.lines[li];
          nestedLineIdx = li;
          break;
        }
      }
    }
    if (!nestedLine?.nestedTable || nestedLineIdx < 0) return undefined;

    // Use computeMergedCellLineLayouts for accurate Y positioning that
    // accounts for merged-row redistribution and vertical alignment.
    const rowSpan = cellData?.rowSpan ?? 1;
    const lineLayouts = computeMergedCellLineLayouts(
      cell.lines, rowIndex, rowSpan, cellPadding,
      tl.rowYOffsets, tl.rowHeights,
    );
    const ll = lineLayouts[nestedLineIdx];

    xOffset += tl.columnXOffsets[colIndex] + cellPadding;
    yOffset += ll ? ll.runLineY : (tl.rowYOffsets[rowIndex] + cellPadding + nestedLine.y);

    const nextBlock = cellData?.blocks.find((b) => b.id === targetId);
    if (!nextBlock?.tableData) return undefined;
    tl = nestedLine.nestedTable;
    dataBlock = nextBlock;
  }

  return {
    lb: { block: lb.block, layoutTable: lb.layoutTable, blockIndex: lbIdx },
    layoutTable: tl,
    dataBlock,
    xOffset,
    yOffset,
    outerRowIndex: path[0].rowIndex,
  };
}
