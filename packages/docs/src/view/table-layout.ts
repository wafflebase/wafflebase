import type { TableData, Block, BlockCellInfo } from '../model/types.js';
import { LIST_INDENT_PX } from '../model/types.js';
import type { LayoutLine } from './layout.js';
import { applyAlignment, assignLineHeights, layoutBlock } from './layout.js';
import { ptToPx, Theme } from './theme.js';
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
 * Layout blocks within a table cell into wrapped lines.
 * Mirrors the body-side path in `computeLayout`: list indent is merged
 * into `marginLeft`, then the shared `layoutBlock` produces lines.
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

    if (block.type === 'table' && block.tableData) {
      const nestedLayout = computeTableLayout(
        block.tableData,
        block.id,
        ctx,
        maxWidth,
      );
      if (blockParentMap) {
        for (const [k, v] of nestedLayout.blockParentMap) {
          blockParentMap.set(k, v);
        }
      }
      allLines.push({
        runs: [],
        y: 0,
        height: nestedLayout.totalHeight,
        width: nestedLayout.totalWidth,
        nestedTable: nestedLayout,
      });
      continue;
    }

    const listIndent =
      block.type === 'list-item'
        ? LIST_INDENT_PX * ((block.listLevel ?? 0) + 1)
        : 0;
    const effectiveBlock: Block = listIndent === 0
      ? block
      : {
          ...block,
          style: {
            ...block.style,
            marginLeft: (block.style.marginLeft ?? 0) + listIndent,
          },
        };

    const blockLines = layoutBlock(effectiveBlock, ctx, maxWidth);
    assignLineHeights(blockLines, effectiveBlock);

    const alignWidth = maxWidth - (effectiveBlock.style.marginLeft ?? 0);
    const alignment = effectiveBlock.style.alignment ?? 'left';
    for (let li = 0; li < blockLines.length; li++) {
      applyAlignment(
        blockLines[li],
        alignWidth,
        alignment,
        li === blockLines.length - 1,
      );
    }

    allLines.push(...blockLines);
  }

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

        // Ensure every receiving row has enough height for the content
        // already assigned to it (not just the last row).
        const needed = yInRow + padding;
        if (needed > rowHeights[curRow]) {
          rowHeights[curRow] = needed;
        }
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

/**
 * Find the maximum safe split height for a table row given the available space.
 * Returns 0 if no safe split is possible (row stays atomic).
 *
 * A split at height H is safe when, for every non-merged cell in the row,
 * H falls exactly at a line boundary (never mid-line). Because different
 * cells have different line heights, the function clamps to each cell's
 * largest breakpoint <= availableHeight and returns the minimum across cells.
 */
export function findRowSplitHeight(
  layout: LayoutTable,
  rowIndex: number,
  availableHeight: number,
  tableData?: import('../model/types.js').TableData,
): number {
  const cells = layout.cells[rowIndex];
  if (!cells || cells.length === 0) return 0;

  let minSafe = availableHeight;
  let hasCells = false;

  for (let c = 0; c < cells.length; c++) {
    const cell = cells[c];
    if (cell.merged) continue;
    hasCells = true;

    const padding = tableData?.rows[rowIndex]?.cells[c]?.style?.padding ?? DEFAULT_CELL_PADDING;

    // Use the layout engine's actual line.y values (which include any
    // block margins and spacing) instead of re-summing heights manually.
    // Breakpoints are at padding + line.y + line.height for each line.
    let bestBp = 0;
    let allFit = true;
    for (const line of cell.lines) {
      const lineEnd = padding + line.y + line.height;
      if (line.nestedTable) {
        // Recurse into nested table: each row boundary is a breakpoint
        const nt = line.nestedTable;
        const ntBase = padding + line.y; // Y of nested table top within row
        for (let nr = 0; nr < nt.rowHeights.length; nr++) {
          const rowEnd = ntBase + nt.rowYOffsets[nr] + nt.rowHeights[nr];
          if (rowEnd <= availableHeight) {
            bestBp = rowEnd;
          } else {
            const nestedAvail = availableHeight - ntBase - nt.rowYOffsets[nr];
            if (nestedAvail > 0) {
              const innerSplit = findRowSplitHeight(nt, nr, nestedAvail);
              if (innerSplit > 0) {
                bestBp = ntBase + nt.rowYOffsets[nr] + innerSplit;
              }
            }
            allFit = false;
            break;
          }
        }
      } else {
        if (lineEnd <= availableHeight) {
          bestBp = lineEnd;
        } else {
          allFit = false;
        }
      }
      if (!allFit) break;
    }
    if (!allFit) {
      minSafe = Math.min(minSafe, bestBp);
    }
    // When allFit, this cell's content ends before availableHeight,
    // so splitting at any height >= bestBp is safe — no constraint.
  }

  return hasCells ? minSafe : 0;
}
