import type { Doc } from '../model/document.js';
import type {
  BlockCellInfo,
  CellAddress,
  CellRange,
  DocPosition,
  DocRange,
} from '../model/types.js';
import { expandCellRangeForMerges } from './selection.js';

export type TableMergeContext =
  | { state: 'none' }
  | { state: 'canMerge'; tableBlockId: string; range: CellRange }
  | { state: 'canUnmerge'; tableBlockId: string; cell: CellAddress };

/**
 * Decide which merge action (if any) the context menu should offer.
 *
 * Rules:
 *  - Cursor outside a table → none.
 *  - Active cell range covering ≥ 2 cells → canMerge (range from selection,
 *    expanded so any merged cell it touches is fully contained).
 *    Wins over canUnmerge so a user can grow an existing merge.
 *  - Cursor in a cell with `colSpan > 1` or `rowSpan > 1` → canUnmerge.
 *  - Otherwise → none.
 *
 * The selection range is expanded here as a defensive measure. The drag and
 * Shift+Arrow handlers already call `expandCellRangeForMerges` at write
 * time, but programmatic `Selection.setRange()` callers are not required
 * to; this read-path expansion keeps the menu state consistent even when a
 * raw range partially overlaps a merged cell.
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
  const tableData = doc.getBlock(tableBlockId).tableData;
  const cr = selectionRange?.tableCellRange;
  if (cr && cr.blockId === tableBlockId && tableData) {
    // Expand the range so any merged cell it touches is fully contained.
    // `expandCellRangeForMerges` also orders start/end and skips over
    // covered cells, so downstream consumers can treat the returned
    // rectangle as canonical.
    const expanded = expandCellRangeForMerges(cr, tableData);
    const rows = expanded.end.rowIndex - expanded.start.rowIndex + 1;
    const cols = expanded.end.colIndex - expanded.start.colIndex + 1;
    if (rows * cols >= 2) {
      return {
        state: 'canMerge',
        tableBlockId,
        range: { start: expanded.start, end: expanded.end },
      };
    }
  }

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
