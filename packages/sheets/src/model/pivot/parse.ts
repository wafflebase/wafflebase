import { toSref } from '../core/coordinates';
import type { Grid, PivotRecord, Range } from '../core/types';

/**
 * `parseSourceData` extracts headers and records from a grid within the given range.
 *
 * - The first row of the range is treated as headers.
 * - Remaining rows become records (arrays of string values).
 * - Empty cells are represented as ''.
 * - Trailing rows where all values are '' are trimmed.
 */
export function parseSourceData(
  grid: Grid,
  range: Range,
): { headers: string[]; records: PivotRecord[] } {
  const [from, to] = range;

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

  return { headers, records };
}
