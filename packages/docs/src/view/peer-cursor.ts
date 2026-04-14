import type { DocPosition, DocRange } from '../model/types.js';
import { LIST_INDENT_PX } from '../model/types.js';
import type { PaginatedLayout } from './pagination.js';
import { findPageForPosition, getPageYOffset, getPageXOffset } from './pagination.js';
import type { DocumentLayout } from './layout.js';
import { buildFont, Theme } from './theme.js';
import { computeMergedCellLineLayouts } from './table-renderer.js';

/**
 * Represents a remote peer's cursor for collaborative editing.
 */
export interface PeerCursor {
  clientID: string;
  position: DocPosition;
  color: string;
  username: string;
  labelVisible: boolean;
  selection?: DocRange;
}

/**
 * Pixel coordinates of a cursor position on the canvas.
 */
export interface PositionPixel {
  x: number;
  y: number;
  height: number;
}

/**
 * Shared coordinate calculation extracted from Cursor.getPixelPosition().
 * Resolves a document position to canvas pixel coordinates.
 *
 * @returns PositionPixel if the position can be resolved, undefined otherwise.
 */
export function resolvePositionPixel(
  position: DocPosition,
  lineAffinity: 'forward' | 'backward',
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
): PositionPixel | undefined {
  // --- Table cell cursor ---
  const cellInfo = layout.blockParentMap.get(position.blockId);
  if (cellInfo) {
    // Walk up the blockParentMap chain to find the top-level table and
    // collect the nesting path: [{tableBlockId, rowIndex, colIndex}, ...]
    // from outermost to innermost.
    const nestingPath: Array<{ tableBlockId: string; rowIndex: number; colIndex: number }> = [];
    nestingPath.push(cellInfo);
    let currentTableId = cellInfo.tableBlockId;
    while (true) {
      const parentInfo = layout.blockParentMap.get(currentTableId);
      if (!parentInfo) break; // currentTableId is a top-level block
      nestingPath.unshift(parentInfo);
      currentTableId = parentInfo.tableBlockId;
    }

    // currentTableId is now the top-level table block ID
    const lb = layout.blocks.find((b) => b.block.id === currentTableId);
    if (!lb?.layoutTable) return undefined;

    // Navigate down through nested LayoutTables to find the target cell
    let tl = lb.layoutTable;
    let xOffset = 0;
    let yOffsetInTable = 0;
    let dataBlock = lb.block;

    for (let ni = 0; ni < nestingPath.length; ni++) {
      const seg = nestingPath[ni];
      const { rowIndex, colIndex } = seg;
      const cell = tl.cells[rowIndex]?.[colIndex];
      if (!cell || cell.merged) return undefined;

      const cellData = dataBlock.tableData?.rows[rowIndex]?.cells[colIndex];
      const cellPadding = cellData?.style.padding ?? 4;

      if (ni < nestingPath.length - 1) {
        // Intermediate nesting level — find the nested table line and
        // accumulate coordinate offsets.
        const nextTableId = nestingPath[ni + 1].tableBlockId;
        let nestedTableLine: import('./layout.js').LayoutLine | undefined;
        let nestedLineIdx = -1;
        for (let li = 0; li < cell.lines.length; li++) {
          if (cell.lines[li].nestedTable) {
            // Find the block index for this line
            let blockIdx = 0;
            for (let bi = cell.blockBoundaries.length - 1; bi >= 0; bi--) {
              if (li >= cell.blockBoundaries[bi]) { blockIdx = bi; break; }
            }
            if (cellData?.blocks[blockIdx]?.id === nextTableId) {
              nestedTableLine = cell.lines[li];
              nestedLineIdx = li;
              break;
            }
          }
        }
        if (!nestedTableLine?.nestedTable || nestedLineIdx < 0) return undefined;

        // Accumulate X offset: cell origin + padding
        xOffset += tl.columnXOffsets[colIndex] + cellPadding;
        // Accumulate Y offset: row Y + cell padding + line Y within cell
        yOffsetInTable += tl.rowYOffsets[rowIndex] + cellPadding + nestedTableLine.y;

        // Descend into the nested table
        const nextBlock = cellData?.blocks.find((b) => b.id === nextTableId);
        if (!nextBlock?.tableData) return undefined;
        tl = nestedTableLine.nestedTable;
        dataBlock = nextBlock;
      } else {
        // Innermost level — resolve cursor position in this cell
        const rowSpan = cellData?.rowSpan ?? 1;
        const lineLayouts = computeMergedCellLineLayouts(
          cell.lines, rowIndex, rowSpan, cellPadding,
          tl.rowYOffsets, tl.rowHeights,
        );

        const cbi = cellData ? cellData.blocks.findIndex((b) => b.id === position.blockId) : 0;
        const effectiveCbi = cbi >= 0 ? cbi : 0;
        const startLine = cell.blockBoundaries[effectiveCbi] ?? 0;
        const endLine = cell.blockBoundaries[effectiveCbi + 1] ?? cell.lines.length;

        let cursorX = 0;
        let targetLineIdx = -1;
        let lineHeight = tl.rowHeights[rowIndex] ?? 20;
        let offsetRemaining = position.offset;

        for (let li = startLine; li < endLine; li++) {
          const line = cell.lines[li];
          let lineChars = 0;
          for (const run of line.runs) {
            lineChars += run.text.length;
          }
          if (offsetRemaining <= lineChars) {
            targetLineIdx = li;
            lineHeight = line.height;
            let chars = 0;
            for (const run of line.runs) {
              if (offsetRemaining <= chars + run.text.length) {
                const localOff = offsetRemaining - chars;
                if (run.imageHeight !== undefined) {
                  cursorX = run.x + (localOff > 0 ? run.width : 0);
                } else {
                  const textBefore = run.text.slice(0, localOff);
                  ctx.font = buildFont(
                    run.inline.style.fontSize, run.inline.style.fontFamily,
                    run.inline.style.bold, run.inline.style.italic,
                  );
                  cursorX = run.x + ctx.measureText(textBefore).width;
                }
                break;
              }
              chars += run.text.length;
            }
            break;
          }
          offsetRemaining -= lineChars;
        }

        if (targetLineIdx < 0) {
          targetLineIdx = Math.max(startLine, endLine - 1);
          const tailLine = cell.lines[targetLineIdx];
          if (tailLine) {
            lineHeight = tailLine.height;
            const lastRun = tailLine.runs[tailLine.runs.length - 1];
            cursorX = lastRun ? lastRun.x + lastRun.width : 0;
          }
        }

        const targetLayout = lineLayouts[targetLineIdx];
        if (!targetLayout) return undefined;
        const ownerRow = targetLayout.ownerRow;

        const blockIndex = layout.blocks.indexOf(lb);
        const pageX = getPageXOffset(paginatedLayout, canvasWidth);
        const { margins } = paginatedLayout.pageSetup;

        if (nestingPath.length === 1) {
          // Non-nested table cell — use the original cursor positioning
          // logic that finds the PageLine by ownerRow.
          let pageLine: import('./pagination.js').PageLine | undefined;
          let pageIndex = 0;
          for (const page of paginatedLayout.pages) {
            for (const pl of page.lines) {
              if (pl.blockIndex === blockIndex && pl.lineIndex === ownerRow) {
                pageLine = pl;
                pageIndex = page.pageIndex;
                break;
              }
            }
            if (pageLine) break;
          }
          if (!pageLine) return undefined;

          const pageY = getPageYOffset(paginatedLayout, pageIndex);
          const cellX = tl.columnXOffsets[colIndex] + cellPadding;
          const cursorYOnPage =
            pageY + pageLine.y + (targetLayout.runLineY - tl.rowYOffsets[ownerRow]);

          return {
            x: pageX + margins.left + cellX + cursorX,
            y: cursorYOnPage,
            height: lineHeight,
          };
        }

        // Nested table cell — find the PageLine for the outermost table's
        // row, then add accumulated Y offset from outer cells.
        const outerRowIndex = nestingPath[0].rowIndex;
        let pageLine: import('./pagination.js').PageLine | undefined;
        let pageIndex = 0;
        for (const page of paginatedLayout.pages) {
          for (const pl of page.lines) {
            if (pl.blockIndex === blockIndex && pl.lineIndex === outerRowIndex) {
              pageLine = pl;
              pageIndex = page.pageIndex;
              break;
            }
          }
          if (pageLine) break;
        }
        if (!pageLine) return undefined;

        const pageY = getPageYOffset(paginatedLayout, pageIndex);
        const innerCellX = tl.columnXOffsets[colIndex] + cellPadding;
        const innerCursorY = pageY + pageLine.y
          + yOffsetInTable
          + tl.rowYOffsets[ownerRow]
          + (targetLayout.runLineY - tl.rowYOffsets[ownerRow]);

        return {
          x: pageX + margins.left + xOffset + innerCellX + cursorX,
          y: innerCursorY,
          height: lineHeight,
        };
      }
    }
    return undefined;
  }

  // --- Regular (non-table) cursor ---
  const lb = layout.blocks.find((b) => b.block.id === position.blockId);
  const found = findPageForPosition(
    paginatedLayout, position.blockId, position.offset, layout, lineAffinity,
  );
  if (!found) return undefined;

  const { pageIndex, pageLine } = found;
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const pageY = getPageYOffset(paginatedLayout, pageIndex);
  if (!lb) return undefined;

  // Count chars before this line
  let charsBeforeLine = 0;
  for (let li = 0; li < pageLine.lineIndex; li++) {
    for (const r of lb.lines[li].runs) {
      charsBeforeLine += r.charEnd - r.charStart;
    }
  }
  const lineOffset = position.offset - charsBeforeLine;

  let charCount = 0;
  for (const run of pageLine.line.runs) {
    const runLength = run.charEnd - run.charStart;
    if (lineOffset >= charCount && lineOffset <= charCount + runLength) {
      const localOffset = lineOffset - charCount;
      let xOffset: number;
      if (run.imageHeight !== undefined) {
        // Image run: use display width, not measureText of the placeholder char
        xOffset = localOffset > 0 ? run.width : 0;
      } else {
        const textBefore = run.text.slice(0, localOffset);
        const isSuperOrSub = run.inline.style.superscript || run.inline.style.subscript;
        const measureFontSize = isSuperOrSub
          ? (run.inline.style.fontSize ?? Theme.defaultFontSize) * 0.6
          : run.inline.style.fontSize;
        ctx.font = buildFont(
          measureFontSize, run.inline.style.fontFamily,
          run.inline.style.bold, run.inline.style.italic,
        );
        xOffset = ctx.measureText(textBefore).width;
      }
      const x = pageX + pageLine.x + run.x + xOffset;
      return { x, y: pageY + pageLine.y, height: pageLine.line.height };
    }
    charCount += runLength;
  }

  // Fallback: end of line
  const lastRun = pageLine.line.runs[pageLine.line.runs.length - 1];
  if (lastRun) {
    return {
      x: pageX + pageLine.x + lastRun.x + lastRun.width,
      y: pageY + pageLine.y,
      height: pageLine.line.height,
    };
  }
  // Empty line — compute effective marginLeft (includes list indent)
  let marginLeft = lb.block.style.marginLeft ?? 0;
  if (lb.block.type === 'list-item') {
    marginLeft += LIST_INDENT_PX * ((lb.block.listLevel ?? 0) + 1);
  }
  return { x: pageX + pageLine.x + marginLeft, y: pageY + pageLine.y, height: pageLine.line.height };
}

