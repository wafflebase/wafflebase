import { toSref } from '../core/coordinates';
import type {
  CellStyle,
  Grid,
  PivotCellFormat,
  PivotRecord,
  Range,
} from '../core/types';

/**
 * Extract the format-only subset of a cell style, or undefined when the cell
 * has no number format applied.
 */
function extractFormat(style?: CellStyle): PivotCellFormat | undefined {
  if (!style || !style.nf) {
    return undefined;
  }
  const format: PivotCellFormat = { nf: style.nf };
  if (style.dp !== undefined) format.dp = style.dp;
  if (style.cu !== undefined) format.cu = style.cu;
  return format;
}

/**
 * `parseSourceData` extracts headers, records, and per-column formats from a
 * grid within the given range.
 *
 * - The first row of the range is treated as headers.
 * - Remaining rows become records (arrays of string values).
 * - Empty cells are represented as ''.
 * - Trailing rows where all values are '' are trimmed.
 * - `columnFormats[i]` is the number format of source column `i`, taken from
 *   the first data cell in that column that carries one (so a date/currency
 *   column's format can be inherited by pivot labels and values). The grid's
 *   cell styles are expected to be the resolved effective styles (including
 *   range/row/column layers), built by the caller.
 */
export function parseSourceData(
  grid: Grid,
  range: Range,
): {
  headers: string[];
  records: PivotRecord[];
  columnFormats: (PivotCellFormat | undefined)[];
} {
  const [from, to] = range;

  const colCount = to.c - from.c + 1;
  const columnFormats: (PivotCellFormat | undefined)[] = new Array(
    colCount,
  ).fill(undefined);

  // Extract headers from the first row of the range.
  const headers: string[] = [];
  for (let c = from.c; c <= to.c; c++) {
    const cell = grid.get(toSref({ r: from.r, c }));
    headers.push(cell?.v ?? '');
  }

  // Extract records from the remaining rows.
  const records: PivotRecord[] = [];
  for (let r = from.r + 1; r <= to.r; r++) {
    const row: string[] = [];
    for (let c = from.c; c <= to.c; c++) {
      const cell = grid.get(toSref({ r, c }));
      row.push(cell?.v ?? '');

      // Capture the first defined format per column from its data cells.
      const ci = c - from.c;
      if (columnFormats[ci] === undefined) {
        columnFormats[ci] = extractFormat(cell?.s);
      }
    }
    records.push(row);
  }

  // Trim trailing empty rows (where all values are '').
  while (records.length > 0) {
    const last = records[records.length - 1];
    if (last.every((v) => v === '')) {
      records.pop();
    } else {
      break;
    }
  }

  return { headers, records, columnFormats };
}
