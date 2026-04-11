import type { Doc } from '../model/document.js';
import type {
  BlockCellInfo,
  CellAddress,
  CellRange,
  DocPosition,
  DocRange,
} from '../model/types.js';

export type TableMergeContext =
  | { state: 'none' }
  | { state: 'canMerge'; tableBlockId: string; range: CellRange }
  | { state: 'canUnmerge'; tableBlockId: string; cell: CellAddress };

/**
 * Decide which merge action (if any) the context menu should offer.
 *
 * Rules:
 *  - Cursor outside a table → none.
 *  - Active cell range covering ≥ 2 cells → canMerge (range from selection).
 *    Wins over canUnmerge so a user can grow an existing merge.
 *  - Cursor in a cell with `colSpan > 1` or `rowSpan > 1` → canUnmerge.
 *  - Otherwise → none.
 *
 * Pure: no DOM, no editor reference. Reads only `doc`, the parent map, the
 * cursor position, and the selection range.
 */
export function computeTableMergeContext(
  doc: Doc,
  blockParentMap: Map<string, BlockCellInfo>,
  cursorPos: DocPosition,
  selectionRange: DocRange | null,
): TableMergeContext {
  const cellInfo = blockParentMap.get(cursorPos.blockId);
  if (!cellInfo) return { state: 'none' };

  const tableBlockId = cellInfo.tableBlockId;
  const cr = selectionRange?.tableCellRange;
  if (cr && cr.blockId === tableBlockId) {
    const rowSpan = Math.abs(cr.end.rowIndex - cr.start.rowIndex) + 1;
    const colSpan = Math.abs(cr.end.colIndex - cr.start.colIndex) + 1;
    if (rowSpan * colSpan >= 2) {
      return {
        state: 'canMerge',
        tableBlockId,
        range: {
          start: {
            rowIndex: Math.min(cr.start.rowIndex, cr.end.rowIndex),
            colIndex: Math.min(cr.start.colIndex, cr.end.colIndex),
          },
          end: {
            rowIndex: Math.max(cr.start.rowIndex, cr.end.rowIndex),
            colIndex: Math.max(cr.start.colIndex, cr.end.colIndex),
          },
        },
      };
    }
  }

  const tableData = doc.getBlock(tableBlockId).tableData;
  const cell = tableData?.rows[cellInfo.rowIndex]?.cells[cellInfo.colIndex];
  if (cell && ((cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1)) {
    return {
      state: 'canUnmerge',
      tableBlockId,
      cell: { rowIndex: cellInfo.rowIndex, colIndex: cellInfo.colIndex },
    };
  }

  return { state: 'none' };
}