/**
 * Draw a 2px colored vertical caret for a peer cursor.
 */
export function drawPeerCaret(
  ctx: CanvasRenderingContext2D,
  pixel: PositionPixel,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(pixel.x, pixel.y, 2, pixel.height);
}

/**
 * Returns black or white text color based on background luminance.
 */
function getLabelTextColor(bgColor: string): string {
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6 ? '#000000' : '#FFFFFF';
}

/**
 * Draw a username label tag near a peer cursor caret.
 *
 * The tag is a rounded rectangle filled with `color`, with text color
 * chosen automatically for contrast (white on dark, black on light).
 * When the tag would overflow the top of the page it flips below the caret.
 * When it would overflow the right edge of the canvas it shifts left.
 * Long usernames are truncated with an ellipsis (U+2026).
 *
 * @param ctx         - 2-D canvas context to draw into.
 * @param pixel       - Resolved pixel position of the caret.
 * @param username    - Display name for the peer.
 * @param color       - Hex/CSS color string for the tag background.
 * @param pageTopY    - Absolute Y of the top of the current page (used for flip logic).
 * @param canvasWidth - Total canvas width (used for right-edge clamping).
 */
export function drawPeerLabel(
  ctx: CanvasRenderingContext2D,
  pixel: PositionPixel,
  username: string,
  color: string,
  pageTopY: number,
  canvasWidth: number,
  stackIndex: number = 0,
): void {
  const fontSize = 11;
  const paddingX = 4;
  const paddingY = 2;
  const maxWidth = 120;
  const radius = 2;

  ctx.font = `${fontSize}px sans-serif`;
  let displayName = username;
  let textWidth = ctx.measureText(displayName).width;

  if (textWidth > maxWidth) {
    while (textWidth > maxWidth && displayName.length > 1) {
      displayName = displayName.slice(0, -1);
      textWidth = ctx.measureText(displayName + '\u2026').width;
    }
    displayName += '\u2026';
    textWidth = ctx.measureText(displayName).width;
  }

  const tagWidth = textWidth + paddingX * 2;
  const tagHeight = fontSize + paddingY * 2;

  let x = pixel.x;
  let y = pixel.y - tagHeight - stackIndex * (tagHeight + 1);

  // Flip label below caret if it would overflow the top of the page
  if (y < pageTopY) {
    y = pixel.y + pixel.height + stackIndex * (tagHeight + 1);
  }

  // Clamp x if label overflows canvas right edge
  if (x + tagWidth > canvasWidth) {
    x = canvasWidth - tagWidth;
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + tagWidth - radius, y);
  ctx.arcTo(x + tagWidth, y, x + tagWidth, y + radius, radius);
  ctx.lineTo(x + tagWidth, y + tagHeight);
  ctx.lineTo(x, y + tagHeight);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = getLabelTextColor(color);
  ctx.textBaseline = 'top';
  ctx.fillText(displayName, x + paddingX, y + paddingY);
}
